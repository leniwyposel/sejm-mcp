/**
 * Odczyt maszynowy (OCR) stron skanu: zadania w tle i wyniki w schowku.
 *
 * Rozpoznawanie idzie w osobnym wątku (ocr-watek.ts), jedno zadanie naraz, strona po stronie; każda
 * gotowa strona od razu trafia do schowku, więc wywołanie narzędzia, któremu skończył się czas,
 * zwraca to, co już jest, a następne dostaje resztę. Wynik OCR nigdy nie udaje tekstu Sejmu: niesie
 * etykietę odczytu maszynowego, nazwę silnika i średnią pewność Tesseracta.
 */

import { Worker } from 'node:worker_threads';
import type { Schowek } from '../schowek.js';
import type { DaneWatku, WiadomoscWatku } from './ocr-watek.js';
import { KATALOG_SILNIKA, OPIS_SILNIKA, PLIKI_SILNIKA, WERSJA_SILNIKA } from './silnik-ocr.js';

/** Rozdzielczość rysowania strony: 200 dpi to kompromis między jakością a czasem (ok. 1–3 s na stronę). */
const DPI = 200;
/** Szacunek do pytania o zgodę: tyle sekund na stronę (pomiar na skanach druków 30, 558, 2457). */
export const SEKUND_NA_STRONE = 2;

export interface StronaOcr {
  strona: number;
  tekst: string;
  /** Średnia pewność Tesseracta, 0–100. */
  pewnosc: number;
  silnik: string;
  ms: number;
  /** Strona bez żadnego obrazu: nie ma czego rozpoznać (np. pusta strona rozdzielająca). */
  pusta?: boolean;
  blad?: string;
}

/** Uruchomienie wątku: w testach podstawiamy własne, bez silnika. */
export type UruchomWatek = (dane: DaneWatku, naWiadomosc: (w: WiadomoscWatku) => void) => Promise<void>;

export const uruchomWatek: UruchomWatek = (dane, naWiadomosc) =>
  new Promise((gotowe, blad) => {
    const watek = new Worker(new URL('./ocr-watek.js', import.meta.url), {
      workerData: dane,
      transferList: [dane.pdf.buffer as ArrayBuffer],
      // Wyjście wątku NIE może trafić na stdout procesu: tam idzie wyłącznie protokół MCP (pdf.js pisze ostrzeżenia przez console.log).
      stdout: true,
      stderr: true,
    });
    watek.stdout.resume();
    watek.stderr.resume();
    watek.on('message', naWiadomosc);
    watek.on('error', blad);
    watek.on('exit', () => gotowe());
  });

const kluczOcr = (sha: string, strona: number) => ['ocr', `${sha}-${WERSJA_SILNIKA}`, `${strona}.json`] as const;

/** Wyniki OCR już zapisane w schowku dla tych stron. */
export async function zapisaneOcr(schowek: Schowek, sha: string, strony: readonly number[]): Promise<Map<number, StronaOcr>> {
  const wynik = new Map<number, StronaOcr>();
  for (const s of strony) {
    const w = await schowek.czytajJson<StronaOcr>(...kluczOcr(sha, s));
    if (w) wynik.set(s, w);
  }
  return wynik;
}

interface Zadanie {
  strony: Set<number>;
  gotowe: number;
  obietnica: Promise<void>;
  blad?: string;
}

/**
 * Kolejka zadań OCR na cały proces serwera: jedno zadanie naraz (rozpoznawanie zajmuje cały rdzeń),
 * to samo zadanie dla tego samego pliku nie rusza drugi raz.
 */
export class KolejkaOcr {
  private zadania = new Map<string, Zadanie>();
  /** Ostatni błąd zadania dla pliku (np. silnik nie ruszył): zostaje po końcu zadania, żeby narzędzie mogło go podać. */
  private bledy = new Map<string, string>();
  private ogon: Promise<void> = Promise.resolve();

  constructor(private readonly uruchom: UruchomWatek = uruchomWatek) {}

  /** Stan zadania dla pliku: ile stron zrobiono z ilu, albo null, gdy nic nie trwa. */
  stan(sha: string): { gotowe: number; wszystkie: number; blad?: string } | null {
    const z = this.zadania.get(sha);
    if (z) return { gotowe: z.gotowe, wszystkie: z.strony.size, ...(z.blad ? { blad: z.blad } : {}) };
    const blad = this.bledy.get(sha);
    return blad ? { gotowe: 0, wszystkie: 0, blad } : null;
  }

  /**
   * Zleca OCR stron pliku (tych, których jeszcze nie ma w schowku). Zwraca obietnicę końca zadania;
   * wołający czeka na nią tylko do swojego terminu, zadanie biegnie dalej w tle.
   */
  zlec(schowek: Schowek, sha: string, pdf: Uint8Array, strony: readonly number[]): Promise<void> {
    const trwa = this.zadania.get(sha);
    const nowe = strony.filter((s) => !trwa?.strony.has(s));
    if (trwa && nowe.length === 0) return trwa.obietnica;
    const zadanie: Zadanie = { strony: new Set([...(trwa?.strony ?? []), ...nowe]), gotowe: trwa?.gotowe ?? 0, obietnica: Promise.resolve() };
    const poprzednie = trwa?.obietnica ?? Promise.resolve();
    const praca = async () => {
      await poprzednie.catch(() => {});
      const brakujace = [...nowe];
      if (brakujace.length === 0) return;
      const zapisy: Promise<unknown>[] = [];
      await this.uruchom(
        { pdf: new Uint8Array(pdf), strony: brakujace, katalog: KATALOG_SILNIKA, pliki: PLIKI_SILNIKA.map((p) => ({ nazwa: p.nazwa, sha256: p.sha256 })), dpi: DPI },
        (w) => {
          if (w.typ === 'strona' || w.typ === 'blad-strony') {
            zadanie.gotowe++;
            const zapis: StronaOcr =
              w.typ === 'strona'
                ? { strona: w.strona, tekst: w.tekst.trim(), pewnosc: w.pewnosc, silnik: OPIS_SILNIKA, ms: w.ms, ...(w.tekst.trim() ? {} : { pusta: true }) }
                : { strona: w.strona, tekst: '', pewnosc: 0, silnik: OPIS_SILNIKA, ms: 0, blad: w.powod };
            // Błędu strony nie zapisujemy na stałe: następne wywołanie spróbuje jeszcze raz.
            if (w.typ === 'strona') zapisy.push(schowek.zapiszJson(zapis, ...kluczOcr(sha, w.strona)).catch(() => {}));
            else zadanie.blad = w.powod;
          } else if (w.typ === 'blad') {
            zadanie.blad = w.powod;
          }
        },
      );
      // Koniec zadania dopiero po zapisie ostatniej strony: kto czeka na zadanie, czyta wynik z dysku.
      await Promise.all(zapisy);
    };
    // Jedno zadanie naraz w całym procesie: dokładamy się na koniec kolejki.
    this.bledy.delete(sha);
    const obietnica = this.ogon
      .then(praca, praca)
      .catch((e: unknown) => {
        zadanie.blad = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        if (zadanie.blad) this.bledy.set(sha, zadanie.blad);
        if (this.zadania.get(sha) === zadanie) this.zadania.delete(sha);
      });
    this.ogon = obietnica.catch(() => {});
    zadanie.obietnica = obietnica;
    this.zadania.set(sha, zadanie);
    return obietnica;
  }
}
