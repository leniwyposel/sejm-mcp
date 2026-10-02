/**
 * Jeden katalog błędów: co się stało, czyja to wina i co zrobić, prostym polskim językiem.
 *
 * Komunikat trafia do człowieka przez asystenta AI, więc zamiast „Sejm odpowiedział 503” mówimy,
 * co to znaczy dla pytającego. Szczegóły techniczne (status, skrócony adres) idą na koniec.
 * Ten sam katalog opisuje błąd całego wywołania (`komunikatBledu`, pole isError) i błąd, przez
 * który wynik jest tylko częściowy (`zdanieBledu`, pole wynikCzesciowy.dlaczego).
 */

export type CzyjaWina = 'pytanie' | 'Sejm' | 'sieć' | 'ten serwer';

export interface WpisKatalogu {
  /** Krótki kod do szczegółów technicznych, np. "404", "5xx", "siec". */
  kod: string;
  /** Jedno zdanie dla człowieka: co się stało. */
  coSieStalo: string;
  czyjaWina: CzyjaWina;
  /** Jedno zdanie: co pytający może zrobić. */
  coZrobic: string;
  /** Czy to samo pytanie za chwilę ma szansę się udać. */
  czyPonowic: boolean;
}

export type RodzajBledu =
  | '400' | '401' | '402' | '403' | '404' | '405' | '406' | '408' | '410' | '413' | '414' | '415' | '422' | '429'
  | '500' | '501' | '502' | '503' | '504'
  | '4xx' | '5xx' | '3xx'
  | 'siec' | 'czas-zapytania' | 'czas-wywolania' | 'kolejka' | 'za-duza' | 'nie-json' | 'zapora' | 'ksztalt'
  | 'adres-odrzucony' | 'walidacja' | 'pdf' | 'nieznany';

const ZA_KILKA_MINUT = 'Spróbować ponownie za kilka minut; dane w Sejmie są, tylko teraz nie da się ich pobrać.';

export const KATALOG: Record<RodzajBledu, WpisKatalogu> = {
  '400': {
    kod: '400',
    coSieStalo: 'Sejm uznał zapytanie za błędne: zwykle parametr ma wartość, której rejestr nie przyjmuje (np. zły format daty albo numeru).',
    czyjaWina: 'pytanie',
    coZrobic: 'Sprawdzić numer, datę albo nazwę w pytaniu i zapytać jeszcze raz inaczej.',
    czyPonowic: false,
  },
  '401': {
    kod: '401',
    coSieStalo: 'Sejm zażądał zalogowania, choć jego API jest publiczne i nie wymaga konta; to nietypowe i leży po stronie Sejmu.',
    czyjaWina: 'Sejm',
    coZrobic: 'Nic nie da się tu zrobić po stronie pytającego; spróbować później.',
    czyPonowic: true,
  },
  '402': {
    kod: '402',
    coSieStalo: 'Sejm odpowiedział, że żąda opłaty, choć jego API jest bezpłatne; to nietypowa odmowa po stronie Sejmu.',
    czyjaWina: 'Sejm',
    coZrobic: 'To nie jest wina pytającego ani nie trzeba nic płacić; spróbować później.',
    czyPonowic: true,
  },
  '403': {
    kod: '403',
    coSieStalo: 'Sejm odmówił dostępu do tego zasobu (zakaz dostępu), choć dane są publiczne.',
    czyjaWina: 'Sejm',
    coZrobic: 'Spróbować później albo zadać pytanie o inny zasób; jeśli się powtarza, dane są czasowo niedostępne.',
    czyPonowic: true,
  },
  '404': {
    kod: '404',
    coSieStalo: 'Sejm nie ma takiego zasobu: zwykle zły numer (posiedzenia, pisma, druku, głosowania), zła kadencja albo rzecz, która jeszcze nie powstała.',
    czyjaWina: 'pytanie',
    coZrobic: 'Sprawdzić numer i kadencję (bieżąca to X, od 2023 r.) albo najpierw wyszukać właściwy numer.',
    czyPonowic: false,
  },
  '405': {
    kod: '405',
    coSieStalo: 'Sejm nie obsługuje takiego sposobu pytania o ten adres.',
    czyjaWina: 'ten serwer',
    coZrobic: 'Zapytać o to samo innym narzędziem; to usterka tego serwera, nie pytającego.',
    czyPonowic: false,
  },
  '406': {
    kod: '406',
    coSieStalo: 'Pod tym adresem Sejm nie ma danych w formacie, o który prosimy (np. jest tam strona albo plik, a nie dane).',
    czyjaWina: 'pytanie',
    coZrobic: 'Użyć narzędzia przeznaczonego do tej rzeczy zamiast surowego adresu.',
    czyPonowic: false,
  },
  '408': {
    kod: '408',
    coSieStalo: 'Sejm za długo czekał na zapytanie i je przerwał.',
    czyjaWina: 'sieć',
    coZrobic: 'Spróbować ponownie za chwilę.',
    czyPonowic: true,
  },
  '410': {
    kod: '410',
    coSieStalo: 'Sejm usunął ten zasób na stałe: kiedyś był, teraz go nie ma.',
    czyjaWina: 'Sejm',
    coZrobic: 'Szukać tej samej informacji inną drogą (np. przez wyszukiwanie); ponowienie nic nie da.',
    czyPonowic: false,
  },
  '413': {
    kod: '413',
    coSieStalo: 'Zapytanie było dla Sejmu za duże.',
    czyjaWina: 'pytanie',
    coZrobic: 'Zawęzić pytanie (krótszy okres, mniej wyników naraz).',
    czyPonowic: false,
  },
  '414': {
    kod: '414',
    coSieStalo: 'Adres zapytania wyszedł za długi (za dużo albo za długie parametry).',
    czyjaWina: 'pytanie',
    coZrobic: 'Skrócić frazę albo podać mniej parametrów naraz.',
    czyPonowic: false,
  },
  '415': {
    kod: '415',
    coSieStalo: 'Sejm nie przyjął formatu zapytania.',
    czyjaWina: 'ten serwer',
    coZrobic: 'Zapytać o to samo innym narzędziem; to usterka tego serwera, nie pytającego.',
    czyPonowic: false,
  },
  '422': {
    kod: '422',
    coSieStalo: 'Sejm zrozumiał zapytanie, ale nie może go wykonać z podanymi wartościami (np. data albo numer spoza zakresu).',
    czyjaWina: 'pytanie',
    coZrobic: 'Sprawdzić daty, numery i kadencję w pytaniu i zapytać jeszcze raz.',
    czyPonowic: false,
  },
  '429': {
    kod: '429',
    coSieStalo: 'Sejm ogranicza liczbę zapytań i chwilowo odmawia kolejnych; serwer już ponawiał próbę kilka razy.',
    czyjaWina: 'Sejm',
    coZrobic: 'Odczekać około minuty i zapytać ponownie.',
    czyPonowic: true,
  },
  '500': {
    kod: '500',
    coSieStalo: 'W systemie Sejmu wystąpiła awaria (błąd wewnętrzny serwera Sejmu).',
    czyjaWina: 'Sejm',
    coZrobic: ZA_KILKA_MINUT,
    czyPonowic: true,
  },
  '501': {
    kod: '501',
    coSieStalo: 'Sejm nie obsługuje tego rodzaju zapytania.',
    czyjaWina: 'Sejm',
    coZrobic: 'Zapytać o tę informację inną drogą; ponowienie nic nie da.',
    czyPonowic: false,
  },
  '502': {
    kod: '502',
    coSieStalo: 'Serwer pośredniczący Sejmu nie dostał odpowiedzi od właściwego systemu (awaria po stronie Sejmu).',
    czyjaWina: 'Sejm',
    coZrobic: ZA_KILKA_MINUT,
    czyPonowic: true,
  },
  '503': {
    kod: '503',
    coSieStalo: 'System Sejmu jest chwilowo niedostępny albo przeciążony.',
    czyjaWina: 'Sejm',
    coZrobic: ZA_KILKA_MINUT,
    czyPonowic: true,
  },
  '504': {
    kod: '504',
    coSieStalo: 'System Sejmu nie zdążył przygotować odpowiedzi (za długo liczył albo jest przeciążony).',
    czyjaWina: 'Sejm',
    coZrobic: `${ZA_KILKA_MINUT} Węższe pytanie (krótszy okres) też może pomóc.`,
    czyPonowic: true,
  },
  '4xx': {
    kod: '4xx',
    coSieStalo: 'Sejm odrzucił zapytanie jako niepoprawne.',
    czyjaWina: 'pytanie',
    coZrobic: 'Sprawdzić numery, daty i nazwy w pytaniu i zapytać jeszcze raz inaczej.',
    czyPonowic: false,
  },
  '5xx': {
    kod: '5xx',
    coSieStalo: 'Po stronie Sejmu wystąpiła awaria albo przeciążenie.',
    czyjaWina: 'Sejm',
    coZrobic: ZA_KILKA_MINUT,
    czyPonowic: true,
  },
  '3xx': {
    kod: '3xx',
    coSieStalo: 'Sejm odesłał zapytanie pod inny adres, a ten serwer ze względów bezpieczeństwa nie podąża za przekierowaniami.',
    czyjaWina: 'ten serwer',
    coZrobic: 'Zapytać o to samo innym narzędziem albo spróbować później; to nie wina pytającego.',
    czyPonowic: false,
  },
  siec: {
    kod: 'siec',
    coSieStalo: 'Nie udało się połączyć z serwerem Sejmu (brak połączenia, nieznany adres, zerwane albo niezabezpieczone połączenie).',
    czyjaWina: 'sieć',
    coZrobic: 'Sprawdzić połączenie z internetem i spróbować ponownie za kilka minut.',
    czyPonowic: true,
  },
  'czas-zapytania': {
    kod: 'czas-zapytania',
    coSieStalo: 'Sejm nie odpowiedział w wyznaczonym czasie, mimo kilku prób.',
    czyjaWina: 'Sejm',
    coZrobic: 'Spróbować ponownie za kilka minut albo zadać węższe pytanie (krótszy okres, mniej wyników).',
    czyPonowic: true,
  },
  'czas-wywolania': {
    kod: 'czas-wywolania',
    coSieStalo: 'Zabrakło czasu: jedno pytanie wymagało zbyt wielu zapytań do Sejmu, by zdążyć przed limitem (około minuty).',
    czyjaWina: 'ten serwer',
    coZrobic: 'Zapytać jeszcze raz tak samo (to, co już pobrano, serwer pamięta, więc drugie podejście zwykle się uda) albo zawęzić pytanie.',
    czyPonowic: true,
  },
  kolejka: {
    kod: 'kolejka',
    coSieStalo: 'Zapytanie czekało w kolejce za innymi i zabrakło na nie czasu (serwer pyta Sejm najwyżej o 4 rzeczy naraz).',
    czyjaWina: 'ten serwer',
    coZrobic: 'Zapytać jeszcze raz za chwilę.',
    czyPonowic: true,
  },
  'za-duza': {
    kod: 'za-duza',
    coSieStalo: 'Odpowiedź Sejmu była za duża, żeby ją przyjąć w całości.',
    czyjaWina: 'pytanie',
    coZrobic: 'Zawęzić pytanie (krótszy okres, konkretny numer zamiast całej listy).',
    czyPonowic: false,
  },
  'nie-json': {
    kod: 'nie-json',
    coSieStalo: 'Sejm oddał odpowiedź w nieoczekiwanej postaci (nie dane, tylko np. uszkodzony albo pusty tekst).',
    czyjaWina: 'Sejm',
    coZrobic: 'Spróbować ponownie za kilka minut; jeśli się powtarza, ten zasób jest po stronie Sejmu uszkodzony.',
    czyPonowic: true,
  },
  zapora: {
    kod: 'zapora',
    coSieStalo: 'Zabezpieczenie (zapora) przed serwerem Sejmu odrzuciło zapytanie i zamiast danych oddało stronę z odmową.',
    czyjaWina: 'Sejm',
    coZrobic: 'Spróbować później albo prościej sformułować pytanie (krótsza fraza, bez nietypowych znaków).',
    czyPonowic: true,
  },
  ksztalt: {
    kod: 'ksztalt',
    coSieStalo: 'Sejm oddał dane w innym układzie niż zwykle, więc serwer nie może ich rzetelnie policzyć.',
    czyjaWina: 'Sejm',
    coZrobic: 'Spróbować później; jeśli się powtarza, Sejm zmienił format danych i ten serwer wymaga poprawki.',
    czyPonowic: true,
  },
  'adres-odrzucony': {
    kod: 'adres-odrzucony',
    coSieStalo: 'Ten serwer odrzucił adres, zanim cokolwiek poszło do sieci: wolno mu pytać wyłącznie publiczne API Sejmu (api.sejm.gov.pl/sejm i /eli).',
    czyjaWina: 'pytanie',
    coZrobic: 'Podać ścieżkę w API Sejmu (np. "term10/MP", bez „..” i „//”) albo użyć narzędzia do tej rzeczy; innych stron internetowych ten serwer nie pobiera.',
    czyPonowic: false,
  },
  walidacja: {
    kod: 'walidacja',
    coSieStalo: 'Argument narzędzia ma złą wartość albo brakuje wymaganego.',
    czyjaWina: 'pytanie',
    coZrobic: 'Poprawić argument według opisu błędu i wywołać narzędzie jeszcze raz.',
    czyPonowic: false,
  },
  pdf: {
    kod: 'pdf',
    coSieStalo: 'Nie udało się odczytać tekstu z pliku PDF.',
    czyjaWina: 'ten serwer',
    coZrobic: 'Otworzyć plik PDF z podanego adresu samodzielnie.',
    czyPonowic: false,
  },
  nieznany: {
    kod: 'nieznany',
    coSieStalo: 'Wystąpił nieoczekiwany błąd przy pobieraniu danych.',
    czyjaWina: 'ten serwer',
    coZrobic: 'Spróbować ponownie za chwilę; jeśli się powtarza, zadać pytanie inaczej.',
    czyPonowic: true,
  },
};

/** Rodzaj z samego statusu HTTP. */
export function rodzajZeStatusu(status: number): RodzajBledu {
  const s = String(status) as RodzajBledu;
  if (s in KATALOG && /^\d{3}$/.test(s)) return s;
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'nieznany';
}

/** Rodzaj błędu sieci zgłoszonego przez fetch albo AbortSignal (nie przez Sejm). */
export function rodzajBleduSieci(e: unknown): RodzajBledu {
  if (typeof e === 'object' && e !== null && 'name' in e) {
    const b = e as Error & { cause?: { code?: string; message?: string } };
    if (b.name === 'TimeoutError' || b.name === 'AbortError') return 'czas-zapytania';
    const szczegol = `${b.message ?? ''} ${b.cause?.code ?? ''} ${b.cause?.message ?? ''}`;
    if (/redirect/i.test(szczegol)) return '3xx';
    if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR|CERT|TLS|SSL|socket|network/i.test(szczegol) || b.name === 'TypeError') {
      return 'siec';
    }
  }
  return 'nieznany';
}

/**
 * Rodzaj dowolnego błędu. `BladSejmu` niesie go sam (pole `rodzaj`); zwykły `Error` rzucony przez
 * narzędzie to zła wartość argumentu (np. odwrócony przedział dat): tak piszą go narzędzia.
 */
export function rodzajBledu(e: unknown): RodzajBledu {
  if (typeof e === 'object' && e !== null) {
    const r = (e as { rodzaj?: unknown }).rodzaj;
    if (typeof r === 'string' && r in KATALOG) return r as RodzajBledu;
    const status = (e as { status?: unknown }).status;
    if ((e as { name?: string }).name === 'BladSejmu' && typeof status === 'number') return rodzajZeStatusu(status);
  }
  const siec = rodzajBleduSieci(e);
  if (siec !== 'nieznany') return siec;
  if (e instanceof Error && e.name === 'Error') return 'walidacja';
  return 'nieznany';
}

export function wpisKatalogu(e: unknown): WpisKatalogu {
  return KATALOG[rodzajBledu(e)];
}

const WINA: Record<CzyjaWina, string> = {
  pytanie: 'pytania albo podanej wartości (np. zły numer, data, adres), nie awaria',
  Sejm: 'po stronie Sejmu, nie pytającego',
  'sieć': 'połączenia z Sejmem, nie pytającego',
  'ten serwer': 'tego narzędzia, nie pytającego',
};

const bezKropki = (s: string) => s.trim().replace(/[.\s]+$/, '');

/** Szczegół techniczny: status, rodzaj i treść błędu, bez długich adresów. */
function szczegoly(e: unknown, wpis: WpisKatalogu): string {
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : null;
  const tresc = e instanceof Error ? e.message : String(e);
  const kod = typeof status === 'number' ? `HTTP ${status}` : wpis.kod;
  return `${kod}; ${tresc.slice(0, 400)}`;
}

/**
 * Tekst błędu całego wywołania (isError): stała forma, szczegóły techniczne na końcu.
 * Zła wartość argumentu ma inną końcówkę: model ma ją sam poprawić, zanim zawraca głowę człowiekowi.
 */
export function komunikatBledu(e: unknown): string {
  const rodzaj = rodzajBledu(e);
  const w = KATALOG[rodzaj];
  const tresc = e instanceof Error ? e.message : String(e);
  if (rodzaj === 'walidacja') {
    return (
      `Narzędzie nie wykonało zapytania, bo argument ma złą wartość. Co się stało: ${bezKropki(tresc)}. ` +
      `Czyja to wina: ${WINA[w.czyjaWina]}. Co zrobić: ${w.coZrobic} ` +
      'Jeśli poprawka nie pomoże, powiedz użytkownikowi prostymi słowami, czego nie udało się sprawdzić.'
    );
  }
  const poczatek = rodzaj === 'adres-odrzucony' ? 'Nie pobrano danych: zapytanie odrzucił ten serwer, nie poszło do Sejmu.' : 'Nie udało się pobrać danych z Sejmu.';
  return (
    `${poczatek} Co się stało: ${w.coSieStalo} Czyja to wina: ${WINA[w.czyjaWina]}. Co zrobić: ${w.coZrobic} ` +
    `(szczegóły techniczne: ${szczegoly(e, w)}). Przekaż to użytkownikowi prostymi słowami, na początku odpowiedzi; nie zgaduj brakujących danych.`
  );
}

/**
 * Krótki opis błędu do pola wynikCzesciowy.dlaczego: przy wyniku częściowym narzędzie działa dalej,
 * więc wystarczy, co się stało i czyja to wina.
 */
export function zdanieBledu(e: unknown): string {
  const w = wpisPomocniczy(e);
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : null;
  return `${bezKropki(w.coSieStalo)} (${typeof status === 'number' ? `HTTP ${status}` : w.kod}; wina: ${WINA[w.czyjaWina]})`;
}

/** Co zrobić przy danym błędzie: zdanie z katalogu. */
export function coZrobicPrzy(e: unknown): string {
  return wpisPomocniczy(e).coZrobic;
}

/**
 * Przy pomocniczym zapytaniu (wynik częściowy) argumenty narzędzia już przeszły, więc zwykły Error
 * nie jest złą wartością argumentu, tylko nieoczekiwaną awarią.
 */
function wpisPomocniczy(e: unknown): WpisKatalogu {
  const r = rodzajBledu(e);
  return KATALOG[r === 'walidacja' ? 'nieznany' : r];
}
