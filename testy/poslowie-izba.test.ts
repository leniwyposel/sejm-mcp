import { describe, expect, it } from 'vitest';
import { komisje } from '../src/narzedzia/izba.js';
import { wypowiedziPosiedzenia } from '../src/narzedzia/posiedzenia.js';
import { kluby, profilPosla, znajdzPosla } from '../src/narzedzia/poslowie.js';
import { czyscArgumenty, czyscWejscie, opisKadencji, wejscieCzyszczone } from '../src/narzedzia/wspolne.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;
const okreg16 = () => new ZrodloZFikstur({ 'term10/MP': 'mp-okreg-16.json' });

describe('znajdz_posla po testach 01, 02, 05, 19', () => {
  it('każdy poseł ma glosowWWyborach, sortuj="glosy" układa ranking okręgu', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { okreg: 16, sortuj: 'glosy', tylkoAktywni: false }), okreg16());
    const lista = w.poslowie as Array<{ imieNazwisko: string; glosowWWyborach: number | null }>;
    expect(lista.every((p) => typeof p.glosowWWyborach === 'number')).toBe(true);
    expect(lista[0].imieNazwisko).toBe('Marcin Kierwiński');
    const glosy = lista.map((p) => p.glosowWWyborach ?? -1);
    expect(glosy).toEqual([...glosy].sort((x, y) => y - x));
    expect((w.uwagi as string[]).join(' ')).toMatch(/od największej liczby głosów/);
  });

  it('poseł ślubujący w trakcie kadencji dostaje mandaty wygasłe wcześniej w okręgu, bez wskazania jednego poprzednika', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Kulpa' }), okreg16());
    const [n] = w.wygasliWczesniejWOkregu as Array<{ posel: { id: number }; poslowie: Array<{ id: number; tenSamKlub: boolean }> }>;
    expect(n.posel.id).toBe(476);
    expect(n.poslowie.map((q) => q.id)).toEqual([413, 160, 279]);
    expect(n.poslowie.filter((q) => q.tenSamKlub).map((q) => q.id)).toEqual([413, 279]);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/nie zapisuje, kogo poseł zastąpił/);
    expect(uwagi).toMatch(/API nie rozstrzyga/);
    // Poseł z początku kadencji nie dostaje tego pola.
    const k = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Kierwiński' }), okreg16());
    expect(k.wygasliWczesniejWOkregu).toBeUndefined();
  });

  it('tylkoWygasle: tylko wygasłe mandaty z liczbą według powodu, bez list następców', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { tylkoWygasle: true }), okreg16());
    expect(w.razem).toBe(3);
    expect(w.wedlugPowodu).toEqual({ Zrzeczenie: 2, 'Utrata prawa wybieralności': 1 });
    expect(w.odpowiedz).toMatch(/mandat wygasł przed końcem kadencji 3 posłom \(Zrzeczenie 2/);
    expect(w.slubowaliPozniejWOkregu).toBeUndefined();
  });

  it('skrót klubu: jednoznaczny początek dopasowany z uwagą, nieznany z listą skrótów', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { klub: 'Rozwoj' }), z);
    expect((w.poslowie as Array<{ klub: string }>).every((p) => p.klub === 'RozwojPlus')).toBe(true);
    expect((w.uwagi as string[]).join(' ')).toMatch(/klub \u201ERozwoj\u201D nazywa się RozwojPlus/);
    const nic = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { klub: 'PSL' }), z);
    expect(nic.razem).toBe(0);
    expect((nic.uwagi as string[]).join(' ')).toMatch(/nie ma klubu \u201EPSL\u201D\. Skróty z rejestru: Demokracja, KO, PiS, RozwojPlus/);
  });

  it('nazwisko spoza rejestru kadencji: fakt w odpowiedzi; nazwisko z innym klubem: przyczyna', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Radosław Sikorski' }), okreg16());
    expect(w.odpowiedz).toMatch(/Kadencja 10 \(od 2023\): w rejestrze Sejmu nie ma posła pasującego do \u201ERadosław Sikorski\u201D, także wśród posłów, których mandat wygasł/);
    const inny = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Kulpa', klub: 'KO' }), okreg16());
    expect(inny.razem).toBe(0);
    expect((inny.uwagi as string[]).join(' ')).toMatch(/pasuje do Wioletta Maria Kulpa \(id 476, PiS/);
  });
});

describe('czyszczenie wejścia (test 20, S1)', () => {
  it('znaki niewidoczne, bidi, dywizy i pełna szerokość', () => {
    expect(czyscWejscie('Pe\u200Btru')).toBe('Petru');
    expect(czyscWejscie('\u202EPetru\u202C')).toBe('Petru');
    expect(czyscWejscie('Dzie\u200Bmia\u00ADnowicz\u2011Bąk')).toBe('Dziemianowicz-Bąk');
    expect(czyscWejscie('Dziemianowicz\u2013Bąk \u2014 x\u2212y')).toBe('Dziemianowicz-Bąk - x-y');
    expect(czyscWejscie('\uFF30\uFF25\uFF34\uFF32\uFF35')).toBe('PETRU');
    expect(czyscWejscie('\uFEFFbu\u2060dżet')).toBe('budżet');
    expect(czyscArgumenty({ fraza: 'a\u200Bb', n: 3, lista: ['x\u2212y'], t: true })).toEqual({ fraza: 'ab', n: 3, lista: ['x-y'], t: true });
  });

  it('znajdz_posla z niewidocznym znakiem znajduje posła; schemat serwera czyści przed walidacją', async () => {
    for (const fraza of ['Kul\u200Bpa', '\u202EKulpa', '\uFF2B\uFF35\uFF2C\uFF30\uFF21']) {
      const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza }), okreg16());
      expect(w.razem).toBe(1);
    }
    // Dywiz wklejony w środek nazwiska (łamanie wiersza w PDF-ie): ostatnia próba bez separatorów.
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Kul\u2011pa' }), okreg16());
    expect(w.razem).toBe(1);
    expect((w.uwagi as string[]).join(' ')).toMatch(/bez spacji i dywizów/);
    // Kod z niewidocznym znakiem odpadłby na wyrażeniu regularnym, gdyby czyszczenie szło po walidacji.
    expect(wejscieCzyszczone(komisje.wejscie).parse({ kod: 'INF\u200B01N' })).toMatchObject({ kod: 'INF01N' });
    expect(() => komisje.wejscie.parse({ kod: 'INF\u200B01N' })).toThrow();
  });
});

describe('profil_posla: okres, posiedzenia, zakończona kadencja (testy 02, 17)', () => {
  const dni = JSON.parse(fikstura('mp-1-stats.json')) as Array<{ sitting: number; date: string; numVotings: number; numMissed: number; absenceExcuse: boolean | null }>;
  const zrodlo = () => new ZrodloZFikstur({ 'term10/MP/1': 'mp-1.json', 'term10/MP/1/votings/stats': 'mp-1-stats.json' });

  it('od/do sumuje statystykę Sejmu za okres, posiedzenia sumuje każde posiedzenie', async () => {
    const w = await profilPosla.wykonaj(wejscie(profilPosla.wejscie, { id: 1, od: '2024-01-01', do: '2024-12-31', posiedzenia: true }), zrodlo());
    const wOkresie = dni.filter((d) => d.date >= '2024-01-01' && d.date <= '2024-12-31');
    expect(w.zakres).toMatchObject({
      od: '2024-01-01',
      do: '2024-12-31',
      dniPosiedzen: wOkresie.length,
      glosowan: wOkresie.reduce((s, d) => s + d.numVotings, 0),
      opuszczonych: wOkresie.reduce((s, d) => s + d.numMissed, 0),
      dniNieusprawiedliwione: wOkresie.filter((d) => d.numMissed > 0 && d.absenceExcuse === false).length,
    });
    const pos = w.posiedzenia as Array<{ posiedzenie: number; od: string; glosowan: number; opuszczonych: number }>;
    expect(new Set(pos.map((p) => p.posiedzenie))).toEqual(new Set(wOkresie.map((d) => d.sitting)));
    const p0 = pos[0];
    const jego = wOkresie.filter((d) => d.sitting === p0.posiedzenie);
    expect(p0.glosowan).toBe(jego.reduce((s, d) => s + d.numVotings, 0));
    expect(pos.map((p) => p.od)).toEqual([...pos.map((p) => p.od)].sort().reverse());
    expect(w.odpowiedz).toMatch(/od 2024-01-01 do 2024-12-31: opuszczone .* W całej kadencji: opuszczone/);
  });

  it('odwrócony przedział to błąd', async () => {
    await expect(profilPosla.wykonaj(wejscie(profilPosla.wejscie, { id: 1, od: '2025-01-01', do: '2024-01-01' }), zrodlo())).rejects.toThrow(/Odwrócony/);
  });

  it('zakończona kadencja: klub na koniec kadencji i mandat do końca, z latami kadencji', async () => {
    const z = new ZrodloZFikstur({ 'term8/MP/45': 'mp-8-45.json', 'term8/MP/45/votings/stats': 'mp-1-stats.json' });
    const w = await profilPosla.wykonaj(wejscie(profilPosla.wejscie, { id: 45, kadencja: 8 }), z);
    expect(w.odpowiedz).toMatch(/^Kadencja 8 \(2015\u20132019\)\. Borys Budka \(klub na koniec kadencji 8: PO-KO; mandat do końca kadencji\)/);
    expect(w.odpowiedz).not.toMatch(/klub dziś|mandat wygasł/);
  });
});

describe('izba: kluby i komisje (testy 03, 12, 17)', () => {
  it('kluby {}: lata kadencji w odpowiedzi i ostatnie wejścia do klubów bez dodatkowych zapytań', async () => {
    const z = new ZrodloZFikstur({ 'term10/clubs': 'kluby.json', 'term10/MP': 'mp-slubowania.json' });
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, {}), z);
    expect(w.odpowiedz).toMatch(/^Kadencja 10 \(od 2023\): /);
    expect(w.odpowiedz).toMatch(/Najpóźniejsze wejście do klubu \(bez nowych posłów\): 2026-09-19, PiS, Sławomir Skwarek\./);
    const zm = w.ostatnieZmiany as Array<{ od: string; klub: string; nowyPosel?: boolean; poslowie: Array<{ imieNazwisko: string }> }>;
    expect(zm[0]).toMatchObject({ od: '2026-09-19', klub: 'PiS', liczba: 1, poslowie: [{ imieNazwisko: 'Sławomir Skwarek' }] });
    expect(zm[0].nowyPosel).toBeUndefined();
    expect(zm.every((g) => g.poslowie.length <= 5)).toBe(true);
    expect(z.zapytania.map((q) => q.sciezka).sort()).toEqual(['term10/MP', 'term10/clubs']);
  });

  it('kluby {}: wejście w dniu ślubowania to nowy poseł, nie zmiana klubu (03-b)', async () => {
    const z = new ZrodloZFikstur({ 'term10/clubs': 'kluby.json', 'term10/MP': 'mp-slubowania.json' });
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, {}), z);
    const zm = w.ostatnieZmiany as Array<{ od: string; klub: string; nowyPosel?: boolean; poslowie: Array<{ imieNazwisko: string }> }>;
    const borowiec = zm.find((g) => g.poslowie.some((p) => p.imieNazwisko === 'Bożena Borowiec'));
    expect(borowiec).toMatchObject({ od: '2026-05-15', klub: 'Lewica', nowyPosel: true });
    // Przejście do Rozwoju Plus po latach mandatu to zmiana, nie nowy poseł.
    expect(zm.find((g) => g.klub === 'RozwojPlus' && g.od === '2026-07-30')?.nowyPosel).toBeUndefined();
    expect((w.uwagi as string[]).join(' ')).toMatch(/nowyPosel=true to wejście do klubu w dniu ślubowania/);
    // Bez listy posłów: bez oznaczeń, z uwagą.
    const bez = await kluby.wykonaj(wejscie(kluby.wejscie, {}), new ZrodloZFikstur({ 'term10/clubs': 'kluby.json' }));
    expect((bez.ostatnieZmiany as Array<{ nowyPosel?: boolean }>).some((g) => g.nowyPosel)).toBe(false);
    expect((bez.uwagi as string[]).join(' ')).toMatch(/nie odróżniono od przejść/);
  });

  it('komisje z kodem podkomisji: nazwa, komisja macierzysta, daty i skład', async () => {
    const z = new ZrodloZFikstur({
      'term10/committees': 'komisje-inf.json',
      'term10/committees/INF01N': 'komisja-inf01n.json',
      'term10/committees/INF01N/members': 'komisja-inf01n-czlonkowie.json',
    });
    const w = await komisje.wykonaj(wejscie(komisje.wejscie, { kod: 'inf01n' }), z);
    expect(w).toMatchObject({ znaleziono: true, kod: 'INF01N', rodzaj: 'podkomisja nadzwyczajna', komisjaMacierzysta: { kod: 'INF' }, powolana: '2024-11-05' });
    expect((w.sklad as Array<{ funkcja: string }>).some((c) => c.funkcja === 'przewodniczący')).toBe(true);
    expect(w.odpowiedz).toMatch(/podkomisja nadzwyczajna Komisji Infrastruktury/);
  });

  it('komisje z kodem komisji: podkomisje z nazwami i datą rozwiązania; lista ma datę powołania', async () => {
    const z = new ZrodloZFikstur({
      'term10/committees': 'komisje-inf.json',
      'term10/committees/INF/members': 'komisja-zdr-czlonkowie.json',
      'term10/committees/INF01N': 'komisja-inf01n.json',
      'term10/committees/INF02N': 'komisja-inf02n.json',
    });
    const w = await komisje.wykonaj(wejscie(komisje.wejscie, { kod: 'INF' }), z);
    const pod = w.podkomisje as Array<{ kod: string; nazwa: string | null; rozwiazana: string | null }>;
    expect(pod.map((p) => [p.kod, p.rozwiazana])).toEqual([['INF01N', null], ['INF02N', '2024-12-06']]);
    expect(pod[1].nazwa).toMatch(/Prawo lotnicze/);
    expect((w.uwagi as string[]).join(' ')).toMatch(/w tym rozwiązanych 1/);
    const lista = await komisje.wykonaj(wejscie(komisje.wejscie, {}), new ZrodloZFikstur({ 'term10/committees': 'komisje-inf.json' }));
    expect((lista.komisje as Array<{ kod: string; powolana: string; podkomisji: number }>)[0]).toMatchObject({ kod: 'INF', powolana: '2023-11-21', podkomisji: 2 });
    expect((lista.uwagi as string[]).join(' ')).toMatch(/z kodem komisji/);
  });

  it('kod, którego nie ma ani na liście, ani w /committees/{kod}', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees': 'komisje-inf.json', 'term10/committees/XYZ99': null });
    const w = await komisje.wykonaj(wejscie(komisje.wejscie, { kod: 'XYZ99' }), z);
    expect(w).toMatchObject({ znaleziono: false });
    expect((w.uwagi as string[])[0]).toMatch(/Nie ma komisji ani podkomisji o kodzie XYZ99/);
  });

  it('opisKadencji', () => {
    expect(opisKadencji(8)).toBe('Kadencja 8 (2015\u20132019)');
    expect(opisKadencji(9)).toBe('Kadencja 9 (2019\u20132023)');
    expect(opisKadencji(10)).toBe('Kadencja 10 (od 2023)');
  });
});

describe('wypowiedzi: sprawozdawcy z punktem porządku (test 13)', () => {
  it('tylkoSprawozdawcy dołącza punktPorzadku i tematPunktu z uwagą o nagłówku', async () => {
    const z = new ZrodloZFikstur({});
    z.json = (async () => ({
      statements: [
        { num: 1, name: 'Anna Nowak', function: 'Poseł Sprawozdawca', memberID: 5, rapporteur: true },
        { num: 2, name: 'Jan Kowalski', function: 'Poseł', memberID: 6 },
      ],
    })) as typeof z.json;
    z.tekst = (async () =>
      '<h2 class="punkt">3. punkt porządku dziennego:</h2><p class="punkt-tytul">Sprawozdanie Komisji Zdrowia (druk nr 100).</p>') as typeof z.tekst;
    const w = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, { posiedzenie: 65, data: '2026-09-17', tylkoSprawozdawcy: true }), z);
    expect(w.spis).toEqual([
      expect.objectContaining({ numer: 1, sprawozdawca: true, punktPorzadku: '3. punkt porządku dziennego', tematPunktu: 'Sprawozdanie Komisji Zdrowia (druk nr 100).' }),
    ]);
    expect((w.uwagi as string[]).join(' ')).toMatch(/bywa niezgodny z treścią wystąpienia/);
  });
});
