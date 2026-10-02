import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BladSejmu, type ZrodloSejmu } from '../src/klient.js';
import { akt, artykulNaId, dopasujRodzajPowiazan, oczyscFraze, szukajAktow, trescAktu, zachowajIndeksy, zmianaPoStanie } from '../src/narzedzia/eli.js';
import { zapytanieSurowe } from '../src/narzedzia/surowe.js';
import { ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

// Wyniki zależą od „dziś” (vacatio legis, zmiany, które jeszcze nie weszły w życie): dzień testu z raportów.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('szukaj_aktow: granice dat', () => {
  it('wchodzaOd jest włączne: pytamy ELI od dnia wcześniej i łapiemy ustawy z 1 października', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/search': 'eli-szukaj-wchodza-pazdziernik.json' });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { rodzaj: 'Ustawa', wchodzaOd: '2026-10-01', wchodzaDo: '2026-10-31' }), z);
    expect(z.zapytania[0].parametry).toMatchObject({ dateEffectFrom: '2026-09-30', dateEffectTo: '2026-10-31' });
    const adresy = (w.akty as Array<{ adres: string }>).map((x) => x.adres);
    for (const a of ['DU/2025/1864', 'DU/2026/846', 'DU/2026/864', 'DU/2026/1161', 'DU/2026/507']) expect(adresy).toContain(a);
    expect(w.razem).toBe(5);
    // Surowy status ELI nie udaje obowiązywania: nazywa się statusWELI, a o obowiązywaniu mówi obowiazuje.
    const pierwszy = (w.akty as Array<Record<string, unknown>>)[0];
    expect(pierwszy).toHaveProperty('statusWELI');
    expect(pierwszy).not.toHaveProperty('status');
    expect(w.uwagi!.join(' ')).toMatch(/o tym, czy akt obowiązuje, mówi pole obowiazuje, nie statusWELI/);
  });

  it('dzień przed granicą, gdyby przyszedł z API, jest odcinany po stronie serwera', async () => {
    // Ta sama odpowiedź, a granica dzień później: akty z 1 października muszą wypaść.
    const z = new ZrodloZFikstur({ 'eli/acts/search': 'eli-szukaj-wchodza-pazdziernik.json' });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { rodzaj: 'Ustawa', wchodzaOd: '2026-10-02' }), z);
    expect(z.zapytania[0].parametry).toMatchObject({ dateEffectFrom: '2026-10-01' });
    const wejscia = (w.akty as Array<{ wejscieWZycie: string }>).map((x) => x.wejscieWZycie);
    expect(wejscia.every((d) => d >= '2026-10-02')).toBe(true);
    expect(w.razem).toBe(2);
  });

  it('ogloszoneOd i od też przesuwają się o dzień; zmienioneOd pyta od 23:59:59 dnia wcześniej', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/search': 'eli-szukaj-wchodza-pazdziernik.json' });
    await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { ogloszoneOd: '2026-01-01', od: '2025-03-01' }), z);
    expect(z.zapytania[0].parametry).toMatchObject({ pubDateFrom: '2025-12-31', dateFrom: '2025-02-28' });
  });
});

describe('szukaj_aktow: fraza z wyciekłym znacznikiem', () => {
  it('bierze tekst do pierwszego znacznika i mówi o tym', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/search': 'eli-szukaj-krs.json' });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { fraza: 'Krajowej Radzie Sądownictwa</fraza>\n<parameter name="rok">2024' }), z);
    expect(z.zapytania[0].parametry?.title).toBe('Krajowej Radzie Sądownictwa');
    expect(w.uwagi?.[0]).toMatch(/znaczniki/);
  });

  it('odrzuca frazę, z której nic nie zostaje', () => {
    expect(() => oczyscFraze('<fraza>x')).toThrow(/znaczniki/);
    expect(oczyscFraze('Kodeks pracy')).toEqual({ fraza: 'Kodeks pracy', uwaga: null });
  });
});

describe('akt', () => {
  it('ustawa ogłoszona z wejściem w życie w przyszłości: obowiazuje „jeszcze nie”', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2026/1098': 'eli-du-2026-1098.json', 'eli/acts/DU/2026/1098/references': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/1098' }), z);
    expect(w.obowiazuje).toBe('jeszcze nie (wchodzi w życie 2027-01-01)');
    expect(w.odpowiedz).toMatch(/jeszcze nie obowiązuje: wchodzi w życie 2027-01-01/);
  });

  it('druki sejmowe niosą numer druku i procesu z podpowiedzią o narzędziu proces', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2026/1098': 'eli-du-2026-1098.json', 'eli/acts/DU/2026/1098/references': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/1098' }), z);
    expect(w.drukiSejmowe).toEqual([{ numer: '2580', kadencja: 10, proces: '2580', link: 'https://www.sejm.gov.pl/Sejm10.nsf/PrzebiegProc.xsp?nr=2580' }]);
    expect(w.odpowiedz).toMatch(/narzędzie proces 2580/);
  });

  it('powiazania: „Teksty jednolite” to „Inf. o tekście jednolitym”, a nie cichy brak filtra', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/1974/141': 'eli-du-1974-141.json', 'eli/acts/DU/1974/141/references': null, 'eli/acts/DU/2025/277': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/1974/141', powiazania: 'Teksty jednolite', powiazaniaLimit: 50 }), z);
    expect(w.uwagi?.[0]).toMatch(/odczytano jako „Inf\. o tekście jednolitym”/);
    const tj = (w.powiazania as Array<{ rodzaj: string; liczba: number; akty: unknown[] }>).find((p) => p.rodzaj === 'Inf. o tekście jednolitym');
    expect(tj?.akty.length).toBe(Math.min(50, tj!.liczba));
    // Pozostałe rodzaje to same liczby, bez adresów i bez uwagi „całą listę daje parametr powiazania”.
    const inne = (w.powiazania as Array<{ rodzaj: string; liczba: number; akty?: unknown[] }>).filter((p) => p.rodzaj !== 'Inf. o tekście jednolitym');
    expect(inne.length).toBeGreaterThan(0);
    expect(inne.every((p) => p.akty === undefined && p.liczba > 0)).toBe(true);
    expect(w.uwagi!.join(' ')).not.toMatch(/całą listę daje parametr powiazania/);
    expect(JSON.stringify(w).length).toBeLessThan(12_000);
  });

  it('bez filtra powiązań: po 10 adresów każdego rodzaju i uwaga o parametrze powiazania', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/1974/141': 'eli-du-1974-141.json', 'eli/acts/DU/2025/277': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/1974/141' }), z);
    expect((w.powiazania as Array<{ akty?: unknown[] }>).every((p) => Array.isArray(p.akty) && p.akty.length <= 10)).toBe(true);
    expect(w.uwagi!.join(' ')).toMatch(/całą listę daje parametr powiazania/);
  });

  it('ustawa budżetowa: stosujeSieOd z validFrom (2026-01-01), inne niż wejście w życie (2026-01-20)', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2026/62': 'eli-du-2026-62.json', 'eli/acts/DU/2026/62/references': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/62' }), z);
    expect(w.stosujeSieOd).toBe('2026-01-01');
    expect(w.wejscieWZycie).toBe('2026-01-20');
    expect(w.odpowiedz).toMatch(/stosuje się od 2026-01-01/);
  });

  it('bez różnicy validFrom i wejścia w życie odpowiedź o stosowaniu milczy', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2026/1098': 'eli-du-2026-1098.json', 'eli/acts/DU/2026/1098/references': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/1098' }), z);
    if (w.stosujeSieOd === w.wejscieWZycie || w.stosujeSieOd === null) expect(w.odpowiedz).not.toMatch(/stosuje się od/);
  });

  it('powiazania spoza słownika: uwaga z listą rodzajów tego aktu', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/1974/141': 'eli-du-1974-141.json', 'eli/acts/DU/1974/141/references': null, 'eli/acts/DU/2025/277': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/1974/141', powiazania: 'Wywiady prasowe' }), z);
    expect(w.uwagi?.[0]).toMatch(/Nieznany rodzaj powiązania „Wywiady prasowe”\. Ten akt ma: .*Akty zmieniające/);
  });

  it('dopasowanie rodzaju powiązania: liczba mnoga, bez polskich znaków, synonimy', () => {
    const dostepne = ['Akty zmieniające', 'Akty zmienione', 'Orzeczenie TK', 'Inf. o tekście jednolitym'];
    expect(dopasujRodzajPowiazan('Orzeczenia TK', dostepne)).toBe('Orzeczenie TK');
    expect(dopasujRodzajPowiazan('akty zmieniajace', dostepne)).toBe('Akty zmieniające');
    expect(dopasujRodzajPowiazan('nowelizacje', dostepne)).toBe('Akty zmieniające');
    expect(dopasujRodzajPowiazan('Teksty jednolite', dostepne)).toBe('Inf. o tekście jednolitym');
    expect(dopasujRodzajPowiazan('Akty uchylające', dostepne)).toBe('Akty uchylające');
    expect(dopasujRodzajPowiazan('Wywiady prasowe', dostepne)).toBeNull();
  });
});

describe('tresc_aktu', () => {
  const kodeks = () =>
    new ZrodloZFikstur({
      'eli/acts/DU/1964/93': 'eli-du-1964-93.json',
      'eli/acts/DU/2026/795': 'eli-du-2026-795.json',
      'eli/acts/DU/2025/1071': 'eli-du-2025-1071.json',
      'eli/acts/DU/2024/1061': 'eli-du-2024-1061.json',
      'eli/acts/DU/2024/1061/text.html': 'eli-du-2024-1061-wycinek.html',
      'eli/acts/DU/1964/93/references': 'eli-du-1964-93-references-zmieniajace.json',
      // Najnowszy tekst jednolity jest tylko w PDF; tu go nie ma (404), więc cytat idzie ze starszego HTML.
      'eli/acts/DU/2026/795/text.pdf': null,
    });

  it('akt tylko w PDF: odpowiedź mówi, czym jest akt (DU/1997/78 to nie Konstytucja)', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/1997/78': 'eli-du-1997-78.json', 'eli/acts/DU/1997/78/text.pdf': null });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1997/78', artykul: '30' }), z);
    expect(w.akt).toMatchObject({ adres: 'DU/1997/78', rodzaj: 'Rozporządzenie', oznaczenie: 'Dz.U. 1997 nr 14 poz. 78' });
    expect(w.odpowiedz).toMatch(/Rozporządzenie Ministra Finansów/);
  });

  it('opis adresu mówi o rok/POZYCJA i o Konstytucji', () => {
    const opis = JSON.stringify(trescAktu.wejscie.shape.adres.description);
    expect(opis).toMatch(/DU\/1997\/483/);
  });

  it('indeksy górne zostają: § 2¹ w art. 117, Art. 764⁵ i odesłania do 764³ i 764⁴', async () => {
    const w117 = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1964/93', artykul: '117' }), kodeks());
    expect(w117.tekst).toMatch(/§ 2¹\.\nPo upływie terminu przedawnienia nie można/);
    expect(w117.tekst).not.toMatch(/Art\. 117¹/);
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1964/93', artykul: '764^5' }), kodeks());
    expect(w.tekst).toMatch(/^Art\. 764⁵\./);
    expect(w.tekst).toMatch(/art\. 764³ i art\. 764⁴/);
    expect(w.odpowiedz).toMatch(/^Art\. 764⁵: DU\/1964\/93 \(„Ustawa z dnia 23 kwietnia 1964 r\. - Kodeks cywilny\.”/);
  });

  it('nieistniejący artykuł: wprost, że go nie ma, i numer ostatniego', async () => {
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1964/93', artykul: '1150' }), kodeks());
    expect(w.znaleziono).toBe(false);
    expect(w.odpowiedz).toMatch(/^Art\. 1150 nie istnieje w tym tekście \(Dz\.U\. 2024 poz\. 1061\); ostatni artykuł to 1088\./);
    // Liczba jednostek „Art.” (1296 z indeksami i literami) nie jest liczbą artykułów: pola nie ma.
    expect(w).not.toHaveProperty('artykulow');
    expect(w.zrodloTekstu).toMatchObject({ adres: 'DU/2024/1061', format: 'html', starszyNizNajnowszy: true });
    expect(w.uwagi?.join(' ')).toMatch(/tylko w PDF/);
  });

  it('spłaszczony indeks („7645”) dostaje podpowiedź art. 764⁵', async () => {
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1964/93', artykul: '7645' }), kodeks());
    expect(w.odpowiedz).toMatch(/Czy chodziło o art\. 764⁵ \(artykul: "764\^5"\)/);
  });

  it('nowszy tekst jednolity tylko w PDF i zmiany po stanie prawnym cytowanego tekstu, z datami', async () => {
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1964/93', artykul: '117' }), kodeks());
    expect(w.tekstZ).toMatchObject({ adres: 'DU/2024/1061', stanPrawnyNa: '2024-06-19' });
    const uwagi = w.uwagi!.join(' ');
    expect(uwagi).toMatch(/^UWAGA: tekst jednolity obejmuje zmiany ogłoszone przed dniem stanu prawnego \(2024-06-19\); od tego dnia ogłoszono \d+ (akty zmieniające|aktów zmieniających)/);
    expect(uwagi).toMatch(/NOWSZY tekst jednolity DU\/2026\/795/);
    const zmiany = w.zmianyPoTekscie as Array<{ adres: string; wZyciuOd: string | null }>;
    expect(zmiany.length).toBeGreaterThan(0);
    expect(zmiany.every((z) => !z.wZyciuOd || z.wZyciuOd > '2024-06-19')).toBe(true);
  });

  it('zmianaPoStanie: data ogłoszenia rozstrzyga; bez niej rok z adresu, a w roku stanu data wejścia w życie', () => {
    expect(zmianaPoStanie({ id: 'DU/2024/1871', date: '2025-03-19' }, '2024-12-18', '2025-02-07')).toBe(false);
    expect(zmianaPoStanie({ id: 'DU/2025/807', date: '2025-12-24' }, '2025-06-24', '2025-02-07')).toBe(true);
    expect(zmianaPoStanie({ id: 'DU/2025/1', date: '2025-01-02' }, '2025-02-07', '2025-02-07')).toBe(true);
    expect(zmianaPoStanie({ id: 'DU/2024/1871', date: '2025-03-19' }, undefined, '2025-02-07')).toBe(false);
    expect(zmianaPoStanie({ id: 'DU/2026/25', date: '2026-01-27' }, undefined, '2025-02-07')).toBe(true);
    expect(zmianaPoStanie({ id: 'DU/2025/9', date: '2025-03-01' }, undefined, '2025-02-07')).toBe(true);
  });

  it('numery artykułów w każdej postaci', () => {
    expect(artykulNaId('52a')).toBe('52a');
    expect(artykulNaId('764^5')).toBe('764_5');
    expect(artykulNaId('764⁵')).toBe('764_5');
    expect(artykulNaId('764(5)')).toBe('764_5');
    expect(artykulNaId('7645')).toBe('7645');
    expect(trescAktu.wejscie.safeParse({ adres: 'DU/1964/93', artykul: '764^5' }).success).toBe(true);
    expect(trescAktu.wejscie.safeParse({ adres: 'DU/1964/93', fragment: 'book_PIERWSZA-part_OGÓLNA-titl_VI-arti_117-para_2_1' }).success).toBe(true);
    expect(zachowajIndeksy('Art.&nbsp;764<SUP>5</SUP>. przypis<sup>12)</sup>')).toBe('Art.&nbsp;764⁵. przypis¹²⁾');
    // Prawdziwy odnośnik z t.j. Kodeksu karnego (DU/2024/17, art. 148 § 1).
    const kk =
      '§&nbsp;1<A class="gloss-link tooltip" href="#gloss-0:101:"><sup>101)</sup><span class="tooltip-text"><span class="pro-gloss-inner">Ze zmianą wprowadzoną przez art. 1 pkt 55 lit. a ustawy, o której mowa w odnośniku\n 2.</span></span></A>.';
    expect(zachowajIndeksy(kk)).toBe('§&nbsp;1 [przypis 101: Ze zmianą wprowadzoną przez art. 1 pkt 55 lit. a ustawy, o której mowa w odnośniku 2.].');
  });
});

describe('zapytanie_surowe: komunikaty', () => {
  const zrodloZBledem = (status: number): ZrodloSejmu => {
    const z = new ZrodloZFikstur({});
    return { json: async () => { throw new BladSejmu(`Sejm odpowiedział ${status}`, status); }, lista: z.lista.bind(z), tekst: z.tekst.bind(z), bajty: z.bajty.bind(z), adres: z.adres.bind(z) };
  };

  it('406 dla tekstu aktu odsyła do tresc_aktu', async () => {
    const w = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'eli/acts/DU/2024/1061/text.html' }), zrodloZBledem(406));
    expect(w.znaleziono).toBe(false);
    expect(w.odpowiedz).toMatch(/tresc_aktu/);
  });

  it('404 dla marszałka odsyła do głosowania nad wyborem', async () => {
    const z = new ZrodloZFikstur({ 'term9/marshal': null });
    const w = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'term9/marshal' }), z);
    expect(w.uwagi?.[0]).toMatch(/nie ma zasobu z marszałkiem.*Wybór Marszałka Sejmu/);
    expect(w.uwagi?.[0]).toMatch(/proceedings\/\{nr\}\/\{RRRR-MM-DD\}\/transcripts/);
    expect(w.uwagi?.[0]).toMatch(/videos/);
  });

  it('od poza długością odpowiedzi: mówi, ile znaków ma odpowiedź', async () => {
    const z = new ZrodloZFikstur({ term10: 'kadencja.json' });
    const w = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'term10', od: 999_999_999 }), z);
    expect(w.uwagi?.[0]).toMatch(/wykracza poza odpowiedź: ma ona \d+ znaków/);
  });
});
