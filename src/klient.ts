/**
 * Jedyna droga do sieci w tym serwerze.
 *
 * Każde zapytanie idzie wyłącznie do dwóch API Kancelarii Sejmu na jednym hoście:
 * https://api.sejm.gov.pl/sejm/… (parlament) i https://api.sejm.gov.pl/eli/… (akty prawne). Adres składa się tu
 * z względnej ścieżki i jest sprawdzany PO złożeniu, przekierowania są odrzucane, odpowiedź
 * ma limit rozmiaru i czasu. Uprzejmość wobec Sejmu: najwyżej 4 zapytania naraz, wspólny
 * hamulec przy 429 i 5xx, uczciwy User-Agent.
 */

import { rodzajBleduSieci, rodzajZeStatusu, type RodzajBledu } from './bledy.js';
import type { Pamiec } from './pamiec.js';

export const ADRES_API = 'https://api.sejm.gov.pl';
const PREFIKS = '/sejm/';
/** Ścieżka zaczynająca się od `eli/` idzie do API aktów prawnych, każda inna do API Sejmu. */
const PREFIKS_ELI = '/eli/';

export const WERSJA = '0.3.0';
const USER_AGENT = `sejm-mcp/${WERSJA} (+https://github.com/leniwyposel/sejm-mcp)`;

export type Parametry = Record<string, string | number | boolean | undefined | null>;

export interface OpcjePobrania {
  parametry?: Parametry;
  /** Milisekundy na jedno podejście. */
  limitCzasu?: number;
  /**
   * Chwila (Date.now()), po której nie zaczynamy ani nie ciągniemy zapytania: jedno wywołanie narzędzia
   * robi kilka zapytań i PDF, a klient MCP czeka na całość ok. minuty, nie na każde z osobna.
   */
  termin?: number;
}

/** Wszystko, czego narzędzia potrzebują od źródła danych. Testy podstawiają tu fikstury. */
export interface ZrodloSejmu {
  /** JSON spod ścieżki względem /sejm/ (np. `term10/MP`) albo spod /eli/ (np. `eli/acts/DU/2026/62`). 404 daje `null`. */
  json<T>(sciezka: string, opcje?: OpcjePobrania): Promise<T | null>;
  /** Lista JSON razem z nagłówkiem X-Total-Count (ile pasuje do filtra, nie ile przyszło). */
  lista<T>(sciezka: string, opcje?: OpcjePobrania): Promise<{ dane: T[]; razem: number | null }>;
  /** HTML albo tekst spod ścieżki względem /sejm/. 404 daje `null`. */
  tekst(sciezka: string, opcje?: OpcjePobrania): Promise<string | null>;
  /** Plik binarny (PDF) spod tej samej allowlisty, z tym samym limitem rozmiaru i czasu. 404 daje `null`. */
  bajty(sciezka: string, opcje?: OpcjePobrania): Promise<Uint8Array | null>;
  /** Pełny adres zapytania, do pola `zrodla` w odpowiedzi. */
  adres(sciezka: string, parametry?: Parametry): string;
  /**
   * Plik z katalogu rejestru (np. druk: katalog `term10/prints/2457`, nazwa `2457-ustawa.docx`), z nazwą
   * wziętą z rejestru (bywa ze spacjami i polskimi literami). Ta sama allowlista, kolejka i hamulec co
   * reszta, ale własny limit rozmiaru i czasu, bez pamięci krótkiej. 404 daje `null`; plik większy niż
   * `limitBajtow` daje BladSejmu rodzaju 'za-duza' (Sejm nie podaje rozmiaru z góry, więc liczymy bajty).
   * Opcjonalne tylko dla źródeł testowych, które plików nie pobierają; KlientSejmu je ma.
   */
  pobierzPlik?(katalog: string, nazwa: string, opcje: OpcjePliku): Promise<Uint8Array | null>;
  /**
   * Rozmiar pliku z nagłówka Content-Length (zapytanie HEAD, bez pobierania treści): `{ bajtow }`,
   * `{ bajtow: null }`, gdy Sejm rozmiaru nie podaje, `null` przy 404.
   */
  rozmiarPliku?(katalog: string, nazwa: string): Promise<{ bajtow: number | null } | null>;
}

export interface OpcjePliku {
  limitBajtow: number;
  /** Milisekundy na całe pobranie (duży druk idzie dłużej niż minuta; wywołanie narzędzia na nie nie czeka). */
  czasMs: number;
}

/** Nazwa pliku z rejestru: bez ukośników, bez `..`, bez znaków sterujących, najwyżej 200 znaków. */
const DOZWOLONA_NAZWA = /^[^/\\\u0000-\u001f]{1,200}$/u;

/**
 * Adres pliku w katalogu rejestru: katalog przez zlozAdres, nazwa zakodowana i sprawdzona. Wynik leży
 * zawsze bezpośrednio w tym katalogu (nazwa nie może wyjść piętro wyżej ani wskazać innego hosta).
 */
export function adresPliku(katalog: string, nazwa: string): URL {
  if (!DOZWOLONA_NAZWA.test(nazwa) || nazwa === '.' || nazwa === '..') {
    throw new BladSejmu(`Niedozwolona nazwa pliku: ${JSON.stringify(nazwa.slice(0, 200))}`, null, 'adres-odrzucony');
  }
  const baza = zlozAdres(katalog);
  const url = new URL(encodeURIComponent(nazwa), `${baza.href}/`);
  if (url.origin !== ADRES_API || url.pathname !== `${baza.pathname}/${encodeURIComponent(nazwa)}` || url.search || url.hash) {
    throw new BladSejmu(`Adres pliku poza katalogiem ${baza.pathname}: ${skrocAdres(url)}`, null, 'adres-odrzucony');
  }
  return url;
}

export class BladSejmu extends Error {
  /** Rodzaj z katalogu błędów (src/bledy.ts): mówi człowiekowi, co się stało i co zrobić. */
  readonly rodzaj: RodzajBledu;
  constructor(
    message: string,
    readonly status: number | null = null,
    rodzaj?: RodzajBledu,
  ) {
    super(message);
    this.name = 'BladSejmu';
    this.rodzaj = rodzaj ?? (status !== null ? rodzajZeStatusu(status) : 'nieznany');
  }
}

/** Najdłuższy adres, jaki wysyłamy; zapora Sejmu odrzuca długie adresy, a błąd nie może zalać rozmowy. */
const MAKS_ADRES = 2000;

/** Adres w komunikacie błędu: nigdy dłuższy niż 300 znaków. */
export function skrocAdres(url: URL | string): string {
  const s = String(url);
  return s.length > 300 ? `${s.slice(0, 300)}… (${s.length} znaków)` : s;
}

/**
 * Pełny adres z rejestru (np. załącznik pisma) → ścieżka dla klienta, albo `null`, gdy adres
 * leży poza https://api.sejm.gov.pl/sejm/ i /eli/ albo ma zapytanie lub kotwicę. Allowlisty to nie
 * rozszerza: wynik i tak przechodzi przez zlozAdres.
 */
export function sciezkaZAdresu(adres: string): string | null {
  let u: URL;
  try {
    u = new URL(adres);
  } catch {
    return null;
  }
  if (u.origin !== ADRES_API || u.search || u.hash || u.username || u.password) return null;
  if (u.pathname.startsWith(PREFIKS)) return u.pathname.slice(PREFIKS.length);
  if (u.pathname.startsWith(PREFIKS_ELI)) return u.pathname.slice(1);
  return null;
}

/** Dozwolone znaki ścieżki: litery, cyfry, `/ _ - .`, bez `..` i bez `//`. */
const DOZWOLONA_SCIEZKA = /^[A-Za-z0-9_\-./]+$/;

/**
 * Złożenie adresu z kontrolą: wynik MUSI leżeć pod https://api.sejm.gov.pl/sejm/ albo /eli/.
 * Rzuca wyjątek dla wszystkiego innego, zanim cokolwiek pójdzie w sieć.
 */
export function zlozAdres(sciezka: string, parametry?: Parametry): URL {
  const czysta = sciezka.replace(/^\/+/, '');
  if (!DOZWOLONA_SCIEZKA.test(czysta) || czysta.includes('..') || czysta.includes('//')) {
    throw new BladSejmu(`Niedozwolona ścieżka: ${JSON.stringify(sciezka)}`, null, 'adres-odrzucony');
  }
  const eli = czysta.startsWith('eli/');
  const url = new URL(eli ? `/${czysta}` : PREFIKS + czysta, ADRES_API);
  const prefiks = eli ? PREFIKS_ELI : PREFIKS;
  if (url.origin !== ADRES_API || !url.pathname.startsWith(prefiks)) {
    throw new BladSejmu(`Adres poza api.sejm.gov.pl/sejm/ i /eli/: ${url.href}`, null, 'adres-odrzucony');
  }
  for (const [k, v] of Object.entries(parametry ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  if (url.href.length > MAKS_ADRES) throw new BladSejmu(`Adres zapytania jest za długi (${url.href.length} znaków, limit ${MAKS_ADRES})`, null, '414');
  return url;
}

// ---------------------------------------------------------------------------

/** Ile zapytań do Sejmu naraz: tyle, żeby nie obciążać publicznego API. */
const NARAZ = 4;
const PODEJSC = 3;
const LIMIT_CZASU_MS = 45_000;
/** Całe pobranie, ze wszystkimi próbami, mieści się w tym czasie: klienci MCP czekają ok. minuty. */
const CALOSC_MS = 55_000;
/** Największa odpowiedź, jaką przyjmujemy. Lista druków to ok. 1,8 MB. */
const LIMIT_BAJTOW = 8 * 1024 * 1024;
/**
 * PDF ma osobny, wyższy limit: PDF Konstytucji (DU/1997/483, skan z warstwą OCR) waży ok. 13,2 MB
 * i przy 8 MiB najczęściej cytowany akt był nie do odczytania. JSON i HTML zostają przy 8 MiB.
 */
export const LIMIT_BAJTOW_PDF = 24 * 1024 * 1024;

type Fetch = typeof fetch;
type Rodzaj = 'json' | 'lista' | 'html' | 'pdf' | 'plik' | 'naglowek';

export class KlientSejmu implements ZrodloSejmu {
  private aktywne = 0;
  private kolejka: Array<() => void> = [];
  private odstepMs = 0;
  private wLocie = new Map<string, Promise<string | null>>();

  constructor(
    private readonly pamiec: Pamiec,
    // Przez funkcję, nie `= fetch`: w części środowisk (np. Cloudflare Workers) fetch wywołany jako metoda obiektu rzuca „Illegal invocation”.
    private readonly pobierz: Fetch = (url, init) => fetch(url, init),
    private readonly spij: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  adres(sciezka: string, parametry?: Parametry): string {
    return zlozAdres(sciezka, parametry).href;
  }

  async json<T>(sciezka: string, opcje: OpcjePobrania = {}): Promise<T | null> {
    const tresc = await this.surowe(sciezka, opcje, 'json');
    if (tresc === null) return null;
    try {
      return JSON.parse(tresc) as T;
    } catch {
      throw new BladSejmu(`Sejm odpowiedział czymś, co nie jest JSON-em: ${skrocAdres(this.adres(sciezka, opcje.parametry))}`, null, 'nie-json');
    }
  }

  async lista<T>(sciezka: string, opcje: OpcjePobrania = {}): Promise<{ dane: T[]; razem: number | null }> {
    const tresc = await this.surowe(sciezka, opcje, 'lista');
    if (tresc === null) return { dane: [], razem: 0 };
    try {
      const zapis = JSON.parse(tresc) as { razem: number | null; tresc: string };
      const dane = JSON.parse(zapis.tresc) as unknown;
      return { dane: Array.isArray(dane) ? (dane as T[]) : [], razem: zapis.razem };
    } catch {
      throw new BladSejmu(`Sejm odpowiedział czymś, co nie jest listą JSON: ${skrocAdres(this.adres(sciezka, opcje.parametry))}`, null, 'nie-json');
    }
  }

  async tekst(sciezka: string, opcje: OpcjePobrania = {}): Promise<string | null> {
    return this.surowe(sciezka, opcje, 'html');
  }

  /**
   * PDF i inne pliki binarne: ta sama allowlista, kolejka i limit czasu co reszta; limit rozmiaru 24 MiB (LIMIT_BAJTOW_PDF).
   * W pamięci krótkiej leżą jako base64 (pamięć trzyma napisy), nigdy na dysku.
   */
  async bajty(sciezka: string, opcje: OpcjePobrania = {}): Promise<Uint8Array | null> {
    const tresc = await this.surowe(sciezka, opcje, 'pdf');
    return tresc === null ? null : new Uint8Array(Buffer.from(tresc, 'base64'));
  }

  async pobierzPlik(katalog: string, nazwa: string, opcje: OpcjePliku): Promise<Uint8Array | null> {
    const url = adresPliku(katalog, nazwa);
    const koniec = Date.now() + opcje.czasMs;
    const bajty = await this.wKolejce(() => this.zSieci(url, 'plik', opcje.czasMs, koniec, (odp) => czytajBajtyZLimitem(odp, opcje.limitBajtow)));
    return bajty === null ? null : new Uint8Array(bajty.buffer, bajty.byteOffset, bajty.byteLength);
  }

  async rozmiarPliku(katalog: string, nazwa: string): Promise<{ bajtow: number | null } | null> {
    const url = adresPliku(katalog, nazwa);
    const koniec = Date.now() + LIMIT_CZASU_MS;
    return this.wKolejce(() =>
      this.zSieci(url, 'naglowek', LIMIT_CZASU_MS, koniec, async (odp) => {
        await odp.body?.cancel();
        const n = Number(odp.headers.get('content-length'));
        return { bajtow: odp.headers.has('content-length') && Number.isFinite(n) && n >= 0 ? n : null };
      }),
    );
  }

  private async surowe(sciezka: string, opcje: OpcjePobrania, rodzaj: Rodzaj): Promise<string | null> {
    const url = zlozAdres(sciezka, opcje.parametry);
    const klucz = `${rodzaj} ${url.href}`;

    const zPamieci = this.pamiec.czytaj(klucz);
    if (zPamieci !== null) return zPamieci;

    // To samo zapytanie w locie: czekamy na nie, zamiast pytać Sejm drugi raz.
    const trwa = this.wLocie.get(klucz);
    if (trwa) return trwa;

    // Termin liczy się od wejścia do kolejki: klient MCP czeka na całość, nie na samą sieć.
    const koniec = Math.min(Date.now() + CALOSC_MS, opcje.termin ?? Infinity);
    if (koniec - Date.now() < 1000) throw new BladSejmu(`Zabrakło czasu na zapytanie w ramach jednego wywołania narzędzia: ${skrocAdres(url)}`, null, 'czas-wywolania');
    const obietnica = this.wKolejce(() => this.zSieci(url, rodzaj, opcje.limitCzasu ?? LIMIT_CZASU_MS, koniec, (odp) => tresc(odp, rodzaj)))
      .then(async (tresc) => {
        if (tresc !== null) this.pamiec.zapisz(klucz, tresc);
        return tresc;
      })
      .finally(() => this.wLocie.delete(klucz));
    this.wLocie.set(klucz, obietnica);
    return obietnica;
  }

  private async wKolejce<T>(zadanie: () => Promise<T>): Promise<T> {
    // Zwolnione miejsce przechodzi wprost na czekającego, więc nikt go nie podbierze w międzyczasie.
    if (this.aktywne >= NARAZ) await new Promise<void>((r) => this.kolejka.push(r));
    else this.aktywne++;
    try {
      return await zadanie();
    } finally {
      const nastepny = this.kolejka.shift();
      if (nastepny) nastepny();
      else this.aktywne--;
    }
  }

  private async zSieci<T>(url: URL, rodzaj: Rodzaj, limitCzasu: number, koniec: number, czytaj: (odp: Response) => Promise<T>): Promise<T | null> {
    let ostatni: unknown = null;
    let prob = 0;
    for (let podejscie = 0; podejscie < PODEJSC; podejscie++) {
      if (this.odstepMs > 0) await this.spij(this.odstepMs);
      const zostalo = koniec - Date.now();
      if (zostalo < 1000) break;
      prob++;
      try {
        const odp = await this.pobierz(url, {
          // HEAD tylko po rozmiar pliku: treści nie pobieramy, dopóki użytkownik się nie zgodzi.
          method: rodzaj === 'naglowek' ? 'HEAD' : 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: rodzaj === 'html' ? 'text/html, text/plain' : rodzaj === 'pdf' ? 'application/pdf' : rodzaj === 'plik' || rodzaj === 'naglowek' ? '*/*' : 'application/json',
          },
          // 'manual' zamiast 'error': przekierowanie widać jako status 3xx i od razu mówimy, co się stało,
          // zamiast trzech prób i komunikatu „fetch failed”.
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.min(limitCzasu, zostalo)),
        });

        if (odp.status >= 300 && odp.status < 400) {
          await odp.body?.cancel();
          throw new BladSejmu(`API odpowiedziało przekierowaniem (${odp.status}); serwer nie podąża za przekierowaniami: ${skrocAdres(url)}`, odp.status);
        }
        if (odp.status === 404) {
          await odp.body?.cancel();
          return null;
        }
        if (odp.status === 429 || odp.status >= 500) {
          await odp.body?.cancel();
          this.przyhamuj();
          ostatni = new BladSejmu(`Sejm odpowiedział ${odp.status}`, odp.status);
          const czekaj = Number(odp.headers.get('retry-after'));
          const przerwa = Number.isFinite(czekaj) && czekaj > 0 ? Math.min(czekaj, 30) * 1000 : 1000 * 2 ** podejscie;
          if (Date.now() + przerwa >= koniec) break;
          await this.spij(przerwa);
          continue;
        }
        if (!odp.ok) {
          await odp.body?.cancel();
          throw new BladSejmu(`Sejm odpowiedział ${odp.status} na ${skrocAdres(url)}`, odp.status);
        }

        const typ = odp.headers.get('content-type') ?? '';
        if (rodzaj !== 'html' && typ.includes('text/html')) {
          await odp.body?.cancel();
          // Zapora przed API Sejmu oddaje stronę HTML „Request Rejected" ze statusem 200.
          throw new BladSejmu(`Zapora Sejmu odrzuciła zapytanie albo adres nie zwraca ${rodzaj === 'pdf' || rodzaj === 'plik' || rodzaj === 'naglowek' ? 'pliku' : 'JSON-a'}: ${skrocAdres(url)}`, null, 'zapora');
        }

        const wynik = await czytaj(odp);
        this.rozpedz();
        return wynik;
      } catch (e) {
        if (e instanceof BladSejmu && e.status !== null && e.status < 500 && e.status !== 429) throw e;
        if (e instanceof BladSejmu && e.status === null) throw e;
        // Przekierowanie zgłoszone przez fetch jako błąd (redirect: 'error' w innym środowisku) jest stałe: bez ponawiania.
        if (opisBledu(e) === 'przekierowanie') throw new BladSejmu(`API odpowiedziało przekierowaniem; serwer nie podąża za przekierowaniami: ${skrocAdres(url)}`, 300, '3xx');
        ostatni = e;
        this.przyhamuj();
      }
    }
    if (prob === 0) throw new BladSejmu(`Zabrakło czasu, zanim zapytanie wyszło z kolejki (limit ${CALOSC_MS / 1000} s na całość): ${skrocAdres(url)}`, null, 'kolejka');
    const opis = opisBledu(ostatni);
    // Status ostatniej odpowiedzi (429, 503) zostaje w błędzie: człowiek dostaje opis tego, co zrobił Sejm, nie „nie odpowiedział”.
    const status = ostatni instanceof BladSejmu ? ostatni.status : null;
    const rodzajBledu = ostatni instanceof BladSejmu ? ostatni.rodzaj : rodzajBleduSieci(ostatni) === 'nieznany' ? 'siec' : rodzajBleduSieci(ostatni);
    throw new BladSejmu(`Sejm nie odpowiedział po ${prob} ${prob === 1 ? 'próbie' : 'próbach'} (${opis}): ${skrocAdres(url)}`, status, rodzajBledu);
  }

  private przyhamuj(): void {
    this.odstepMs = Math.min(2000, Math.max(250, this.odstepMs * 2));
  }

  private rozpedz(): void {
    this.odstepMs = this.odstepMs <= 250 ? 0 : Math.floor(this.odstepMs / 2);
  }
}

/**
 * Błąd sieci po polsku: fetch i AbortSignal mówią po angielsku („The operation was aborted due to
 * timeout”, „fetch failed”), a ten tekst idzie wprost do rozmowy.
 */
export function opisBledu(e: unknown): string {
  if (e instanceof BladSejmu) return e.message;
  if (e instanceof Error || (typeof e === 'object' && e !== null && 'name' in e)) {
    const b = e as Error & { cause?: unknown };
    if (b.name === 'TimeoutError') return 'przekroczono limit czasu odpowiedzi';
    if (b.name === 'AbortError') return 'zapytanie przerwano';
    const przyczyna = b.cause as { code?: string; message?: string } | undefined;
    const szczegol = przyczyna?.code ?? przyczyna?.message ?? '';
    if (/redirect/i.test(`${b.message} ${szczegol}`)) return 'przekierowanie';
    if (b.message === 'fetch failed' || b.name === 'TypeError') return `błąd sieci${szczegol ? ` (${String(szczegol).slice(0, 80)})` : ''}`;
    return b.message.slice(0, 200);
  }
  return String(e).slice(0, 200);
}

/** Treść odpowiedzi dla json/lista/html/pdf: napis (PDF jako base64, bo pamięć krótka trzyma napisy). */
async function tresc(odp: Response, rodzaj: Rodzaj): Promise<string> {
  const t = await czytajZLimitem(odp, rodzaj === 'pdf' ? LIMIT_BAJTOW_PDF : LIMIT_BAJTOW, rodzaj === 'pdf' ? 'base64' : 'utf-8');
  if (rodzaj !== 'lista') return t;
  const razem = Number(odp.headers.get('x-total-count'));
  return JSON.stringify({ razem: odp.headers.has('x-total-count') && Number.isFinite(razem) ? razem : null, tresc: t });
}

async function czytajZLimitem(odp: Response, limit: number, kodowanie: 'utf-8' | 'base64'): Promise<string> {
  const calosc = await czytajBajtyZLimitem(odp, limit);
  return kodowanie === 'base64' ? calosc.toString('base64') : new TextDecoder('utf-8').decode(calosc);
}

async function czytajBajtyZLimitem(odp: Response, limit: number): Promise<Buffer> {
  const deklarowana = Number(odp.headers.get('content-length'));
  if (Number.isFinite(deklarowana) && deklarowana > limit) {
    await odp.body?.cancel();
    throw new BladSejmu(`Odpowiedź Sejmu jest za duża (${deklarowana} B, limit ${limit} B)`, null, 'za-duza');
  }
  if (!odp.body) return Buffer.alloc(0);
  const czytnik = odp.body.getReader();
  const kawalki: Uint8Array[] = [];
  let razem = 0;
  for (;;) {
    const { done, value } = await czytnik.read();
    if (done) break;
    razem += value.byteLength;
    if (razem > limit) {
      await czytnik.cancel();
      throw new BladSejmu(`Odpowiedź Sejmu jest za duża (ponad ${limit} B)`, null, 'za-duza');
    }
    kawalki.push(value);
  }
  return Buffer.concat(kawalki);
}
