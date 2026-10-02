/**
 * Tekst z PDF-ów publikowanych przez API Sejmu (odpowiedzi ministrów, teksty jednolite w ELI).
 *
 * PDF przychodzi WYŁĄCZNIE przez klienta (allowlista api.sejm.gov.pl /sejm i /eli, limit 24 MiB
 * i limit czasu). Czyta go pdf.js 6 w wersji serwerowej z paczki unpdf, w tym samym wątku
 * (bez workera i bez wątków), bez czcionek i cmap z sieci (cMapUrl i standardFontDataUrl zostają
 * puste), bez zapisu na dysk. pdf.js 6 nie ma już ścieżki z eval (opcję isEvalSupported usunięto,
 * bo nie ma czego wyłączać): w paczce nie ma ani `eval(`, ani `new Function`, czego pilnuje test.
 * Skryptów z PDF pdf.js nie uruchamia (to robi dopiero przeglądarkowy viewer).
 * Limit stron, znaków i czasu; każda awaria daje opis zamiast wyjątku, a narzędzie zostaje przy linku.
 * Tekst przechodzi przez te same czyszczenie co tekst z HTML (zwyklyTekst).
 */

import { sciezkaZAdresu, type ZrodloSejmu } from './klient.js';
import { odmiana } from './reguly/daty.js';
import { zwyklyTekst } from './tekst.js';

export interface OpcjePdf {
  /** Najwięcej stron do przeczytania; dalsze strony pomijamy i mówimy o tym. */
  maksStron: number;
  /** Najwięcej znaków wyniku. */
  maksZnakow: number;
  /** Milisekundy na samo czytanie PDF (bez pobierania). */
  limitCzasuMs: number;
}

/** Pismo ministra ma kilka stron; 60 wystarcza z zapasem. */
export const OPCJE_PISMA: OpcjePdf = { maksStron: 60, maksZnakow: 400_000, limitCzasuMs: 20_000 };
/** Tekst jednolity kodeksu ma setki stron (Kodeks pracy DU/2025/277: 97 stron, ok. 380 tys. znaków). */
export const OPCJE_AKTU: OpcjePdf = { maksStron: 600, maksZnakow: 3_000_000, limitCzasuMs: 20_000 };

export interface TekstPdf {
  tekst: string;
  stron: number;
  przeczytanoStron: number;
  /** Czy tekst jest niepełny (limit stron albo znaków). */
  uciety: boolean;
}

export type WynikPdf = ({ ok: true } & TekstPdf) | { ok: false; powod: string };

/** Mniej znaków niż tyle na stronę: PDF to najpewniej skan bez warstwy tekstowej. */
const ZNAKOW_NA_STRONE_SKANU = 20;

export interface ElementTekstu {
  str?: string;
  hasEOL?: boolean;
  height?: number;
  transform?: number[];
}

/** Znaki indeksu górnego; to, czego nie da się tak zapisać, idzie jako „^tekst”. */
const INDEKS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '(': '⁽', ')': '⁾', '+': '⁺', '-': '⁻',
};
function indeks(t: string): string {
  const s = t.trim();
  return [...s].every((c) => INDEKS[c]) ? [...s].map((c) => INDEKS[c]).join('') : `^${s}`;
}

/**
 * Strona → wiersze tekstu. Indeks górny (mniejsza czcionka, wyżej niż poprzedni tekst w tym
 * samym wierszu) zapisujemy znakami ¹²³: w PDF „Art. 9¹.” to trzy kawałki „Art. 9”, „1”, „.”,
 * a sklejone dawałyby nieistniejący „Art. 91.”.
 */
export function stronaNaTekst(elementy: ElementTekstu[]): string {
  let wynik = '';
  let poprzedni: { wys: number; y: number } | null = null;
  for (const e of elementy) {
    if (typeof e.str !== 'string') continue;
    const wys = e.height ?? 0;
    const y = e.transform?.[5] ?? 0;
    let s = e.str;
    // Indeks bywa cyfrą z literą: art. 18³ᵃ Kodeksu pracy to w PDF „Art. 18” i „3a”; zapisujemy go „18^3a”, jak tekst z HTML.
    const cyfryIndeksu = /^(?:[0-9()+-]{1,6}|[0-9]{1,3}[a-z]{1,2})$/.test(s.trim());
    if (poprzedni && cyfryIndeksu && wys > 0 && poprzedni.wys > 0 && wys < poprzedni.wys * 0.8 && y > poprzedni.y + 1 && !/\s$/.test(wynik)) {
      s = indeks(s);
    } else if (wys > 0 && s.trim()) {
      poprzedni = { wys, y };
    }
    wynik += s;
    if (e.hasEOL) {
      wynik += '\n';
      poprzedni = null;
    }
  }
  return wynik;
}

/**
 * Nagłówek każdej strony dziennika rozcinał przepisy w pół i doklejał się do artykułów:
 * dziś „Dziennik Ustaw – 5 – Poz. 277”, w starych rocznikach „Dziennik Ustaw Nr 78 - 2414 -”
 * i osobny wiersz „Poz. 483” (Konstytucja, DU/1997/483).
 */
const NAGLOWEK_DZIENNIKA = /^(?:Dziennik Ustaw|Monitor Polski)(?:\s+Nr\s+\d+)?\s*[–—-]\s*\d+\s*[–—-]\s*(?:Poz\.\s*\d+)?\s*$/gm;
const SAMA_POZYCJA = /^Poz\.\s*\d+\s*$/gm;
/** Stopka wydawcy na ostatniej stronie starych dzienników: do końca tekstu nie ma w niej przepisów. */
const STOPKA_WYDAWCY = /\n(?:Wydawca: Kancelaria Prezesa Rady Ministrów|Wydawca: Rządowe Centrum Legislacji)[\s\S]*$/;

/**
 * Znaki z czcionek symbolowych (Symbol, Wingdings) trafiają do prywatnego obszaru Unicode:
 * wypunktowanie to U+F0B7, a model widział w odpowiedzi pismo z 58 takimi znakami. Znane
 * punktory zamieniamy na „•”, resztę usuwamy (bez czcionki nie wiadomo, czym były).
 */
const PUNKTORY = new Set([0xf0b7, 0xf0a7, 0xf06e, 0xf0d8, 0xf076, 0xf0a8, 0xf0fc, 0xf0b0, 0xf06c, 0xf0a2]);
export function bezZnakowPrywatnych(t: string): string {
  return t.replace(/[\uE000-\uF8FF]/g, (c) => (PUNKTORY.has(c.codePointAt(0)!) ? '•' : ''));
}

function zPrzerwa<T>(obietnica: Promise<T>, ms: number, anuluj: () => void): Promise<T> {
  let zegar: ReturnType<typeof setTimeout> | undefined;
  const czas = new Promise<never>((_, odrzuc) => {
    zegar = setTimeout(() => {
      anuluj();
      odrzuc(new Error(`czytanie PDF przekroczyło ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  return Promise.race([obietnica, czas]).finally(() => clearTimeout(zegar));
}

/**
 * Bajty PDF → tekst. Nigdy nie rzuca: błąd, przekroczony czas, skan bez tekstu i plik, który nie
 * jest PDF-em, dają `{ ok: false, powod }`.
 */
export async function tekstZPdf(bajty: Uint8Array, opcje: OpcjePdf): Promise<WynikPdf> {
  // Nagłówek %PDF- może leżeć do 1024 bajtów od początku pliku.
  if (!Buffer.from(bajty.subarray(0, 1024)).toString('latin1').includes('%PDF-')) {
    return { ok: false, powod: 'plik nie jest PDF-em' };
  }
  const koniec = Date.now() + opcje.limitCzasuMs;
  let zadanie: { promise: Promise<unknown>; destroy(): Promise<void> } | null = null;
  const anuluj = () => {
    void zadanie?.destroy().catch(() => {});
  };
  try {
    const { getDocument } = await import('unpdf/pdfjs');
    // pdf.js przejmuje bufor na własność: podajemy kopię, żeby nie wyzerował danych z pamięci klienta.
    zadanie = getDocument({
      data: bajty.slice(),
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      stopAtErrors: false,
      verbosity: 0,
    }) as unknown as { promise: Promise<unknown>; destroy(): Promise<void> };
    const dokument = (await zPrzerwa(zadanie.promise, opcje.limitCzasuMs, anuluj)) as {
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: ElementTekstu[] }>; cleanup(): void }>;
    };
    const stron = dokument.numPages;
    const doPrzeczytania = Math.min(stron, opcje.maksStron);
    const strony: string[] = [];
    let znakow = 0;
    let przeczytano = 0;
    for (let n = 1; n <= doPrzeczytania; n++) {
      const zostalo = koniec - Date.now();
      if (zostalo <= 0) throw new Error(`czytanie PDF przekroczyło ${Math.round(opcje.limitCzasuMs / 1000)} s`);
      const strona = await zPrzerwa(dokument.getPage(n), zostalo, anuluj);
      const tresc = await zPrzerwa(strona.getTextContent(), Math.max(1, koniec - Date.now()), anuluj);
      strona.cleanup();
      const t = stronaNaTekst(tresc.items);
      strony.push(t);
      znakow += t.length;
      przeczytano = n;
      if (znakow >= opcje.maksZnakow) break;
    }
    let tekst = zwyklyTekst(bezZnakowPrywatnych(strony.join('\n\n').replace(NAGLOWEK_DZIENNIKA, '').replace(SAMA_POZYCJA, '').replace(STOPKA_WYDAWCY, '')));
    const ucietyZnakami = tekst.length > opcje.maksZnakow;
    if (ucietyZnakami) tekst = tekst.slice(0, opcje.maksZnakow);
    if (tekst.replace(/\s/g, '').length < ZNAKOW_NA_STRONE_SKANU * Math.max(1, przeczytano)) {
      return { ok: false, powod: 'PDF nie ma warstwy tekstowej (najpewniej skan); serwer nie rozpoznaje tekstu z obrazu' };
    }
    return { ok: true, tekst, stron, przeczytanoStron: przeczytano, uciety: ucietyZnakami || przeczytano < stron };
  } catch (e) {
    const opis = e instanceof Error ? e.message : String(e);
    return { ok: false, powod: `nie udało się odczytać PDF (${opis.slice(0, 200)})` };
  } finally {
    anuluj();
  }
}

/**
 * Pełny adres PDF z rejestru → tekst. Adres musi leżeć pod api.sejm.gov.pl/sejm/ albo /eli/:
 * inny zostaje linkiem (allowlisty nie rozszerzamy). Nigdy nie rzuca.
 */
export async function czytajPdf(zrodlo: ZrodloSejmu, adres: string, opcje: OpcjePdf, termin?: number): Promise<WynikPdf> {
  const sciezka = sciezkaZAdresu(adres);
  if (sciezka === null) return { ok: false, powod: 'PDF leży poza api.sejm.gov.pl/sejm i /eli; serwer go nie pobiera' };
  // Termin całego wywołania narzędzia: pobranie i czytanie muszą się zmieścić razem z resztą zapytań.
  if (termin !== undefined && termin - Date.now() < 5000) return { ok: false, powod: 'zabrakło czasu na pobranie i odczyt PDF w ramach jednego wywołania' };
  let bajty: Uint8Array | null;
  try {
    bajty = await zrodlo.bajty(sciezka, termin !== undefined ? { termin } : undefined);
  } catch (e) {
    const opis = e instanceof Error ? e.message : String(e);
    return { ok: false, powod: `nie udało się pobrać PDF (${opis.slice(0, 200)})` };
  }
  if (bajty === null) return { ok: false, powod: 'Sejm nie ma tego pliku (404)' };
  if (termin !== undefined) {
    const zostalo = termin - Date.now() - 500;
    if (zostalo < 2000) return { ok: false, powod: 'PDF pobrano, ale zabrakło czasu na jego odczyt w ramach jednego wywołania' };
    return tekstZPdf(bajty, { ...opcje, limitCzasuMs: Math.min(opcje.limitCzasuMs, zostalo) });
  }
  return tekstZPdf(bajty, opcje);
}

/** Uwaga do każdego tekstu z PDF: skąd jest i czego nie ma. */
export const UWAGA_PDF =
  'Ten tekst serwer odczytał z pliku PDF (pole zPdf): układ strony, tabele i przypisy są spłaszczone do zwykłego tekstu, ' +
  'a wyrazy przeniesione na koniec wiersza zostają z dywizem. Liczby i cytaty sprawdzaj z tym tekstem. ' +
  // Model odsyłał czytelnika do PDF-u po kwoty, których w przeczytanym w całości pliku nie było.
  'Gdy odczytano wszystkie strony pliku, to jest cały jego tekst: czego tu nie ma, nie ma też w tym PDF, więc nie odsyłaj po to czytelnika do pliku.';

/** Znacznik „⁶⁾” za numerem artykułu to odsyłacz do przypisu, nie część numeru. */
export const UWAGA_PRZYPISY =
  'Znacznik „N⁾” w indeksie górnym (np. „Art. 446¹.⁶⁾”) to odsyłacz do przypisu dziennika, nie część numeru artykułu; treść przypisu bywa w stopce strony.';

/** „przeczytano 3 z 3 stron (cały plik)”: zawsze, także gdy PDF odczytano w całości. */
export function opisOdczytuPdf(w: Pick<TekstPdf, 'stron' | 'przeczytanoStron' | 'uciety'>): string {
  const zdanie = `przeczytano ${w.przeczytanoStron} z ${odmiana(w.stron, ['strony', 'stron', 'stron'])}`;
  return w.uciety ? `${zdanie} (limit: dalszej części tekstu tu nie ma)` : `${zdanie} (cały plik)`;
}

/** Ta sama informacja jako zdanie do pola uwagi. */
export function uwagaOdczytuPdf(w: Pick<TekstPdf, 'stron' | 'przeczytanoStron' | 'uciety'>): string {
  const o = opisOdczytuPdf(w);
  return `PDF: ${o}.`;
}
