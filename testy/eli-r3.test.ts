import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zlozAdres, type OpcjePobrania, type Parametry, type ZrodloSejmu } from '../src/klient.js';
import {
  akt,
  artykulNaId,
  artykulZTekstuPdf,
  indeksyZNawiasow,
  szukajAktow,
  tekstUstawyZObwieszczenia,
  terminyZKomentarza,
  trescAktu,
  wytnijJednostke,
} from '../src/narzedzia/eli.js';
import { zapytanieSurowe } from '../src/narzedzia/surowe.js';
import { bezZnakowPrywatnych, OPCJE_AKTU, tekstZPdf } from '../src/pdf.js';
import { wiersze, zbudujPdf } from './pdf-wzor.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

/** Źródło z obiektów w pamięci: ścieżka → JSON, HTML albo bajty PDF. Brak ścieżki to błąd testu. */
class ZrodloZMapy implements ZrodloSejmu {
  zapytania: Array<{ sciezka: string; parametry?: Parametry }> = [];
  constructor(private readonly mapa: Record<string, unknown>) {}
  private wez(sciezka: string, opcje?: OpcjePobrania): unknown {
    this.zapytania.push({ sciezka, parametry: opcje?.parametry });
    if (!(sciezka in this.mapa)) throw new Error(`Brak danych dla ${sciezka}`);
    return this.mapa[sciezka];
  }
  async json<T>(s: string, o?: OpcjePobrania) {
    return this.wez(s, o) as T | null;
  }
  async lista<T>(s: string, o?: OpcjePobrania) {
    const d = (this.wez(s, o) as T[] | null) ?? [];
    return { dane: d, razem: d.length };
  }
  async tekst(s: string, o?: OpcjePobrania) {
    return this.wez(s, o) as string | null;
  }
  async bajty(s: string, o?: OpcjePobrania) {
    return this.wez(s, o) as Uint8Array | null;
  }
  adres(s: string, p?: Parametry) {
    return zlozAdres(s, p).href;
  }
}

describe('tresc_aktu: obwieszczenie w HTML (Prawo o ruchu drogowym, DU/2024/1251)', () => {
  // Wycinek w układzie ELI: część obwieszczenia przytacza art. 20 nowelizacji, załącznik to ustawa.
  const html =
    '<div class="part" ><h2>Treść obwieszczenia</h2><div class="block">' +
    '<div class="unit unit_pass pro-text false" id="pass_2" data-id="pass_2"><div class="unit-inner">2. Tekst jednolity nie obejmuje:</div>' +
    '<div class="unit unit_pint" id="pass_2-pint_11" data-id="pint_11"><div class="unit-inner">11) art. 20 ustawy zmieniającej:</div>' +
    '<div class="unit unit_arti" id="pass_2-pint_11-arti_20" data-id="arti_20"><div class="unit-inner">Art. 20. Dotychczasowe przepisy wykonawcze zachowują moc.</div></div>' +
    '</div></div></div></div>' +
    '<div class="part" ><h2>Załącznik &nbsp;-&nbsp; Tekst jednolity ustawy z dnia 20 czerwca 1997 r. Prawo o ruchu drogowym</h2><div class="block">' +
    '<div class="unit unit_bran" id="bran_II" data-id="bran_II"><div class="unit-inner">DZIAŁ II</div>' +
    '<div class="unit unit_arti" id="bran_II-chpt_3-schp_3-arti_20" data-id="arti_20"><div class="unit-inner">Art. 20. 1. Prędkość dopuszczalna pojazdu na obszarze zabudowanym wynosi 50 km/h.</div></div>' +
    '<div class="unit unit_arti" id="bran_II-chpt_3-schp_3-arti_21" data-id="arti_21"><div class="unit-inner">Art. 21. Inny.</div></div>' +
    '</div></div></div>';

  const zrodlo = () =>
    new ZrodloZMapy({
      'eli/acts/DU/2024/1251': {
        publisher: 'DU', year: 2024, pos: 1251, type: 'Obwieszczenie', title: 'Obwieszczenie Marszałka Sejmu w sprawie ogłoszenia jednolitego tekstu ustawy - Prawo o ruchu drogowym',
        textHTML: true, legalStatusDate: '2024-07-19', displayAddress: 'Dz.U. 2024 poz. 1251',
        references: { 'Tekst jednolity dla aktu': [{ id: 'DU/1997/602' }] },
      },
      'eli/acts/DU/1997/602': {
        publisher: 'DU', year: 1997, pos: 602, type: 'Ustawa', title: 'Ustawa z dnia 20 czerwca 1997 r. - Prawo o ruchu drogowym',
        references: { 'Inf. o tekście jednolitym': [{ id: 'DU/2024/1251' }] },
      },
      'eli/acts/DU/2024/1251/text.html': html,
    });

  it('artykul "20" to art. 20 ustawy z załącznika, nie art. 20 nowelizacji przytoczony w obwieszczeniu', async () => {
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2024/1251', artykul: '20' }), zrodlo());
    expect(w.znaleziono).toBe(true);
    expect(w.tekst).toMatch(/^Art\. 20\. 1\. Prędkość dopuszczalna/);
    expect(w.tekst).not.toMatch(/Dotychczasowe przepisy wykonawcze/);
    expect(w.tekst).not.toMatch(/Art\. 21/);
  });

  it('dokładne id z spisu nadal sięga do części obwieszczenia', async () => {
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2024/1251', fragment: 'pass_2-pint_11-arti_20' }), zrodlo());
    expect(w.tekst).toMatch(/Dotychczasowe przepisy wykonawcze/);
  });

  it('bez załącznika HTML zostaje cały; wśród trafień wygrywa artykuł tego samego poziomu', () => {
    expect(tekstUstawyZObwieszczenia('<div class="unit x" id="arti_1">')).toBe('<div class="unit x" id="arti_1">');
    const nowelizacja =
      '<div class="unit a" id="arti_2">Art. 2. W ustawie X:</div><div class="unit a" id="arti_2-pint_1-arti_5">Art. 5. cytowany</div>' +
      '<div class="unit a" id="arti_5">Art. 5. własny</div><div class="unit a" id="arti_6">Art. 6.</div>';
    expect(wytnijJednostke(nowelizacja, 'arti_5')).toMatch(/własny/);
  });
});

describe('PDF: indeks górny w nawiasie i odnośnik przypisu po kropce', () => {
  const kodeks = zbudujPdf([
    [
      ...wiersze(['Załącznik do obwieszczenia Marszałka Sejmu', 'Art. 446. § 1. Jeżeli wskutek uszkodzenia ciała nastąpiła śmierć.', '§ 4. Sąd może przyznać zadośćuczynienie.']),
      { tekst: 'Art. 446[1].', x: 72, y: 730 },
      { tekst: '6)', x: 120.7, y: 733.5, rozmiar: 6.5 },
      { tekst: ' Z chwilą urodzenia dziecko może żądać naprawienia szkód.', x: 126.5, y: 730 },
      { tekst: 'Art. 446[2]. W razie ciężkiego uszkodzenia ciała sąd może przyznać sumę.', x: 72, y: 716 },
      { tekst: 'Art. 23', x: 72, y: 702 },
      { tekst: '1', x: 101.5, y: 705.5, rozmiar: 6.5 },
      { tekst: '.', x: 105.1, y: 702 },
      { tekst: '3)', x: 107.9, y: 705.5, rozmiar: 6.5 },
      { tekst: ' § 1. W razie przejścia zakładu pracy na innego pracodawcę.', x: 113.7, y: 702 },
      { tekst: 'Art. 24. Następny.', x: 72, y: 688 },
    ],
  ]);

  it('446^1, 446[1] i 446¹ trafiają w „Art. 446[1].⁶⁾”, a wycinek 446 kończy się przed 446¹', async () => {
    const w = await tekstZPdf(kodeks, OPCJE_AKTU);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const tekst = indeksyZNawiasow(w.tekst);
    for (const zapis of ['446^1', '446[1]', '446¹']) {
      const c = artykulZTekstuPdf(tekst, '446¹');
      expect(artykulNaId(zapis)).toBe('446_1');
      expect(c.tekst).toMatch(/^Art\. 446¹\.⁶⁾ Z chwilą urodzenia/);
      expect(c.tekst).not.toMatch(/446²/);
    }
    const art446 = artykulZTekstuPdf(tekst, '446');
    expect(art446.tekst).toMatch(/§ 4\. Sąd może przyznać zadośćuczynienie\.$/);
    expect(artykulZTekstuPdf(tekst, '446²').tekst).toMatch(/^Art\. 446²\. W razie/);
    expect(artykulZTekstuPdf(tekst, '23¹').tekst).toMatch(/^Art\. 23¹\.³⁾ § 1\. W razie przejścia/);
  });

  it('schemat wejścia przyjmuje „446[1]”', () => {
    expect(() => trescAktu.wejscie.parse({ adres: 'DU/2026/795', artykul: '446[1]' })).not.toThrow();
  });
});

describe('PDF: nagłówki, stopki i znaki z czcionek symbolowych', () => {
  it('stary nagłówek „Dziennik Ustaw Nr 78 - 2414 -”, samotne „Poz. 483” i stopka wydawcy nie wchodzą do art. 243', async () => {
    const pdf = zbudujPdf([
      wiersze(['Dziennik Ustaw Nr 78 - 2414 -', 'Art. 242. Tracą moc:', '1) ustawa konstytucyjna.']),
      wiersze([
        'Dziennik Ustaw Nr 78 - 2415 -',
        'Art. 243. Konstytucja wchodzi w życie',
        'po upływie 3 miesięcy od dnia jej ogłoszenia.',
        'Prezydent Rzeczypospolitej Polskiej',
        'Poz. 483',
        'Wydawca: Kancelaria Prezesa Rady Ministrów',
        'Redakcja: Departament Legislacyjny Rządu',
      ]),
    ]);
    const w = await tekstZPdf(pdf, OPCJE_AKTU);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.tekst).not.toMatch(/Dziennik Ustaw|Poz\. 483|Wydawca|Redakcja/);
    expect(artykulZTekstuPdf(w.tekst, '243').tekst).toBe('Art. 243. Konstytucja wchodzi w życie\npo upływie 3 miesięcy od dnia jej ogłoszenia.');
    expect(artykulZTekstuPdf(w.tekst, '242').tekst).toBe('Art. 242. Tracą moc:\n1) ustawa konstytucyjna.');
  });

  it('punktor U+F0B7 to „•”, inne znaki prywatnego obszaru znikają', () => {
    expect(bezZnakowPrywatnych(' pierwszy\n drugi x')).toBe('• pierwszy\n• drugi x');
  });

  it('tresc_aktu podaje liczbę przeczytanych stron PDF i czy przycięto', async () => {
    const pdf = zbudujPdf([wiersze(['Art. 1. Pierwszy artykuł ustawy o czymś ważnym.']), wiersze(['Art. 2. Drugi artykuł ustawy o czymś innym.'])]);
    const z = new ZrodloZMapy({
      'eli/acts/DU/2020/1': { publisher: 'DU', year: 2020, pos: 1, type: 'Ustawa', title: 'Ustawa o czymś', textHTML: false, textPDF: true },
      'eli/acts/DU/2020/1/text.pdf': pdf,
    });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2020/1', artykul: '2' }), z);
    expect(w).toMatchObject({ znaleziono: true, stronPdf: 2, przeczytanoStronPdf: 2, pdfUciety: false });
  });
});

describe('zmianyPoTekscie: data ogłoszenia z /references (Konstytucja)', () => {
  it('ogloszono uzupełnione, choć rok z adresu rozstrzygał', async () => {
    const pdf = zbudujPdf([wiersze(['Art. 243. Konstytucja wchodzi w życie po upływie 3 miesięcy.'])]);
    const z = new ZrodloZMapy({
      'eli/acts/DU/1997/483': {
        publisher: 'DU', year: 1997, pos: 483, type: 'Ustawa', title: 'Konstytucja Rzeczypospolitej Polskiej', textHTML: false, textPDF: true,
        references: { 'Akty zmieniające': [{ id: 'DU/2009/946', date: '2009-10-21' }, { id: 'DU/2006/1471', date: '2006-11-07' }] },
      },
      'eli/acts/DU/1997/483/references': {
        'Akty zmieniające': [
          { act: { ELI: 'DU/2009/946', promulgation: '2009-07-20' } },
          { act: { ELI: 'DU/2006/1471', promulgation: '2006-10-16' } },
        ],
      },
      'eli/acts/DU/1997/483/text.pdf': pdf,
    });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/1997/483', artykul: '243' }), z);
    expect(w.zmianyPoTekscie).toEqual([
      { adres: 'DU/2006/1471', ogloszono: '2006-10-16', wZyciuOd: '2006-11-07' },
      { adres: 'DU/2009/946', ogloszono: '2009-07-20', wZyciuOd: '2009-10-21' },
    ]);
  });
});

describe('obowiązywanie: część przepisów przed terminem głównym (DU/2026/1123)', () => {
  const komentarz =
    '1) art. 1 pkt 1 lit. b wchodzą w życie z dniem 1 września 2028 r.;\n2) art. 1 pkt 7 wchodzą w życie z dniem 1 września 2027 r.;\n' +
    '4) art. 1 pkt 15 lit. b, art. 27-42 oraz art. 44 wchodzą w życie po upływie 9 września 2026 r.;\n' +
    '6) art. 1 pkt 61 - wchodzi w życie z dniem określonym w komunikacie, o którym mowa w art. 47';
  const ustawa = {
    publisher: 'DU', year: 2026, pos: 1123, type: 'Ustawa', title: 'Ustawa o zmianie ustawy o opiece nad dziećmi w wieku do lat 3',
    inForce: 'IN_FORCE', status: 'obowiązujący', entryIntoForce: '2028-01-01', promulgation: '2026-08-25', comments: komentarz,
  };

  it('terminy z komentarza: „po upływie 9 września” to 10 września, komunikat bez daty pominięty, terminy względne od ogłoszenia', () => {
    expect(terminyZKomentarza(komentarz)).toEqual(['2026-09-10', '2027-09-01', '2028-09-01']);
    expect(terminyZKomentarza('art. 7 wchodzi w życie po upływie 14 dni od dnia ogłoszenia', '2026-10-01')).toEqual(['2026-10-16']);
  });

  it('akt: „obowiązuje częściowo”, nie „jeszcze nie obowiązuje”', async () => {
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/1123' }), new ZrodloZMapy({ 'eli/acts/DU/2026/1123': ustawa }));
    expect(w.obowiazuje).toMatch(/^częściowo \(część przepisów od 2026-09-10, reszta od 2028-01-01/);
    expect(w.odpowiedz).toMatch(/obowiązuje częściowo: część przepisów od 2026-09-10, termin główny wejścia w życie 2028-01-01/);
    expect(w.odpowiedz).not.toMatch(/jeszcze nie obowiązuje/);
  });

  it('szukaj_aktow: to samo pole i flaga przepisów o innym terminie', async () => {
    const z = new ZrodloZMapy({ 'eli/acts/search': { count: 1, items: [ustawa] } });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { rodzaj: 'Ustawa', rok: 2026 }), z);
    expect((w.akty as Array<Record<string, unknown>>)[0]).toMatchObject({ obowiazuje: expect.stringMatching(/^częściowo/), czescPrzepisowWInnymTerminie: true });
    expect(w.uwagi!.join(' ')).toMatch(/wejscieWZycie to termin główny/);
  });

  it('bez wcześniejszego terminu zostaje „jeszcze nie”', async () => {
    const z = new ZrodloZMapy({ 'eli/acts/DU/2026/1123': { ...ustawa, comments: '1) art. 5 wchodzi w życie z dniem 1 września 2028 r.' } });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/1123' }), z);
    expect(w.obowiazuje).toBe('jeszcze nie (wchodzi w życie 2028-01-01)');
  });
});

describe('akt: powiązania z datą ogłoszenia i obowiązywaniem (nowelizacje ustawy o PIT)', () => {
  const lata = [2025, 2025, 2025, 2024, 2024, 2023];
  const statusy = ['obowiązujący', 'akt jednorazowy', 'akt objęty tekstem jednolitym', 'uchylony', 'bez statusu', 'akt posiada tekst jednolity'];
  const zmieniajace = Array.from({ length: 36 }, (_, i) => ({ id: `DU/${lata[i % 6]}/${1000 + i}`, date: `${lata[i % 6] + 1}-01-01` }));
  const z = () =>
    new ZrodloZMapy({
      'eli/acts/DU/1991/350': {
        publisher: 'DU', year: 1991, pos: 350, type: 'Ustawa', title: 'Ustawa o podatku dochodowym od osób fizycznych', inForce: 'IN_FORCE',
        references: { 'Akty zmieniające': zmieniajace },
      },
      'eli/acts/DU/1991/350/references': {
        'Akty zmieniające': zmieniajace.map((p, i) => ({
          act: { ELI: p.id, title: `Ustawa ${i}`, type: 'Ustawa', year: lata[i % 6], status: statusy[i % 6], promulgation: `${lata[i % 6]}-0${1 + (i % 9)}-15` },
          date: p.date,
        })),
      },
    });

  it('każda pozycja ma ogloszono, a zestawienie liczy po latach ogłoszenia i po obowiązywaniu', async () => {
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/1991/350', powiazania: 'Akty zmieniające' }), z());
    const p = (w.powiazania as Array<{ rodzaj: string; akty: Array<{ ogloszono: string }>; zestawienie: Record<string, Record<string, number>> }>)[0];
    expect(p.akty.every((x) => /^\d{4}-\d{2}-15$/.test(x.ogloszono))).toBe(true);
    expect(p.zestawienie.wedlugRokuOgloszenia).toEqual({ '2025': 18, '2024': 12, '2023': 6 });
    expect(p.zestawienie.wedlugObowiazywania).toEqual({ tak: 30, nie: 6 });
    expect(w.uwagi!.join(' ')).toMatch(/wedlugRokuOgloszenia liczy po dacie ogłoszenia/);
  });
});

describe('szukaj_aktow: rodzaj „Kodeks”', () => {
  it('szuka ustaw ze słowem „Kodeks” w tytule i mówi, że w ELI kodeksy mają rodzaj „Ustawa”', async () => {
    const z = new ZrodloZMapy({ 'eli/acts/search': { count: 0, items: [] } });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { rodzaj: 'Kodeks', fraza: 'cywilny' }), z);
    expect(z.zapytania[0].parametry).toMatchObject({ type: 'Ustawa', title: 'Kodeks cywilny' });
    expect(w.uwagi!.join(' ')).toMatch(/W bazie ELI nie ma rodzaju „Kodeks”: kodeksy mają rodzaj „Ustawa”/);
  });
});

describe('zapytanie_surowe: 404 z podpowiedzią o podkomisjach i klubach', () => {
  it('committees/INF/subcommittees → adres committees/INF01N', async () => {
    const z = new ZrodloZMapy({ 'term10/committees/INF/subcommittees': null });
    const w = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'term10/committees/INF/subcommittees' }), z);
    expect(w.uwagi![0]).toMatch(/committees\/INF01N/);
    expect(w.uwagi![0]).toMatch(/subCommittees/);
  });

  it('clubs → joinDate w clubs/{id}', async () => {
    const z = new ZrodloZMapy({ 'term10/clubs/KO/history': null });
    const w = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'term10/clubs/KO/history' }), z);
    expect(w.uwagi![0]).toMatch(/joinDate/);
  });
});
