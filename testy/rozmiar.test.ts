import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NARZEDZIA } from '../src/narzedzia/index.js';
import { posiedzeniaKomisji } from '../src/narzedzia/posiedzenia.js';
import { transmisje } from '../src/narzedzia/izba.js';
import { znajdzPosla } from '../src/narzedzia/poslowie.js';
import { narzedzie, type Narzedzie, type Wynik } from '../src/narzedzia/wspolne.js';
import { przytnij, SUFIT_ZNAKOW } from '../src/rozmiar.js';
import { odpowiedz, utworzSerwer } from '../src/serwer.js';
import { ZrodloZFikstur } from './pomoc.js';

const TERAZ = new Date('2026-10-02T10:00:00Z');
const nazwy = (n: Narzedzie<any>) => Object.keys((n.wejscie as { shape?: object }).shape ?? {});
const wejscie = <S extends z.ZodType>(s: S, x: unknown) => s.parse(x) as z.infer<S>;

/** Wynik o wiele za duży: długa lista z zagnieżdżonymi listami i długimi napisami, plus jeden ogromny napis. */
function olbrzym(): Wynik {
  return {
    odpowiedz: 'Znaleziono 3000 pozycji.',
    pozycje: Array.from({ length: 3000 }, (_, i) => ({
      numer: i + 1,
      tytul: `Pozycja ${i + 1}: ${'ustawa o zmianie ustawy '.repeat(4)}`,
      glosy: Array.from({ length: 5 }, (_, j) => ({ j, opis: 'za przeciw wstrzymał się' })),
    })),
    tekst: 'Słowo '.repeat(20_000),
    nastepnePrzesuniecie: 3000,
    pokazano: '1–3000 z 9000',
    zrodla: ['https://api.sejm.gov.pl/sejm/term10/x'],
    uwagi: ['Uwaga testowa.'],
  };
}

describe('wspólny sufit rozmiaru odpowiedzi', () => {
  it('przytnij: listy od końca, co najmniej jedna pozycja, poprawny obiekt; oryginał bez zmian', () => {
    const w = olbrzym();
    const { wynik, przyciecia } = przytnij(w, 20_000);
    expect(JSON.stringify(wynik).length).toBeLessThanOrEqual(20_000);
    expect((wynik.pozycje as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((wynik.pozycje as Array<{ numer: number }>)[0].numer).toBe(1);
    expect(przyciecia.find((p) => p.pole === 'pozycje')).toMatchObject({ rodzaj: 'lista', bylo: 3000 });
    expect((w.pozycje as unknown[]).length).toBe(3000);
    // Chronione pola zostają.
    expect(wynik.zrodla).toEqual(w.zrodla);
    expect(wynik.odpowiedz).toBe(w.odpowiedz);
  });

  it('przytnij: sam długi napis skraca na granicy słowa, ze znacznikiem', () => {
    const { wynik, przyciecia } = przytnij({ zrodla: [], tresc: 'Art. 1. Ustawa określa zasady. '.repeat(3000) }, 10_000);
    const t = wynik.tresc as string;
    expect(JSON.stringify(wynik).length).toBeLessThanOrEqual(10_000);
    expect(t).toMatch(/zasady\. \[…\] \(skrócono: limit rozmiaru odpowiedzi\)$|\S \[…\]/);
    expect(przyciecia[0]).toMatchObject({ pole: 'tresc', rodzaj: 'tekst' });
  });

  it('odpowiedz: tekst pod sufitem, „Wynik niepełny” na początku, przesuniecie wskazuje pierwszą niepokazaną pozycję', () => {
    const o = odpowiedz(olbrzym(), TERAZ, { nazwy: ['fraza', 'limit', 'przesuniecie'], wartosci: { przesuniecie: 100 } });
    const tekst = o.content[0].text;
    expect(tekst.length).toBeLessThanOrEqual(SUFIT_ZNAKOW);
    const j = JSON.parse(tekst);
    expect(j).toEqual(o.structuredContent);
    expect(j.odpowiedz).toMatch(/^Wynik niepełny: odpowiedź przekroczyła 28.000 znaków/);
    const pokazano = j.pozycje.length;
    expect(j.nastepnePrzesuniecie).toBe(100 + pokazano);
    expect(j.wynikCzesciowy.czegoBrakuje).toMatch(new RegExp(`lista pozycje: pokazano ${pokazano} z 3000 pozycji`));
    expect(j.wynikCzesciowy.jakUzupelnic).toMatch(new RegExp(`przesuniecie=${100 + pokazano}`));
    expect(j.odpowiedz).toMatch(new RegExp(`przesuniecie=${100 + pokazano}`));
    expect(j.skroconoDoLimitu.limitZnakow).toBe(SUFIT_ZNAKOW);
    expect(j.kalendarz.dzis).toMatch(/^2026-10-02/);
  });

  it('odpowiedz: mały wynik bez zmian i bez pola o skróceniu', () => {
    const j = JSON.parse(odpowiedz({ zrodla: ['x'], odpowiedz: 'ok' }, TERAZ).content[0].text);
    expect(j.wynikCzesciowy).toBeUndefined();
    expect(j.skroconoDoLimitu).toBeUndefined();
  });

  it.each(NARZEDZIA.map((n) => [n.nazwa, n] as const))('%s: każdy wynik, choćby ogromny, mieści się pod sufitem i mówi, jak dostać resztę', (_nazwa, n) => {
    const argumenty = nazwy(n);
    const tekst = odpowiedz(olbrzym(), TERAZ, { nazwy: argumenty, wartosci: {} }).content[0].text;
    expect(tekst.length).toBeLessThanOrEqual(SUFIT_ZNAKOW);
    const j = JSON.parse(tekst);
    expect(j.odpowiedz).toMatch(/^Wynik niepełny:/);
    if (argumenty.includes('przesuniecie')) expect(j.wynikCzesciowy.jakUzupelnic).toMatch(/przesuniecie=\d+/);
    else if (argumenty.includes('limit')) expect(j.wynikCzesciowy.jakUzupelnic).toMatch(/mniejszym limit/);
    else expect(j.wynikCzesciowy.jakUzupelnic).toMatch(/wywołać to samo narzędzie/);
  });

  it('prawdziwe narzędzia na fiksturach przy najwyższych limitach mieszczą się pod sufitem', async () => {
    const przypadki: Array<[Narzedzie<any>, Record<string, string>, Record<string, unknown>]> = [
      [znajdzPosla, { 'term10/MP': 'mp-lista.json' }, { limit: 100 }],
      [transmisje, { 'term10/videos/2024-04-24': 'transmisje-2024-04-24.json' }, { data: '2024-04-24', limit: 50 }],
      [posiedzeniaKomisji, { 'term10/committees/ZDR/sittings': 'komisja-zdr-posiedzenia.json' }, { komisja: 'ZDR', limit: 40 }],
    ];
    for (const [n, mapa, args] of przypadki) {
      const dane = wejscie(n.wejscie, args);
      const w = await n.wykonaj(dane, new ZrodloZFikstur(mapa));
      const tekst = odpowiedz(w, TERAZ, { nazwy: nazwy(n), wartosci: dane }).content[0].text;
      expect(tekst.length, n.nazwa).toBeLessThanOrEqual(SUFIT_ZNAKOW);
    }
  });

  it('niższe limity: transmisje 50, znajdz_posla 100, posiedzenia_komisji 40, szukaj_aktow 50, tekst_druku znakow 25000', () => {
    const maks = (nazwa: string, pole: string, x: unknown) => {
      const n = NARZEDZIA.find((t) => t.nazwa === nazwa)!;
      return () => n.wejscie.parse({ numer: '1', komisja: 'ZDR', data: '2026-01-01', ...(pole ? { [pole]: x } : {}) });
    };
    expect(maks('transmisje', 'limit', 51)).toThrow();
    expect(maks('transmisje', 'limit', 50)).not.toThrow();
    expect(maks('znajdz_posla', 'limit', 101)).toThrow();
    expect(maks('posiedzenia_komisji', 'limit', 41)).toThrow();
    expect(maks('szukaj_aktow', 'limit', 51)).toThrow();
    expect(maks('tekst_druku', 'znakow', 25_001)).toThrow();
    expect(maks('tekst_druku', 'znakow', 25_000)).not.toThrow();
  });

  it('w prawdziwym serwerze MCP: ogromny wynik narzędzia przychodzi przycięty, z poprawnym JSON-em', async () => {
    const duze = narzedzie({
      nazwa: 'duze',
      tytul: 'test',
      opis: 'test',
      wejscie: z.object({ limit: z.number().optional(), przesuniecie: z.number().default(0) }),
      wykonaj: async () => olbrzym(),
    });
    const [klient, serwer] = InMemoryTransport.createLinkedPair();
    const s = utworzSerwer(new ZrodloZFikstur({}), [duze]);
    await s.connect(serwer);
    const czekaj = new Map<number, (m: any) => void>();
    klient.onmessage = (m: any) => {
      if (m.id !== undefined && czekaj.has(m.id)) czekaj.get(m.id)!(m);
    };
    await klient.start();
    const zapytaj = (id: number, method: string, params: unknown) =>
      new Promise<any>((r) => {
        czekaj.set(id, r);
        void klient.send({ jsonrpc: '2.0', id, method, params } as any);
      });
    await zapytaj(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    await klient.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as any);
    const odp = await zapytaj(2, 'tools/call', { name: 'duze', arguments: { przesuniecie: 20 } });
    await s.close();
    const tekst = odp.result.content[0].text as string;
    expect(tekst.length).toBeLessThanOrEqual(SUFIT_ZNAKOW);
    const j = JSON.parse(tekst);
    expect(j.odpowiedz).toMatch(/^Wynik niepełny:/);
    expect(j.nastepnePrzesuniecie).toBe(20 + j.pozycje.length);
  });
});
