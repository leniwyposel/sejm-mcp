/**
 * Tekst aktu z PDF w bazie ELI, odczytany raz i trzymany w schowku na dysku użytkownika.
 *
 * Część aktów ELI ma tekst tylko w PDF (Konstytucja DU/1997/483: skan z warstwą tekstową, ok. 13 MB;
 * najnowsze teksty jednolite kodeksów). Pobranie i odczyt takiego pliku trwa kilkanaście sekund
 * przy każdym pytaniu. Tu zapisujemy sam odczytany tekst (nie plik), pod adresem ELI i datą
 * ostatniej zmiany rekordu w ELI (`changeDate`): dopóki ELI pokazuje tę samą datę, tekst bierzemy
 * z dysku; gdy ELI pokaże nowszą, czytamy PDF od nowa i nadpisujemy wpis. Bez `changeDate` nie ma
 * czym sprawdzić świeżości, więc nic nie zapisujemy. Źródłem pozostaje wyłącznie API ELI Sejmu.
 *
 * Zapis idzie przez `Schowek` (jedyne miejsce, które pisze na dysk). Awaria dysku nigdy nie psuje
 * odpowiedzi: wtedy po prostu czytamy PDF z sieci, jak przedtem.
 */

import { czytajPdf, type OpcjePdf, type TekstPdf, type WynikPdf } from './pdf.js';
import { Schowek } from './schowek.js';

/** Zmiana sposobu odczytu PDF (pdf.ts) musi podbić tę liczbę, żeby stare teksty nie wracały z dysku. */
export const WERSJA_TEKSTU_AKTU = 1;

interface ZapisTekstuAktu {
  wersja: number;
  eli: string;
  zmiana: string;
  opcje: string;
  zapisano: string;
  tekst: TekstPdf;
}

let dajSchowek: () => Schowek | null = () => new Schowek();

/** Testy podstawiają schowek w katalogu tymczasowym albo wyłączają go (`null`). */
export function ustawSchowekAktow(f: () => Schowek | null): void {
  dajSchowek = f;
}

/** Plik wpisu: „akty/DU-1997-483.json”. Adres ELI sprawdzony, zanim cokolwiek dotknie dysku. */
function plikWpisu(eli: string): [string, string] | null {
  return /^(DU|MP)\/\d{4}\/\d{1,6}$/.test(eli) ? ['akty', `${eli.replace(/\//g, '-')}.json`] : null;
}

const opisOpcji = (o: OpcjePdf) => `${o.maksStron}-${o.maksZnakow}`;

export type WynikPdfAktu = WynikPdf & { zDysku?: { zmianaWEli: string; zapisano: string } };

/**
 * Jak `czytajPdf`, ale z dysku, gdy ten sam akt w tej samej wersji (`changeDate` z ELI) był już
 * przeczytany. Nigdy nie rzuca.
 */
export async function czytajPdfAktu(
  zrodlo: Parameters<typeof czytajPdf>[0],
  eli: string,
  zmiana: string | null | undefined,
  adresPdf: string,
  opcje: OpcjePdf,
  termin?: number,
): Promise<WynikPdfAktu> {
  const plik = plikWpisu(eli);
  let schowek: Schowek | null = null;
  try {
    schowek = plik && zmiana ? dajSchowek() : null;
  } catch {
    schowek = null;
  }
  if (schowek && plik && zmiana) {
    try {
      const z = await schowek.czytajJson<ZapisTekstuAktu>(...plik);
      if (z && z.wersja === WERSJA_TEKSTU_AKTU && z.eli === eli && z.zmiana === zmiana && z.opcje === opisOpcji(opcje) && typeof z.tekst?.tekst === 'string') {
        return { ok: true, ...z.tekst, zDysku: { zmianaWEli: z.zmiana, zapisano: z.zapisano } };
      }
    } catch {
      // Nieczytelny wpis: czytamy PDF z sieci.
    }
  }
  const w = await czytajPdf(zrodlo, adresPdf, opcje, termin);
  if (w.ok && schowek && plik && zmiana) {
    try {
      const zapis: ZapisTekstuAktu = {
        wersja: WERSJA_TEKSTU_AKTU,
        eli,
        zmiana,
        opcje: opisOpcji(opcje),
        zapisano: new Date().toISOString(),
        tekst: { tekst: w.tekst, stron: w.stron, przeczytanoStron: w.przeczytanoStron, uciety: w.uciety },
      };
      const sciezka = await schowek.zapiszJson(zapis, ...plik);
      await schowek.sprzataj(undefined, sciezka);
    } catch {
      // Pełny albo tylko do odczytu dysk: odpowiedź i tak jest, następnym razem przeczytamy PDF znowu.
    }
  }
  return w;
}
