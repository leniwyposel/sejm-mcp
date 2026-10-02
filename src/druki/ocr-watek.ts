/**
 * Wątek OCR (worker_threads): strony skanu z PDF → obraz w skali szarości → Tesseract.
 *
 * Osobny wątek, bo rozpoznawanie jednej strony to 1–3 s pracy procesora bez przerwy: w głównym
 * wątku serwer przestałby w tym czasie odpowiadać na inne wywołania. Wątek ładuje WYŁĄCZNIE pliki
 * silnika z paczki (dist/silnik-ocr), po sprawdzeniu ich skrótów sha256 (lista w silnik-ocr.ts), i nie łączy się
 * z siecią. Stronę rysuje własny, prosty rasteryzator: tylko obrazy i maski obrazów (z tego składa
 * się skan), bez wektorów i czcionek; pdf.js dekoduje obrazy (JPEG, CCITT, JBIG2, JPEG 2000).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';

export interface DaneWatku {
  pdf: Uint8Array;
  strony: number[];
  katalog: string;
  pliki: Array<{ nazwa: string; sha256: string }>;
  /** Rozdzielczość rysowania strony (punkty na cal). */
  dpi: number;
}

export type WiadomoscWatku =
  | { typ: 'strona'; strona: number; tekst: string; pewnosc: number; ms: number }
  | { typ: 'blad-strony'; strona: number; powod: string }
  | { typ: 'blad'; powod: string }
  | { typ: 'koniec' };

type Macierz = [number, number, number, number, number, number];

interface ObrazPdf {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
}

const wyslij = (w: WiadomoscWatku) => parentPort?.postMessage(w);

const razy = (m: Macierz, n: number[]): Macierz => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const jasnosc = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

/** Kolor wypełnienia z listy operacji pdf.js („#353535”) → jasność 0–255. */
function jasnoscKoloru(a: unknown): number {
  const s = String(Array.isArray(a) ? a[0] : a);
  if (/^#[0-9a-f]{6}$/i.test(s)) return jasnosc(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16));
  return 0;
}

class Plotno {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h).fill(255);
  }

  /** Rysuje kwadrat jednostkowy obrazu przez macierz `m`; `probka(x, y)` daje jasność albo -1 (przezroczysty). */
  rysuj(m: Macierz, szer: number, wys: number, probka: (x: number, y: number) => number): void {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det || szer <= 0 || wys <= 0) return;
    const odw = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
    const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(this.w, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.h, Math.ceil(Math.max(...ys)));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const u = odw[0] * (x + 0.5) + odw[2] * (y + 0.5) + odw[4];
        const v = odw[1] * (x + 0.5) + odw[3] * (y + 0.5) + odw[5];
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const g = probka(Math.floor(u * szer), Math.floor((1 - v) * wys));
        if (g >= 0) this.px[y * this.w + x] = g;
      }
    }
  }

  /** Obraz w formacie PGM (P5): Leptonica w Tesseract czyta go bez dodatkowych bibliotek. */
  pgm(): Uint8Array {
    const naglowek = Buffer.from(`P5\n${this.w} ${this.h}\n255\n`, 'latin1');
    return Buffer.concat([naglowek, this.px]);
  }
}

/** Próbkowanie obrazu pdf.js: kind 1 = 1 bit na piksel, 2 = RGB, 3 = RGBA. */
function probkaObrazu(o: ObrazPdf): ((x: number, y: number) => number) | null {
  const d = o.data;
  if (!d) return null;
  const w = o.width;
  if (o.kind === 1) {
    const wiersz = (w + 7) >> 3;
    return (x, y) => ((d[y * wiersz + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0);
  }
  if (o.kind === 2) return (x, y) => jasnosc(d[(y * w + x) * 3], d[(y * w + x) * 3 + 1], d[(y * w + x) * 3 + 2]);
  if (o.kind === 3) return (x, y) => (d[(y * w + x) * 4 + 3] < 128 ? -1 : jasnosc(d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]));
  return null;
}

/** Maska obrazu (1 bit): bit 0 maluje kolorem wypełnienia, bit 1 zostawia tło (tak podaje ją pdf.js). */
function probkaMaski(d: Uint8Array | Uint8ClampedArray, w: number, kolor: number) {
  const wiersz = (w + 7) >> 3;
  return (x: number, y: number) => ((d[y * wiersz + (x >> 3)] >> (7 - (x & 7))) & 1 ? -1 : kolor);
}

async function main(): Promise<void> {
  const dane = workerData as DaneWatku;
  // 1. Skróty plików silnika: uruchamiamy wyłącznie pliki z paczki, sprawdzone przy budowaniu i tu jeszcze raz.
  for (const p of dane.pliki) {
    const b = readFileSync(join(dane.katalog, p.nazwa));
    if (createHash('sha256').update(b).digest('hex') !== p.sha256) throw new Error(`plik silnika ${p.nazwa} ma inny skrót niż oczekiwany (uszkodzona instalacja); zainstaluj sejm-mcp ponownie`);
  }
  // pdf.js z pdfjs-dist przy ładowaniu tworzy DOMMatrix (potrzebny tylko do rysowania na canvas,
  // którego nie używamy): w wątku podstawiamy minimalne zastępstwa.
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= class {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  };
  g.Path2D ??= class {};
  const pdfjs = (await import(pathToFileURL(join(dane.katalog, 'pdf.mjs')).href)) as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(o: Record<string, unknown>): { promise: Promise<any> };
    OPS: Record<string, number>;
  };
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(dane.katalog, 'pdf.worker.mjs')).href;
  const OPS = pdfjs.OPS;
  const dokument = await pdfjs.getDocument({
    data: dane.pdf,
    wasmUrl: dane.katalog + sep,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  }).promise;

  // 2. Tesseract: moduł WebAssembly ładowany z pliku w schowku (CommonJS, bez sieci).
  // Rozszerzenie .cjs: dist leży w paczce "type": "module", a moduł Emscripten to CommonJS.
  const TesseractCore = createRequire(import.meta.url)(join(dane.katalog, 'tesseract-core-simd-lstm.wasm.cjs')) as (o: object) => Promise<any>;
  const M = await TesseractCore({ print: () => {}, printErr: () => {} });
  M.FS.writeFile('/pol.traineddata', gunzipSync(readFileSync(join(dane.katalog, 'pol.traineddata.gz'))));
  const api = new M.TessBaseAPI();
  if (api.Init(null, 'pol', 1) !== 0) throw new Error('Tesseract nie wczytał danych języka polskiego');

  const obiekt = (strona: any, nazwa: string): Promise<ObrazPdf | null> =>
    new Promise((r) => {
      try {
        (nazwa.startsWith('g_') ? strona.commonObjs : strona.objs).get(nazwa, r);
      } catch {
        r(null);
      }
    });

  for (const numer of dane.strony) {
    const start = Date.now();
    try {
      const strona = await dokument.getPage(numer);
      const skala = dane.dpi / 72;
      const widok = strona.getViewport({ scale: skala });
      const plotno = new Plotno(Math.ceil(widok.width), Math.ceil(widok.height));
      const lista = await strona.getOperatorList();
      let ctm = widok.transform.slice() as Macierz;
      let wypelnienie = 0;
      const stos: Array<[Macierz, number]> = [];
      let obrazow = 0;
      for (let i = 0; i < lista.fnArray.length; i++) {
        const f = lista.fnArray[i];
        const a = lista.argsArray[i];
        if (f === OPS.save) stos.push([ctm, wypelnienie]);
        else if (f === OPS.restore) [ctm, wypelnienie] = stos.pop() ?? [ctm, wypelnienie];
        else if (f === OPS.transform) ctm = razy(ctm, a);
        else if (f === OPS.setFillRGBColor) wypelnienie = jasnoscKoloru(a);
        else if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject) {
          const o = typeof a[0] === 'string' ? await obiekt(strona, a[0]) : (a[0] as ObrazPdf);
          const p = o && probkaObrazu(o);
          if (o && p) {
            plotno.rysuj(ctm, o.width, o.height, p);
            obrazow++;
          }
        } else if (f === OPS.paintImageMaskXObject) {
          const m = a[0] as { data: string | Uint8Array; width: number; height: number };
          const o = typeof m.data === 'string' ? await obiekt(strona, m.data) : m;
          const d = (o as ObrazPdf | null)?.data ?? (o as unknown as Uint8Array | null);
          if (d && typeof (d as Uint8Array).length === 'number') {
            plotno.rysuj(ctm, m.width, m.height, probkaMaski(d as Uint8Array, m.width, wypelnienie));
            obrazow++;
          }
        } else if (f === OPS.paintImageMaskXObjectGroup) {
          for (const m of a[0] as Array<{ data: Uint8Array; width: number; height: number; transform: number[] }>) {
            plotno.rysuj(razy(ctm, m.transform), m.width, m.height, probkaMaski(m.data, m.width, wypelnienie));
            obrazow++;
          }
        }
      }
      strona.cleanup();
      if (obrazow === 0) {
        wyslij({ typ: 'strona', strona: numer, tekst: '', pewnosc: 0, ms: Date.now() - start });
        continue;
      }
      M.FS.writeFile('/strona.pgm', plotno.pgm());
      // SetImageFile czyta plik /input; tak robi tesseract.js.
      M.FS.rename('/strona.pgm', '/input');
      if (api.SetImageFile(1, 0) === 1) throw new Error('Tesseract nie odczytał obrazu strony');
      api.Recognize(null);
      const tekst = String(api.GetUTF8Text() ?? '');
      const pewnosc = Number(api.MeanTextConf() ?? 0);
      api.Clear();
      wyslij({ typ: 'strona', strona: numer, tekst, pewnosc, ms: Date.now() - start });
    } catch (e) {
      wyslij({ typ: 'blad-strony', strona: numer, powod: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) });
    }
  }
  api.End();
  wyslij({ typ: 'koniec' });
}

if (parentPort) {
  main().catch((e: unknown) => {
    wyslij({ typ: 'blad', powod: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) });
  });
}
