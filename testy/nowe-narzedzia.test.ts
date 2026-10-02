import { describe, expect, it } from 'vitest';
import { slownikEli } from '../src/narzedzia/eli.js';
import { grupyBilateralne, kadencje, komisje, porzadekPosiedzenia, transmisje } from '../src/narzedzia/izba.js';
import { szukajDrukow, szukajProjektow } from '../src/narzedzia/legislacja.js';
import { posiedzeniaKomisji } from '../src/narzedzia/posiedzenia.js';
import { kluby } from '../src/narzedzia/poslowie.js';
import { ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

describe('izba', () => {
  it('kadencje: dziesięć kadencji, trwa tylko X', async () => {
    const w = await kadencje.wykonaj(wejscie(kadencje.wejscie, {}), new ZrodloZFikstur({ term: 'kadencje.json' }));
    const lista = w.kadencje as Array<{ kadencja: number; trwa: boolean }>;
    expect(lista).toHaveLength(10);
    expect(lista.filter((k) => k.trwa).map((k) => k.kadencja)).toEqual([10]);
  });

  it('komisje: lista, skład z funkcjami bez dawnych członków, komisje posła', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees': 'komisje.json', 'term10/committees/ZDR/members': 'komisja-zdr-czlonkowie.json' });
    const lista = await komisje.wykonaj(wejscie(komisje.wejscie, {}), z);
    expect((lista.komisje as Array<{ kod: string }>).map((k) => k.kod)).toContain('ZDR');

    const zdr = await komisje.wykonaj(wejscie(komisje.wejscie, { kod: 'zdr' }), z);
    const sklad = zdr.sklad as Array<{ imieNazwisko: string; funkcja: string; doKiedy?: string }>;
    expect(sklad.some((c) => c.funkcja === 'przewodniczący' || c.funkcja === 'przewodnicząca')).toBe(true);
    expect(sklad.every((c) => !c.doKiedy)).toBe(true);
    // Bartosz Arłukowicz przewodniczył do 2024-06-10: w dzisiejszym składzie go nie ma.
    expect(sklad.some((c) => c.imieNazwisko === 'Bartosz Arłukowicz')).toBe(false);
  });

  it('porzadek_posiedzenia: porządek jako tekst', async () => {
    const z = new ZrodloZFikstur({ 'term10/proceedings/current': 'posiedzenie-biezace.json' });
    const w = await porzadekPosiedzenia.wykonaj(wejscie(porzadekPosiedzenia.wejscie, {}), z);
    expect((w.porzadek as { tekst: string }).tekst).toMatch(/Porządek dzienny/);
    expect((w.porzadek as { tekst: string }).tekst).not.toMatch(/<div/);
  });

  it('transmisje z jednego dnia z linkiem do odtwarzacza na sejm.gov.pl', async () => {
    const z = new ZrodloZFikstur({ 'term10/videos/2024-04-24': 'transmisje-2024-04-24.json' });
    const w = await transmisje.wykonaj(wejscie(transmisje.wejscie, { data: '2024-04-24' }), z);
    const lista = w.transmisje as Array<{ odtwarzacz: string | null }>;
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((t) => t.odtwarzacz === null || t.odtwarzacz.startsWith('https://sejm.gov.pl/'))).toBe(true);
  });

  it('grupy bilateralne: wyszukiwanie po nazwie i członkowie z funkcją po polsku', async () => {
    const z = new ZrodloZFikstur({ 'term10/bilateralGroups': 'grupy.json', 'term10/bilateralGroups/532': 'grupa-532.json' });
    const g = await grupyBilateralne.wykonaj(wejscie(grupyBilateralne.wejscie, { id: 532 }), z);
    expect((g.czlonkowie as Array<{ funkcja: string }>)[0].funkcja).toBe('przewodniczący');
    expect(typeof (g.czlonkowie as Array<{ id: unknown }>)[0].id).toBe('number');
  });

  it('kluby: skład klubu z funkcjami i logo', async () => {
    const z = new ZrodloZFikstur({ 'term10/clubs/Centrum': 'klub-centrum.json' });
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, { klub: 'Centrum' }), z);
    expect(w).toMatchObject({ znaleziono: true, rodzaj: 'klub', logo: 'https://api.sejm.gov.pl/sejm/term10/clubs/Centrum/logo' });
    expect((w.sklad as Array<{ funkcja: string }>)[0].funkcja).toBe('przewodniczący');
  });
});

describe('posiedzenia komisji: historia i jedno posiedzenie', () => {
  it('historia komisji od najnowszych, porządek skrócony, zapis PDF przy zakończonych', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/ZDR/sittings': 'komisja-zdr-posiedzenia.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { komisja: 'ZDR' }), z);
    const lista = w.posiedzenia as Array<{ numer: number; zapisPdf: string | null; porzadek: string | null }>;
    expect(lista[0].numer).toBeGreaterThan(lista[lista.length - 1].numer);
    expect(lista.find((p) => p.zapisPdf)?.zapisPdf).toMatch(/\/committees\/ZDR\/sittings\/\d+\/pdf$/);
    expect(lista.every((p) => (p.porzadek?.length ?? 0) <= 401)).toBe(true);
  });

  it('jedno posiedzenie z pełnym porządkiem', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/ZDR/sittings/164': 'komisja-zdr-164.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { komisja: 'ZDR', numer: 164 }), z);
    expect(w).toMatchObject({ znaleziono: true, numer: 164, status: 'zakończone' });
  });

  it('bez daty i bez komisji to błąd z podpowiedzią', async () => {
    await expect(posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, {}), new ZrodloZFikstur({}))).rejects.toThrow(/Podaj data/);
  });
});

describe('projekty i druki', () => {
  it('szukaj_projektow: filtr wnioskodawcy u siebie, od najnowszych, po polsku', async () => {
    const z = new ZrodloZFikstur({ 'term10/bills': 'projekty.json' });
    const w = await szukajProjektow.wykonaj(wejscie(szukajProjektow.wejscie, { wnioskodawca: 'Prezydent' }), z);
    const lista = w.projekty as Array<{ wnioskodawca: string; wplynal: string }>;
    expect(lista.every((p) => p.wnioskodawca === 'Prezydent')).toBe(true);
    expect([...lista].map((p) => p.wplynal)).toEqual([...lista].map((p) => p.wplynal).sort().reverse());
  });

  it('szukaj_drukow: wszystkie słowa w tytule, bez polskich znaków', async () => {
    const z = new ZrodloZFikstur({ 'term10/prints': 'druki.json' });
    const w = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { fraza: 'asystencji osobistej' }), z);
    expect((w.druki as Array<{ tytul: string }>).every((d) => /asystencji osobistej/i.test(d.tytul))).toBe(true);
    expect(w.razem).toBeGreaterThan(0);
  });
});

describe('słowniki ELI', () => {
  it('rodzaje aktów zawierają Ustawę', async () => {
    const w = await slownikEli.wykonaj(wejscie(slownikEli.wejscie, { slownik: 'rodzaje' }), new ZrodloZFikstur({ 'eli/types': 'eli-rodzaje.json' }));
    expect(w.pozycje).toContain('Ustawa');
  });

  it('tytuly bez frazy to błąd', async () => {
    await expect(slownikEli.wykonaj(wejscie(slownikEli.wejscie, { slownik: 'tytuly' }), new ZrodloZFikstur({}))).rejects.toThrow(/podaj frazę/);
  });
});

describe('izba po testach 03 i 20', () => {
  it('kluby bez parametru: Lewica to klub, niez. to niezrzeszeni; 8 klubów i 3 koła', async () => {
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, {}), new ZrodloZFikstur({ 'term10/clubs': 'kluby.json' }));
    const lista = w.kluby as Array<{ skrot: string; rodzaj: string | null }>;
    expect(lista.find((k) => k.skrot === 'Lewica')?.rodzaj).toBe('klub');
    expect(lista.find((k) => k.skrot === 'niez.')?.rodzaj).toBe('niezrzeszeni');
    expect(lista.every((k) => k.rodzaj !== null)).toBe(true);
    expect(w).toMatchObject({ liczbaKlubow: 8, liczbaKol: 3 });
    expect(w.odpowiedz).toMatch(/8 klubów, 3 koła/);
  });

  it('kluby {klub:"PSL"}: skrót potoczny dopasowany do PSL-TD, z uwagą o dacie od', async () => {
    const z = new ZrodloZFikstur({ 'term10/clubs/PSL': null, 'term10/clubs': 'kluby.json', 'term10/clubs/PSL-TD': 'klub-centrum.json' });
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, { klub: 'PSL' }), z);
    expect(w.znaleziono).toBe(true);
    expect(z.zapytania.map((q) => q.sciezka)).toEqual(['term10/clubs/PSL', 'term10/clubs', 'term10/clubs/PSL-TD']);
    expect((w.uwagi as string[]).join(' ')).toMatch(/data wejścia posła do TEGO klubu/);
  });

  it('kluby: niejednoznaczny skrót podpowiada, nazwa ze spacjami nie idzie do ścieżki', async () => {
    const z = new ZrodloZFikstur({ 'term10/clubs/Konf': null, 'term10/clubs': 'kluby.json' });
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, { klub: 'Konf' }), z);
    expect(w).toMatchObject({ znaleziono: false });
    expect((w.pasujace as Array<{ skrot: string }>).map((k) => k.skrot)).toEqual(['Konfederacja', 'Konfederacja_KP']);
    const z2 = new ZrodloZFikstur({ 'term10/clubs': 'kluby.json', 'term10/clubs/PiS': 'klub-centrum.json' });
    await kluby.wykonaj(wejscie(kluby.wejscie, { klub: 'Prawo i Sprawiedliwość' }), z2);
    expect(z2.zapytania.map((q) => q.sciezka)).toEqual(['term10/clubs', 'term10/clubs/PiS']);
  });

  it('kadencje I–V: druków null z uwagą, nie zero', async () => {
    const w = await kadencje.wykonaj(wejscie(kadencje.wejscie, {}), new ZrodloZFikstur({ term: 'kadencje.json' }));
    const lista = w.kadencje as Array<{ kadencja: number; drukow: number | null }>;
    expect(lista.find((k) => k.kadencja === 1)?.drukow).toBeNull();
    expect(lista.find((k) => k.kadencja === 10)?.drukow).toBeGreaterThan(0);
    expect((w.uwagi as string[])[0]).toMatch(/API nie ma danych/);
  });

  it('odwrócony przedział dat to błąd, nie pusty wynik', async () => {
    await expect(transmisje.wykonaj(wejscie(transmisje.wejscie, { od: '2026-05-01', do: '2025-01-01' }), new ZrodloZFikstur({}))).rejects.toThrow(/Odwrócony przedział/);
  });
});

describe('posiedzenia komisji: dwa posiedzenia jednego dnia i posiedzenia wspólne (benchmark B177–B179)', () => {
  // Rejestr RRW: 167 i 168 oba 10.06.2026, 168 wspólne z KSP 133, 169 wspólne z SUE 150.
  // Spis dzienny 10.06.2026 ma RRW 167 i KSP 133 z jointWith RRW 168, a samego RRW 168 nie ma.
  it('czerwiec 2026 z kodem: trzy posiedzenia w dwóch dniach, z rejestru komisji', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/RRW/sittings': 'komisja-rrw-posiedzenia-2026-06.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { komisja: 'RRW', od: '2026-06-01', do: '2026-06-30' }), z);
    expect(w.razem).toBe(3);
    expect(w.dniPosiedzen).toBe(2);
    expect((w.posiedzenia as Array<{ numer: number }>).map((p) => p.numer)).toEqual([169, 168, 167]);
    expect(w.odpowiedz).toMatch(/3 posiedzenia \(w 2 dniach\).*Numery: 167, 168, 169\./);
    expect((w.uwagi as string[]).join(' ')).toMatch(/liczba POSIEDZEŃ, nie dni/);
    expect(z.zapytania.map((q) => q.sciezka)).toEqual(['term10/committees/RRW/sittings']);
  });

  it('z kodem i jednym dniem (data): oba posiedzenia 10.06.2026', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/RRW/sittings': 'komisja-rrw-posiedzenia-2026-06.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { komisja: 'RRW', data: '2026-06-10' }), z);
    expect((w.posiedzenia as Array<{ numer: number }>).map((p) => p.numer)).toEqual([168, 167]);
  });

  it('awaria rejestru komisji: zapas ze spisu dziennego liczy też posiedzenie wspólne prowadzone przez inną komisję', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/sittings/2026-06-10': 'komisje-2026-06-10.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { komisja: 'RRW', od: '2026-06-10', do: '2026-06-10' }), z);
    const lista = w.posiedzenia as Array<{ komisja: string; numer: number; wspolnieZ: Array<{ code: string; num: number }> }>;
    expect(lista.map((p) => `${p.komisja} ${p.numer}`)).toEqual(['RRW 168', 'RRW 167']);
    expect(lista[0].wspolnieZ).toEqual([{ code: 'KSP', num: 133 }]);
    expect(w.wynikCzesciowy).toBeDefined();
  });

  it('bez kodu: posiedzenie wspólne jest jedną pozycją pod komisją prowadzącą, z uwagą', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/sittings/2026-06-10': 'komisje-2026-06-10.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { data: '2026-06-10' }), z);
    expect(w.liczba).toBe(29);
    expect((w.uwagi as string[]).join(' ')).toMatch(/pod komisją prowadzącą/);
  });
});
