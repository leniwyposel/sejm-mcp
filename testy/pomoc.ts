import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BladSejmu, zlozAdres, type OpcjePliku, type OpcjePobrania, type Parametry, type ZrodloSejmu } from '../src/klient.js';

const KATALOG = join(import.meta.dirname, 'fikstury');

export function fikstura(nazwa: string): string {
  return readFileSync(join(KATALOG, nazwa), 'utf8');
}

/**
 * Źródło z fikstur: ścieżka → plik. Ścieżka bez mapy rzuca wyjątek, więc test nie przejdzie
 * po cichu na pustych danych. Zapisuje każde zapytanie, żeby test mógł sprawdzić parametry.
 */
export class ZrodloZFikstur implements ZrodloSejmu {
  zapytania: Array<{ sciezka: string; parametry?: Parametry }> = [];

  constructor(
    private readonly mapa: Record<string, string | null>,
    private readonly razem: Record<string, number> = {},
  ) {}

  private plik(sciezka: string, opcje?: OpcjePobrania): string | null {
    this.zapytania.push({ sciezka, parametry: opcje?.parametry });
    if (!(sciezka in this.mapa)) throw new Error(`Brak fikstury dla ${sciezka}`);
    const nazwa = this.mapa[sciezka];
    return nazwa === null ? null : fikstura(nazwa);
  }

  async json<T>(sciezka: string, opcje?: OpcjePobrania): Promise<T | null> {
    const t = this.plik(sciezka, opcje);
    return t === null ? null : (JSON.parse(t) as T);
  }

  async lista<T>(sciezka: string, opcje?: OpcjePobrania): Promise<{ dane: T[]; razem: number | null }> {
    const t = this.plik(sciezka, opcje);
    const dane = t === null ? [] : (JSON.parse(t) as T[]);
    return { dane, razem: this.razem[sciezka] ?? dane.length };
  }

  async tekst(sciezka: string, opcje?: OpcjePobrania): Promise<string | null> {
    return this.plik(sciezka, opcje);
  }

  async bajty(sciezka: string, opcje?: OpcjePobrania): Promise<Uint8Array | null> {
    this.zapytania.push({ sciezka, parametry: opcje?.parametry });
    if (!(sciezka in this.mapa)) throw new Error(`Brak fikstury dla ${sciezka}`);
    const nazwa = this.mapa[sciezka];
    return nazwa === null ? null : new Uint8Array(readFileSync(join(KATALOG, nazwa)));
  }

  adres(sciezka: string, parametry?: Parametry): string {
    return zlozAdres(sciezka, parametry).href;
  }

  /** Rozmiar pliku z fikstury (jak Content-Length); test może podmienić, np. na „Sejm nie podaje rozmiaru”. */
  async rozmiarPliku(katalog: string, nazwa: string): Promise<{ bajtow: number | null } | null> {
    const klucz = `plik:${katalog}/${nazwa}`;
    if (!(klucz in this.mapa)) throw new Error(`Brak fikstury dla ${klucz}`);
    const plik = this.mapa[klucz];
    return plik === null ? null : { bajtow: readFileSync(join(KATALOG, plik)).byteLength };
  }

  /** Plik z katalogu: klucz mapy `plik:<katalog>/<nazwa>`, wartość to nazwa pliku w fiksturach (albo null = 404). */
  pobraniaPlikow: Array<{ katalog: string; nazwa: string; opcje: OpcjePliku }> = [];
  async pobierzPlik(katalog: string, nazwa: string, opcje: OpcjePliku): Promise<Uint8Array | null> {
    this.pobraniaPlikow.push({ katalog, nazwa, opcje });
    const klucz = `plik:${katalog}/${nazwa}`;
    if (!(klucz in this.mapa)) throw new Error(`Brak fikstury dla ${klucz}`);
    const plik = this.mapa[klucz];
    if (plik === null) return null;
    const bajty = new Uint8Array(readFileSync(join(KATALOG, plik)));
    if (bajty.byteLength > opcje.limitBajtow) throw new BladSejmu(`Odpowiedź Sejmu jest za duża (ponad ${opcje.limitBajtow} B)`, null, 'za-duza');
    return bajty;
  }
}
