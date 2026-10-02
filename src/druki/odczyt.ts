/**
 * Plik druku (PDF, DOCX, DOC) → tekst strona po stronie, spis treści i znaczniki skanów.
 *
 * PDF czyta pdf.js z paczki unpdf (ta sama co przy pismach i aktach, bez eval, bez workera, bez
 * czcionek z sieci), strona po stronie. Strona, na której warstwa tekstowa ma mniej niż 80 znaków
 * innych niż odstępy, jest oznaczona jako skan: w próbce 80 druków takich stron było ok. 4%, a pliki
 * mieszane są częste (558.pdf: 73 ze 117 stron, 2457.pdf: 34 ze 161). Tekstu z obrazu ten moduł
 * nie rozpoznaje; to robi osobny moduł OCR, wyłącznie po zgodzie użytkownika.
 *
 * DOCX i DOC czyta word-extractor (czysty JavaScript, bez natywnych zależności). Word nie ma stron:
 * dzielimy tekst na części po akapitach i mówimy wprost, że to części, a nie strony wydruku.
 */

import WordExtractor from 'word-extractor';
import { bezZnakowPrywatnych, stronaNaTekst, type ElementTekstu } from '../pdf.js';
import { zwyklyTekst } from '../tekst.js';

/** Mniej znaków (bez odstępów) na stronie: strona bez warstwy tekstowej, najpewniej skan. */
export const PROG_SKANU = 80;
/** Część pliku Word: tyle znaków najwyżej, cięte na granicy akapitu. */
const ZNAKOW_CZESCI_WORD = 4000;
/** Wersja formatu zapisu w schowku; zmiana wymusza ponowny odczyt starszych wpisów. */
export const WERSJA_ODCZYTU = 1;

export type RodzajPliku = 'pdf' | 'docx' | 'doc';

export interface Strona {
  tekst: string;
  /** Strona bez warstwy tekstowej (mniej niż PROG_SKANU znaków): najpewniej skan. */
  skan: boolean;
}

export interface Odczyt {
  wersja: number;
  rodzaj: RodzajPliku;
  /** PDF: liczba stron pliku. Word: liczba części (Word nie ma stron). */
  stron: number;
  strony: Strona[];
}

/** Rodzaj pliku z pierwszych bajtów (nie z nazwy: rejestr zdarza się mylić rozszerzenia). */
export function rodzajPliku(bajty: Uint8Array): RodzajPliku | null {
  const poczatek = Buffer.from(bajty.subarray(0, 1024));
  if (poczatek.toString('latin1').includes('%PDF-')) return 'pdf';
  if (poczatek.length >= 4 && poczatek.readUInt32BE(0) === 0x504b0304) return 'docx';
  if (poczatek.length >= 8 && poczatek.readUInt32BE(0) === 0xd0cf11e0) return 'doc';
  return null;
}

const bezOdstepow = (t: string) => t.replace(/\s/g, '').length;

/**
 * PDF → strony. `postep(n, z)` dostaje liczbę przeczytanych stron (duży druk czyta się kilkanaście
 * sekund: 948.pdf, 2025 stron, ok. 15 s). Rzuca wyjątek przy pliku, którego pdf.js nie otworzy.
 */
export async function odczytajPdf(bajty: Uint8Array, postep?: (przeczytano: number, stron: number) => void): Promise<Odczyt> {
  const { getDocument } = await import('unpdf/pdfjs');
  const zadanie = getDocument({
    data: new Uint8Array(bajty),
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
  try {
    const dokument = (await zadanie.promise) as {
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: ElementTekstu[] }>; cleanup(): void }>;
    };
    const strony: Strona[] = [];
    for (let n = 1; n <= dokument.numPages; n++) {
      const strona = await dokument.getPage(n);
      const tresc = await strona.getTextContent();
      strona.cleanup();
      const tekst = zwyklyTekst(bezZnakowPrywatnych(stronaNaTekst(tresc.items)));
      strony.push({ tekst, skan: bezOdstepow(tekst) < PROG_SKANU });
      if (n % 25 === 0) {
        postep?.(n, dokument.numPages);
        // Oddajemy pętlę zdarzeń: serwer w tym czasie obsługuje inne wywołania.
        await new Promise((r) => setImmediate(r));
      }
    }
    postep?.(dokument.numPages, dokument.numPages);
    return { wersja: WERSJA_ODCZYTU, rodzaj: 'pdf', stron: dokument.numPages, strony };
  } finally {
    await zadanie.destroy().catch(() => {});
  }
}

/** Tekst na części najwyżej `limit` znaków, cięte na granicy akapitu (akapit dłuższy od limitu tniemy na zdaniach). */
export function podzielNaCzesci(tekst: string, limit = ZNAKOW_CZESCI_WORD): string[] {
  const akapity = tekst.split(/\n+/).map((a) => a.trim()).filter(Boolean);
  const czesci: string[] = [];
  let biezaca = '';
  const dodaj = (a: string) => {
    if (biezaca && biezaca.length + 1 + a.length > limit) {
      czesci.push(biezaca);
      biezaca = '';
    }
    biezaca = biezaca ? `${biezaca}\n${a}` : a;
  };
  for (const a of akapity) {
    if (a.length <= limit) {
      dodaj(a);
      continue;
    }
    for (let i = 0; i < a.length; i += limit) dodaj(a.slice(i, i + limit));
  }
  if (biezaca) czesci.push(biezaca);
  return czesci;
}

/** DOCX albo DOC → części tekstu (przypisy i przypisy końcowe jako ostatnie części, z nagłówkiem). */
export async function odczytajWord(bajty: Uint8Array, rodzaj: 'docx' | 'doc'): Promise<Odczyt> {
  const dokument = await new WordExtractor().extract(Buffer.from(bajty));
  const glowny = zwyklyTekst(bezZnakowPrywatnych(dokument.getBody()));
  const przypisy = zwyklyTekst(bezZnakowPrywatnych([dokument.getFootnotes(), dokument.getEndnotes()].filter((t) => t && t.trim()).join('\n')));
  const czesci = podzielNaCzesci(glowny);
  if (przypisy) czesci.push(...podzielNaCzesci(`Przypisy:\n${przypisy}`));
  const strony = czesci.map((tekst) => ({ tekst, skan: false }));
  return { wersja: WERSJA_ODCZYTU, rodzaj, stron: strony.length, strony };
}

// ---------------------------------------------------------------------------
// Spis treści
// ---------------------------------------------------------------------------

export type RodzajWpisu = 'dzial' | 'rozdzial' | 'oddzial' | 'art' | 'uzasadnienie' | 'osr' | 'zalacznik' | 'ustawa';

export interface WpisSpisu {
  rodzaj: RodzajWpisu;
  /** Napis tak, jak stoi w druku (z tytułem z następnego wiersza, gdy nagłówek jest sam). */
  etykieta: string;
  /** Numer artykułu (tylko rodzaj 'art'), np. "12a". */
  numer?: string;
  strona: number;
}

const NAGLOWKI: Array<[RodzajWpisu, RegExp, boolean]> = [
  // [rodzaj, wzór całego wiersza, czy dołączyć następny wiersz jako tytuł]
  ['dzial', /^DZIAŁ\s+[IVXLC]+[a-z]?$|^Dział\s+[IVXLC\d]+[a-z]?$/, true],
  ['rozdzial', /^Rozdział\s+(?:\d+[a-z]?|[IVXLC]+)$/, true],
  ['oddzial', /^Oddział\s+\d+[a-z]?$/, true],
  ['ustawa', /^U\s?S\s?T\s?A\s?W\s?A$/, false],
  ['uzasadnienie', /^U\s?Z\s?A\s?S\s?A\s?D\s?N\s?I\s?E\s?N\s?I\s?E$|^Uzasadnienie$/, false],
  ['osr', /^OCENA SKUTKÓW REGULACJI\b|^Ocena Skutków Regulacji\b/, false],
  ['zalacznik', /^Załącznik(?:i)?(?:\s+(?:nr\s*)?\d+[a-z]?)?\b.{0,80}$/, false],
];
/**
 * „Art. 12. …” na początku wiersza. Cytowany przepis w nowelizacji zaczyna się od „„Art.” albo małej
 * litery („art. 5 otrzymuje brzmienie”), więc go nie łapiemy: spis mówi, gdzie są artykuły druku.
 */
const ARTYKUL = /^Art\.\s*(\d+[a-z]{0,3}(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\^\d+[a-z]?)?)\.(?:\s|$)/;

/** Spis z tekstu stron: nagłówki struktury i artykuły, z numerem strony, w kolejności. */
export function spisTresci(strony: readonly Strona[]): WpisSpisu[] {
  const wpisy: WpisSpisu[] = [];
  strony.forEach((s, i) => {
    const wiersze = s.tekst.split('\n').map((w) => w.trim()).filter(Boolean);
    wiersze.forEach((w, j) => {
      const art = ARTYKUL.exec(w);
      if (art) {
        wpisy.push({ rodzaj: 'art', etykieta: `Art. ${art[1]}`, numer: art[1], strona: i + 1 });
        return;
      }
      for (const [rodzaj, wzor, zTytulem] of NAGLOWKI) {
        if (!wzor.test(w)) continue;
        const tytul = zTytulem && wiersze[j + 1] && !ARTYKUL.test(wiersze[j + 1]) && wiersze[j + 1].length <= 120 ? ` ${wiersze[j + 1]}` : '';
        wpisy.push({ rodzaj, etykieta: `${w}${tytul}`.replace(/\s+/g, ' '), strona: i + 1 });
        return;
      }
    });
  });
  return wpisy;
}

/** Numer artykułu do porównania: „12 a” = „12a”, indeks górny „9¹” = „9^1”. */
export function kluczArtykulu(n: string): string {
  const gorne: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  return n
    .toLowerCase()
    .replace(/^art\.?\s*/, '')
    .replace(/\s+/g, '')
    .replace(/\.$/, '')
    .replace(/([¹²³⁴⁵⁶⁷⁸⁹⁰]+)/g, (m) => `^${[...m].map((c) => gorne[c]).join('')}`);
}
