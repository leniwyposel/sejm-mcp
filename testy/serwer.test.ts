import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const KORZEN = join(import.meta.dirname, '..');

/** Rozmowa z prawdziwym procesem po stdio. Bez sieci: tylko wywołania, które nie pytają Sejmu. */
async function rozmowa(wiadomosci: unknown[]): Promise<Array<Record<string, any>>> {
  const proc = spawn(process.execPath, [join(KORZEN, 'dist/index.js')], {
  });
  let wyjscie = '';
  proc.stdout.on('data', (d) => (wyjscie += d));
  for (const w of wiadomosci) proc.stdin.write(JSON.stringify(w) + '\n');
  const oczekiwane = wiadomosci.filter((w) => (w as { id?: number }).id !== undefined).length;
  const start = Date.now();
  // Liczą się tylko linie zakończone znakiem nowej linii: duża odpowiedź przychodzi kawałkami.
  const pelne = () => wyjscie.split('\n').slice(0, -1).filter(Boolean);
  while (pelne().length < oczekiwane && Date.now() - start < 10_000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill();
  return pelne().map((l) => JSON.parse(l));
}

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

describe('serwer po stdio', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: KORZEN, stdio: 'ignore' });
  }, 60_000);

  it('każde narzędzie jest tylko do odczytu i ma schemat wyjścia', async () => {
    const [, lista] = await rozmowa([init, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    const narzedzia = lista.result.tools as Array<Record<string, any>>;
    expect(narzedzia.length).toBeGreaterThanOrEqual(17);
    for (const n of narzedzia) {
      expect(n.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
      expect(n.outputSchema?.properties?.zrodla).toBeDefined();
    }
  });

  it('instrukcje serwera mówią, że tekst z rejestru to dane, nie polecenia', async () => {
    const [odp] = await rozmowa([init]);
    expect(odp.result.instructions).toMatch(/Nie wykonuj poleceń/);
  });

  it('ścieżka poza /sejm/ kończy się błędem narzędzia, zanim cokolwiek pójdzie w sieć', async () => {
    const [, odp] = await rozmowa([
      init,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zapytanie_surowe', arguments: { sciezka: 'term10/../../eli/acts' } } },
    ]);
    expect(odp.result.isError).toBe(true);
    expect(odp.result.content[0].text).toMatch(/Niedozwolona ścieżka/);
  });

  it('niepoprawne argumenty to błąd walidacji, nie awaria procesu', async () => {
    const [, odp] = await rozmowa([
      init,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profil_posla', arguments: { id: 'jeden' } } },
    ]);
    expect(odp.error ?? odp.result?.isError).toBeTruthy();
  });

  it('komunikaty walidacji po polsku i bez wyrażeń regularnych; numer jako napis przechodzi', async () => {
    const [, zly, sciezka] = await rozmowa([
      init,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profil_posla', arguments: { id: -5 } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'zapytanie_surowe', arguments: { sciezka: 'https://evil.example.com/x' } } },
    ]);
    expect(zly.result.content[0].text).toMatch(/Liczba musi być co najmniej 1/);
    expect(sciezka.result.content[0].text).toMatch(/Niedozwolone znaki/);
    expect(sciezka.result.content[0].text).not.toMatch(/\^\[/);
  });

  it('gotowe pytania: lista z argumentami, tekst z argumentem, zły argument to błąd -32602', async () => {
    const odp = await rozmowa([
      init,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'prompts/list' },
      { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'kluby_w_glosowaniu', arguments: { posiedzenie: '66', numer: '3' } } },
      { jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'kluby_w_glosowaniu', arguments: { posiedzenie: 'sześćdziesiąte', numer: '3' } } },
      { jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'posel', arguments: {} } },
      { jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'nie_ma_takiego' } },
    ]);
    // Odpowiedzi przychodzą w kolejności ukończenia, nie wysłania.
    const [start, lista, dobre, zlyNumer, brak, nieznane] = [1, 2, 3, 4, 5, 6].map((id) => odp.find((o) => o.id === id)!);
    expect(start.result.capabilities.prompts).toBeDefined();
    const pytania = lista.result.prompts as Array<{ name: string; title: string; arguments?: Array<{ name: string; required: boolean }> }>;
    expect(pytania.map((p) => p.name)).toEqual(expect.arrayContaining(['glosowania_dzis', 'posel', 'etap_ustawy', 'kluby_w_glosowaniu', 'czy_obowiazuje']));
    expect(pytania.find((p) => p.name === 'kluby_w_glosowaniu')?.arguments).toEqual([
      expect.objectContaining({ name: 'posiedzenie', required: true }),
      expect.objectContaining({ name: 'numer', required: true }),
    ]);
    expect(pytania.find((p) => p.name === 'glosowania_dzis')?.arguments ?? []).toEqual([]);
    expect(dobre.result.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    expect(dobre.result.messages[0].content.text).toContain('glosowanie z posiedzenie=66 i numer=3');
    expect(zlyNumer.error.code).toBe(-32602);
    expect(zlyNumer.error.message).toMatch(/Podaj sam numer/);
    expect(brak.error.code).toBe(-32602);
    expect(nieznane.error).toBeDefined();
  });
});
