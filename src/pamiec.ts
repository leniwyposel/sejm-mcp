/**
 * Pamięć krótka, tylko w procesie serwera.
 *
 * Nic nie trafia na dysk i nic nie przeżywa procesu: rejestr Sejmu zmienia się w ciągu dnia
 * (głosowania na żywo, usprawiedliwienia dopisywane wstecz), więc odpowiedź sprzed godziny
 * mogłaby już być nieprawdziwa. Pamiętamy odpowiedź najwyżej minutę, tylko po to, żeby model,
 * który w jednej odpowiedzi dwa razy potrzebuje tej samej listy (np. listy posłów do nazwisk
 * autorów pism), nie pytał Sejmu dwa razy o to samo.
 */

export interface Pamiec {
  czytaj(klucz: string): string | null;
  zapisz(klucz: string, tresc: string): void;
}

/** Jak długo pamiętamy odpowiedź Sejmu. */
export const CZAS_ZYCIA_MS = 60_000;
/** Najwyżej tyle znaków trzymamy naraz; starsze wpisy wypadają pierwsze. */
const LIMIT_ZNAKOW = 30_000_000;

export class PamiecKrotka implements Pamiec {
  private wpisy = new Map<string, { czas: number; tresc: string }>();
  private znakow = 0;

  constructor(private readonly teraz: () => number = Date.now) {}

  czytaj(klucz: string): string | null {
    const w = this.wpisy.get(klucz);
    if (!w) return null;
    if (this.teraz() - w.czas > CZAS_ZYCIA_MS) {
      this.usun(klucz);
      return null;
    }
    return w.tresc;
  }

  zapisz(klucz: string, tresc: string): void {
    this.usun(klucz);
    if (tresc.length > LIMIT_ZNAKOW) return;
    const teraz = this.teraz();
    // Map trzyma kolejność wstawiania, więc pierwsze wpisy są najstarsze.
    for (const [k, w] of this.wpisy) {
      if (teraz - w.czas <= CZAS_ZYCIA_MS && this.znakow + tresc.length <= LIMIT_ZNAKOW) break;
      this.usun(k);
    }
    this.wpisy.set(klucz, { czas: teraz, tresc });
    this.znakow += tresc.length;
  }

  private usun(klucz: string): void {
    const w = this.wpisy.get(klucz);
    if (!w) return;
    this.znakow -= w.tresc.length;
    this.wpisy.delete(klucz);
  }
}

/** Pamięć, która niczego nie pamięta: testy. */
export class BezPamieci implements Pamiec {
  czytaj(): string | null {
    return null;
  }
  zapisz(): void {}
}
