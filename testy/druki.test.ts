import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adresPliku, BladSejmu } from '../src/klient.js';
import { KolejkaOcr, type UruchomWatek } from '../src/druki/ocr.js';
import { kluczArtykulu, odczytajPdf, odczytajWord, podzielNaCzesci, rodzajPliku, spisTresci } from '../src/druki/odczyt.js';
import { PLIKI_SILNIKA, silnikGotowy } from '../src/druki/silnik-ocr.js';
import { ETYKIETA_OCR, ETYKIETA_SKANU, PROG_ZGODY_BAJTOW, utworzTekstDruku, zakresStron, zakresyNapisem, ZGODY_NA_PLIKI, type Srodowisko } from '../src/narzedzia/druki.js';
import { narzedzie, type KontekstWywolania, type Wynik } from '../src/narzedzia/wspolne.js';
import { katalogSchowka, Schowek } from '../src/schowek.js';
import { utworzSerwer } from '../src/serwer.js';
import { ZrodloZFikstur } from './pomoc.js';

const FIKSTURY = join(import.meta.dirname, 'fikstury', 'druki');
const bajty = (nazwa: string) => new Uint8Array(readFileSync(join(FIKSTURY, nazwa)));

let katalog: string;
beforeEach(() => {
  katalog = mkdtempSync(join(tmpdir(), 'sejm-mcp-test-'));
  ZGODY_NA_PLIKI.clear();
});
afterEach(() => rmSync(katalog, { recursive: true, force: true }));

/** Środowisko narzędzia bez sieci i bez prawdziwego silnika OCR: „OCR” oddaje stały tekst. */
function srodowisko(opcje: { silnik?: boolean } = {}) {
  const stan = { silnik: opcje.silnik ?? true, ocrStron: [] as number[] };
  const uruchom: UruchomWatek = async (dane, naWiadomosc) => {
    for (const s of dane.strony) {
      stan.ocrStron.push(s);
      naWiadomosc({ typ: 'strona', strona: s, tekst: `Tekst odczytany ze skanu strony ${s}`, pewnosc: 91.4, ms: 5 });
    }
    naWiadomosc({ typ: 'koniec' });
  };
  const schowek = new Schowek(katalog);
  const s: Srodowisko = {
    schowek: () => schowek,
    kolejkaOcr: new KolejkaOcr(uruchom),
    silnikGotowy: async () => stan.silnik,
    teraz: () => Date.now(),
  };
  return { s, stan };
}

const zrodlo = () =>
  new ZrodloZFikstur({
    'term10/prints/2690': 'druk-2690.json',
    'plik:term10/prints/2690/2690.pdf': 'druki/2690.pdf',
    'term10/prints/2660': 'druk-2660.json',
    'plik:term10/prints/2660/2660.pdf': 'druki/2660.pdf',
    'term10/prints/2667': 'druk-2667.json',
    'plik:term10/prints/2667/2667-ustawa.docx': 'druki/2667-ustawa.docx',
    'term10/prints/99999': null,
  });

const kontekst = (moznaPytac: boolean, odpowiedzi: Record<string, 'tak' | 'nie'> = {}): KontekstWywolania => ({
  moznaPytac,
  odpowiedz: (k) => odpowiedzi[k] ?? null,
});

type StronaWyniku = { strona?: number; czesc?: number; tekst: string; skan?: string; ocr?: { etykieta: string; pewnosc: number }; cytowanie: Record<string, unknown> };

/** Każda strona i część ma pełne cytowanie: druk, plik, strona (albo część Worda) i adres pliku. */
function sprawdzCytowania(w: Wynik, druk: string, plik: string) {
  const strony = w.strony as StronaWyniku[];
  expect(strony.length).toBeGreaterThan(0);
  for (const s of strony) {
    expect(s.cytowanie.druk).toBe(druk);
    expect(s.cytowanie.plik).toBe(plik);
    const url = String(s.cytowanie.url);
    expect(url.startsWith(`https://api.sejm.gov.pl/sejm/term10/prints/${druk}/`)).toBe(true);
    if (/\.pdf$/i.test(plik)) {
      expect(s.cytowanie.strona).toBe(s.strona);
      expect(url).toBe(`https://api.sejm.gov.pl/sejm/term10/prints/${druk}/${encodeURIComponent(plik)}#page=${s.strona}`);
    } else {
      expect(s.cytowanie.czesc).toBe(s.czesc);
      expect(s.cytowanie.strona).toBeNull();
    }
    if (s.ocr) {
      expect(s.ocr.etykieta).toBe(ETYKIETA_OCR);
      expect(s.skan).toBe(ETYKIETA_SKANU);
      expect(String(s.cytowanie.sprawdz)).toContain(url);
      expect(String(s.cytowanie.zrodloTekstu)).toMatch(/odczyt maszynowy/);
    }
  }
  expect(String(w.cytowanie)).toMatch(/numer druku, nazwę pliku i numer strony/);
  expect(String(w.cytowanie)).toMatch(/Otworzyć plik, żeby sprawdzić\?/);
}

describe('odczyt plików druku (prawdziwe pliki z api.sejm.gov.pl)', () => {
  it('rodzaj pliku z pierwszych bajtów', () => {
    expect(rodzajPliku(bajty('2690.pdf'))).toBe('pdf');
    expect(rodzajPliku(bajty('2667-ustawa.docx'))).toBe('docx');
    expect(rodzajPliku(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('doc');
    expect(rodzajPliku(new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('druk 2690 (sprawozdanie komisji): PDF z warstwą tekstową, strona po stronie', async () => {
    const o = await odczytajPdf(bajty('2690.pdf'));
    expect(o.stron).toBe(2);
    expect(o.strony.every((s) => !s.skan)).toBe(true);
    expect(o.strony[0].tekst).toMatch(/S P R A W O Z D A N I E\nKOMISJI ZDROWIA/);
  });

  it('druk 2660 (uchwała Senatu): plik mieszany, strony bez warstwy tekstowej są oznaczone', async () => {
    const o = await odczytajPdf(bajty('2660.pdf'));
    expect(o.stron).toBe(4);
    expect(o.strony.map((s) => s.skan)).toEqual([false, false, true, true]);
  });

  it('druk 2667: DOCX z projektem ustawy, w częściach, z artykułami w spisie', async () => {
    const o = await odczytajWord(bajty('2667-ustawa.docx'), 'docx');
    expect(o.rodzaj).toBe('docx');
    expect(o.strony[0].tekst).toMatch(/Art\. 1\. Wyraża się zgodę/);
    expect(spisTresci(o.strony).filter((w) => w.rodzaj === 'art').map((w) => w.numer)).toEqual(['1', '2']);
  });

  it('spis: cytowany przepis nowelizacji („„Art. 2a.”) nie jest artykułem druku; nagłówki z tytułem', () => {
    const spis = spisTresci([
      { tekst: 'U S T A W A\nDZIAŁ I\nPrzepisy ogólne\nArt. 1. Ustawa określa…\n„Art. 2a. Minister…\nArt. 9¹. Przepis', skan: false },
      { tekst: 'Rozdział 2\nZadania ministra\nArt. 10a. Coś\nUZASADNIENIE\nArt. 5 ust. 2 w uzasadnieniu', skan: false },
    ]);
    expect(spis.map((w) => w.etykieta)).toEqual(['U S T A W A', 'DZIAŁ I Przepisy ogólne', 'Art. 1', 'Art. 9¹', 'Rozdział 2 Zadania ministra', 'Art. 10a', 'UZASADNIENIE']);
    expect(kluczArtykulu('9¹')).toBe(kluczArtykulu('9^1'));
    expect(kluczArtykulu('Art. 12 a')).toBe('12a');
  });

  it('części Worda tną na granicy akapitu', () => {
    const czesci = podzielNaCzesci(['a'.repeat(3000), 'b'.repeat(3000), 'c'.repeat(100)].join('\n'), 4000);
    expect(czesci).toEqual(['a'.repeat(3000), `${'b'.repeat(3000)}\n${'c'.repeat(100)}`]);
  });
});

describe('tekst_druku', () => {
  it('druk 2690: strony z cytowaniem (druk, plik, strona, adres z #page=N), drugie wywołanie z dysku', async () => {
    const { s } = srodowisko();
    const n = utworzTekstDruku(s);
    const z = zrodlo();
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2690' }), z);
    sprawdzCytowania(w, '2690', '2690.pdf');
    expect(w.zrodla).toEqual(['https://api.sejm.gov.pl/sejm/term10/prints/2690', 'https://api.sejm.gov.pl/sejm/term10/prints/2690/2690.pdf']);
    expect(w.stronaDruku).toBe('https://www.sejm.gov.pl/Sejm10.nsf/druk.xsp?nr=2690');
    expect((w.plik as { stron: number }).stron).toBe(2);
    expect(z.pobraniaPlikow).toHaveLength(1);
    expect(z.pobraniaPlikow[0].opcje.limitBajtow).toBe(PROG_ZGODY_BAJTOW);

    const drugi = await n.wykonaj(n.wejscie.parse({ numer: '2690', strony: '2' }), z);
    expect(z.pobraniaPlikow).toHaveLength(1);
    expect(drugi.odpowiedz).toMatch(/z dysku/);
    expect((drugi.strony as StronaWyniku[]).map((x) => x.strona)).toEqual([2]);
    expect(drugi.spis).toBeUndefined();
  });

  it('druk 2660 (mieszany): skany oznaczone, bez OCR bez pytania, podpowiedź ocr=true', async () => {
    const { s, stan } = srodowisko();
    const n = utworzTekstDruku(s);
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2660' }), zrodlo());
    sprawdzCytowania(w, '2660', '2660.pdf');
    const strony = w.strony as StronaWyniku[];
    expect(strony.filter((x) => x.skan === ETYKIETA_SKANU).map((x) => x.strona)).toEqual([3, 4]);
    expect(w.odpowiedz).toMatch(/2 strony nie mają warstwy tekstowej \(skany\): 3–4/);
    expect(w.odpowiedz).toMatch(/ocr=true/);
    expect(stan.ocrStron).toEqual([]);
  });

  it('OCR kilku stron: bez pytania, silnik z paczki; strony-skany z etykietą i prośbą o sprawdzenie', async () => {
    const { s, stan } = srodowisko();
    const n = utworzTekstDruku(s);
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true }), zrodlo(), kontekst(true));
    expect(w.pytanieOZgode).toBeUndefined();
    expect(stan.ocrStron).toEqual([3, 4]);
    sprawdzCytowania(w, '2660', '2660.pdf');
    const strony = w.strony as StronaWyniku[];
    for (const x of strony.filter((x) => x.skan)) {
      expect(x.ocr).toMatchObject({ etykieta: 'odczyt maszynowy, możliwe błędy', pewnosc: 91 });
      expect(x.tekst).toBe(`Tekst odczytany ze skanu strony ${x.strona}`);
    }
    expect(strony.filter((x) => !x.skan).every((x) => x.ocr === undefined)).toBe(true);
    expect((w.uwagi as string[]).join(' ')).toMatch(/nie tekst opublikowany przez Sejm/);

    // Drugi raz: wynik OCR z dysku, bez ponownego rozpoznawania.
    const drugi = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true }), zrodlo(), kontekst(false));
    expect(stan.ocrStron).toEqual([3, 4]);
    expect((drugi.strony as StronaWyniku[])[2].ocr?.etykieta).toBe(ETYKIETA_OCR);
  });

  it('OCR ponad 10 stron: pytanie z liczbą stron i czasem, bez rozmiaru pobrania; odmowa i zgoda', async () => {
    const { s, stan } = srodowisko();
    const n = utworzTekstDruku(s);
    const z = zrodlo();
    // 12 stron-skanów: plik 2660 ma dwa, więc podstawiamy odczyt z 12 pustymi stronami.
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2660' }), z);
    const sha = (w.plik as { sha256: string }).sha256;
    await s.schowek().zapiszJson({ wersja: 1, rodzaj: 'pdf', stron: 12, strony: Array.from({ length: 12 }, () => ({ tekst: '', skan: true })) }, 'tekst', `${sha}-v1.json`);
    const bezOkna = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true, strony: '1-12' }), z, kontekst(false));
    expect(bezOkna.potrzebnaZgoda).toMatchObject({ klucz: 'ocr' });
    expect(String(bezOkna.odpowiedz)).toMatch(/12 stron nie ma warstwy tekstowej \(skany: 1–12\)/);
    expect(String(bezOkna.odpowiedz)).toMatch(/potrwa ok\. 24 s/);
    expect(String(bezOkna.odpowiedz)).not.toMatch(/MB|jsdelivr|pobra/);
    expect(String(bezOkna.odpowiedz)).toMatch(/zgoda=\["ocr"\]/);
    const zOknem = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true, strony: '1-12' }), z, kontekst(true));
    expect(zOknem.pytanieOZgode).toMatchObject({ klucz: 'ocr' });
    const odmowa = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true, strony: '1-12' }), z, kontekst(true, { ocr: 'nie' }));
    expect(odmowa.uwagi).toContain('Użytkownik nie zgodził się na odczyt maszynowy (OCR); strony-skany zostają bez tekstu.');
    expect(stan.ocrStron).toEqual([]);
    const zgoda = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true, strony: '1-12', zgoda: ['ocr'] }), z, kontekst(false));
    expect(stan.ocrStron).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    sprawdzCytowania(zgoda, '2660', '2660.pdf');
  });

  it('brak silnika w instalacji: uczciwy wynik częściowy z linkiem, bez pobierania', async () => {
    const { s } = srodowisko({ silnik: false });
    const n = utworzTekstDruku(s);
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2660', ocr: true }), zrodlo());
    expect((w.wynikCzesciowy as { dlaczego: string }).dlaczego).toMatch(/silnika OCR brakuje/);
    expect((w.wynikCzesciowy as { jakUzupelnic: string }).jakUzupelnic).toMatch(/2660\.pdf/);
  });

  it('DOCX: części zamiast stron, cytowanie z numerem części i artykułami', async () => {
    const { s } = srodowisko();
    const n = utworzTekstDruku(s);
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2667', plik: '2667-ustawa.docx' }), zrodlo());
    sprawdzCytowania(w, '2667', '2667-ustawa.docx');
    expect((w.strony as StronaWyniku[])[0].cytowanie.artykuly).toEqual(['Art. 1', 'Art. 2']);
    expect(w.odpowiedz).toMatch(/Word nie ma stron/);
  });

  it('plik ponad 20 MB (rozmiar znany): pytanie z rozmiarem przed pobraniem; po zgodzie pobiera', async () => {
    const { s } = srodowisko();
    const n = utworzTekstDruku(s);
    const z = zrodlo();
    z.rozmiarPliku = async () => ({ bajtow: 22_592_550 });
    z.pobierzPlik = async (k, nazwa, o) => {
      z.pobraniaPlikow.push({ katalog: k, nazwa, opcje: o });
      return bajty('2690.pdf');
    };
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2667' }), z, kontekst(false));
    expect(w.potrzebnaZgoda).toMatchObject({ klucz: 'duzy-plik' });
    expect(String(w.odpowiedz)).toMatch(/2667\.pdf druku 2667 ma ok\. 22,6 MB/);
    expect(String(w.odpowiedz)).toMatch(/2667-ustawa\.docx/);
    expect(z.pobraniaPlikow).toHaveLength(0);
    const po = await n.wykonaj(n.wejscie.parse({ numer: '2667', zgoda: ['duzy-plik'] }), z, kontekst(false));
    expect(z.pobraniaPlikow).toHaveLength(1);
    expect(z.pobraniaPlikow[0].opcje.limitBajtow).toBeGreaterThan(PROG_ZGODY_BAJTOW);
    sprawdzCytowania(po, '2667', '2667.pdf');
  });

  it('Sejm nie podaje rozmiaru, plik mały: pobiera bez pytania z limitem 20 MB w strumieniu', async () => {
    const { s } = srodowisko();
    const n = utworzTekstDruku(s);
    const z = zrodlo();
    z.rozmiarPliku = async () => ({ bajtow: null });
    const w = await n.wykonaj(n.wejscie.parse({ numer: '2660' }), z, kontekst(true));
    expect(w.pytanieOZgode).toBeUndefined();
    expect(w.potrzebnaZgoda).toBeUndefined();
    expect(z.pobraniaPlikow).toHaveLength(1);
    expect(z.pobraniaPlikow[0].opcje.limitBajtow).toBe(PROG_ZGODY_BAJTOW);
    sprawdzCytowania(w, '2660', '2660.pdf');
  });

  it('Sejm nie podaje rozmiaru, plik ponad 20 MB: przerwane po 20 MB, pytanie z powodem; zgoda pamiętana, odmowa z linkiem', async () => {
    const { s } = srodowisko();
    const n = utworzTekstDruku(s);
    const z = zrodlo();
    z.rozmiarPliku = async () => ({ bajtow: null });
    // Plik „waży” 30 MB: przy limicie 20 MB strumień pęka, przy wyższym limicie oddaje treść.
    z.pobierzPlik = async (k, nazwa, o) => {
      z.pobraniaPlikow.push({ katalog: k, nazwa, opcje: o });
      if (o.limitBajtow < 30 * 1024 * 1024) throw new BladSejmu(`Odpowiedź Sejmu jest za duża (ponad ${o.limitBajtow} B)`, null, 'za-duza');
      return bajty(nazwa === '2690.pdf' ? '2690.pdf' : '2660.pdf');
    };
    // Okno pytania (elicitation): pytanie z powodem, nic nie zapisano.
    const okno = await n.wykonaj(n.wejscie.parse({ numer: '2660' }), z, kontekst(true));
    expect(okno.pytanieOZgode).toMatchObject({ klucz: 'duzy-plik' });
    const pytanie = (okno.pytanieOZgode as { pytanie: string }).pytanie;
    expect(pytanie).toMatch(/2660\.pdf druku 2660 ma ponad 20 MB/);
    expect(pytanie).toMatch(/przerwał pobieranie po 20 MB/);
    expect(pytanie).toMatch(/2660-uchwała\.docx/);
    expect(z.pobraniaPlikow).toHaveLength(1);
    expect(z.pobraniaPlikow[0].opcje.limitBajtow).toBe(PROG_ZGODY_BAJTOW);
    // Bez okna: prośba do modelu z kluczem zgody.
    const bezOkna = await n.wykonaj(n.wejscie.parse({ numer: '2660' }), z, kontekst(false));
    expect(bezOkna.potrzebnaZgoda).toMatchObject({ klucz: 'duzy-plik' });
    expect(String(bezOkna.odpowiedz)).toMatch(/zgoda=\["duzy-plik"\]/);
    // Tak w oknie: pobiera całość z wyższym limitem.
    const tak = await n.wykonaj(n.wejscie.parse({ numer: '2660' }), z, kontekst(true, { 'duzy-plik': 'tak' }));
    expect(z.pobraniaPlikow.at(-1)!.opcje.limitBajtow).toBeGreaterThan(PROG_ZGODY_BAJTOW);
    sprawdzCytowania(tak, '2660', '2660.pdf');
    // Ten sam plik jeszcze raz od nowa (odswiez): zgoda zapamiętana, bez drugiego pytania.
    const ile = z.pobraniaPlikow.length;
    const znowu = await n.wykonaj(n.wejscie.parse({ numer: '2660', odswiez: true }), z, kontekst(true));
    expect(znowu.pytanieOZgode).toBeUndefined();
    expect(z.pobraniaPlikow).toHaveLength(ile + 1);
    // Odmowa dla innego pliku: podaje link, nic nie zapisuje.
    const nie = await n.wykonaj(n.wejscie.parse({ numer: '2690' }), z, kontekst(true, { 'duzy-plik': 'nie' }));
    expect(String(nie.odpowiedz)).toMatch(/nie zgodził się.*https:\/\/api\.sejm\.gov\.pl\/sejm\/term10\/prints\/2690\/2690\.pdf/);
    expect(nie.strony).toBeUndefined();
    // Stary klucz „pobranie” działa jak „duzy-plik”.
    const stary = await n.wykonaj(n.wejscie.parse({ numer: '2690', zgoda: ['pobranie'] }), z, kontekst(false));
    sprawdzCytowania(stary, '2690', '2690.pdf');
  });

  it('nieznany druk i nieznany plik: uczciwa odpowiedź z adresem źródła', async () => {
    const { s } = srodowisko();
    const n = utworzTekstDruku(s);
    const w = await n.wykonaj(n.wejscie.parse({ numer: '99999' }), zrodlo());
    expect(w.znaleziono).toBe(false);
    expect(w.zrodla).toEqual(['https://api.sejm.gov.pl/sejm/term10/prints/99999']);
    await expect(n.wykonaj(n.wejscie.parse({ numer: '2690', plik: 'inny.pdf' }), zrodlo())).rejects.toThrow(/Pliki druku: 2690\.pdf/);
  });

  it('zakresy stron', () => {
    expect(zakresStron('5-12', 100)).toEqual({ od: 5, do: 12 });
    expect(zakresStron('5–7', 6)).toEqual({ od: 5, do: 6 });
    expect(zakresStron('3', 10)).toEqual({ od: 3, do: 3 });
    expect(zakresStron('1-500', 2025)).toEqual({ od: 1, do: 50 });
    expect(() => zakresStron('11', 10)).toThrow(/nie istnieje/);
    expect(() => zakresStron('x', 10)).toThrow(/zły format/);
    expect(zakresyNapisem([3, 4, 5, 9, 12, 13])).toBe('3–5, 9, 12–13');
  });
});

describe('adres pliku druku', () => {
  it('koduje spacje i polskie litery, nie wychodzi poza katalog druku', () => {
    expect(adresPliku('term10/prints/558', '558-ustawa i uzasadnienie.docx').href).toBe('https://api.sejm.gov.pl/sejm/term10/prints/558/558-ustawa%20i%20uzasadnienie.docx');
    expect(adresPliku('term10/prints/2660', '2660-uchwała.docx').href).toBe('https://api.sejm.gov.pl/sejm/term10/prints/2660/2660-uchwa%C5%82a.docx');
    for (const zla of ['../MP', '..', 'a/b.pdf', 'a\\b.pdf', '']) expect(() => adresPliku('term10/prints/1', zla)).toThrow(BladSejmu);
  });
});

describe('schowek i silnik OCR', () => {
  it('katalog schowka dla każdego systemu i zmiennej SEJM_MCP_SCHOWEK', () => {
    expect(katalogSchowka({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Caches/sejm-mcp');
    expect(katalogSchowka({}, 'linux', '/home/a')).toBe('/home/a/.cache/sejm-mcp');
    expect(katalogSchowka({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/a')).toBe('/x/sejm-mcp');
    expect(katalogSchowka({ SEJM_MCP_SCHOWEK: '/tmp/s' }, 'linux', '/home/a')).toBe('/tmp/s');
  });

  it('schowek ponad limit: kasuje najdawniej używane pliki do 80% limitu, właśnie zapisany zostaje', async () => {
    const s = new Schowek(katalog);
    const sciezki: string[] = [];
    for (let i = 0; i < 5; i++) sciezki.push(await s.zapisz(new Uint8Array(1000), 'pliki', `p${i}`));
    // Czas użycia: p0 najdawniej, p4 najświeżej; potem p0 przeczytany, więc staje się najświeższy.
    for (let i = 0; i < 5; i++) utimesSync(sciezki[i], new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i));
    await s.czytaj('pliki', 'p0');
    expect(await s.sprzataj(10_000)).toBe(0);
    expect(await s.sprzataj(4000, sciezki[1])).toBe(2);
    expect(['p0', 'p1', 'p2', 'p3', 'p4'].map((p) => existsSync(join(katalog, 'pliki', p)))).toEqual([true, true, false, false, true]);
  });

  it('schowek nie wychodzi poza swój katalog', () => {
    const s = new Schowek(katalog);
    expect(() => s.sciezka('..', 'x')).toThrow();
    expect(() => s.sciezka('a/b')).toThrow();
  });

  it('silnik OCR jedzie w paczce: przypięte pliki z paczek npm o dokładnych wersjach, ze skrótami sha256', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    for (const p of PLIKI_SILNIKA) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      const pakiet = p.zrodlo.startsWith('@') ? p.zrodlo.split('/').slice(0, 2).join('/') : p.zrodlo.split('/')[0];
      expect(pkg.devDependencies[pakiet]).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkg.dependencies[pakiet]).toBeUndefined();
    }
    expect(pkg.scripts.build).toContain('kopiuj-silnik-ocr.mjs');
  });

  const zbudowany = join(import.meta.dirname, '..', 'dist', 'silnik-ocr');
  it.skipIf(!existsSync(join(zbudowany, 'pdf.mjs')))('zbudowany silnik: pliki ze skrótami, licencje i NOTICE, bez eval i new Function', async () => {
    expect(await silnikGotowy(zbudowany)).toBe(true);
    for (const l of ['LICENSE-tesseract.js-core', 'LICENSE-pdfjs-dist', 'LICENSE-tessdata', 'NOTICE']) expect(existsSync(join(zbudowany, l))).toBe(true);
    for (const p of PLIKI_SILNIKA.filter((p) => /\.[cm]?js$/.test(p.nazwa))) {
      const kod = readFileSync(join(zbudowany, p.nazwa), 'utf8');
      expect(kod).not.toMatch(/\beval\s*\(/);
      expect(kod).not.toMatch(/new Function\s*\(/);
    }
  });

  it('silnik z uszkodzonym plikiem nie jest gotowy (i nic nie jest pobierane)', async () => {
    expect(await silnikGotowy(katalog)).toBe(false);
  });
});

describe('zgoda przez okno pytania (elicitation) w prawdziwym serwerze MCP', () => {
  const pytajace = narzedzie({
    nazwa: 'pytajace',
    tytul: 'test',
    opis: 'test',
    wejscie: z.object({}),
    async wykonaj(_a, _z, k) {
      const odp = k?.odpowiedz('ocr');
      if (odp === null && k?.moznaPytac) return { zrodla: [], pytanieOZgode: { klucz: 'ocr', pytanie: 'Pobrać silnik OCR (ok. 10 MB)?' } };
      return { zrodla: [], odpowiedz: `zgoda: ${odp ?? 'brak'}; moznaPytac: ${k?.moznaPytac}` };
    },
  });

  async function rozmowa(mozliwosci: Record<string, unknown>, naPytanie?: (p: any) => unknown) {
    const [klient, serwer] = InMemoryTransport.createLinkedPair();
    const s = utworzSerwer(zrodlo(), [pytajace]);
    await s.connect(serwer);
    const odebrane: any[] = [];
    const czekaj = new Map<number, (m: any) => void>();
    klient.onmessage = (m: any) => {
      odebrane.push(m);
      if (m.method === 'elicitation/create') void klient.send({ jsonrpc: '2.0', id: m.id, result: naPytanie!(m.params) } as any);
      else if (m.id !== undefined && czekaj.has(m.id)) czekaj.get(m.id)!(m);
    };
    await klient.start();
    const zapytaj = (id: number, method: string, params: unknown) =>
      new Promise<any>((r) => {
        czekaj.set(id, r);
        void klient.send({ jsonrpc: '2.0', id, method, params } as any);
      });
    await zapytaj(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: mozliwosci, clientInfo: { name: 't', version: '1' } });
    await klient.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as any);
    const wynik = await zapytaj(2, 'tools/call', { name: 'pytajace', arguments: {} });
    await s.close();
    return { wynik, pytania: odebrane.filter((m) => m.method === 'elicitation/create') };
  }

  it('klient z elicitation: serwer pyta użytkownika i dostaje odpowiedź', async () => {
    const { wynik, pytania } = await rozmowa({ elicitation: { form: {} } }, () => ({ action: 'accept', content: { zgoda: true } }));
    expect(pytania).toHaveLength(1);
    expect(pytania[0].params.message).toBe('Pobrać silnik OCR (ok. 10 MB)?');
    expect(pytania[0].params.requestedSchema.properties.zgoda.type).toBe('boolean');
    expect(wynik.result.structuredContent.odpowiedz).toBe('zgoda: tak; moznaPytac: true');
  });

  it('odmowa w oknie to „nie”', async () => {
    const { wynik } = await rozmowa({ elicitation: { form: {} } }, () => ({ action: 'decline' }));
    expect(wynik.result.structuredContent.odpowiedz).toBe('zgoda: nie; moznaPytac: true');
  });

  it('klient bez elicitation: bez okna, narzędzie wie, że nie da się zapytać', async () => {
    const { wynik, pytania } = await rozmowa({});
    expect(pytania).toHaveLength(0);
    expect(wynik.result.structuredContent.odpowiedz).toBe('zgoda: brak; moznaPytac: false');
  });
});
