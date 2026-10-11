/**
 * Poprawki z 11.10.2026: odpowiedzi, które modele czytały błędnie.
 * Każdy test stoi na prawdziwej odpowiedzi API Sejmu zapisanej w testy/fikstury.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ustawSchowekAktow } from '../src/akty-schowek.js';
import { trescAktu } from '../src/narzedzia/eli.js';
import { Schowek } from '../src/schowek.js';
import type { OpcjePobrania } from '../src/klient.js';
import { glosowanie, glosowaniaPosiedzenia, szukajGlosowan } from '../src/narzedzia/glosowania.js';
import { ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

describe('n06: rejestr nie zapisuje, kto był na sali', () => {
  // 18/127 (1.10.2024): 221 za, 5 przeciw, 1 wstrzymał się, 232 nie głosowało, present = 0.
  // Pole „obecniBezGlosu: 0” model czytał jako „na sali nie było nikogo, kto nie głosował” (8 z 8 przebiegów).
  it('glosowanie za-przeciw: bez obecniBezGlosu, zdanie mówi, czego rejestr nie zapisuje', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/18/127': 'glosowanie-18-127.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 18, numer: 127 }), z);
    expect(w).not.toHaveProperty('obecniBezGlosu');
    expect(w).not.toHaveProperty('przyciskObecny');
    expect(w).toMatchObject({ za: 221, przeciw: 5, wstrzymalo: 1, nieglosowalo: 232 });
    expect(w.odpowiedz).toMatch(/Nie głosowało 232 posłów .*Rejestr głosowania nie zapisuje, kto był wtedy na sali obrad/);
    for (const k of w.kluby as Array<Record<string, unknown>>) expect(k).not.toHaveProperty('obecniBezGlosu');
    expect((w.uwagi as string[]).join(' ')).toMatch(/NIE zapisuje, kto był na sali obrad/);
  });

  it('liczba „obecny” (PRESENT) pojawia się tylko wtedy, gdy rejestr ją ma', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65': 'glosowania-65.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 65, limit: 30 }), z);
    const lista = w.glosowania as Array<Record<string, unknown>>;
    expect(lista.some((g) => 'obecniBezGlosu' in g)).toBe(false);
    for (const g of lista.filter((x) => x.rodzaj === 'za-przeciw')) expect(g).not.toHaveProperty('przyciskObecny');
  });
});

describe('t004, t018, t021: wynik w listach oznaczony jako wyliczony przez serwer', () => {
  it('glosowania_posiedzenia: wynikWyliczony zamiast wynik, zdanie mówi, kto liczył', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65': 'glosowania-65.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 65, limit: 30 }), z);
    const lista = w.glosowania as Array<Record<string, unknown>>;
    expect(lista.length).toBeGreaterThan(0);
    for (const g of lista) {
      expect(g).not.toHaveProperty('wynik');
      expect(typeof g.wynikWyliczony).toBe('string');
    }
    expect(w.odpowiedz).toMatch(/przyjęto \d+, odrzucono \d+ \(wylicza ten serwer z liczb głosów i progów, rejestr nie ma pola z wynikiem\)/);
    expect((w.uwagi as string[]).join(' ')).toMatch(/Pola wynikWyliczony, przeszlo i rozstrzygniecie .* wylicza ten serwer/);
  });

  it('porządek obrad: wiersze też mają wynikWyliczony', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65': 'glosowania-65.json', 'term10/proceedings/65': 'posiedzenie-65.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 65, porzadek: true }), z);
    const p = w.porzadek as { punkty: Array<{ glosowania?: Array<Record<string, unknown>> }> };
    const wiersze = p.punkty.flatMap((x) => x.glosowania ?? []);
    expect(wiersze.length).toBeGreaterThan(0);
    for (const g of wiersze) {
      expect(g).not.toHaveProperty('wynik');
      expect(g).toHaveProperty('wynikWyliczony');
    }
  });
});

describe('t038: kandydat z inicjałem to napis rejestru, pełne imię tylko z listy posłów', () => {
  // VIII kadencja, 1/1 (12.11.2015): votingOptions „M. Kuchciński” 409, „K. Morawiecki” 42, bez numeru posła.
  it('szukaj_glosowan: kandydatWRejestrze dosłownie, poselKadencji z /term8/MP (jedna osoba)', async () => {
    const z = new ZrodloZFikstur({ 'term8/votings/search': 'glosowania-k8-szukaj-marszalka.json', 'term8/MP': 'mp-lista-k8.json' });
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'wyborem marszałka', kadencja: 8 }), z);
    const g = (w.glosowania as Array<Record<string, unknown>>).find((x) => x.glosowanie === '1/1')!;
    expect(g.kandydaci).toEqual([
      { kandydatWRejestrze: 'M. Kuchciński', glosow: 409, poselKadencji: { id: 199, imieNazwisko: 'Marek Kuchciński' } },
      { kandydatWRejestrze: 'K. Morawiecki', glosow: 42, poselKadencji: { id: 255, imieNazwisko: 'Kornel Morawiecki' } },
    ]);
    expect(g.wybrani).toEqual(['M. Kuchciński']);
    // 85/25 (9.08.2019) zapisuje kandydatów odwrotnie: „Witek E.”.
    const g85 = (w.glosowania as Array<Record<string, unknown>>).find((x) => x.glosowanie === '85/25')!;
    expect(g85.kandydaci).toContainEqual({ kandydatWRejestrze: 'Witek E.', glosow: 245, poselKadencji: { id: 429, imieNazwisko: 'Elżbieta Witek' } });
    expect((w.uwagi as string[]).join(' ')).toMatch(/Nie rozwijaj inicjału z pamięci/);
  });

  it('bez listy posłów (awaria) zostaje sam napis rejestru, bez zgadywania', async () => {
    const z = new ZrodloZFikstur({ 'term8/votings/search': 'glosowania-k8-szukaj-marszalka.json' });
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'wyborem marszałka', kadencja: 8 }), z);
    const g = (w.glosowania as Array<Record<string, unknown>>).find((x) => x.glosowanie === '1/1')!;
    expect(g.kandydaci).toEqual([
      { kandydatWRejestrze: 'M. Kuchciński', glosow: 409 },
      { kandydatWRejestrze: 'K. Morawiecki', glosow: 42 },
    ]);
  });

  it('glosowanie: ten sam kształt i zdanie z dopasowaniem', async () => {
    const z = new ZrodloZFikstur({ 'term8/votings/1/1': 'glosowanie-k8-1-1.json', 'term8/MP': 'mp-lista-k8.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 1, numer: 1, kadencja: 8 }), z);
    expect((w.kandydaci as Array<Record<string, unknown>>)[1]).toEqual({
      kandydatWRejestrze: 'K. Morawiecki',
      glosow: 42,
      poselKadencji: { id: 255, imieNazwisko: 'Kornel Morawiecki' },
    });
    expect(w.odpowiedz).toMatch(/„K\. Morawiecki” = Kornel Morawiecki \(id 255\)/);
  });
});

describe('t047: fraza trafia też w opis głosowania, nie tylko w temat', () => {
  // Temat 65/12 ma literówkę rejestru („wnioskuo wyrażenie zgody przez Sejm na zatrzymanie…”), więc pełna fraza
  // z pytania trafia w samo 63/71. Opis 65/12 brzmi jak pytanie. Liczby trafień rdzeni zmierzone 11.10.2026.
  const RAZEM: Record<string, number> = { zgo: 127, zatrzyma: 55, tymczas: 64, aresztowa: 64, pos: 1495, Wojcie: 10, Kró: 329 };
  class Wyszukiwarka extends ZrodloZFikstur {
    override async lista<T>(sciezka: string, opcje?: OpcjePobrania): Promise<{ dane: T[]; razem: number | null }> {
      const tytul = String(opcje?.parametry?.title ?? '');
      if (tytul in RAZEM && tytul !== 'Wojcie') return { dane: [], razem: RAZEM[tytul] };
      const plik = tytul === 'Wojcie' ? 'term10/votings/search?Wojcie' : sciezka;
      const w = await super.lista<T>(plik, opcje);
      return tytul === 'Wojcie' && opcje?.parametry?.limit === 1 ? { dane: w.dane.slice(0, 1), razem: 10 } : w;
    }
  }

  it('szukaj_glosowan dokłada 65/12 z opisem pasującym do frazy', async () => {
    const z = new Wyszukiwarka({ 'term10/votings/search': 'glosowania-szukaj-zgoda-krol.json', 'term10/votings/search?Wojcie': 'glosowania-szukaj-wojcie.json' });
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'zgody na zatrzymanie i tymczasowe aresztowanie posła Wojciecha Króla' }), z);
    const numery = (w.glosowania as Array<{ glosowanie: string }>).map((g) => g.glosowanie);
    // 63/69 i 63/70 to ten sam punkt porządku (tytuł punktu wymienia zatrzymanie i areszt), ale ich temat mówi
    // o odpowiedzialności karnej: zostają na liście, model rozróżnia je po temacie.
    expect(numery).toEqual(['65/12', '63/69', '63/70', '63/71']);
    expect(w.razem).toBe(4);
    expect((w.uwagi as string[]).join(' ')).toMatch(/dołączono jeszcze 63\/69, 63\/70, 65\/12: mają wszystkie rdzenie frazy .* w tytule, temacie albo opisie/);
    expect(w).not.toHaveProperty('wynikCzesciowy');
  });
});

describe('tekst aktu z PDF w schowku: raz na wersję aktu w ELI', () => {
  // DU/1997/78 ma w ELI tylko PDF (textHTML: false); plik i rekord to prawdziwe odpowiedzi ELI.
  let katalog: string;
  beforeEach(() => {
    katalog = mkdtempSync(join(tmpdir(), 'sejm-mcp-akty-'));
    ustawSchowekAktow(() => new Schowek(katalog));
  });
  afterEach(() => {
    ustawSchowekAktow(() => null);
    rmSync(katalog, { recursive: true, force: true });
  });

  const pobranPdf = (z: ZrodloZFikstur) => z.zapytania.filter((q) => q.sciezka.endsWith('/text.pdf')).length;

  it('drugie pytanie bierze tekst z dysku; nowsza data zmiany w ELI czyta PDF od nowa', async () => {
    const pierwszy = new ZrodloZFikstur({ 'eli/acts/DU/1997/78': 'eli-du-1997-78.json', 'eli/acts/DU/1997/78/text.pdf': 'eli-du-1997-78.pdf' });
    const w1 = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1997/78' }), pierwszy);
    expect(pobranPdf(pierwszy)).toBe(1);
    expect(JSON.stringify(w1)).toMatch(/nauczyciel/i);
    expect(existsSync(join(katalog, 'akty', 'DU-1997-78.json'))).toBe(true);

    // Ta sama wersja w ELI: bez pobierania PDF (mapa nie zna pliku, więc pobranie by się nie udało).
    const drugi = new ZrodloZFikstur({ 'eli/acts/DU/1997/78': 'eli-du-1997-78.json' });
    const w2 = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1997/78' }), drugi);
    expect(pobranPdf(drugi)).toBe(0);
    expect(JSON.stringify(w2)).toMatch(/nauczyciel/i);
    expect((w2.uwagi as string[]).join(' ')).toMatch(/wzięto z dysku użytkownika: ELI pokazuje tę samą wersję aktu \(zmiana rekordu 2014-12-31T12:25:46\)/);

    // ELI pokazuje nowszą zmianę rekordu: PDF czytany od nowa.
    const nowszy = new ZrodloZFikstur({ 'eli/acts/DU/1997/78': 'eli-du-1997-78.json', 'eli/acts/DU/1997/78/text.pdf': 'eli-du-1997-78.pdf' });
    const json = nowszy.json.bind(nowszy);
    nowszy.json = (async (s: string, o?: OpcjePobrania) => {
      const r = (await json(s, o)) as Record<string, unknown> | null;
      return r && s === 'eli/acts/DU/1997/78' ? { ...r, changeDate: '2026-10-11T08:00:00' } : r;
    }) as typeof nowszy.json;
    const w3 = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1997/78' }), nowszy);
    expect(pobranPdf(nowszy)).toBe(1);
    expect((w3.uwagi as string[]).join(' ')).not.toMatch(/wzięto z dysku/);
  });
});
