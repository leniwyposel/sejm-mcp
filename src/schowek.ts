/**
 * Schowek na dysku użytkownika: pliki druków, tekst z nich odczytany i wyniki OCR.
 *
 * Jedyne miejsce, które zapisuje na dysk. Decyzja właściciela z 28.09.2026: druk ma do 2000 stron
 * i kilkadziesiąt MB, więc pobieramy go raz i czytamy z dysku przy kolejnych pytaniach. Wszystko leży
 * w jednym katalogu użytkownika (macOS: ~/Library/Caches/sejm-mcp, Linux: ~/.cache/sejm-mcp,
 * Windows: %LOCALAPPDATA%\sejm-mcp\Cache, albo SEJM_MCP_SCHOWEK), można go w każdej chwili skasować.
 * Nazwy plików składa ten moduł z numeru druku (walidowanego) i skrótu sha256, nigdy z nazwy z sieci.
 * Zapis jest atomowy: najpierw plik tymczasowy, potem zmiana nazwy.
 *
 * Rozmiar: najwyżej {@link LIMIT_SCHOWKA_BAJTOW} (500 MB). Po zapisie pliku druku `sprzataj()` kasuje
 * najdawniej używane pliki, aż schowek zejdzie do 80% limitu; skasowany druk pobierze się od nowa.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export function katalogSchowka(env: NodeJS.ProcessEnv = process.env, platforma: NodeJS.Platform = process.platform, dom: string = homedir()): string {
  if (env.SEJM_MCP_SCHOWEK) return resolve(env.SEJM_MCP_SCHOWEK);
  if (platforma === 'darwin') return join(dom, 'Library', 'Caches', 'sejm-mcp');
  if (platforma === 'win32') return join(env.LOCALAPPDATA || join(dom, 'AppData', 'Local'), 'sejm-mcp', 'Cache');
  return join(env.XDG_CACHE_HOME || join(dom, '.cache'), 'sejm-mcp');
}

/** Najwięcej bajtów w schowku; ponad to `sprzataj()` kasuje najdawniej używane pliki. */
export const LIMIT_SCHOWKA_BAJTOW = 500 * 1024 * 1024;

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** Część ścieżki: tylko litery, cyfry, `-`, `_`, `.`, bez `..`. Inaczej wyjątek, zanim cokolwiek dotknie dysku. */
const CZESC = /^[A-Za-z0-9_.-]{1,200}$/;

export class Schowek {
  constructor(readonly katalog: string = katalogSchowka()) {}

  /** Pełna ścieżka do pliku w schowku; każda część sprawdzona, wynik zawsze pod katalogiem schowka. */
  sciezka(...czesci: string[]): string {
    for (const c of czesci) if (!CZESC.test(c) || c === '.' || c === '..') throw new Error(`Niedozwolona nazwa w schowku: ${JSON.stringify(c)}`);
    const p = join(this.katalog, ...czesci);
    if (!p.startsWith(this.katalog + sep)) throw new Error('Ścieżka poza schowkiem');
    return p;
  }

  async czytaj(...czesci: string[]): Promise<Buffer | null> {
    try {
      const p = this.sciezka(...czesci);
      const b = await readFile(p);
      // Czas modyfikacji to „ostatnio używany”: sprzątanie kasuje najpierw to, czego dawno nikt nie czytał.
      const teraz = new Date();
      await utimes(p, teraz, teraz).catch(() => {});
      return b;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async czytajJson<T>(...czesci: string[]): Promise<T | null> {
    const b = await this.czytaj(...czesci);
    if (b === null) return null;
    try {
      return JSON.parse(b.toString('utf8')) as T;
    } catch {
      // Uszkodzony wpis (np. przerwany zapis starszej wersji) traktujemy jak brak.
      return null;
    }
  }

  async zapisz(dane: Uint8Array | string, ...czesci: string[]): Promise<string> {
    const cel = this.sciezka(...czesci);
    await mkdir(dirname(cel), { recursive: true });
    const tymczasowy = `${cel}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tymczasowy, dane);
      await rename(tymczasowy, cel);
    } catch (e) {
      await rm(tymczasowy, { force: true }).catch(() => {});
      throw e;
    }
    return cel;
  }

  zapiszJson(dane: unknown, ...czesci: string[]): Promise<string> {
    return this.zapisz(JSON.stringify(dane), ...czesci);
  }

  /**
   * Gdy schowek przekracza `limit`, kasuje pliki od najdawniej używanego, aż zejdzie do 80% limitu.
   * Plik `oszczedz` (właśnie zapisany) zostaje. Zwraca liczbę skasowanych plików.
   */
  async sprzataj(limit: number = LIMIT_SCHOWKA_BAJTOW, oszczedz?: string): Promise<number> {
    let wpisy: string[];
    try {
      wpisy = (await readdir(this.katalog, { recursive: true })) as string[];
    } catch {
      return 0;
    }
    const pliki: Array<{ sciezka: string; bajtow: number; czas: number }> = [];
    for (const w of wpisy) {
      // Plik tymczasowy to zapis w toku: nie ruszamy.
      if (w.endsWith('.tmp')) continue;
      const sciezka = join(this.katalog, w);
      const s = await stat(sciezka).catch(() => null);
      if (s?.isFile()) pliki.push({ sciezka, bajtow: s.size, czas: s.mtimeMs });
    }
    let razem = pliki.reduce((a, p) => a + p.bajtow, 0);
    if (razem <= limit) return 0;
    let skasowano = 0;
    for (const p of pliki.sort((a, b) => a.czas - b.czas)) {
      if (razem <= limit * 0.8) break;
      if (p.sciezka === oszczedz) continue;
      await rm(p.sciezka, { force: true }).catch(() => {});
      razem -= p.bajtow;
      skasowano++;
    }
    return skasowano;
  }
}
