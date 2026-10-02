import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WERSJA } from '../src/klient.js';
import { NARZEDZIA } from '../src/narzedzia/index.js';
import { druk } from '../src/narzedzia/legislacja.js';
import { glosowanie } from '../src/narzedzia/glosowania.js';
import { ZrodloZFikstur } from './pomoc.js';

const czytaj = (p: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', p), 'utf8'));

describe('pakiet', () => {
  it('wersja jest ta sama w package.json, server.json i w kodzie', () => {
    const pkg = czytaj('package.json');
    const srv = czytaj('server.json');
    expect(WERSJA).toBe(pkg.version);
    expect(srv.version).toBe(pkg.version);
    expect(srv.packages[0].version).toBe(pkg.version);
    expect(srv.name).toBe(pkg.mcpName);
  });

  it('wtyczka uruchamia pakiet przypięty do bieżącej wersji (katalog wtyczek odrzuca npx bez wersji)', () => {
    const pkg = czytaj('package.json');
    expect(czytaj('plugin/.mcp.json').mcpServers.sejm.args).toEqual(['-y', `${pkg.name}@${pkg.version}`]);
    expect(czytaj('plugin/.claude-plugin/plugin.json').version).toBe(pkg.version);
  });

  it('opis w server.json mieści się w limicie rejestru MCP (100 znaków)', () => {
    expect([...czytaj('server.json').description].length).toBeLessThanOrEqual(100);
  });

  it('licencja Apache-2.0 jest ta sama w package.json, wtyczce, paczce .mcpb i pliku LICENSE', () => {
    const pkg = czytaj('package.json');
    expect(pkg.license).toBe('Apache-2.0');
    expect(czytaj('plugin/.claude-plugin/plugin.json').license).toBe('Apache-2.0');
    const tekst = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
    expect(tekst('skrypty/pakuj-mcpb.mjs')).toContain("license: 'Apache-2.0'");
    expect(tekst('LICENSE')).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'LICENSE', 'NOTICE', 'README.md']));
  });

  it('server.json wskazuje ten sam pakiet npm co package.json', () => {
    const pkg = czytaj('package.json');
    const npm = czytaj('server.json').packages.find((p: { registryType: string }) => p.registryType === 'npm');
    expect(npm.identifier).toBe(pkg.name);
    expect(npm.registryBaseUrl).toBe('https://registry.npmjs.org');
  });

  it('manifest .mcpb: Node jak w engines, działająca strona domowa, opisy narzędzi nieurwane w pół zdania', async () => {
    const tekst = readFileSync(join(import.meta.dirname, '..', 'skrypty/pakuj-mcpb.mjs'), 'utf8');
    expect(czytaj('package.json').engines.node).toBe('>=22');
    expect(tekst).toContain("runtimes: { node: '>=22.0.0' }");
    expect(tekst).toContain("homepage: 'https://leniwyposel.pl/dla-developerow/'");
    // @ts-expect-error moduł .mjs bez deklaracji typów
    const { pierwszeZdanie } = await import('../skrypty/opis-narzedzia.mjs');
    expect(pierwszeZdanie('Grupy (np. Polsko-Ukraińska): lista. Druga część.')).toBe('Grupy (np. Polsko-Ukraińska): lista.');
    expect(pierwszeZdanie('W porcjach po 12 tys. znaków. Dalej.')).toBe('W porcjach po 12 tys. znaków.');
    expect(pierwszeZdanie('Kluby (klub, koło). Z parametrem klub.')).toBe('Kluby (klub, koło).');
    expect(pierwszeZdanie('Bez kropki na końcu zdania (np. Sejm')).toBe('Bez kropki na końcu zdania (np. Sejm');
    for (const n of NARZEDZIA) {
      const z = pierwszeZdanie(n.opis) as string;
      expect(n.opis.startsWith(z), n.nazwa).toBe(true);
      expect(z, n.nazwa).not.toMatch(/\b(np|tys|ok|m\.in|tzw|art)\.$/);
      expect(z === n.opis.trim() || /[.)”"]\.?$/.test(z), n.nazwa).toBe(true);
    }
  });

  it('zależności uruchomieniowe są przypięte dokładnie', () => {
    for (const v of Object.values(czytaj('package.json').dependencies)) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('odporność narzędzi', () => {
  it('druk z nazwą pliku wymagającą kodowania nie wywraca narzędzia', async () => {
    const z = new ZrodloZFikstur({ 'term10/prints/1': 'druk-1.json' });
    const zmieniony = { ...z, json: async () => ({ number: '1', title: 't', attachments: ['1 a.pdf', 'ł.docx'] }) };
    const w = await druk.wykonaj(druk.wejscie.parse({ numer: '1' }), Object.assign(z, zmieniony));
    expect(w.pliki).toEqual([
      'https://api.sejm.gov.pl/sejm/term10/prints/1/1%20a.pdf',
      'https://api.sejm.gov.pl/sejm/term10/prints/1/%C5%82.docx',
    ]);
  });

  it('nieznany głos na liście imiennej: bez rozbicia na kluby, ale z odpowiedzią', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/10/1': 'glosowanie-10-1.json' });
    const oryg = z.json.bind(z);
    z.json = (async (s: string) => {
      const g = (await oryg(s)) as { votes: Array<{ vote: string }> };
      g.votes[0].vote = 'COŚ_NOWEGO';
      return g;
    }) as typeof z.json;
    const w = await glosowanie.wykonaj(glosowanie.wejscie.parse({ posiedzenie: 10, numer: 1 }), z);
    expect(w.kluby).toBeNull();
    expect(w.wynik).toBe('Przyjęto');
    expect(w.uwagi?.[0]).toMatch(/Rozbicia na kluby nie policzono/);
  });
});
