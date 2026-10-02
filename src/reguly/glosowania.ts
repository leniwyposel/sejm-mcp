/**
 * Głosowania: rodzaj, werdykt i rozbicie klubowe.
 *
 * Każda reguła powstała na konkretnym rekordzie rejestru, który ją złamał.
 */

import { odmiana } from './daty.js';

/** Rekord głosowania z `/votings/{posiedzenie}/{numer}`, bez imiennej listy. */
export interface GlosowanieSurowe {
  kind: string | null;
  topic: string | null;
  title: string | null;
  description?: string | null;
  yes: number;
  no: number;
  abstain: number;
  present: number;
  notParticipating: number;
  totalVoted: number;
  majorityType: string | null;
  /** Przy `SIMPLE_MAJORITY` rejestr też go podaje i wynosi wtedy `no + 1`. */
  majorityVotes: number | null;
  votingOptions?: Array<{ option: string; votes: number; optionIndex?: number }> | null;
  /** Bezstrefowy czas warszawski. */
  date: string;
  againstAll?: number | null;
  /** Tożsamość rekordu: potrzebna rejestrowi apeli w trybie „dowolny przycisk”. */
  sitting?: number | null;
  votingNumber?: number | null;
}

export type RodzajGlosowania = 'zwykle' | 'kworum' | 'lista';

/**
 * Kworum to połowa ustawowej liczby posłów (art. 120 Konstytucji: 460 / 2). Apel o kworum
 * niczego nie przyjmuje, ale pytanie „czy kworum było” rozstrzyga ta liczba.
 */
export const KWORUM = 230;

/**
 * Głosowanie nad uchwałą Senatu. Sejm nie głosuje wtedy poprawki ani ustawy, tylko WNIOSEK
 * O ODRZUCENIE stanowiska Senatu (art. 121 ust. 3 Konstytucji, bezwzględna większość).
 * Wniosek, który nie przeszedł, znaczy, że poprawka Senatu jest PRZYJĘTA: 26/19 (194 za przy
 * progu 216) model czytał jako „Sejm odrzucił poprawkę”, czyli odwrotnie.
 */
export type GlosowanieSenackie = 'poprawka-senatu' | 'uchwala-senatu-odrzucajaca-ustawe';

interface TekstGlosowania {
  title?: string | null;
  topic?: string | null;
  description?: string | null;
  /** `glosy_posla_w_dniu` nie dostaje większości; wtedy rozstrzyga sam tekst. */
  majorityType?: string | null;
}

export function glosowanieSenackie(g: TekstGlosowania): GlosowanieSenackie | null {
  const tekst = `${g.title ?? ''} ${g.topic ?? ''} ${g.description ?? ''}`;
  if (!/uchwa\p{L}* Senatu/iu.test(tekst)) return null;
  // Rejestr zapisuje te głosowania z większością bezwzględną; „poprawka” przy zwykłej większości to drugie czytanie.
  if (g.majorityType && g.majorityType !== 'ABSOLUTE_MAJORITY') return null;
  const temat = `${g.topic ?? ''} ${g.description ?? ''}`;
  // IX kadencja, 76/104: „wniosek o odrzucenie uchwały Senatu odrzucającej ustawę”.
  if (/odrzuceni\p{L}* uchwały Senatu odrzucając/iu.test(temat)) return 'uchwala-senatu-odrzucajaca-ustawe';
  if (/^\s*poprawk/iu.test(g.topic ?? '')) return 'poprawka-senatu';
  return null;
}

/** Rozstrzygnięcie głosowania nad uchwałą Senatu, liczone z wyniku wniosku o odrzucenie. */
export function rozstrzygniecieSenatu(
  rodzaj: GlosowanieSenackie,
  wniosekPrzeszedl: boolean,
  topic?: string | null,
): { wynik: string; stanowiskoSenatuPrzyjete: boolean } {
  if (rodzaj === 'uchwala-senatu-odrzucajaca-ustawe') {
    return wniosekPrzeszedl
      ? { wynik: 'Uchwała Senatu odrzucająca ustawę odrzucona: ustawa zostaje w brzmieniu uchwalonym przez Sejm', stanowiskoSenatuPrzyjete: false }
      : { wynik: 'Senat odrzucił ustawę, a wniosek o odrzucenie uchwały Senatu nie uzyskał bezwzględnej większości: ustawa upada', stanowiskoSenatuPrzyjete: true };
  }
  // „poprawki nr 1-2 i 4” to jedno głosowanie nad kilkoma poprawkami naraz.
  const mnoga = /^\s*poprawki/iu.test(topic ?? '');
  return wniosekPrzeszedl
    ? { wynik: `${mnoga ? 'Poprawki Senatu odrzucone' : 'Poprawka Senatu odrzucona'} (wniosek o odrzucenie uzyskał bezwzględną większość)`, stanowiskoSenatuPrzyjete: false }
    : { wynik: `${mnoga ? 'Poprawki Senatu przyjęte' : 'Poprawka Senatu przyjęta'} (wniosek o odrzucenie nie uzyskał bezwzględnej większości)`, stanowiskoSenatuPrzyjete: true };
}

// ---------------------------------------------------------------------------
// Apele o kworum: dwa tryby
// ---------------------------------------------------------------------------

/**
 * Apel o kworum ma w Sejmie dwa tryby, a rejestr zapisuje je różnie:
 *
 *   1. Tryb „obecny” (temat „Głosowanie kworum”, raz 18/46). Jedynym przyciskiem jest „obecny”,
 *      więc wynik ma kształt 0 za, 0 przeciw, 0 wstrzymań i N obecnych. Ten tryb rozpoznaje
 *      {@link rodzajGlosowania} po KSZTAŁCIE wyniku.
 *   2. Tryb „dowolny przycisk” (pięć razy w X kadencji, wszystkie z tematem „wniosek
 *      o stwierdzenie kworum”). Marszałek prosi o naciśnięcie JAKIEGOKOLWIEK przycisku, żeby
 *      potwierdzić obecność, i stwierdza kworum z sumy. Rejestr zapisuje to jak zwykłe
 *      głosowanie (33/5: 145 za, 47 przeciw, 237 wstrzymań), więc kształtem się go nie odróżni.
 *
 * Dlatego jawny rejestr pięciu rekordów, każdy z cytatem ze stenogramu, a nie reguła na temacie:
 * temat to etykieta porządku obrad, a regulamin (art. 184 ust. 3 pkt 10 i ust. 4) przewiduje
 * rozstrzygnięcie takiego wniosku większością głosów, więc kiedyś może paść prawdziwe głosowanie
 * nad nim. Nowy rekord z tym tematem, który nie jest apelem z kształtu ani z rejestru, dostaje
 * łagodne ostrzeżenie ({@link apelDoPrzegladu}), a nie cichą klasyfikację.
 *
 * Niezależne potwierdzenie: statystyka posła w Sejmie (`/MP/{id}/votings/stats`) pomija
 * wszystkie pięć, tak jak pomija apele w trybie „obecny” (poseł 1, 23.04.2025: lista dnia ma
 * 6 pozycji z 33/5 „ABSTAIN”, statystyka mówi 5).
 *
 * Reguła taka sama jak w serwisie leniwyposel.pl (`shared/apele-kworum.ts`, decyzja z 2.10.2026).
 */
export interface ApelDowolnyPrzycisk {
  kadencja: number;
  posiedzenie: number;
  numer: number;
  /** Dzień głosowania 'YYYY-MM-DD' (czas warszawski); chroni przed pomyłką kadencji. */
  dzien: string;
  /** Stenogram dnia w PDF (API Sejmu). */
  stenogram: string;
  /** Słowa marszałka ze stenogramu. */
  cytat: string;
}

const STENOGRAM = (posiedzenie: number, dzien: string): string =>
  `https://api.sejm.gov.pl/sejm/term10/proceedings/${posiedzenie}/${dzien}/transcripts/pdf`;

/** Pięć apeli w trybie „dowolny przycisk” X kadencji. Wpis dopisuje się po lekturze stenogramu, nigdy z samego tematu. */
export const APELE_DOWOLNY_PRZYCISK: readonly ApelDowolnyPrzycisk[] = [
  {
    kadencja: 10, posiedzenie: 1, numer: 125, dzien: '2023-12-20',
    stenogram: STENOGRAM(1, '2023-12-20'),
    cytat:
      'proszę o wciśnięcie dowolnego przycisku na urządzeniu do głosowania, tak aby można było ' +
      'potwierdzić państwa aktywność i obecność na posiedzeniu. Głosowało 342 posłów. (...) jest nas 342. ' +
      'Na tym zakończymy potwierdzanie kworum.',
  },
  {
    kadencja: 10, posiedzenie: 15, numer: 4, dzien: '2024-07-12',
    stenogram: STENOGRAM(15, '2024-07-12'),
    cytat:
      'Ponieważ pan poseł Tumanowicz ma wątpliwości, czy jest kworum, obecnie przystąpimy do stwierdzenia ' +
      'tego faktu. Proszę zatem o naciśnięcie jakiegokolwiek przycisku w celu potwierdzenia państwa obecności ' +
      'na posiedzeniu. (...) Głosowało 418 posłów. (...) Stwierdzam kworum.',
  },
  {
    kadencja: 10, posiedzenie: 16, numer: 4, dzien: '2024-07-23',
    stenogram: STENOGRAM(16, '2024-07-23'),
    cytat:
      'My w międzyczasie ustalimy kworum, gdyż pan poseł Tumanowicz ma wątpliwości co do obecności państwa ' +
      'na sali. Proszę zatem o naciśnięcie jakiegokolwiek przycisku w celu potwierdzenia swojej obecności ' +
      'na posiedzeniu. (...) Głosowało 424 posłów.',
  },
  {
    kadencja: 10, posiedzenie: 20, numer: 4, dzien: '2024-10-16',
    stenogram: STENOGRAM(20, '2024-10-16'),
    cytat:
      'Ponieważ został zgłoszony wniosek o stwierdzenie kworum, proszę wszystkich państwa o naciśnięcie ' +
      'dowolnego przycisku w celu potwierdzenia obecności na posiedzeniu (...) można stwierdzić, że jest ' +
      'nas 419, w związku z powyższym należy stwierdzić, że jest też kworum.',
  },
  {
    kadencja: 10, posiedzenie: 33, numer: 5, dzien: '2025-04-23',
    stenogram: STENOGRAM(33, '2025-04-23'),
    cytat:
      'Przystępujemy teraz do stwierdzenia kworum. Proszę o naciśnięcie przycisku w celu potwierdzenia ' +
      'obecności na posiedzeniu. Jakiegokolwiek przycisku. (...) Stwierdzam kworum.',
  },
];

/**
 * Rekordy z tematem wniosku o kworum, po których lekturze stwierdzono, że BYŁY głosowaniem nad
 * wnioskiem. Dziś pusta: każdy taki rekord X kadencji był apelem. Wpis tutaj ucisza ostrzeżenie.
 */
export const WNIOSKI_O_KWORUM_GLOSOWANE: readonly Pick<ApelDowolnyPrzycisk, 'kadencja' | 'posiedzenie' | 'numer' | 'dzien'>[] = [];

/** Temat porządku obrad, przy którym rekord trzeba sprawdzić w stenogramie. */
export const TEMAT_WNIOSKU_O_KWORUM = /stwierdzeni\w*\s+(kworum|quorum)/i;

const pasujeDoWpisu = (
  wpis: Pick<ApelDowolnyPrzycisk, 'posiedzenie' | 'numer' | 'dzien'>,
  posiedzenie: number | null | undefined,
  numer: number | null | undefined,
  data: string | null | undefined,
): boolean => wpis.posiedzenie === posiedzenie && wpis.numer === numer && String(data ?? '').slice(0, 10) === wpis.dzien;

/**
 * Czy rekord to apel w trybie „dowolny przycisk” z rejestru. Dopasowanie po posiedzeniu, numerze
 * i DNIU: numery powtarzają się w każdej kadencji, dzień nie.
 */
export function czyApelDowolnyPrzycisk(
  posiedzenie: number | null | undefined,
  numer: number | null | undefined,
  data: string | null | undefined,
): ApelDowolnyPrzycisk | null {
  return APELE_DOWOLNY_PRZYCISK.find((w) => pasujeDoWpisu(w, posiedzenie, numer, data)) ?? null;
}

/** Apel z kształtu: nie ma czego nacisnąć poza „obecny”. */
function apelZKsztaltu(g: Pick<GlosowanieSurowe, 'kind' | 'yes' | 'no' | 'abstain' | 'present'>): boolean {
  return g.kind !== 'ON_LIST' && g.yes + g.no + g.abstain === 0 && g.present > 0;
}

/**
 * Ostrzeżenie (nie błąd): rekord z tematem „stwierdzenie kworum”, którego reguła nie umie
 * rozstrzygnąć, bo nie jest apelem z kształtu ani wpisem rejestru. Serwer pyta Sejm na żywo,
 * więc taki rekord może się pojawić jutro; wtedy liczymy go jak zwykłe głosowanie i mówimy, że
 * trzeba sprawdzić stenogram. `null`, gdy nic do przeglądu.
 */
export function apelDoPrzegladu(g: GlosowanieSurowe): string | null {
  if (!TEMAT_WNIOSKU_O_KWORUM.test(g.topic ?? '')) return null;
  if (apelZKsztaltu(g)) return null;
  if (czyApelDowolnyPrzycisk(g.sitting, g.votingNumber, g.date)) return null;
  if (WNIOSKI_O_KWORUM_GLOSOWANE.some((w) => pasujeDoWpisu(w, g.sitting, g.votingNumber, g.date))) return null;
  const nr = g.sitting && g.votingNumber ? `${g.sitting}/${g.votingNumber}` : 'To głosowanie';
  return (
    `${nr} ma temat „${(g.topic ?? '').trim()}”, ale nie jest apelem o kworum z kształtu wyniku (0 za, 0 przeciw, 0 wstrzymań) ` +
    'ani ze znanego rejestru apeli w trybie „dowolny przycisk”. Policzono je jak zwykłe głosowanie; czy marszałek prosił o naciśnięcie ' +
    'dowolnego przycisku (wtedy to sprawdzenie kworum, a nie głosowanie nad wnioskiem), rozstrzyga stenogram tego dnia.'
  );
}

/**
 * Rodzaj głosowania. Apel o kworum ma dwa tryby: „obecny” rozpoznany po KSZTAŁCIE wyniku
 * (0 za, 0 przeciw, 0 wstrzymań, obecni > 0) i „dowolny przycisk” z jawnego rejestru
 * {@link APELE_DOWOLNY_PRZYCISK} (1/125, 15/4, 16/4, 20/4, 33/5).
 *
 * Do 2.10.2026 stało tu, że 33/5 to zwykłe głosowanie (145/47/237). Stenogram mówi co innego:
 * marszałek prosił o „jakikolwiek przycisk” i stwierdził kworum, a statystyka posła w Sejmie
 * pomija ten rekord. Sam temat dalej niczego nie rozstrzyga: 18/46 ma ten sam temat i jest
 * apelem w trybie „obecny”.
 */
export function rodzajGlosowania(g: GlosowanieSurowe): RodzajGlosowania {
  if (g.kind === 'ON_LIST') return 'lista';
  if (apelZKsztaltu(g)) return 'kworum';
  if (czyApelDowolnyPrzycisk(g.sitting, g.votingNumber, g.date)) return 'kworum';
  return 'zwykle';
}

/** Apel o kworum, w obu trybach. */
export function czyKworum(g: GlosowanieSurowe): boolean {
  return rodzajGlosowania(g) === 'kworum';
}

/**
 * Ilu posłów potwierdziło obecność na apelu: każde naciśnięcie, także „za”, „przeciw”
 * i „wstrzymuję się” w trybie „dowolny przycisk”. W trybie „obecny” to po prostu `present`.
 */
export function obecniNaApelu(g: Pick<GlosowanieSurowe, 'yes' | 'no' | 'abstain' | 'present'>): number {
  return g.yes + g.no + g.abstain + g.present;
}

export interface WynikGlosowania {
  rodzaj: RodzajGlosowania;
  /** `null` przy apelu o kworum i przy wyborze z listy: tam nic się nie przyjmuje. */
  przeszlo: boolean | null;
  /** Wymagana liczba głosów „za", gdy obowiązuje próg kwalifikowany. */
  prog: number | null;
  /** Przy apelu o kworum: wszyscy, którzy nacisnęli przycisk ({@link obecniNaApelu}). */
  obecnych: number | null;
  /** Tylko przy apelu o kworum: czy obecnych było co najmniej {@link KWORUM}. */
  kworumJest?: boolean;
  /** Tylko przy apelu o kworum: tryb „obecny” (kształt) albo „dowolny przycisk” (rejestr, z cytatem). */
  trybApelu?: 'obecny' | 'dowolny-przycisk';
  /** Przy trybie „dowolny przycisk”: dowód ze stenogramu. */
  apel?: ApelDowolnyPrzycisk;
  /** Głosowanie nad uchwałą Senatu: wtedy `przeszlo` mówi o WNIOSKU O ODRZUCENIE, nie o poprawce. */
  senat?: GlosowanieSenackie;
  /** Przy uchwale Senatu: czy stanowisko Senatu (poprawka, odrzucenie ustawy) się ostało. */
  stanowiskoSenatuPrzyjete?: boolean;
  wybrani: string[];
  etykieta: string;
  wiekszosc: string;
}

const ETYKIETY_WIEKSZOSCI: Record<string, string> = {
  SIMPLE_MAJORITY: 'większość zwykła',
  STATUTORY_MAJORITY: 'większość ustawowa',
  ABSOLUTE_MAJORITY: 'większość bezwzględna',
  ABSOLUTE_STATUTORY_MAJORITY: 'bezwzględna większość ustawowej liczby posłów',
  MAJORITY_TWO_THIRDS: 'większość 2/3',
  STATUTORY_MAJORITY_TWO_THIRDS: 'większość 2/3 ustawowej liczby posłów',
  MAJORITY_THREE_FIFTHS: 'większość 3/5',
  STATUTORY_MAJORITY_THREE_FIFTHS: 'większość 3/5 ustawowej liczby posłów',
};

/** Nazwa większości po polsku. Pusta wartość znaczy „Sejm nie podał", a nie „zwykła". */
export function etykietaWiekszosci(majorityType: string | null | undefined): string {
  if (!majorityType) return 'nie podano rodzaju większości';
  return ETYKIETY_WIEKSZOSCI[majorityType] ?? majorityType;
}

/** „GASIUK-PIHOWICZ KAMILA" → „Gasiuk-Pihowicz Kamila". */
export function nazwaZListy(option: string): string {
  return option
    .toLocaleLowerCase('pl-PL')
    .split(' ')
    .filter(Boolean)
    .map((slowo) =>
      slowo
        .split('-')
        .map((czesc) => (czesc ? czesc.charAt(0).toLocaleUpperCase('pl-PL') + czesc.slice(1) : czesc))
        .join('-'),
    )
    .join(' ');
}

/** Kto wygrał wybór z listy: kandydaci, którzy sięgnęli progu, a bez progu ci z maksimum. */
export function wybraniZListy(g: GlosowanieSurowe): string[] {
  const opcje = (g.votingOptions ?? []).filter((o) => o && typeof o.votes === 'number');
  if (opcje.length === 0) return [];
  const prog = g.majorityVotes ?? 0;
  if (prog > 0) return opcje.filter((o) => o.votes >= prog).map((o) => o.option);
  const max = Math.max(...opcje.map((o) => o.votes));
  if (max <= 0) return [];
  return opcje.filter((o) => o.votes === max).map((o) => o.option);
}

/**
 * Jeden werdykt na jedno głosowanie: `majorityVotes > 0 ? yes >= majorityVotes : yes > no`.
 * Próg kwalifikowany (np. 64/15: 241 za, 198 przeciw, próg 266) znaczy „odrzucono",
 * choć „za" było więcej niż „przeciw".
 */
export function wynikGlosowania(g: GlosowanieSurowe): WynikGlosowania {
  const rodzaj = rodzajGlosowania(g);
  const wiekszosc = etykietaWiekszosci(g.majorityType);
  const prog =
    g.majorityType && g.majorityType !== 'SIMPLE_MAJORITY' && (g.majorityVotes ?? 0) > 0
      ? (g.majorityVotes as number)
      : null;

  if (rodzaj === 'kworum') {
    const obecnych = obecniNaApelu(g);
    const kworumJest = obecnych >= KWORUM;
    const apel = czyApelDowolnyPrzycisk(g.sitting, g.votingNumber, g.date);
    return {
      rodzaj,
      przeszlo: null,
      prog: null,
      obecnych,
      kworumJest,
      trybApelu: apel ? 'dowolny-przycisk' : 'obecny',
      ...(apel ? { apel } : {}),
      wybrani: [],
      // Tak jak w serwisie: „Kworum stwierdzone: N obecnych”; poniżej progu mówimy wprost, że kworum nie było.
      etykieta: kworumJest
        ? `Kworum stwierdzone: ${odmiana(obecnych, ['obecny', 'obecnych', 'obecnych'])}`
        : `Brak kworum: ${odmiana(obecnych, ['obecny', 'obecnych', 'obecnych'])} (< ${KWORUM})`,
      wiekszosc,
    };
  }

  if (rodzaj === 'lista') {
    const wybrani = wybraniZListy(g);
    return {
      rodzaj,
      przeszlo: null,
      prog,
      obecnych: null,
      wybrani,
      etykieta: wybrani.length > 0 ? `Wybrano: ${wybrani.map(nazwaZListy).join(', ')}` : 'Nikogo nie wybrano',
      wiekszosc,
    };
  }

  const przeszlo = (g.majorityVotes ?? 0) > 0 ? g.yes >= (g.majorityVotes as number) : g.yes > g.no;
  const senat = glosowanieSenackie(g);
  if (senat) {
    const r = rozstrzygniecieSenatu(senat, przeszlo, g.topic);
    return { rodzaj, przeszlo, prog, obecnych: null, senat, stanowiskoSenatuPrzyjete: r.stanowiskoSenatuPrzyjete, wybrani: [], etykieta: r.wynik, wiekszosc };
  }
  return {
    rodzaj,
    przeszlo,
    prog,
    obecnych: null,
    wybrani: [],
    etykieta: przeszlo ? 'Przyjęto' : 'Odrzucono',
    wiekszosc,
  };
}

// ---------------------------------------------------------------------------
// Głos jednego posła
// ---------------------------------------------------------------------------

export const GLOS = {
  ZA: 1,
  PRZECIW: 2,
  WSTRZYMAL: 3,
  NIEOBECNY: 4,
  OBECNY: 5,
  NIE_UCZESTNICZYL: 6,
} as const;

/**
 * Napis rejestru → kod głosu. Nieznana wartość rzuca wyjątek, bo serwis o nieobecnościach
 * nie może po cichu zaksięgować nieobecności, której nie było. `VOTE_VALID` (karta z listy)
 * obsługuje gałąź `ON_LIST` przed tym wywołaniem.
 */
export function kodGlosu(glos: string | null | undefined): number {
  switch ((glos || '').toUpperCase()) {
    case 'YES':
    case 'FOR':
    case 'ZA':
      return GLOS.ZA;
    case 'NO':
    case 'AGAINST':
    case 'PRZECIW':
      return GLOS.PRZECIW;
    case 'ABSTAIN':
    case 'WSTRZYMAŁ SIĘ':
      return GLOS.WSTRZYMAL;
    case 'ABSENT':
      return GLOS.NIEOBECNY;
    case 'PRESENT':
      return GLOS.OBECNY;
    case 'NOT_PARTICIPATING':
    // Starsze kadencje (np. III) zapisują to samo jako NO_VOTE; Sejm liczy je w notParticipating.
    case 'NO_VOTE':
      return GLOS.NIE_UCZESTNICZYL;
    default:
      throw new Error(`Nieznana wartość głosu w rejestrze: ${JSON.stringify(glos)}`);
  }
}

/**
 * Głos posła po polsku, rzeczownikiem, bez rodzaju gramatycznego: rejestr nie podaje płci,
 * a „wstrzymał się” przy posłance to błąd. Na apelu o kworum „obecność” jest udziałem.
 */
export function etykietaGlosu(
  glos: string | null | undefined,
  kind: string | null | undefined,
  kworum = false,
  senat: GlosowanieSenackie | null = null,
): string {
  if (kind === 'ON_LIST') {
    // ABSENT przy wyborze z listy to nieobecność jak w każdym innym głosowaniu, nie „karta nieoddana”.
    const kod = (glos ?? '').toUpperCase();
    if (kod === 'VOTE_VALID') return 'karta oddana';
    if (kod === 'VOTE_INVALID') return 'karta nieważna';
    if (kod === 'ABSENT') return 'nieobecność';
    if (kod === 'PRESENT') return 'obecność bez oddania karty';
    if (kod === 'NOT_PARTICIPATING' || kod === 'NO_VOTE') return 'nieuczestniczenie w głosowaniu';
    return 'karta nieoddana';
  }
  const kod = kodGlosu(glos);
  if (kworum) {
    // Apel o kworum w obu trybach: każde naciśnięcie to obecność, brak naciśnięcia to opuszczony apel.
    if (kod === GLOS.OBECNY) return 'obecność na apelu o kworum (to jest udział)';
    if (kod === GLOS.ZA || kod === GLOS.PRZECIW || kod === GLOS.WSTRZYMAL) {
      const przycisk = kod === GLOS.ZA ? 'za' : kod === GLOS.PRZECIW ? 'przeciw' : 'wstrzymuję się';
      return `obecność na apelu o kworum (naciśnięty przycisk „${przycisk}”; to potwierdzenie obecności, nie głos)`;
    }
    return 'opuszczony apel o kworum (nie wlicza się do nieobecności w głosowaniach)';
  }
  // Przy uchwale Senatu „za” to głos za ODRZUCENIEM stanowiska Senatu; gołe „przeciw” czytano jako „przeciw poprawce”.
  switch (kod) {
    case GLOS.ZA:
      return senat === 'poprawka-senatu'
        ? 'za odrzuceniem poprawki Senatu'
        : senat === 'uchwala-senatu-odrzucajaca-ustawe'
          ? 'za odrzuceniem uchwały Senatu (za utrzymaniem ustawy)'
          : 'za';
    case GLOS.PRZECIW:
      return senat === 'poprawka-senatu'
        ? 'przeciw odrzuceniu poprawki Senatu (za poprawką)'
        : senat === 'uchwala-senatu-odrzucajaca-ustawe'
          ? 'przeciw odrzuceniu uchwały Senatu (za odrzuceniem ustawy)'
          : 'przeciw';
    case GLOS.WSTRZYMAL:
      return 'wstrzymanie się';
    case GLOS.NIEOBECNY:
      return 'nieobecność';
    case GLOS.OBECNY:
      return 'obecność bez oddania głosu';
    default:
      return 'nieuczestniczenie w głosowaniu';
  }
}

// ---------------------------------------------------------------------------
// Rozbicie klubowe z dnia głosowania
// ---------------------------------------------------------------------------

/**
 * Wiersz imiennej listy. `club` to przynależność Z DNIA GŁOSOWANIA: dzisiejszy klub posła
 * dałby dla starych głosowań inny, fałszywy fakt.
 */
export interface GlosImienny {
  MP: number;
  club?: string | null;
  vote?: string | null;
  firstName?: string;
  lastName?: string;
  listVotes?: Record<string, string> | null;
}

export interface KubelkiKlubu {
  klub: string;
  za: number;
  przeciw: number;
  wstrzymanie: number;
  /** Był na sali, nie nacisnął. Na apelu o kworum to jest udział. */
  obecny: number;
  nieobecny: number;
  nieuczestniczacy: number;
  /** Wybór z listy: karty oddane przez klub. */
  zListy: number;
  /** Wybór z listy: karty nieważne (VOTE_INVALID). */
  niewazne: number;
}

const KLUB_NIEZNANY = 'bez klubu';

/** Rozbicie klubowe jednego głosowania, liczone z imiennej listy rejestru. */
export function rozkladKlubow(
  votes: readonly GlosImienny[] | null | undefined,
  kind: string | null | undefined,
): KubelkiKlubu[] {
  if (!Array.isArray(votes) || votes.length === 0) return [];
  const wg = new Map<string, KubelkiKlubu>();
  const zListy = kind === 'ON_LIST';

  for (const g of votes) {
    const nazwa = (g.club ?? '').trim() || KLUB_NIEZNANY;
    let k = wg.get(nazwa);
    if (!k) {
      k = { klub: nazwa, za: 0, przeciw: 0, wstrzymanie: 0, obecny: 0, nieobecny: 0, nieuczestniczacy: 0, zListy: 0, niewazne: 0 };
      wg.set(nazwa, k);
    }

    if (zListy) {
      // Kod głosu rozstrzyga: VOTE_VALID to karta oddana także bez żadnego wyboru, a ABSENT to
      // nieobecność, nie „brak karty” (1/1: 459 kart, 1 nieobecny z PiS). Bez kodu decydują wybory.
      const kod = (g.vote ?? '').toUpperCase();
      const wybory = g.listVotes && typeof g.listVotes === 'object' ? Object.keys(g.listVotes).length : 0;
      if (kod === 'VOTE_VALID' || (!kod && wybory > 0)) k.zListy++;
      else if (kod === 'VOTE_INVALID') k.niewazne++;
      else if (kod === 'PRESENT') k.obecny++;
      else if (kod === 'NOT_PARTICIPATING' || kod === 'NO_VOTE') k.nieuczestniczacy++;
      else if (wybory > 0) k.zListy++;
      else k.nieobecny++;
      continue;
    }

    switch (kodGlosu(g.vote)) {
      case GLOS.ZA:
        k.za++;
        break;
      case GLOS.PRZECIW:
        k.przeciw++;
        break;
      case GLOS.WSTRZYMAL:
        k.wstrzymanie++;
        break;
      case GLOS.NIEOBECNY:
        k.nieobecny++;
        break;
      case GLOS.OBECNY:
        k.obecny++;
        break;
      default:
        k.nieuczestniczacy++;
        break;
    }
  }

  return [...wg.values()].sort((a, b) => a.klub.localeCompare(b.klub, 'pl'));
}

// ---------------------------------------------------------------------------
// Poseł na apelu o kworum
// ---------------------------------------------------------------------------

/** Kody głosu, które przy apelu o kworum znaczą „był i nacisnął”: za, przeciw, wstrzymanie, obecny. */
export const KODY_OBECNOSCI_NA_APELU: ReadonlySet<number> = new Set([GLOS.ZA, GLOS.PRZECIW, GLOS.WSTRZYMAL, GLOS.OBECNY]);

/**
 * Poseł na apelu o kworum (oba tryby): każde naciśnięcie to obecność, brak naciśnięcia
 * (nieobecny, nieuczestniczący) to opuszczony apel. Tak samo jak w serwisie: obecność na apelu
 * nie jest oddanym głosem i nie wchodzi do mianownika, a opuszczony apel nie wchodzi do
 * publikowanej liczby nieobecności (stoi osobno).
 */
export function poselNaApelu(glos: string | null | undefined): 'obecny' | 'opuszczony' {
  return KODY_OBECNOSCI_NA_APELU.has(kodGlosu(glos)) ? 'obecny' : 'opuszczony';
}

/** Rozbicie klubowe apelu o kworum: ilu posłów klubu potwierdziło obecność, ilu apel opuściło. */
export function obecnosciNaApelu(kluby: readonly KubelkiKlubu[]): Array<{ klub: string; obecni: number; opuscili: number }> {
  return kluby.map((k) => ({
    klub: k.klub,
    obecni: k.za + k.przeciw + k.wstrzymanie + k.obecny,
    opuscili: k.nieobecny + k.nieuczestniczacy,
  }));
}
