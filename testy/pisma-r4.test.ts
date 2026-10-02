import { describe, expect, it } from 'vitest';
import type { OpcjePobrania } from '../src/klient.js';
import { pismo, rdzenieTytulu, szukajPism } from '../src/narzedzia/pisma.js';
import { wypowiedziPosiedzenia } from '../src/narzedzia/posiedzenia.js';
import { stanPisma, wiarygodnaData, zlozStan, stanyAdresatow } from '../src/reguly/pisma.js';
import { ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

/** Źródło z listą pism podaną w teście: `lista` dostaje parametry, reszta z fikstur. */
function zrodloPism(lista: (parametry: Record<string, unknown>) => unknown[], pismoJson?: unknown) {
  const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json', 'term7/MP': 'mp-lista.json' });
  const json = z.json.bind(z);
  const zapytania: Array<Record<string, unknown>> = [];
  return {
    zapytania,
    zrodlo: {
      json: (async (s: string, o?: OpcjePobrania) => (s.endsWith('/MP') ? json(s, o) : pismoJson ?? null)) as typeof z.json,
      lista: (async (_s: string, o?: OpcjePobrania) => {
        const p = (o?.parametry ?? {}) as Record<string, unknown>;
        zapytania.push(p);
        const dane = lista(p);
        return { dane, razem: dane.length };
      }) as typeof z.lista,
      tekst: (async () => null) as typeof z.tekst,
      bajty: z.bajty.bind(z),
      adres: z.adres.bind(z),
    },
  };
}

describe('daty z rejestru pism (17-b: odpowiedź „0000-12-30”)', () => {
  it('wiarygodnaData odrzuca rok przed 1990 i przyszłość', () => {
    expect(wiarygodnaData('0000-12-30', '2026-09-25')).toBe(false);
    expect(wiarygodnaData('1989-12-31', '2026-09-25')).toBe(false);
    expect(wiarygodnaData('2026-09-26', '2026-09-25')).toBe(true);
    expect(wiarygodnaData('2026-09-27', '2026-09-25')).toBe(false);
    expect(wiarygodnaData('2013-08-10T12:00:00', '2026-09-25')).toBe(true);
    expect(wiarygodnaData(null)).toBe(false);
  });

  it('odpowiedź z błędną datą: odpowiedziano, bez dni i bez werdyktu', () => {
    const adresat = { name: 'minister rozwoju regionalnego', sent: '2013-07-30' };
    const st = stanPisma(adresat, [{ receiptDate: '0000-12-30', key: 'A' }], '2026-09-25');
    expect(st).toMatchObject({ odpowiedziano: true, spoznienieDni: null, bladDatyOdpowiedzi: '0000-12-30' });
    const stany = stanyAdresatow([adresat], [{ receiptDate: '0000-12-30', key: 'A' }], '2026-09-25');
    expect(zlozStan(stany, true).rodzaj).toBe('odpowiedziano-termin-nieznany');
    // Obok błędnej jest prawdziwa: liczy się prawdziwa.
    const dwie = stanPisma(adresat, [{ receiptDate: '0000-12-30' }, { receiptDate: '2013-08-25' }], '2026-09-25');
    expect(dwie).toMatchObject({ spoznienieDni: 5 });
    expect(dwie.bladDatyOdpowiedzi).toBeUndefined();
  });

  it('pismo 20000 z VII kadencji: wplynela null, bez „w terminie”, z uwagą i liczbaAutorow', async () => {
    const { zrodlo } = zrodloPism(() => [], {
      num: 20000, title: 'PO KL', receiptDate: '2013-07-24', sentDate: '2013-07-30', from: ['245', '1'], to: ['minister rozwoju regionalnego'],
      recipientDetails: [{ name: 'minister rozwoju regionalnego', sent: '2013-07-30', answerDelayedDays: 0 }],
      replies: [{ key: 'X1', from: 'Sekretarz stanu Adam Zdziebło', receiptDate: '0000-12-30', prolongation: false }],
    });
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 20000, kadencja: 7 }), zrodlo);
    expect(w.liczbaAutorow).toBe(2);
    expect(w.stan).toBe('odpowiedziano-termin-nieznany');
    expect(w.odpowiedz).not.toMatch(/w terminie/);
    expect(w.odpowiedz).toMatch(/błędną datę jej wpływu \(0000-12-30\)/);
    const ad = (w.adresaci as Array<Record<string, unknown>>)[0];
    expect(ad.odpowiedzDniPoTerminie).toBeNull();
    expect(ad.terminowosc).toMatch(/nie da się ustalić/);
    expect((w.odpowiedzi as Array<Record<string, unknown>>)[0]).toMatchObject({ wplynela: null, bladDatyWRejestrze: '0000-12-30' });
    expect((w.uwagi as string[]).join(' ')).toMatch(/Rejestr podaje błędną datę \(0000-12-30\)/);
  });

  it('szukaj_pism: stan „odpowiedziano-termin-nieznany” zamiast „odpowiedziano”', async () => {
    const { zrodlo } = zrodloPism(() => [
      { num: 20000, title: 'PO KL', from: ['1'], to: ['minister x'], recipientDetails: [{ name: 'minister x', sent: '2013-07-30' }], replies: [{ key: 'A', receiptDate: '0000-12-30' }] },
    ]);
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: 1, kadencja: 7 }), zrodlo);
    expect((w.pisma as Array<{ stan: string }>)[0].stan).toBe('odpowiedziano-termin-nieznany');
    expect((w.podsumowanie as { wedlugStanu: Record<string, number> }).wedlugStanu['odpowiedziano-termin-nieznany']).toBe(1);
  });
});

describe('szukaj_pism: fraza po rdzeniach (08-b: „rezerwa ogólna” a tytuł „rezerwy … ogólnej”)', () => {
  const TYTUL = 'Zapytanie w sprawie wydatkowania rezerwy prezesa Rady Ministrów (rezerwy ogólnej budżetu państwa)';
  const pisma = [
    { num: 3442, title: TYTUL, from: ['1'], to: ['minister finansów'], recipientDetails: [{ name: 'minister finansów', sent: '2026-05-06' }], replies: [] },
    { num: 3000, title: 'Zapytanie w sprawie rezerwy celowej', from: ['1'], to: ['minister finansów'], recipientDetails: [{ name: 'minister finansów', sent: '2026-05-06' }], replies: [] },
  ];

  it('rdzenieTytulu: łagodne cięcie, bez słów pustych', () => {
    expect(rdzenieTytulu('rezerwa ogólna')).toEqual(['rezerw', 'ogóln']);
    expect(rdzenieTytulu('w sprawie szpitalach')).toEqual(['szpital']);
  });

  it('fraza po rdzeniach: rejestr po rdzeniu bez polskich znaków, reszta rdzeni u siebie', async () => {
    const { zrodlo, zapytania } = zrodloPism((p) => {
      const t = String(p.title ?? '').toLowerCase();
      return pisma.filter((x) => x.title.toLowerCase().includes(t));
    });
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'zapytanie', fraza: 'rezerwa ogólna' }), zrodlo);
    expect(zapytania.map((q) => q.title)).toEqual(['rezerw']);
    expect((w.pisma as Array<{ numer: number }>).map((p) => p.numer)).toEqual([3442]);
    expect(w.razem).toBe(1);
    expect((w.uwagi as string[])[0]).toMatch(/po rdzeniach „rezerw”, „ogóln”.*2 tytuły z „rezerw”, z nich wszystkie rdzenie ma 1/);
    // Jedno słowo w mianowniku znajduje też tytuł z dopełniaczem.
    const jedno = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'zapytanie', fraza: 'rezerwa' }), zrodlo);
    expect((jedno.pisma as Array<{ numer: number }>).map((p) => p.numer)).toEqual([3442, 3000]);
  });

  it('zero także po rdzeniach: podpowiedź krótszego rdzenia', async () => {
    const { zrodlo } = zrodloPism(() => []);
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'zapytanie', fraza: 'wydatkowanie' }), zrodlo);
    expect(w.razem).toBe(0);
    expect((w.uwagi as string[])[0]).toMatch(/Spróbuj jednego słowa albo krótszego rdzenia, np\. „wydatkow”/);
  });
});

describe('szukaj_pism: rozmiar wyniku (08-b: 59,5 KB przy limit 100)', () => {
  it('porcja przycięta do ok. 18 tys. znaków, nastepnePrzesuniecie, podsumowanie z całej puli', async () => {
    const autorzy = Array.from({ length: 40 }, (_, i) => String(i + 1));
    const dane = Array.from({ length: 100 }, (_, i) => ({
      num: 5000 - i,
      title: `Interpelacja w sprawie bardzo długiego tytułu dotyczącego sprawy numer ${i} ${'i jeszcze dłuższego opisu '.repeat(6)}`,
      from: autorzy,
      to: ['minister zdrowia', 'minister finansów'],
      recipientDetails: [{ name: 'minister zdrowia', sent: '2026-01-01', answerDelayedDays: 200 }, { name: 'minister finansów', sent: '2026-01-01', answerDelayedDays: 200 }],
      replies: [],
    }));
    const { zrodlo } = zrodloPism(() => dane);
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: 1, limit: 100 }), zrodlo);
    expect(JSON.stringify(w).length).toBeLessThan(20_000);
    const lista = w.pisma as Array<{ numer: number; autorzy: unknown[]; liczbaAutorow: number }>;
    expect(lista.length).toBeGreaterThan(5);
    expect(lista.length).toBeLessThan(100);
    expect(lista[0].autorzy).toHaveLength(3);
    expect(lista[0].liczbaAutorow).toBe(40);
    expect(w.nastepnePrzesuniecie).toBe(lista.length);
    expect((w.podsumowanie as { razem: number }).razem).toBe(100);
    expect((w.uwagi as string[]).join(' ')).toMatch(/Pokazano \d+ z 100 pism tej porcji/);
    const dalej = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: 1, limit: 100, przesuniecie: w.nastepnePrzesuniecie }), zrodlo);
    expect((dalej.pisma as Array<{ numer: number }>)[0].numer).toBe(5000 - lista.length);
  });
});

describe('szukaj_pism z tylkoOpoznione: treści odpowiedzi z terminem i pamięcią (07-b: 44 s)', () => {
  // Pisma do dwóch adresatów z jedną nieprzypisaną odpowiedzią: stan zależy od treści odpowiedzi.
  const dane = Array.from({ length: 6 }, (_, i) => ({
    num: 100 + i, title: 't', from: ['1'], to: ['minister sportu i turystyki', 'minister zdrowia'],
    recipientDetails: [{ name: 'minister sportu i turystyki', sent: '2025-01-01', answerDelayedDays: 0 }, { name: 'minister zdrowia', sent: '2025-01-01', answerDelayedDays: 0 }],
    replies: [{ key: `K${i}`, from: 'Sekretarz stanu Jan Nowak', receiptDate: '2025-01-10', prolongation: false }],
  }));

  it('treści, które nie zdążyły, dają wynik częściowy z uwagą; drugie wywołanie korzysta z pamięci', async () => {
    const { zrodlo } = zrodloPism(() => dane);
    const czytane: string[] = [];
    let wolno = 3;
    zrodlo.tekst = (async (s: string, o?: OpcjePobrania) => {
      expect(typeof o?.termin).toBe('number');
      czytane.push(s);
      if (wolno-- <= 0) throw new Error('Zabrakło czasu');
      return '<p>Odpowiadający: sekretarz stanu w Ministerstwie Zdrowia Jan Nowak</p>';
    }) as typeof zrodlo.tekst;
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', adresat: 'minister sportu i turystyki', tylkoOpoznione: true }), zrodlo);
    expect(czytane).toHaveLength(6);
    // Trzy przeczytane: odpowiedź ministra zdrowia, więc minister sportu jest po terminie.
    expect(w.razem).toBe(3);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/albo czasu/);
    expect(uwagi).toMatch(/Wynik jest częściowy/);
    expect(uwagi).toMatch(/razem \(3\) to dolna granica: 3 pisma mają/);
    // Drugie wywołanie: trzy z pamięci, trzy nowe.
    czytane.length = 0;
    wolno = 10;
    const w2 = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', adresat: 'minister sportu i turystyki', tylkoOpoznione: true }), zrodlo);
    expect(czytane).toHaveLength(3);
    expect(w2.razem).toBe(6);
  });
});

describe('wypowiedzi_posiedzenia z tylkoSprawozdawcy (13-b)', () => {
  const stenogram = {
    statements: Array.from({ length: 45 }, (_, i) => ({ num: i + 1, name: `Poseł ${i}`, function: 'Poseł Sprawozdawca', memberID: i + 1, rapporteur: true })),
  };
  const naglowek = '<h2 class="punkt">7. punkt porządku dziennego:</h2><p class="punkt-tytul">Sprawozdanie Komisji</p>';

  it('ponad 40 sprawozdawców: punkt dla pierwszych 40, uwaga o pominiętych', async () => {
    const z = new ZrodloZFikstur({});
    z.json = (async () => stenogram) as typeof z.json;
    z.tekst = (async () => naglowek) as typeof z.tekst;
    const w = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, { posiedzenie: 60, data: '2026-06-10', tylkoSprawozdawcy: true }), z);
    const spis = w.spis as Array<{ punktPorzadku: string | null }>;
    expect(spis.slice(0, 40).every((s) => s.punktPorzadku === '7. punkt porządku dziennego')).toBe(true);
    expect(spis.slice(40).every((s) => s.punktPorzadku === null)).toBe(true);
    expect((w.uwagi as string[]).join(' ')).toMatch(/pierwszych 40 z 45 wystąpień.*pozostałe 5.*przesuniecie=40/);
  });

  it('nagłówki, które nie zdążyły: null i uwaga o wyniku częściowym; pamięć przy ponownym wywołaniu', async () => {
    const z = new ZrodloZFikstur({});
    z.json = (async () => ({ statements: stenogram.statements.slice(0, 10) })) as typeof z.json;
    let wolno = 6;
    let czytane = 0;
    z.tekst = (async (_s: string, o?: OpcjePobrania) => {
      expect(typeof o?.termin).toBe('number');
      czytane++;
      if (wolno-- <= 0) throw new Error('Zabrakło czasu');
      return naglowek;
    }) as typeof z.tekst;
    const a = { posiedzenie: 60, data: '2026-06-10', tylkoSprawozdawcy: true };
    const w = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, a), z);
    expect((w.spis as Array<{ punktPorzadku: string | null }>).filter((s) => s.punktPorzadku).length).toBe(6);
    expect((w.uwagi as string[]).join(' ')).toMatch(/nie oddał na czas 4 nagłówków/);
    czytane = 0;
    wolno = 10;
    const w2 = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, a), z);
    expect(czytane).toBe(4);
    expect((w2.spis as Array<{ punktPorzadku: string | null }>).every((s) => s.punktPorzadku)).toBe(true);
  });
});

describe('naCzas: kolejka z terminem', () => {
  it('wraca chwilę po terminie, niezaczęte i nieskończone dają undefined', async () => {
    const { naCzas } = await import('../src/narzedzia/na-czas.js');
    const start = Date.now();
    let naraz = 0;
    let najwiecej = 0;
    const w = await naCzas(Array.from({ length: 20 }, (_, i) => i), start + 1700, async (i) => {
      najwiecej = Math.max(najwiecej, ++naraz);
      await new Promise((r) => setTimeout(r, 400));
      naraz--;
      return i;
    });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(najwiecej).toBe(4);
    expect(w.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(w.filter((x) => x === undefined).length).toBeGreaterThan(8);
  });
});
