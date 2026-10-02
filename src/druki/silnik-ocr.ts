/**
 * Silnik OCR: pliki dołączone do paczki (dist/silnik-ocr), bez pobierania czegokolwiek w trakcie działania.
 *
 * Decyzja właściciela (28.09.2026, wariant C): silnik jedzie w paczce .mcpb i w pakiecie npm, więc
 * jedynym adresem, z którym serwer się łączy, zostaje api.sejm.gov.pl. Pliki kopiuje przy budowaniu
 * skrypt skrypty/kopiuj-silnik-ocr.mjs z dokładnie przypiętych paczek npm (devDependencies) i sprawdza
 * ich rozmiary i skróty sha256; wątek OCR sprawdza skróty jeszcze raz przed uruchomieniem.
 *
 * Skład: Tesseract 5 skompilowany do WebAssembly (tesseract.js-core, Apache-2.0), dane języka
 * polskiego tessdata 4.0.0 best_int (Apache-2.0), pdf.js z dekoderami obrazów skanów CCITT, JBIG2
 * i JPEG 2000 (pdfjs-dist, Apache-2.0; paczka unpdf ich nie ma, a bez nich strona skanu jest pusta).
 * Dane best_int wybrane na 10 stronach skanów druków 30 i 558: fast myli ł z l („socjałnej”,
 * „psychołogicznych”, „paździemika”), best daje prawie ten sam tekst co best_int, ale jest 1,8 raza
 * wolniejszy i 3,4 raza większy.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PlikSilnika {
  nazwa: string;
  /** Skąd skrypt budowania bierze plik: ścieżka w node_modules. */
  zrodlo: string;
  bajtow: number;
  sha256: string;
}

export const WERSJA_SILNIKA = 'tesseract-core-7.0.0_pol-4.0.0-best-int_pdfjs-6.3.289';
export const OPIS_SILNIKA = 'Tesseract 5 (tesseract.js-core 7.0.0) z danymi języka polskiego tessdata 4.0.0 best_int';

export const PLIKI_SILNIKA: readonly PlikSilnika[] = [
  { nazwa: 'tesseract-core-simd-lstm.wasm.cjs', zrodlo: 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js', bajtow: 3_899_472, sha256: 'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38' },
  { nazwa: 'pol.traineddata.gz', zrodlo: '@tesseract.js-data/pol/4.0.0_best_int/pol.traineddata.gz', bajtow: 2_642_356, sha256: 'a20fdec4ff99d8f8e84c708da3e42a4e935c26863055a0ed88aef5c66a59b91b' },
  { nazwa: 'pdf.mjs', zrodlo: 'pdfjs-dist/legacy/build/pdf.mjs', bajtow: 1_047_456, sha256: '91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d' },
  { nazwa: 'pdf.worker.mjs', zrodlo: 'pdfjs-dist/legacy/build/pdf.worker.mjs', bajtow: 2_395_538, sha256: 'df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b' },
  { nazwa: 'jbig2.wasm', zrodlo: 'pdfjs-dist/wasm/jbig2.wasm', bajtow: 104_852, sha256: 'e6bee67724a7b5436fe8162638e3708cfc8d52b6342db69a49715e30ff27cfdc' },
  { nazwa: 'openjpeg.wasm', zrodlo: 'pdfjs-dist/wasm/openjpeg.wasm', bajtow: 252_032, sha256: '004a0e62db930ba9ff2a22212f4554d0bb57a0635a8287caf70f98117cee14ba' },
];

/** Licencje składników, kopiowane obok silnika (paczka danych języka nie ma własnego pliku: tessdata to Apache-2.0, skrypty/licencja-tessdata.txt). */
export const LICENCJE_SILNIKA: ReadonlyArray<{ nazwa: string; zrodlo: string }> = [
  { nazwa: 'LICENSE-tesseract.js-core', zrodlo: 'tesseract.js-core/LICENSE' },
  { nazwa: 'LICENSE-pdfjs-dist', zrodlo: 'pdfjs-dist/LICENSE' },
];

/** Katalog silnika w zbudowanym serwerze: dist/silnik-ocr, obok dist/druki. */
export const KATALOG_SILNIKA = fileURLToPath(new URL('../silnik-ocr/', import.meta.url));

/** Czy pliki silnika są na miejscu i mają właściwy skrót (uszkodzona instalacja daje false, nie wyjątek). */
export async function silnikGotowy(katalog: string = KATALOG_SILNIKA): Promise<boolean> {
  try {
    for (const p of PLIKI_SILNIKA) {
      const b = await readFile(join(katalog, p.nazwa));
      if (b.byteLength !== p.bajtow || createHash('sha256').update(b).digest('hex') !== p.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}
