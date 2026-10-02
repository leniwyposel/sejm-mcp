/**
 * tekst_druku: pełny tekst druku sejmowego, strona po stronie, z cytowaniem pliku i strony.
 *
 * Decyzja właściciela (28.09.2026): lokalny serwer czyta druki sam, bez infrastruktury Leniwego Posła.
 * Plik przychodzi z api.sejm.gov.pl (ten sam klient, allowlista i hamulec co reszta), ląduje w schowku
 * użytkownika pod skrótem sha256 i przy następnym pytaniu jest czytany z dysku. Tekst wraca porcjami
 * stron, każda strona z cytowaniem: numer druku, nazwa pliku, numer strony, artykuły i adres pliku
 * z #page=N. Strona bez warstwy tekstowej jest oznaczona jako skan; odczyt maszynowy (OCR) jest
 * opcjonalny i wyłącznie po zgodzie użytkownika, a jego wynik nigdy nie udaje tekstu Sejmu.
 *
 * Zgoda: pobranie pliku ponad 20 MB (do 20 MB bez pytania, limit liczony w strumieniu) i OCR ponad
 * 10 stron naraz. Silnik OCR jest w paczce, nic się nie dociąga. Klient, który umie zapytać
 * użytkownika (elicitation), dostaje okno pytania; inny dostaje prośbę do modelu, żeby zapytał
 * użytkownika i powtórzył wywołanie z argumentem `zgoda`.
 */

import { z } from 'zod';
import { adresPliku, BladSejmu, type ZrodloSejmu } from '../klient.js';
import { odmiana } from '../reguly/daty.js';
import { Schowek, sha256 } from '../schowek.js';
import { czysty } from '../tekst.js';
import { KolejkaOcr, SEKUND_NA_STRONE, zapisaneOcr, type StronaOcr } from '../druki/ocr.js';
import { kluczArtykulu, odczytajPdf, odczytajWord, rodzajPliku, spisTresci, WERSJA_ODCZYTU, type Odczyt, type WpisSpisu } from '../druki/odczyt.js';
import { silnikGotowy } from '../druki/silnik-ocr.js';
import {
  BEZ_PYTANIA,
  brak404,
  czesciowy,
  jakoRekord,
  kadencja,
  narzedzie,
  T,
  UWAGA_TEKST_Z_ZEWNATRZ,
  type KluczZgody,
  type KontekstWywolania,
  type PytanieOZgode,
  type Wynik,
} from './wspolne.js';

/** Do tylu bajtów pobieramy bez pytania; powyżej pytamy o zgodę (Sejm nie podaje rozmiaru z góry: liczymy bajty w strumieniu). */
export const PROG_ZGODY_BAJTOW = 20 * 1024 * 1024;
const PROG_MB = PROG_ZGODY_BAJTOW / 1024 / 1024;
/** Więcej nie pobieramy nawet za zgodą. */
const MAKS_BAJTOW = 200 * 1024 * 1024;
/** Pobranie dużego pliku może trwać dłużej niż jedno wywołanie; biegnie w tle najwyżej tyle. */
const CZAS_POBRANIA_MS = 10 * 60_000;
/** Tyle jedno wywołanie czeka na pobranie, odczyt i OCR; resztę dokończy w tle. */
const BUDZET_MS = 45_000;
/** OCR więcej stron niż tyle naraz wymaga zgody (ok. 2 s na stronę). */
export const PROG_STRON_OCR = 10;
const DOMYSLNIE_STRON = 10;
const MAKS_STRON = 50;
const DOMYSLNIE_ZNAKOW = 20_000;
const MAKS_ZNAKOW = 25_000;
/** Spis treści w odpowiedzi: najwyżej tyle pozycji (duże ustawy mają ich tysiące). */
const MAKS_WPISOW_SPISU = 120;

/** Rozmiar do zdania dla człowieka: „ok. 22,6 MB”. */
const opisRozmiaru = (bajtow: number) => `ok. ${(bajtow / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;

export const ETYKIETA_SKANU = 'strona bez warstwy tekstowej (skan)';
export const ETYKIETA_OCR = 'odczyt maszynowy, możliwe błędy';

/** Instrukcja cytowania: w opisie narzędzia i w każdej odpowiedzi (decyzja właściciela). */
export const ZASADA_CYTOWANIA =
  'Cytując albo streszczając druk, zawsze podaj numer druku, nazwę pliku i numer strony (przy Wordzie numer części i artykuł) oraz link z pola cytowanie.url; ' +
  'zaproponuj użytkownikowi otwarcie oryginału („Otworzyć plik, żeby sprawdzić?”). Nie parafrazuj treści druku bez wskazania pliku i strony.';

const ZASADA_OCR =
  'Strona z polem ocr to odczyt maszynowy obrazu skanu (Tesseract), nie tekst opublikowany przez Sejm: może mieć błędy liter i liczb. ' +
  'Mówiąc o niej, powiedz, że to odczyt maszynowy, podaj stronę i link, i poproś użytkownika, żeby sprawdził tę stronę w oryginale.';

interface DrukZRejestru {
  number: string;
  title?: string;
  changeDate?: string;
  attachments?: string[];
  additionalPrints?: Array<{ number: string }>;
}

/** Zapis w schowku o pobranym pliku druku. */
interface ZapisPliku {
  sha256: string;
  bajtow: number;
  pobrano: string;
  /** changeDate druku z rejestru w chwili pobrania: gdy się zmieni, pobieramy plik od nowa. */
  zmiana: string | null;
}

export interface Srodowisko {
  schowek(): Schowek;
  kolejkaOcr: KolejkaOcr;
  /** Czy silnik OCR dołączony do paczki jest na miejscu (uszkodzona instalacja: nie). */
  silnikGotowy(): Promise<boolean>;
  teraz(): number;
}

let domyslnySchowek: Schowek | null = null;
export const SRODOWISKO: Srodowisko = {
  // Schowek tworzymy przy pierwszym użyciu: samo uruchomienie serwera niczego nie dotyka na dysku.
  schowek: () => (domyslnySchowek ??= new Schowek()),
  kolejkaOcr: new KolejkaOcr(),
  silnikGotowy: () => silnikGotowy(),
  teraz: () => Date.now(),
};

/** Zakres stron z napisu: „5”, „5-12”, „5–12”. */
export function zakresStron(s: string | undefined, stron: number): { od: number; do: number } | null {
  if (!s) return null;
  const m = /^\s*(\d{1,5})\s*(?:[-–—]\s*(\d{1,5}))?\s*$/.exec(s);
  if (!m) throw new Error(`Zakres stron „${s}” ma zły format; podaj np. "5" albo "5-12".`);
  const od = Number(m[1]);
  const do_ = m[2] ? Number(m[2]) : od;
  if (od < 1 || do_ < od) throw new Error(`Zakres stron „${s}” jest pusty albo odwrócony.`);
  if (od > stron) throw new Error(`Plik ma ${odmiana(stron, ['stronę', 'strony', 'stron'])}; strona ${od} nie istnieje.`);
  return { od, do: Math.min(do_, stron, od + MAKS_STRON - 1) };
}

/** Numery stron jako krótki napis: „3–5, 9, 12–40”. */
export function zakresyNapisem(numery: readonly number[]): string {
  const posortowane = [...new Set(numery)].sort((a, b) => a - b);
  const czesci: string[] = [];
  for (let i = 0; i < posortowane.length; i++) {
    let j = i;
    while (j + 1 < posortowane.length && posortowane[j + 1] === posortowane[j] + 1) j++;
    czesci.push(i === j ? String(posortowane[i]) : `${posortowane[i]}–${posortowane[j]}`);
    i = j;
  }
  return czesci.join(', ');
}

/** Spis w odpowiedzi: nagłówki pełne, kolejne artykuły między nagłówkami zwinięte w jeden wpis. */
export function spisDoOdpowiedzi(spis: readonly WpisSpisu[]): { spis: Array<{ etykieta: string; strona: number; doStrony?: number }>; skrocono: boolean } {
  const wynik: Array<{ etykieta: string; strona: number; doStrony?: number }> = [];
  let seria: WpisSpisu[] = [];
  const zamknij = () => {
    if (!seria.length) return;
    const a = seria[0];
    const b = seria[seria.length - 1];
    wynik.push(
      seria.length === 1
        ? { etykieta: a.etykieta, strona: a.strona }
        : { etykieta: `Art. ${a.numer}–${b.numer}`, strona: a.strona, ...(b.strona !== a.strona ? { doStrony: b.strona } : {}) },
    );
    seria = [];
  };
  for (const w of spis) {
    if (w.rodzaj === 'art') seria.push(w);
    else {
      zamknij();
      wynik.push({ etykieta: w.etykieta, strona: w.strona });
    }
  }
  zamknij();
  return { spis: wynik.slice(0, MAKS_WPISOW_SPISU), skrocono: wynik.length > MAKS_WPISOW_SPISU };
}

/** Artykuły na stronie: ten, który trwa z poprzedniej strony, i te, które się na niej zaczynają. */
export function artykulyStron(spis: readonly WpisSpisu[], stron: number): string[][] {
  const wynik: string[][] = Array.from({ length: stron + 1 }, () => []);
  // Uzasadnienie, OSR i załącznik kończą ciąg artykułów ustawy.
  const konczy = (w: WpisSpisu) => w.rodzaj === 'uzasadnienie' || w.rodzaj === 'osr' || w.rodzaj === 'zalacznik';
  let biezacy: string | null = null;
  for (let s = 1; s <= stron; s++) {
    const naStronie = spis.filter((w) => w.strona === s);
    const lista: string[] = [];
    // Artykuł z poprzedniej strony trwa, chyba że strona zaczyna się od nagłówka, który go kończy.
    if (biezacy && !(naStronie[0] && konczy(naStronie[0]))) lista.push(biezacy);
    for (const w of naStronie) {
      if (w.rodzaj === 'art') {
        if (!lista.includes(w.etykieta)) lista.push(w.etykieta);
        biezacy = w.etykieta;
      } else if (konczy(w)) biezacy = null;
    }
    wynik[s] = lista;
  }
  return wynik;
}

// ---------------------------------------------------------------------------
// Zadania w tle: pobranie pliku i odczyt tekstu (trwają dalej, gdy wywołanie skończy czas)
// ---------------------------------------------------------------------------

const pobrania = new Map<string, Promise<ZapisPliku | null>>();
const odczyty = new Map<string, { obietnica: Promise<Odczyt>; przeczytano: number; stron: number }>();

const MINELO = Symbol('minęło');
/** Pliki, na których pobranie użytkownik już się zgodził w tej sesji serwera (adres pliku). */
export const ZGODY_NA_PLIKI = new Set<string>();
async function doTerminu<T>(p: Promise<T>, termin: number, teraz: () => number): Promise<T | typeof MINELO> {
  let zegar: ReturnType<typeof setTimeout> | undefined;
  const czas = new Promise<typeof MINELO>((r) => {
    zegar = setTimeout(() => r(MINELO), Math.max(0, termin - teraz()));
  });
  try {
    return await Promise.race([p, czas]);
  } finally {
    clearTimeout(zegar);
  }
}

const kluczPliku = (kadencja: number, numer: string, nazwa: string) => ['druki', T(kadencja), numer, `${sha256(nazwa).slice(0, 32)}.json`] as const;

function pobierzDoSchowka(zrodlo: ZrodloSejmu, schowek: Schowek, katalog: string, nazwa: string, klucz: readonly string[], zmiana: string | null, limit: number): Promise<ZapisPliku | null> {
  const id = `${katalog}/${nazwa}@${limit}`;
  const trwa = pobrania.get(id);
  if (trwa) return trwa;
  if (!zrodlo.pobierzPlik) return Promise.reject(new Error('to źródło danych nie pobiera plików'));
  const p = zrodlo
    .pobierzPlik(katalog, nazwa, { limitBajtow: limit, czasMs: CZAS_POBRANIA_MS })
    .then(async (bajty) => {
      if (bajty === null) return null;
      const skrot = sha256(bajty);
      const sciezkaPliku = await schowek.zapisz(bajty, 'pliki', skrot);
      // Schowek najwyżej 500 MB: najdawniej używane pliki idą pierwsze (nowy plik zostaje).
      await schowek.sprzataj(undefined, sciezkaPliku).catch(() => {});
      const zapis: ZapisPliku = { sha256: skrot, bajtow: bajty.byteLength, pobrano: new Date().toISOString(), zmiana };
      await schowek.zapiszJson(zapis, ...klucz);
      return zapis;
    })
    .finally(() => pobrania.delete(id));
  // Błąd obsłuży ten, kto czeka; bez tego odrzucenie po terminie wywołania byłoby „nieobsłużone”.
  p.catch(() => {});
  pobrania.set(id, p);
  return p;
}

function odczytajWTle(schowek: Schowek, sha: string, bajty: Uint8Array): { obietnica: Promise<Odczyt>; przeczytano: number; stron: number } {
  const trwa = odczyty.get(sha);
  if (trwa) return trwa;
  const stan = { obietnica: Promise.resolve(null as unknown as Odczyt), przeczytano: 0, stron: 0 };
  const rodzaj = rodzajPliku(bajty);
  stan.obietnica = (async () => {
    if (rodzaj === null) throw new Error('plik nie jest ani PDF-em, ani dokumentem Word (DOCX, DOC)');
    const odczyt =
      rodzaj === 'pdf'
        ? await odczytajPdf(bajty, (n, z) => {
            stan.przeczytano = n;
            stan.stron = z;
          })
        : await odczytajWord(bajty, rodzaj);
    await schowek.zapiszJson(odczyt, 'tekst', `${sha}-v${WERSJA_ODCZYTU}.json`).catch(() => {});
    return odczyt;
  })().finally(() => odczyty.delete(sha));
  stan.obietnica.catch(() => {});
  odczyty.set(sha, stan);
  return stan;
}

// ---------------------------------------------------------------------------
// Zgoda
// ---------------------------------------------------------------------------

function stanZgody(klucz: KluczZgody, kontekst: KontekstWywolania, zgody: readonly KluczZgody[] | undefined): 'tak' | 'nie' | null {
  if (zgody?.includes(klucz)) return 'tak';
  return kontekst.odpowiedz(klucz);
}

/** Zgoda na plik ponad 20 MB; klucz „pobranie” z wersji sprzed 2.10.2026 znaczy to samo. */
function zgodaNaDuzyPlik(kontekst: KontekstWywolania, zgody: readonly KluczZgody[] | undefined): 'tak' | 'nie' | null {
  return stanZgody('duzy-plik', kontekst, zgody) ?? stanZgody('pobranie', kontekst, zgody);
}

/**
 * Wynik „potrzebna zgoda”. Gdy klient umie zapytać użytkownika, serwer zamienia pole pytanieOZgode
 * na okno pytania; inaczej model dostaje prośbę, żeby zapytał sam.
 */
function prosbaOZgode(kontekst: KontekstWywolania, klucz: KluczZgody, pytanie: string, reszta: Wynik): Wynik {
  const prosba: PytanieOZgode = { klucz, pytanie };
  if (kontekst.moznaPytac) return { ...reszta, pytanieOZgode: prosba };
  return {
    ...reszta,
    potrzebnaZgoda: { klucz, pytanie },
    odpowiedz:
      `Potrzebna zgoda użytkownika. Zapytaj go własnymi słowami: ${pytanie} ` +
      `Jeśli się zgodzi, wywołaj tekst_druku jeszcze raz z tymi samymi argumentami i zgoda=["${klucz}"]. Nie podawaj zgody bez pytania użytkownika.`,
  };
}

// ---------------------------------------------------------------------------
// Narzędzie
// ---------------------------------------------------------------------------

const wejscie = z.object({
  numer: z.string().regex(/^[0-9A-Za-z-]{1,20}$/).describe('Numer druku, np. "2457", "851-A" albo "2457-001" (druk dodatkowy)'),
  kadencja,
  plik: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Nazwa pliku z listy plików druku (np. "2457-ustawa.docx"); domyślnie główny PDF druku'),
  strony: z
    .string()
    .max(20)
    .optional()
    .describe('Strony do pokazania: "5" albo "5-12" (najwyżej 50 naraz); w pliku Word to numery części'),
  artykul: z
    .string()
    .max(20)
    .optional()
    .describe('Numer artykułu druku, np. "12" albo "12a": pokaże strony od miejsca, gdzie się zaczyna'),
  znakow: z.coerce.number().int().min(2000).max(MAKS_ZNAKOW).default(DOMYSLNIE_ZNAKOW).describe(`Najwięcej znaków tekstu w odpowiedzi (domyślnie ${DOMYSLNIE_ZNAKOW}, max ${MAKS_ZNAKOW})`),
  ocr: z.boolean().default(false).describe(`Odczyt maszynowy (OCR) stron-skanów w pokazanym zakresie, na tym komputerze; ponad ${PROG_STRON_OCR} stron naraz tylko za zgodą użytkownika`),
  zgoda: z
    .array(z.enum(['pobranie', 'duzy-plik', 'ocr']))
    .max(3)
    .optional()
    .describe('Tylko gdy użytkownik zgodził się na to, o co pytało poprzednie wywołanie (pole potrzebnaZgoda): klucz zgody, np. ["duzy-plik"] albo ["ocr"]'),
  odswiez: z.boolean().default(false).describe('Pobierz plik z Sejmu od nowa zamiast z dysku'),
});

export function utworzTekstDruku(srodowisko: Srodowisko = SRODOWISKO) {
  return narzedzie({
    nazwa: 'tekst_druku',
    tytul: 'Tekst druku sejmowego',
    opis:
      'Pełny tekst druku sejmowego (projekt ustawy, uzasadnienie, OSR, opinie) strona po stronie, z pliku PDF, DOCX albo DOC, ' +
      'ze spisem treści (działy, rozdziały, artykuły, uzasadnienie) i numerami stron. Duży druk pokazuje porcjami: najpierw spis i pierwsze strony, ' +
      'potem strony="11-20" albo artykul="52". Plik pobiera z api.sejm.gov.pl raz i trzyma na dysku użytkownika: do 20 MB bez pytania, większy dopiero za zgodą użytkownika. ' +
      'Strony bez warstwy tekstowej (skany) są oznaczone; odczyt maszynowy daje ocr=true (wynik oznaczony jako odczyt maszynowy). ' +
      ZASADA_CYTOWANIA,
    wejscie,
    async wykonaj(a, zrodlo, kontekst = BEZ_PYTANIA) {
      const termin = srodowisko.teraz() + BUDZET_MS;
      const sciezka = `${T(a.kadencja)}/prints/${a.numer}`;
      const d = jakoRekord<DrukZRejestru>(await zrodlo.json<unknown>(sciezka), 'druk', [], ['number']);
      const zrodloDruku = zrodlo.adres(sciezka);
      if (!d) {
        return { ...brak404(`Rejestr nie zna druku ${a.numer} w kadencji ${a.kadencja}`), zrodla: [zrodloDruku], uwagi: ['Numer druku sprawdzisz narzędziem szukaj_drukow.'] };
      }
      const pliki = (d.attachments ?? []).map((nazwa) => ({ nazwa, adres: adresPliku(sciezka, nazwa).href }));
      const stronaDruku = `https://www.sejm.gov.pl/Sejm${a.kadencja}.nsf/druk.xsp?nr=${encodeURIComponent(d.number)}`;
      const naglowek = {
        znaleziono: true,
        druk: d.number,
        kadencja: a.kadencja,
        tytul: czysty(d.title),
        pliki,
        stronaDruku,
        ...(d.additionalPrints?.length ? { drukiDodatkowe: d.additionalPrints.map((x) => x.number).filter((n) => n !== d.number) } : {}),
      };
      if (pliki.length === 0) {
        return { ...naglowek, odpowiedz: `Druk ${d.number} nie ma w rejestrze żadnego pliku.`, zrodla: [zrodloDruku], uwagi: [`Strona druku w serwisie Sejmu: ${stronaDruku}`] };
      }
      const nazwa = a.plik ?? (pliki.find((p) => /\.pdf$/i.test(p.nazwa)) ?? pliki[0]).nazwa;
      const plik = pliki.find((p) => p.nazwa === a.plik || p.nazwa === nazwa);
      if (!plik) throw new Error(`Druk ${d.number} nie ma pliku „${a.plik}”. Pliki druku: ${pliki.map((p) => p.nazwa).join(', ')}.`);
      const zrodla = [zrodloDruku, plik.adres];
      const inne = pliki.filter((p) => p.nazwa !== plik.nazwa).map((p) => p.nazwa);
      const schowek = srodowisko.schowek();

      // 1. Plik: ze schowka, gdy ta sama wersja druku (changeDate), inaczej z Sejmu.
      const klucz = kluczPliku(a.kadencja, d.number, plik.nazwa);
      let zapis = a.odswiez ? null : await schowek.czytajJson<ZapisPliku>(...klucz);
      if (zapis && (zapis.zmiana ?? null) !== (d.changeDate ?? null)) zapis = null;
      let bajty = zapis ? await schowek.czytaj('pliki', zapis.sha256) : null;
      if (bajty && sha256(bajty) !== zapis!.sha256) bajty = null;
      const zSchowka = bajty !== null;
      if (!bajty) {
        // Zgoda na pobranie (decyzja właściciela z 2.10.2026): plik do 20 MB pobieramy bez pytania,
        // a limit pilnuje licznik bajtów w strumieniu, bo Sejm zwykle nie podaje rozmiaru z góry
        // (Transfer-Encoding: chunked). Gdy plik przekroczy 20 MB, pobieranie przerywamy i dopiero
        // wtedy pytamy o zgodę, z powodem. Raz udzielona zgoda na ten plik obowiązuje do końca
        // działania serwera.
        const idPliku = plik.adres;
        const lzejsze = inne.filter((n) => /\.docx?$/i.test(n));
        const podpowiedz = lzejsze.length ? ` Tekst jest też w pliku ${lzejsze.join(', ')} (argument plik).` : '';
        const zgodaDuzy = ZGODY_NA_PLIKI.has(idPliku) ? 'tak' : zgodaNaDuzyPlik(kontekst, a.zgoda);
        const odmowa = (): Wynik => ({
          ...naglowek,
          odpowiedz: `Użytkownik nie zgodził się na pobranie pliku ${plik.nazwa}. Plik można otworzyć samemu: ${plik.adres}`,
          zrodla,
          uwagi: lzejsze.length ? [`Tekst jest też w pliku ${lzejsze.join(', ')}.`] : [],
        });
        const uwagiZgody = [`Plik do otwarcia bez pobierania przez serwer: ${plik.adres}`];
        let limit = PROG_ZGODY_BAJTOW;
        if (zgodaDuzy === 'tak') {
          ZGODY_NA_PLIKI.add(idPliku);
          limit = MAKS_BAJTOW;
        } else {
          // HEAD: czy plik w ogóle jest, i rozmiar, jeśli Sejm go podaje.
          const rozmiar = zrodlo.rozmiarPliku ? await zrodlo.rozmiarPliku(sciezka, plik.nazwa) : { bajtow: null };
          if (rozmiar === null) {
            return { ...brak404(`Sejm nie ma pliku ${plik.nazwa} druku ${d.number} (404), choć rejestr go wymienia`), ...naglowek, znaleziono: false, zrodla, uwagi: [`Strona druku w serwisie Sejmu: ${stronaDruku}`] };
          }
          if (rozmiar.bajtow !== null && rozmiar.bajtow > MAKS_BAJTOW) {
            return { ...naglowek, odpowiedz: `Plik ${plik.nazwa} ma ${opisRozmiaru(rozmiar.bajtow)}; serwer nie pobiera plików ponad ${MAKS_BAJTOW / 1024 / 1024} MB. Otwórz go samodzielnie: ${plik.adres}`, zrodla };
          }
          if (rozmiar.bajtow !== null && rozmiar.bajtow > PROG_ZGODY_BAJTOW) {
            if (zgodaDuzy === 'nie') return odmowa();
            const pytanie = `Plik ${plik.nazwa} druku ${d.number} ma ${opisRozmiaru(rozmiar.bajtow)}, więcej niż ${PROG_MB} MB pobierane bez pytania. Pobrać go z api.sejm.gov.pl na ten komputer?${podpowiedz}`;
            return prosbaOZgode(kontekst, 'duzy-plik', pytanie, { ...naglowek, zrodla, uwagi: uwagiZgody });
          }
        }
        let wynik: ZapisPliku | null | typeof MINELO;
        try {
          wynik = await doTerminu(pobierzDoSchowka(zrodlo, schowek, sciezka, plik.nazwa, klucz, d.changeDate ?? null, limit), termin, srodowisko.teraz);
        } catch (e) {
          if (e instanceof BladSejmu && e.rodzaj === 'za-duza') {
            if (limit === PROG_ZGODY_BAJTOW) {
              // Plik bez zapowiedzianego rozmiaru przekroczył 20 MB w strumieniu: pobieranie przerwane, pytamy.
              if (zgodaDuzy === 'nie') return odmowa();
              const pytanie =
                `Plik ${plik.nazwa} druku ${d.number} ma ponad ${PROG_MB} MB: Sejm nie podaje rozmiaru z góry, więc serwer przerwał pobieranie po ${PROG_MB} MB. ` +
                `Pobrać cały plik (najwyżej ${MAKS_BAJTOW / 1024 / 1024} MB) z api.sejm.gov.pl na ten komputer?${podpowiedz}`;
              return prosbaOZgode(kontekst, 'duzy-plik', pytanie, { ...naglowek, zrodla, uwagi: uwagiZgody });
            }
            return { ...naglowek, odpowiedz: `Plik ${plik.nazwa} ma ponad ${MAKS_BAJTOW / 1024 / 1024} MB; serwer go nie pobrał. Otwórz go samodzielnie: ${plik.adres}`, zrodla };
          }
          throw e;
        }
        if (wynik === MINELO) {
          return {
            ...naglowek,
            odpowiedz: `Pobieranie pliku ${plik.nazwa} trwa w tle (duży plik, Sejm wysyła go powoli). Wywołaj tekst_druku jeszcze raz za chwilę z tymi samymi argumentami.`,
            wynikCzesciowy: czesciowy('plik druku jeszcze się pobiera', 'tekstu druku', 'wywołać to samo narzędzie ponownie za ok. pół minuty'),
            zrodla,
          };
        }
        if (wynik === null) {
          return { ...brak404(`Sejm nie ma pliku ${plik.nazwa} druku ${d.number} (404), choć rejestr go wymienia`), ...naglowek, znaleziono: false, zrodla, uwagi: [`Strona druku w serwisie Sejmu: ${stronaDruku}`] };
        }
        zapis = wynik;
        bajty = await schowek.czytaj('pliki', wynik.sha256);
        if (!bajty) throw new Error('plik druku zniknął ze schowka zaraz po zapisie');
      }
      const sha = zapis!.sha256;

      // 2. Tekst: ze schowka albo odczyt (duży PDF czyta się kilkanaście sekund; w razie czego w tle).
      let odczyt = await schowek.czytajJson<Odczyt>('tekst', `${sha}-v${WERSJA_ODCZYTU}.json`);
      if (!odczyt || odczyt.wersja !== WERSJA_ODCZYTU) {
        const stan = odczytajWTle(schowek, sha, bajty);
        let w: Odczyt | typeof MINELO;
        try {
          w = await doTerminu(stan.obietnica, termin, srodowisko.teraz);
        } catch (e) {
          const opis = e instanceof Error ? e.message : String(e);
          return {
            ...naglowek,
            odpowiedz: `Nie udało się odczytać tekstu z pliku ${plik.nazwa} (${opis.slice(0, 200)}). Plik można otworzyć samodzielnie: ${plik.adres}`,
            zrodla,
            uwagi: inne.length ? [`Inne pliki tego druku: ${inne.join(', ')} (argument plik).`] : [],
          };
        }
        if (w === MINELO) {
          return {
            ...naglowek,
            odpowiedz: `Odczyt tekstu z pliku ${plik.nazwa} trwa w tle (przeczytano ${stan.przeczytano} z ${stan.stron || '?'} stron). Wywołaj tekst_druku jeszcze raz za chwilę.`,
            wynikCzesciowy: czesciowy('duży plik jeszcze się czyta', 'tekstu druku', 'wywołać to samo narzędzie ponownie za kilkanaście sekund'),
            zrodla,
          };
        }
        odczyt = w;
      }

      // 3. Zakres stron.
      const word = odczyt.rodzaj !== 'pdf';
      const jednostka = word ? (['część', 'części', 'części'] as [string, string, string]) : (['strona', 'strony', 'stron'] as [string, string, string]);
      const spis = spisTresci(odczyt.strony);
      const uwagi: string[] = [];
      let zakres = zakresStron(a.strony, odczyt.stron);
      if (!zakres && a.artykul) {
        const k = kluczArtykulu(a.artykul);
        const trafienia = spis.filter((w) => w.rodzaj === 'art' && kluczArtykulu(w.numer ?? '') === k);
        if (trafienia.length) {
          // Od strony, na której artykuł się zaczyna, do strony, na której zaczyna się następny wpis spisu.
          const i = spis.indexOf(trafienia[0]);
          const nastepny = spis.slice(i + 1).find((w) => w.strona > trafienia[0].strona || w.rodzaj === 'art');
          const koniec = nastepny ? Math.max(trafienia[0].strona, nastepny.strona) : odczyt.stron;
          zakres = { od: trafienia[0].strona, do: Math.min(odczyt.stron, koniec, trafienia[0].strona + DOMYSLNIE_STRON - 1) };
          const inneMiejsca = trafienia.slice(1).map((t) => t.strona);
          if (inneMiejsca.length) {
            const gdzie = word ? (inneMiejsca.length === 1 ? 'części' : 'częściach') : inneMiejsca.length === 1 ? 'stronie' : 'stronach';
            uwagi.push(`„Art. ${a.artykul}.” zaczyna wiersz także na ${gdzie} ${zakresyNapisem(inneMiejsca)} (np. w innej ustawie albo w uzasadnieniu).`);
          }
        } else {
          uwagi.push(`Nie znaleziono wiersza zaczynającego się od „Art. ${a.artykul}.”; pokazuję początek pliku i spis. Artykuł może być w innym pliku druku albo na stronie-skanie.`);
        }
      }
      const pokazSpis = !a.strony;
      const od = zakres?.od ?? 1;
      const doMaks = zakres?.do ?? Math.min(odczyt.stron, od + DOMYSLNIE_STRON - 1);

      // Strony w budżecie znaków (co najmniej jedna).
      const wybrane: number[] = [];
      let znakow = 0;
      for (let s = od; s <= doMaks; s++) {
        const t = odczyt.strony[s - 1].tekst.length;
        if (wybrane.length && znakow + t > a.znakow) break;
        wybrane.push(s);
        znakow += t;
      }

      // 4. OCR stron-skanów w pokazanym zakresie (tylko na prośbę i za zgodą).
      const skany = wybrane.filter((s) => odczyt!.strony[s - 1].skan);
      let ocr = new Map<number, StronaOcr>();
      let czesciowyOcr: ReturnType<typeof czesciowy> | undefined;
      if (!word && skany.length) ocr = await zapisaneOcr(schowek, sha, skany);
      const brakOcr = skany.filter((s) => !ocr.has(s));
      if (a.ocr && brakOcr.length) {
        const gotowy = await srodowisko.silnikGotowy();
        const zgodaOcr = brakOcr.length > PROG_STRON_OCR ? stanZgody('ocr', kontekst, a.zgoda) : 'tak';
        if (!gotowy) {
          czesciowyOcr = czesciowy(
            'silnika OCR brakuje w tej instalacji albo jego pliki są uszkodzone',
            `tekstu stron-skanów ${zakresyNapisem(brakOcr)}`,
            `zainstalować sejm-mcp ponownie albo otworzyć te strony w pliku: ${plik.adres}`,
          );
        } else if (zgodaOcr === null) {
          const sekund = brakOcr.length * SEKUND_NA_STRONE;
          const pytanie =
            `W pliku ${plik.nazwa} druku ${d.number} ${odmiana(brakOcr.length, ['strona nie ma', 'strony nie mają', 'stron nie ma'])} warstwy tekstowej (skany: ${zakresyNapisem(brakOcr)}). ` +
            'Odczyt maszynowy (OCR) działa na tym komputerze, bez wysyłania pliku gdziekolwiek. ' +
            `Rozpoznanie potrwa ok. ${sekund < 90 ? `${sekund} s` : `${Math.round(sekund / 60)} min`} (ok. ${SEKUND_NA_STRONE} s na stronę). ` +
            'Wynik to odczyt maszynowy z możliwymi błędami, nie tekst opublikowany przez Sejm. Zgadzasz się?';
          // Tekst stron z warstwą tekstową i tak oddajemy: pytanie dotyczy tylko skanów.
          const bezOcr = zbudujWynik();
          return prosbaOZgode(kontekst, 'ocr', pytanie, bezOcr);
        } else if (zgodaOcr === 'nie') {
          uwagi.push('Użytkownik nie zgodził się na odczyt maszynowy (OCR); strony-skany zostają bez tekstu.');
        } else {
          try {
            const zadanie = srodowisko.kolejkaOcr.zlec(schowek, sha, bajty, brakOcr);
            zadanie.catch(() => {});
            await doTerminu(zadanie.catch(() => {}), termin, srodowisko.teraz);
            ocr = await zapisaneOcr(schowek, sha, skany);
            const nadal = skany.filter((s) => !ocr.has(s));
            const stan = srodowisko.kolejkaOcr.stan(sha);
            if (nadal.length) {
              czesciowyOcr = stan?.blad && !stan.gotowe
                ? czesciowy(`odczyt maszynowy się nie udał (${stan.blad})`, `tekstu stron-skanów ${zakresyNapisem(nadal)}`, `otworzyć te strony w pliku: ${plik.adres}`)
                : czesciowy(
                    'odczyt maszynowy (OCR) trwa w tle',
                    `tekstu stron-skanów ${zakresyNapisem(nadal)}`,
                    `wywołać to samo narzędzie ponownie za ok. ${Math.max(10, nadal.length * SEKUND_NA_STRONE)} s`,
                  );
            }
          } catch (e) {
            const opis = e instanceof Error ? e.message : String(e);
            czesciowyOcr = czesciowy(`nie udało się przygotować odczytu maszynowego (${opis.slice(0, 200)})`, `tekstu stron-skanów ${zakresyNapisem(brakOcr)}`, `otworzyć te strony w pliku: ${plik.adres}`);
          }
        }
      }

      return zbudujWynik();

      function zbudujWynik(): Wynik {
        const o = odczyt!;
        const arty = word ? [] : artykulyStron(spis, o.stron);
        const artyWord = word ? spis.filter((w) => w.rodzaj === 'art') : [];
        const wszystkieSkany = o.strony.flatMap((s, i) => (s.skan ? [i + 1] : []));
        const strony = wybrane.map((s) => {
          const strona = o.strony[s - 1];
          const artykuly = word ? artyWord.filter((w) => w.strona === s).map((w) => w.etykieta) : arty[s];
          const cytowanie = {
            druk: d!.number,
            plik: plik!.nazwa,
            ...(word ? { czesc: s, strona: null } : { strona: s }),
            ...(artykuly.length ? { artykuly } : {}),
            url: word ? plik!.adres : `${plik!.adres}#page=${s}`,
          };
          const zOcr = ocr.get(s);
          if (strona.skan && zOcr && !zOcr.blad) {
            return {
              ...(word ? { czesc: s } : { strona: s }),
              tekst: zOcr.tekst,
              skan: ETYKIETA_SKANU,
              ocr: { etykieta: ETYKIETA_OCR, silnik: zOcr.silnik, pewnosc: Math.round(zOcr.pewnosc), ...(zOcr.pusta ? { uwaga: 'na stronie nie ma obrazu z tekstem (pusta strona)' } : {}) },
              cytowanie: { ...cytowanie, zrodloTekstu: 'odczyt maszynowy obrazu strony (OCR), nie tekst Sejmu', sprawdz: `Otwórz stronę ${s} w oryginale, żeby sprawdzić odczyt: ${cytowanie.url}` },
            };
          }
          return {
            ...(word ? { czesc: s } : { strona: s }),
            tekst: strona.tekst,
            ...(strona.skan ? { skan: ETYKIETA_SKANU } : {}),
            cytowanie,
          };
        });
        const ostatnia = wybrane[wybrane.length - 1];
        const nastepna = ostatnia < o.stron ? ostatnia + 1 : null;
        const skanyWPokazanych = wybrane.filter((s) => o.strony[s - 1].skan && !ocr.has(s));
        const odp = [
          `Druk ${d!.number}, plik ${plik!.nazwa}: ${odmiana(o.stron, jednostka)}${word ? ' (Word nie ma stron; części to kolejne fragmenty tekstu)' : ''}` +
            `${zSchowka ? ', z dysku (pobrany wcześniej)' : ''}. Pokazano ${word ? 'części' : 'strony'} ${zakresyNapisem(wybrane)}.`,
          ...(wszystkieSkany.length ? [`${odmiana(wszystkieSkany.length, ['strona nie ma', 'strony nie mają', 'stron nie ma'])} warstwy tekstowej (skany): ${zakresyNapisem(wszystkieSkany)}.`] : []),
          ...(skanyWPokazanych.length && !a.ocr ? [`Tekst skanów ${zakresyNapisem(skanyWPokazanych)} może odczytać maszynowo: to samo wywołanie z ocr=true (ok. ${SEKUND_NA_STRONE} s na stronę${skanyWPokazanych.length > PROG_STRON_OCR ? '; przy tylu stronach serwer zapyta użytkownika o zgodę' : ''}).`] : []),
          ...(nastepna ? [`Dalszy ciąg: strony="${nastepna}-${Math.min(o.stron, nastepna + DOMYSLNIE_STRON - 1)}"${spis.some((w) => w.rodzaj === 'art') ? ' albo artykul="N"' : ''}.`] : []),
        ].join(' ');
        const { spis: spisOdp, skrocono } = spisDoOdpowiedzi(spis);
        return {
          ...naglowek,
          odpowiedz: odp,
          ...(czesciowyOcr ? { wynikCzesciowy: czesciowyOcr } : {}),
          plik: {
            nazwa: plik!.nazwa,
            adres: plik!.adres,
            rodzaj: o.rodzaj,
            bajtow: zapis!.bajtow,
            sha256: sha,
            pobrano: zapis!.pobrano,
            [word ? 'czesci' : 'stron']: o.stron,
            ...(wszystkieSkany.length ? { stronBezTekstu: wszystkieSkany.length, skany: zakresyNapisem(wszystkieSkany) } : {}),
          },
          ...(pokazSpis ? { spis: spisOdp, ...(skrocono ? { spisSkrocony: true } : {}) } : {}),
          strony,
          ...(nastepna ? { nastepnaStrona: nastepna } : {}),
          cytowanie: ZASADA_CYTOWANIA,
          zrodla,
          uwagi: [
            ...uwagi,
            UWAGA_TEKST_Z_ZEWNATRZ,
            'Tekst z PDF jest spłaszczony: tabele i przypisy stoją jako zwykły tekst, a wyrazy przeniesione do nowego wiersza zostają z dywizem.',
            ...(ocr.size ? [ZASADA_OCR] : []),
            ...(skrocono ? [`Spis skrócono do ${MAKS_WPISOW_SPISU} pozycji; konkretny artykuł pokaże artykul="N".`] : []),
            ...(inne.length ? [`Inne pliki tego druku: ${inne.join(', ')} (argument plik).`] : []),
            ...(naglowek.drukiDodatkowe?.length ? [`Druki dodatkowe (opinie, OSR) to osobne druki: ${naglowek.drukiDodatkowe.join(', ')} (argument numer).`] : []),
            `Strona druku w serwisie Sejmu: ${stronaDruku}`,
          ],
        };
      }
    },
  });
}

export const tekstDruku = utworzTekstDruku();
