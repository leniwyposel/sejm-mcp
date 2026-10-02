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
  while (wyjscie.split('\n').filter(Boolean).length < oczekiwane && Date.now() - start < 10_000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill();
  return wyjscie.split('\n').filter(Boolean).map((l) => JSON.parse(l));
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
});
