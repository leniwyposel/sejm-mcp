import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NARZEDZIA } from '../src/narzedzia/index.js';
import { GOTOWE_PYTANIA, klubyWGlosowaniu, posel } from '../src/pytania.js';

/** Przykładowe argumenty, żeby każdy tekst dało się złożyć. Nazwisko jest celowo zmyślone. */
const PRZYKLAD: Record<string, string> = { posel: 'Xawery Testowy', ustawa: 'ochrona przyrody', posiedzenie: '66', numer: '3', akt: 'Kodeks pracy' };

function tekstDla(p: (typeof GOTOWE_PYTANIA)[number]): string {
  const ksztalt = p.argumenty?.shape ?? {};
  const a = Object.fromEntries(Object.keys(ksztalt).map((k) => [k, PRZYKLAD[k]]));
  return p.tresc(p.argumenty ? p.argumenty.parse(a) : {});
}

describe('gotowe pytania (MCP prompts)', () => {
  it('jest ich od czterech do sześciu, z unikalnymi nazwami i polskim tytułem w formie pytania', () => {
    expect(GOTOWE_PYTANIA.length).toBeGreaterThanOrEqual(4);
    expect(GOTOWE_PYTANIA.length).toBeLessThanOrEqual(6);
    expect(new Set(GOTOWE_PYTANIA.map((p) => p.nazwa)).size).toBe(GOTOWE_PYTANIA.length);
    for (const p of GOTOWE_PYTANIA) {
      expect(p.nazwa).toMatch(/^[a-z_]+$/);
      expect(p.tytul).toMatch(/\?$/);
      expect(p.opis.length).toBeGreaterThan(20);
    }
  });

  it('każde wymienione narzędzie istnieje i tekst je wymienia', () => {
    const nazwy = new Set(NARZEDZIA.map((n) => n.nazwa));
    for (const p of GOTOWE_PYTANIA) {
      const t = tekstDla(p);
      for (const n of p.narzedzia) {
        expect(nazwy.has(n), `${p.nazwa}: ${n}`).toBe(true);
        expect(t, `${p.nazwa}: ${n}`).toContain(n);
      }
    }
  });

  it('każdy tekst każe podać źródło i nie dopisywać niczego z pamięci', () => {
    for (const p of GOTOWE_PYTANIA) {
      const t = tekstDla(p);
      expect(t).toMatch(/pola zrodla/);
      expect(t).toMatch(/z pamięci/);
      expect(t).not.toMatch(/—/);
    }
  });

  it('w tekstach nie ma nazwisk posłów', () => {
    const lista = JSON.parse(readFileSync(join(import.meta.dirname, 'fikstury/mp-lista.json'), 'utf8')) as Array<{ lastName: string }>;
    for (const p of GOTOWE_PYTANIA) {
      // Same szablony: przykładowe argumenty wycięte.
      const t = Object.values(PRZYKLAD).reduce((x, v) => x.replaceAll(v, ''), `${p.tytul} ${p.opis} ${tekstDla(p)}`);
      for (const { lastName } of lista) expect(t, `${p.nazwa}: ${lastName}`).not.toContain(lastName);
      // Dwa słowa z wielkiej litery obok siebie to zwykle imię i nazwisko; dozwolone tylko nazwy instytucji.
      const pary = [...t.matchAll(/\b\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+/gu)].map((m) => m[0]);
      expect(pary.filter((x) => !['Dzienniku Ustaw', 'Sprawdź to'].includes(x)), p.nazwa).toEqual([]);
    }
  });

  it('argumenty: wymagane, przycięte, numery tylko z cyfr', () => {
    expect(posel.argumenty!.safeParse({}).success).toBe(false);
    expect(posel.argumenty!.safeParse({ posel: ' ' }).success).toBe(false);
    expect(posel.argumenty!.safeParse({ posel: 'x'.repeat(101) }).success).toBe(false);
    expect(posel.argumenty!.parse({ posel: '  Xawery Testowy ' }).posel).toBe('Xawery Testowy');
    expect(klubyWGlosowaniu.argumenty!.safeParse({ posiedzenie: '66', numer: '3' }).success).toBe(true);
    expect(klubyWGlosowaniu.argumenty!.safeParse({ posiedzenie: '66/3', numer: '3' }).success).toBe(false);
    expect(klubyWGlosowaniu.argumenty!.safeParse({ posiedzenie: '66' }).success).toBe(false);
  });

  it('tekst wstawia argumenty tam, gdzie trzeba', () => {
    const t = klubyWGlosowaniu.tresc({ posiedzenie: '66', numer: '3' });
    expect(t).toMatch(/^Jak głosowały kluby w głosowaniu nr 3 na 66\. posiedzeniu Sejmu\?/);
    expect(t).toContain('posiedzenie=66 i numer=3');
  });
});
