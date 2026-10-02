// Silnik OCR do dist/silnik-ocr: przy każdym `npm run build`, z przypiętych paczek npm (devDependencies).
// Plik o innym rozmiarze albo skrócie sha256 niż w src/druki/silnik-ocr.ts zatrzymuje budowanie.
// Obok silnika: licencje składników i NOTICE z listą (Tesseract, tessdata, pdf.js: Apache-2.0).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const KORZEN = join(import.meta.dirname, '..');
const CEL = join(KORZEN, 'dist', 'silnik-ocr');
const { PLIKI_SILNIKA, LICENCJE_SILNIKA, OPIS_SILNIKA } = await import(join(KORZEN, 'dist', 'druki', 'silnik-ocr.js'));
const require = createRequire(join(KORZEN, 'package.json'));
const sciezka = (zrodlo) => {
  const [zakres, nazwa, ...reszta] = zrodlo.split('/');
  const pakiet = zakres.startsWith('@') ? `${zakres}/${nazwa}` : zakres;
  const plik = zakres.startsWith('@') ? reszta : [nazwa, ...reszta];
  return join(dirname(require.resolve(`${pakiet}/package.json`)), ...plik);
};

mkdirSync(CEL, { recursive: true });
for (const p of PLIKI_SILNIKA) {
  const b = readFileSync(sciezka(p.zrodlo));
  const skrot = createHash('sha256').update(b).digest('hex');
  if (b.byteLength !== p.bajtow || skrot !== p.sha256) {
    console.error(`kopiuj-silnik-ocr: ${p.zrodlo} ma ${b.byteLength} B i sha256 ${skrot}, oczekiwano ${p.bajtow} B i ${p.sha256}`);
    process.exit(1);
  }
  copyFileSync(sciezka(p.zrodlo), join(CEL, p.nazwa));
}
for (const l of LICENCJE_SILNIKA) copyFileSync(sciezka(l.zrodlo), join(CEL, l.nazwa));
writeFileSync(join(CEL, 'LICENSE-tessdata'), readFileSync(join(KORZEN, 'skrypty', 'licencja-tessdata.txt')));
writeFileSync(join(CEL, 'NOTICE'), readFileSync(join(KORZEN, 'skrypty', 'notice-silnik-ocr.txt'), 'utf8').replace('{OPIS}', OPIS_SILNIKA));
