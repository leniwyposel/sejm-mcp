import { z } from 'zod';
import type { ZrodloSejmu } from '../klient.js';
import { dataWarszawa, dzisWarszawa, odmiana } from '../reguly/daty.js';
import {
  apelDoPrzegladu,
  etykietaGlosu,
  glosowanieSenackie,
  KWORUM,
  nazwaZListy,
  obecnosciNaApelu,
  poselNaApelu,
  rozkladKlubow,
  wynikGlosowania,
  type WynikGlosowania,
  type GlosImienny,
  type GlosowanieSurowe,
  type KubelkiKlubu,
} from '../reguly/glosowania.js';
import {
  etapPunktu,
  krotkaNazwaPunktu,
  liniaGlosowania,
  POZOSTALE_GLOSOWANIA,
  POZOSTALE_GLOSOWANIA_PODPIS,
  punktyPorzadku,
  rozlozNaPunkty,
} from '../reguly/porzadek.js';
import { czysty, klucz } from '../tekst.js';
import {
  brak404, OPIS_CZESCIOWY,
  czesciowy,
  czesciowyZBledu,
  polaczCzesciowe,
  type WynikCzesciowy,
  data,
  jakoLista,
  jakoRekord,
  kadencja,
  kadencjaDnia,
  limit,
  maWszystkie,
  narzedzie,
  przesuniecie,
  rdzenie,
  rozwinSkroty,
  stanWgDat,
  T,
  UWAGA_RDZENIE,
  uwagaOKadencji,
  type Wynik,
} from './wspolne.js';

/**
 * Klient (Claude Code) zapisuje wynik dłuższy niż ok. 25 tys. znaków do pliku, a model widzi
 * z niego 2 KB podglądu (20-5: 50 KB z glosowania_posiedzenia, sześć wywołań zamiast jednego).
 */
export const MAKS_ZNAKOW = 20_000;

/**
 * Najdłuższa porcja listy, przy której cały wynik mieści się w {@link MAKS_ZNAKOW}. Co najmniej
 * jeden element, żeby stronicowanie zawsze szło naprzód.
 */
export function porcjaWRozmiarze<G>(lista: G[], wynik: (porcja: G[]) => unknown, zapas = 0): number {
  // Zapas na zdanie o skróceniu porcji, dopisywane już po wyborze długości (i na to, czego `wynik` nie składa).
  const granica = MAKS_ZNAKOW - 250 - zapas;
  const ile = (n: number) => JSON.stringify(wynik(lista.slice(0, n))).length;
  if (lista.length <= 1 || ile(lista.length) <= granica) return lista.length;
  let lo = 1;
  let hi = lista.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ile(mid) <= granica) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Kadencja wynikająca z dat zapytania. Domyślna 10 z dniem 2022-11-16 dawała „posiedzenie 66
 * zaplanowane” zamiast głosowań z IX kadencji (17-3): data jest konkretniejsza niż domyślna kadencja.
 */
function kadencjaZDat(k: number, ...daty: Array<string | undefined>): { kadencja: number; uwaga: string | null } {
  const podane = daty.filter((d): d is string => !!d);
  const kadencje = [...new Set(podane.map(kadencjaDnia).filter((x): x is number => x !== null))];
  if (kadencje.length === 0 || (kadencje.length === 1 && kadencje[0] === k)) return { kadencja: k, uwaga: null };
  if (kadencje.length === 1) {
    const kto = podane.length > 1 ? `Daty ${podane.join(' – ')} należą` : `Data ${podane[0]} należy`;
    return { kadencja: kadencje[0], uwaga: `${kto} do kadencji ${kadencje[0]}, nie ${k}: użyto kadencji ${kadencje[0]}.` };
  }
  return {
    kadencja: k,
    uwaga: `Zakres dat obejmuje kadencje ${kadencje.sort((x, y) => x - y).join(' i ')}; pokazano tylko kadencję ${k}. Resztę pobierz osobno z parametrem kadencja.`,
  };
}

/**
 * Numer druku z tekstu rejestru („druki nr 838, 1103 i 1103-A”, „Druk nr 930”, „dotyczące druku 930”).
 * Pierwszy numer to druk projektu; kolejne to sprawozdania komisji. Pięć ustaw „o zmianie ustawy
 * o świadczeniach opieki zdrowotnej…” różni się tylko drukiem (05-k3).
 */
export function drukZTekstu(...teksty: Array<string | null | undefined>): string | null {
  for (const t of teksty) {
    const m = /\bdruk(?:u|i|ów|ach)?\s+(?:nr\s+)?(\d+(?:-[A-Z])?)/iu.exec(t ?? '');
    if (m) return m[1];
  }
  return null;
}

interface GlosowanieZRejestru extends GlosowanieSurowe {
  sitting: number;
  sittingDay: number;
  votingNumber: number;
  votes?: GlosImienny[];
}

interface PosiedzenieZRejestru {
  number: number;
  title: string;
  dates: string[];
}

interface DzienGlosowan {
  proceeding: number;
  date: string;
  votingsNum: number;
}

const LICZBY_GLOSOWANIA = ['yes', 'no', 'abstain', 'present', 'notParticipating'];

const UWAGA_PROG =
  'Werdykt liczy się z progu rejestru: przy większości kwalifikowanej głosów „za” musi być co najmniej tyle, ile próg (progZa), a nie tylko więcej niż „przeciw”.';
const UWAGA_KWORUM =
  'Apel o kworum niczego nie przyjmuje. Ma dwa tryby: „obecny” (jedyny przycisk to „obecny”, wynik 0 za, 0 przeciw, 0 wstrzymań) ' +
  'i „dowolny przycisk” (marszałek prosi o naciśnięcie jakiegokolwiek przycisku; rejestr zapisuje to jak głosowanie, np. 33/5: 145 za, 47 przeciw, 237 wstrzymań, ' +
  'a stenogram i pole apel.cytat mówią, że to sprawdzenie obecności). W obu trybach każde naciśnięcie to obecność, nie głos za ani przeciw: ' +
  'obecnych to suma wszystkich naciśnięć. Brak naciśnięcia to opuszczony apel, który nie wlicza się do nieobecności w głosowaniach (statystyka Sejmu apeli nie liczy).';
const UWAGA_LISTA =
  'Wybór z listy (rodzaj „lista”) nie ma zbiorczych głosów za i przeciw, ale karta każdego posła niesie jego głos przy każdym kandydacie: ' +
  'pole wybory w glosPosla i w liście imiennej. Kandydat to napis z rejestru (bywa sam inicjał imienia): nie dopisuj imienia, którego tam nie ma.';
const UWAGA_NIEGLOSOWALO = 'nieglosowalo to liczba Sejmu „nie głosowało”: posłowie nieobecni i nieuczestniczący razem.';
const UWAGA_SENAT =
  'Przy uchwale Senatu Sejm głosuje WNIOSEK O ODRZUCENIE poprawki (albo uchwały Senatu odrzucającej ustawę), bezwzględną większością (art. 121 ust. 3 Konstytucji). ' +
  'przeszlo mówi o tym wniosku: przeszlo=false znaczy, że poprawka Senatu jest PRZYJĘTA. Głos „za” to głos za odrzuceniem poprawki, „przeciw” to głos za poprawką. ' +
  'Wynik podaje pole rozstrzygniecie; po poprawkach Senatu nie ma już głosowania nad całością ustawy.';
const UWAGA_APELE_STATYSTYKA =
  'Liczby głosowań w rejestrze obejmują apele o kworum, a statystyka Sejmu (profil_posla, /MP/{id}/votings/stats) z reguły ich nie liczy; ' +
  'porównując z nią, odejmij apele o kworum.';

/** Tytuł rekordu bywa tytułem całego posiedzenia; wtedy nic nie mówi o głosowaniu. */
function tytulPunktu(tytul: string | null | undefined): string | null {
  const t = czysty(tytul);
  return t && !/^\d+\.\s*posiedzenie\b/i.test(t) ? t : null;
}

/**
 * Głosowanie nad wetem Prezydenta („wniosek Prezydenta o ponowne rozpatrzenie ustawy”): samo
 * „Odrzucono” model czytał jako odrzucenie wniosku Prezydenta, czyli odwrotnie. Tu mówimy wprost.
 */
export function rozstrzygniecieWeta(g: GlosowanieSurowe): string | null {
  const tekst = `${g.topic ?? ''} ${g.description ?? ''} ${g.title ?? ''}`;
  if (!/ponown\w* rozpatrzeni|ponownym uchwaleniem|ponownie uchwali/i.test(tekst)) return null;
  const w = wynikGlosowania(g);
  if (w.przeszlo === null) return null;
  return w.przeszlo
    ? 'Sejm ponownie uchwalił ustawę: weto Prezydenta odrzucone'
    : `Sejm NIE uchwalił ponownie ustawy (brak wymaganej większości${w.prog ? `, za ${g.yes} przy progu ${w.prog}` : ''}): weto Prezydenta utrzymane. ` +
        'Próg 3/5 liczy się od głosujących, przy obecności co najmniej połowy ustawowej liczby posłów, a nie od 460 posłów';
}

/** Głosowanie w skrócie: to, co wystarcza do listy. */
function skrotGlosowania(g: GlosowanieZRejestru) {
  const w = wynikGlosowania(g);
  const weto = rozstrzygniecieWeta(g);
  const senat = w.senat ?? null;
  const punkt = tytulPunktu(g.title);
  const dataUstawy = weto ? dataZTytulu(punkt ?? g.description ?? '') : null;
  return {
    // Gotowy identyfikator: model składający go sam odwracał kolejność („75/10” zamiast 46/75).
    glosowanie: `${g.sitting}/${g.votingNumber}`,
    posiedzenie: g.sitting,
    numer: g.votingNumber,
    data: g.date,
    temat: czysty(g.topic),
    opis: czysty(g.description),
    akt: /przepisy wprowadzające/i.test(`${punkt ?? ''} ${g.description ?? ''}`) ? 'przepisy wprowadzające' : punkt ? 'ustawa lub uchwała' : null,
    punkt,
    druk: drukZTekstu(g.title, g.topic, g.description),
    // „zwykle” myliło się ze „zwykłą większością”; to jest forma głosowania, nie rodzaj większości.
    rodzaj: w.rodzaj === 'zwykle' ? 'za-przeciw' : w.rodzaj,
    wiekszosc: w.wiekszosc,
    ...(weto ? { rozstrzygniecie: weto, ...(dataUstawy ? { dataUchwaleniaUstawy: dataUstawy } : {}) } : {}),
    ...(senat
      ? {
          przedmiotGlosowania: senat === 'poprawka-senatu' ? 'wniosek o odrzucenie poprawki Senatu' : 'wniosek o odrzucenie uchwały Senatu odrzucającej ustawę',
          rozstrzygniecie: w.etykieta,
          stanowiskoSenatuPrzyjete: w.stanowiskoSenatuPrzyjete,
        }
      : {}),
    // Przy apelu o kworum żadne „stwierdzone” ani „przeszło”: model czytał to jako przyjęcie.
    // Przy wecie samo „Odrzucono” czytano jako „odrzucono weto”, czyli odwrotnie.
    wynik:
      w.rodzaj === 'kworum'
        ? opisApelu(w)
        : weto
          ? w.przeszlo
            ? 'Uchwalono ponownie: weto odrzucone'
            : 'Nie uchwalono ponownie: weto utrzymane'
          : w.etykieta,
    przeszlo: w.przeszlo,
    ...(w.rodzaj === 'kworum'
      ? {
          kworumJest: w.kworumJest,
          obecnych: w.obecnych,
          trybApelu: w.trybApelu,
          ...(w.apel ? { apel: { cytat: w.apel.cytat, stenogram: w.apel.stenogram } } : {}),
        }
      : {}),
    ...(() => {
      const ostrzezenie = apelDoPrzegladu(g);
      return ostrzezenie ? { doSprawdzenia: ostrzezenie } : {};
    })(),
    progZa: w.prog,
    // Przy wyborze z listy za/przeciw/wstrzymało nie istnieją (rejestr podaje zera): pokazujemy kandydatów.
    ...(w.rodzaj === 'lista'
      ? {
          kandydaci: (g.votingOptions ?? []).map((o) => ({ kandydat: nazwaZListy(o.option), glosow: o.votes })),
          wybrani: w.wybrani.map(nazwaZListy),
          przeciwWszystkim: g.againstAll ?? null,
          glosowalo: g.totalVoted,
        }
      : w.rodzaj === 'kworum'
        ? // Na apelu przycisk nie jest głosem: pokazujemy, co naciśnięto, pod nazwą, która tego nie udaje.
          { nacisniecia: { za: g.yes, przeciw: g.no, wstrzymanie: g.abstain, obecny: g.present } }
        : { za: g.yes, przeciw: g.no, wstrzymalo: g.abstain, obecniBezGlosu: g.present }),
    nieglosowalo: g.notParticipating,
  };
}

type SkrotGlosowania = ReturnType<typeof skrotGlosowania>;

/**
 * Rekord do listy bez pól, które nic nie mówią: posiedzenie jest w identyfikatorze, a puste
 * i domyślne wartości przy 69 głosowaniach dawały kilka tysięcy znaków (20-5). punkt zostaje
 * zawsze, bo jego brak (tytuł posiedzenia zamiast punktu) też jest informacją.
 */
function zwiezle(g: SkrotGlosowania): Record<string, unknown> {
  const wynik: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    if (k === 'posiedzenie') continue;
    if (v === null && k !== 'punkt') continue;
    if (k === 'wiekszosc' && v === 'większość zwykła') continue;
    if (k === 'akt' && v === 'ustawa lub uchwała') continue;
    if (k === 'rozstrzygniecie' && v === g.wynik) continue;
    wynik[k] = v;
  }
  return wynik;
}

const UWAGA_ZWIEZLE =
  'Rekordy listy są skrócone: brak pola wiekszosc znaczy większość zwykła, brak progZa: bez progu kwalifikowanego, ' +
  'brak akt przy punkcie: ustawa lub uchwała (inaczej akt = „przepisy wprowadzające”), brak opis albo druk: rejestr ich nie podał. ' +
  'druk to pierwszy numer druku z tytułu (projekt); ten sam tytuł z innym drukiem to inny akt.';

/** Czy głos dotyczy uchwały Senatu (etykieta niesie to już w sobie). */
function senackieZTekstu(g: { glos: string }): boolean {
  return /Senatu/.test(g.glos);
}

/**
 * „apel o kworum: nic nie jest przyjmowane ani odrzucane; kworum stwierdzone: 342 obecnych”.
 * Obecni to WSZYSTKIE naciśnięcia (w trybie „dowolny przycisk” także za, przeciw i wstrzymania).
 */
function opisApelu(w: WynikGlosowania): string {
  const tryb = w.trybApelu === 'dowolny-przycisk' ? ' w trybie „dowolny przycisk” (każde naciśnięcie to obecność, nie głos)' : '';
  const prog = w.kworumJest ? ` (≥ ${KWORUM}, połowa ustawowej liczby posłów)` : ', połowa ustawowej liczby posłów';
  return `apel o kworum${tryb}: nic nie jest przyjmowane ani odrzucane; ${w.etykieta.charAt(0).toLowerCase()}${w.etykieta.slice(1)}${prog}`;
}

/**
 * Gotowe zdanie o głosowaniu: werdykt z liczbami i progiem, żeby model przepisywał, a nie liczył.
 * Badania i nasze testy zgadzają się: każde wyliczenie zostawione modelowi to miejsce na błąd.
 */
export function zdanieOGlosowaniu(g: GlosowanieSurowe & { sitting: number; votingNumber: number }): string {
  const w = wynikGlosowania(g);
  const kiedy = dataWarszawa(g.date);
  const nr = `Głosowanie ${g.sitting}/${g.votingNumber} (${kiedy})`;
  if (w.rodzaj === 'kworum') return `${nr} to ${opisApelu(w)}.`;
  if (w.rodzaj === 'lista') {
    const wybrani = w.wybrani.map(nazwaZListy);
    return (
      `${nr} to wybór z listy: ${wybrani.length ? `wybrani: ${wybrani.join(', ')}` : 'nikogo nie wybrano'}` +
      `${w.prog ? `; próg ${w.prog}` : ''}; głosowało ${g.totalVoted}${g.againstAll != null ? `, przeciw wszystkim ${g.againstAll}` : ''}.`
    );
  }
  const liczby = `za ${g.yes}, przeciw ${g.no}, wstrzymało się ${g.abstain}`;
  const prog = w.prog ? `; wymagane co najmniej ${w.prog} za (${w.wiekszosc})` : '';
  const weto = rozstrzygniecieWeta(g);
  if (weto) return `${nr} nad wetem Prezydenta: ${liczby}${prog}. Rozstrzygnięcie: ${weto}.`;
  if (w.senat === 'poprawka-senatu') {
    return `${nr} nad poprawką Senatu (głosowano wniosek o jej odrzucenie; „za” znaczy za odrzuceniem poprawki): ${liczby}${prog}. Rozstrzygnięcie: ${w.etykieta}.`;
  }
  if (w.senat) return `${nr} nad uchwałą Senatu odrzucającą ustawę (głosowano wniosek o odrzucenie tej uchwały): ${liczby}${prog}. Rozstrzygnięcie: ${w.etykieta}.`;
  return `${nr}: ${liczby}${prog}. Wynik: ${w.przeszlo ? 'przyjęto' : 'odrzucono'}.`;
}

/** Bliźniacze głosowania jako pole na wierzchu wyniku, nie uwaga na końcu (model przeoczał uwagi). */
type DoNiejednoznacznych = {
  glosowanie: string;
  data: string;
  temat: string | null;
  opis: string | null;
  akt: string | null;
  punkt: string | null;
  druk: string | null;
};

/**
 * Przedmiot aktu z tytułu punktu, bez numeru punktu, druków, etapu i części po „oraz”:
 * „ustawy o zmianie ustawy o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych”.
 */
function przedmiotAktu(punkt: string | null): string | null {
  if (!punkt) return null;
  const t = punkt.replace(/^Pkt\.?\s*\d+[a-z]?\s+/iu, '').replace(/\s*\(druk[^)]*\).*$/isu, '');
  const m = /projek\S*\s+((?:ustawy|uchwały)\s.+)$/iu.exec(t);
  return (m ? m[1] : t).split(/\s+oraz\s+/u)[0].trim().toLocaleLowerCase('pl-PL') || null;
}

/** Bliźniacze głosowania jako pole na wierzchu wyniku, nie uwaga na końcu (model przeoczał uwagi). */
function niejednoznaczneGlosowania(lista: DoNiejednoznacznych[], pelna: DoNiejednoznacznych[] = lista) {
  const powody: string[] = [];
  const wskazane = new Map<string, DoNiejednoznacznych>();

  const tegoDnia = new Map<string, DoNiejednoznacznych[]>();
  for (const g of lista) {
    const k = `${g.data.slice(0, 10)}|${g.temat ?? ''}`;
    tegoDnia.set(k, [...(tegoDnia.get(k) ?? []), g]);
  }
  const blizniaki = [...tegoDnia.values()].filter((x) => x.length > 1).flat();
  if (blizniaki.length) {
    powody.push('Kilka głosowań tego samego dnia ma ten sam temat, ale dotyczy różnych aktów albo różnych etapów.');
    for (const g of blizniaki) wskazane.set(g.glosowanie, g);
  }

  // Całość ustaw o tym samym tytule z różnych dni (05-k3: pięć nowelizacji ustawy o świadczeniach
  // opieki zdrowotnej, 32/17 … 60/60) to RÓŻNE ustawy; odróżnia je druk, nie tytuł. Liczone ze
  // wszystkich trafień, gdy są pod ręką: bliźniak spoza porcji też myli.
  const calosci = new Map<string, DoNiejednoznacznych[]>();
  for (const g of pelna) {
    const t = `${g.opis ?? ''} ${g.temat ?? ''}`;
    // Wniosek o odrzucenie „w całości” to inny etap tego samego druku, nie osobny akt.
    if (!/całoś\S* projektu/iu.test(t) || /odrzuceni/iu.test(t)) continue;
    const k = przedmiotAktu(g.punkt);
    if (k) calosci.set(k, [...(calosci.get(k) ?? []), g]);
  }
  const rozne = [...calosci.values()].filter(
    (x) => x.length > 1 && (new Set(x.map((g) => g.data.slice(0, 10))).size > 1 || new Set(x.map((g) => g.druk)).size > 1),
  );
  if (rozne.length) {
    powody.push(
      `Głosowania nad całością aktów o takim samym tytule z różnych dni albo druków to RÓŻNE akty: ${rozne
        .map((x) => x.map((g) => `${g.glosowanie} (${g.data.slice(0, 10)}, druk ${g.druk ?? 'nie podano'})`).join(', '))
        .join('; ')}.`,
    );
    for (const g of rozne.flat()) wskazane.set(g.glosowanie, g);
  }
  if (!powody.length) return undefined;
  return {
    powod: powody.join(' '),
    // Bez pełnego tytułu punktu: jest w liście glosowania, a tu powtarzany zjadał 6 tys. znaków (20-5).
    glosowania: [...wskazane.values()].map((g) => ({ glosowanie: g.glosowanie, data: g.data.slice(0, 10), akt: g.akt, druk: g.druk })),
    coZrobic:
      'Wybierz głosowanie, którego akt, druk, data i punkt pasują do pytania, i napisz, które wybrałeś i dlaczego (podaj numer druku); ' +
      'jeśli pytanie nie rozstrzyga, zapytaj użytkownika. Treść druku i proces daje szukaj_procesow albo druk.',
  };
}

const MIESIACE: Record<string, string> = {
  stycznia: '01', lutego: '02', marca: '03', kwietnia: '04', maja: '05', czerwca: '06',
  lipca: '07', sierpnia: '08', września: '09', października: '10', listopada: '11', grudnia: '12',
};

/** „… ustawy z dnia 7 listopada 2025 r. …” → „2025-11-07”: data uchwalenia ustawy, nie weta. */
function dataZTytulu(tekst: string): string | null {
  const m = /ustaw\S* z dnia (\d{1,2}) (\p{L}+) (\d{4})/iu.exec(tekst);
  const mies = m ? MIESIACE[m[2].toLowerCase()] : undefined;
  return m && mies ? `${m[3]}-${mies}-${m[1].padStart(2, '0')}` : null;
}

/** Najnowsze dni najpierw, ale w obrębie dnia kolejność rejestru (rosnąco po numerze). */
function porzadekDnia<T extends { data: string; numer: number }>(lista: T[]): T[] {
  return [...lista].sort((x, y) => y.data.slice(0, 10).localeCompare(x.data.slice(0, 10)) || x.numer - y.numer);
}

/** Pytanie o ustawę: głosowania nad „Przepisami wprowadzającymi” tę ustawę idą za nią, nie przed. */
function wprowadzajaceNaKoniec<T extends { punkt: string | null; opis: string | null }>(lista: T[], fraza: string | undefined): T[] {
  if (fraza && /wprowadzaj/i.test(fraza)) return lista;
  const wprow = (g: T) => /przepisy wprowadzające/i.test(`${g.punkt ?? ''} ${g.opis ?? ''}`);
  return [...lista.filter((g) => !wprow(g)), ...lista.filter(wprow)];
}

/** Lata wpisane we frazę („ustawy budżetowej na rok 2025”). */
function lataZFrazy(fraza: string | undefined): string[] {
  return [...new Set(fraza?.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) ?? [])];
}

/**
 * Rok z frazy musi być w tytule. Rdzeń „2025” to „202”, więc bez tego filtra pytanie o budżet
 * na 2025 pokazywało na górze głosowania o budżecie na 2026.
 */
function tylkoZRokiem<G>(lista: G[], lata: string[], tekst: (g: G) => string): { lista: G[]; uwaga: string | null } {
  if (!lata.length) return { lista, uwaga: null };
  const zRokiem = lista.filter((g) => lata.some((r) => tekst(g).includes(r)));
  if (zRokiem.length === lista.length) return { lista, uwaga: null };
  if (!zRokiem.length) return { lista, uwaga: `Żaden znaleziony tytuł nie zawiera roku ${lata.join(', ')} z frazy: sprawdź, czy to na pewno ten akt.` };
  return {
    lista: zRokiem,
    uwaga: `Fraza zawiera rok ${lata.join(', ')}: pominięto ${lista.length - zRokiem.length} tytułów bez tego roku (np. ten sam rodzaj ustawy na inny rok).`,
  };
}

/** Dwa głosowania tego dnia z tym samym tematem dotyczą zwykle RÓŻNYCH aktów (ustawa i jej przepisy wprowadzające). */
function uwagaBlizniaki(lista: Array<{ data: string; temat: string | null }>): string | null {
  const klucze = lista.map((g) => `${g.data.slice(0, 10)}|${g.temat ?? ''}`);
  return klucze.some((k, i) => klucze.indexOf(k) !== i)
    ? 'Kilka głosowań tego samego dnia ma ten sam temat, ale dotyczy RÓŻNYCH aktów: pole akt mówi, które jest nad ustawą, a które nad jej przepisami wprowadzającymi. ' +
        'Na pytanie o ustawę bierz akt ≠ „przepisy wprowadzające”. Porównując kilka głosowań, przy każdym podawaj jego numer i jego własne progZa.'
    : null;
}

/** Uwagi tylko o tym, co w tej odpowiedzi faktycznie występuje. */
function uwagiDoGlosowan(lista: ReturnType<typeof skrotGlosowania>[]): string[] {
  const uwagi = [UWAGA_NIEGLOSOWALO];
  if (lista.some((g) => g.progZa !== null)) uwagi.push(UWAGA_PROG);
  if (lista.some((g) => g.rodzaj === 'kworum')) uwagi.push(UWAGA_KWORUM);
  if (lista.some((g) => g.rodzaj === 'lista')) uwagi.push(UWAGA_LISTA);
  if (lista.some((g) => 'przedmiotGlosowania' in g)) uwagi.push(UWAGA_SENAT);
  for (const g of lista) if ('doSprawdzenia' in g && g.doSprawdzenia) uwagi.push(g.doSprawdzenia);
  return uwagi;
}

function bilans(lista: ReturnType<typeof skrotGlosowania>[]) {
  // Głosowania nad uchwałami Senatu liczymy osobno: „odrzucono” przy wniosku o odrzucenie poprawki
  // znaczy, że poprawkę PRZYJĘTO, więc w jednym worku z projektami bilans kłamałby w obie strony.
  const senackie = lista.filter((g) => 'przedmiotGlosowania' in g);
  const poprawki = senackie.filter((g) => g.przedmiotGlosowania === 'wniosek o odrzucenie poprawki Senatu');
  const zwykle = lista.filter((g) => g.rodzaj === 'za-przeciw' && !('przedmiotGlosowania' in g));
  return {
    wszystkich: lista.length,
    przyjetych: zwykle.filter((g) => g.przeszlo === true).length,
    odrzuconych: zwykle.filter((g) => g.przeszlo === false).length,
    nadUchwalamiSenatu: {
      glosowan: senackie.length,
      glosowanNadPoprawkami: poprawki.length,
      // Liczymy GŁOSOWANIA, nie poprawki: jedno głosowanie obejmuje czasem kilka poprawek
      // („poprawki nr 1-2 i 4”, 26/47), więc nazwa pola nie może udawać liczby poprawek (05-b).
      glosowanPoprawkaPrzyjeta: poprawki.filter((g) => g.stanowiskoSenatuPrzyjete === true).length,
      glosowanPoprawkaOdrzucona: poprawki.filter((g) => g.stanowiskoSenatuPrzyjete === false).length,
      nadOdrzuceniemUstawy: senackie.length - poprawki.length,
    },
    apeliOKworum: lista.filter((g) => g.rodzaj === 'kworum').length,
    kworum: lista
      .filter((g) => g.rodzaj === 'kworum')
      .map((g) => ({ glosowanie: `${g.posiedzenie}/${g.numer}`, obecnych: 'obecnych' in g ? g.obecnych : null, kworumJest: 'kworumJest' in g ? g.kworumJest : null })),
    wyborowZListy: lista.filter((g) => g.rodzaj === 'lista').length,
    nadCaloscia: {
      ustaw: nadCaloscia(lista, /całoś\S* projektu ustawy/iu),
      uchwal: nadCaloscia(lista, /całoś\S* projektu uchwały/iu),
    },
  };
}

/** Głosowania nad całością jednego rodzaju: ile, ile przyjęto, które (liczone z całego posiedzenia). */
function nadCaloscia(lista: ReturnType<typeof skrotGlosowania>[], wzor: RegExp) {
  const te = lista.filter((g) => wzor.test(`${g.opis ?? ''} ${g.temat ?? ''}`));
  return {
    razem: te.length,
    przyjetych: te.filter((g) => g.przeszlo === true).length,
    odrzuconych: te.filter((g) => g.przeszlo === false).length,
    glosowania: te.map((g) => `${g.posiedzenie}/${g.numer}`),
  };
}

function klubPoPolsku(k: KubelkiKlubu, lista: boolean) {
  // „bezKarty” zlewało nieobecność z brakiem karty; model pisał „1 bez karty”, a rejestr ma ABSENT (03-2).
  return lista
    ? {
        klub: k.klub,
        kartOddanych: k.zListy,
        nieobecni: k.nieobecny,
        ...(k.niewazne ? { kartNiewaznych: k.niewazne } : {}),
        ...(k.obecny ? { obecniBezKarty: k.obecny } : {}),
        ...(k.nieuczestniczacy ? { nieuczestniczacy: k.nieuczestniczacy } : {}),
      }
    : {
        klub: k.klub,
        za: k.za,
        przeciw: k.przeciw,
        wstrzymalo: k.wstrzymanie,
        obecniBezGlosu: k.obecny,
        nieobecni: k.nieobecny,
        nieuczestniczacy: k.nieuczestniczacy,
      };
}

/** Przegląd `lista_posiedzen` bez od/do: tyle ostatnich odbytych posiedzeń (jak serwer hostowany). */
export const OSTATNICH_POSIEDZEN = 10;
/** …i tyle najbliższych terminów bez numeru, gdy planowane=true. */
export const NAJBLIZSZYCH_TERMINOW = 3;

/**
 * Ostatnie {@link OSTATNICH_POSIEDZEN} posiedzeń, które się zaczęły (zakończone albo trwające), najbliższe
 * zapowiedziane z numerem i, przy planowane, kilka terminów bez numeru. Kolejność wejścia (po pierwszym dniu).
 */
function przeglad<P extends { numer: number | null; stan: string }>(lista: P[], planowane: boolean): P[] {
  const odbyte = lista.filter((p) => p.numer !== null && p.stan !== 'zaplanowane').slice(-OSTATNICH_POSIEDZEN);
  const nastepne = lista.find((p) => p.numer !== null && p.stan === 'zaplanowane');
  const terminy = planowane ? lista.filter((p) => p.numer === null).slice(0, NAJBLIZSZYCH_TERMINOW) : [];
  const wybrane = new Set<P>([...odbyte, ...(nastepne ? [nastepne] : []), ...terminy]);
  return lista.filter((p) => wybrane.has(p));
}

export const listaPosiedzen = narzedzie({
  nazwa: 'lista_posiedzen',
  tytul: 'Posiedzenia Sejmu',
  opis:
    'Posiedzenia Sejmu danej kadencji: numer, daty, stan (zakończone, trwa, zaplanowane) i liczba głosowań w każdym dniu. ' +
    `Podaje też numer ostatniego zakończonego posiedzenia. Bez od/do lista ma ${OSTATNICH_POSIEDZEN} ostatnich posiedzeń i najbliższe ` +
    '(sumy w polu sumy dalej obejmują całą kadencję); całą kadencję daje wszystkie=true, a konkretny okres od/do. ' +
    'Porządek obrad z głosowaniami pod każdym punktem: glosowania_posiedzenia z porzadek=true.',
  wejscie: z.object({
    od: data.optional().describe('Tylko posiedzenia z dniami od tej daty'),
    do: data.optional().describe('Tylko posiedzenia z dniami do tej daty'),
    planowane: z.boolean().default(false).describe('Dołącz posiedzenia zaplanowane, jeszcze bez numeru'),
    wszystkie: z
      .boolean()
      .default(false)
      .describe(`Bez od/do: wszystkie posiedzenia kadencji (ok. 11 tys. znaków). Domyślnie ${OSTATNICH_POSIEDZEN} ostatnich i najbliższe`),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const kz = kadencjaZDat(a.kadencja, a.od, a.do);
    const k = kz.kadencja;
    const sP = `${T(k)}/proceedings`;
    const sG = `${T(k)}/votings`;
    const [posiedzenia, dni] = await Promise.all([
      zrodlo.json<unknown>(sP).then((x) => jakoLista<PosiedzenieZRejestru>(x, 'posiedzenia')),
      zrodlo.json<unknown>(sG).then((x) => jakoLista<DzienGlosowan>(x, 'dni głosowań')),
    ]);
    const glosowanWDniu = new Map<string, number>();
    for (const d of dni) glosowanWDniu.set(`${d.proceeding}|${d.date}`, d.votingsNum);
    const wszystkie = posiedzenia
      .filter((p) => a.planowane || p.number > 0)
      .map((p) => ({
        numer: p.number > 0 ? p.number : null,
        // „66. posiedzenie Sejmu RP w dniach 6, 7 i 8 października 2026 r.” powtarza numer i dni (6 tys. znaków na kadencję).
        ...(/^(planowane\s+)?(\d+\.\s*)?posiedzenie sejmu/iu.test(czysty(p.title) ?? '') ? {} : { tytul: czysty(p.title) }),
        stan: stanWgDat(p.dates ?? []),
        dni: [...(p.dates ?? [])].sort().map((d): { data: string; glosowan: number; apeliOKworum?: number; glosowanBezApeli?: number } => ({
          data: d,
          glosowan: glosowanWDniu.get(`${p.number}|${d}`) ?? 0,
        })),
      }))
      // Rejestr oddaje zaplanowane w swojej kolejności (27–29 I 2027 przed 13–15 I 2027, 19-4): sortujemy po pierwszym dniu.
      .sort((x, y) => (x.dni[0]?.data ?? '9999').localeCompare(y.dni[0]?.data ?? '9999') || (x.numer ?? 0) - (y.numer ?? 0));
    const ostatnie = wszystkie.filter((p) => p.stan === 'zakończone' && p.numer !== null).at(-1);
    const wZakresie = (d: string) => (!a.od || d >= a.od) && (!a.do || d <= a.do);
    const wybrane = wszystkie.filter((p) => p.dni.some((d) => wZakresie(d.data)));
    // Liczba dnia z rejestru obejmuje apele o kworum, a statystyka Sejmu z reguły ich nie liczy (61. posiedzenie,
    // 3 VII 2026: 68 w rejestrze, 67 w statystyce). Przy wąskim zakresie liczymy apele z głosowań posiedzenia.
    const zGlosowaniami = wybrane.filter((p) => p.numer !== null && p.dni.some((d) => d.glosowan > 0));
    const zrodlaApeli: string[] = [];
    let czesciowyApeli: WynikCzesciowy | undefined;
    if (zGlosowaniami.length > 0 && zGlosowaniami.length <= 3) {
      for (const p of zGlosowaniami) {
        const sV = `${T(k)}/votings/${p.numer}`;
        const glosowania = await zrodlo
          .json<unknown>(sV)
          .then((x) => jakoLista<GlosowanieZRejestru>(x, 'głosowania posiedzenia'))
          .catch((e: unknown) => {
            // Apele są dodatkiem: liczby dni i głosowań zostają, ale mówimy, czego brak.
            czesciowyApeli = czesciowyZBledu(
              e,
              `liczby apeli o kworum (apeliOKworum, glosowanBezApeli) przy dniach ${p.numer}. posiedzenia; pozostałe liczby są pełne`,
              `zapytać ponownie za kilka minut albo użyć glosowania_posiedzenia dla posiedzenia ${p.numer}`,
            );
            return null;
          });
        if (!glosowania) continue;
        zrodlaApeli.push(zrodlo.adres(sV));
        for (const d of p.dni) {
          const apele = glosowania.filter((g) => dataWarszawa(g.date) === d.data && typeof g.yes === 'number' && wynikGlosowania(g).rodzaj === 'kworum').length;
          d.apeliOKworum = apele;
          d.glosowanBezApeli = d.glosowan - apele;
        }
      }
    }

    // Sumy liczymy tu, bo model sumował dni sam i się mylił (06-1: 65 zamiast 67). Tylko dni w zakresie
    // i tylko posiedzenia z numerem; dzień dwóch posiedzeń (5 XII 2025: 46. i 47.) liczy się raz w unikalneDni.
    const dzis = dzisWarszawa();
    const dniWZakresie = wybrane.filter((p) => p.numer !== null).flatMap((p) => p.dni.filter((d) => wZakresie(d.data)).map((d) => ({ numer: p.numer!, ...d })));
    const odbyte = dniWZakresie.filter((d) => d.data <= dzis);
    const unikalne = new Set(odbyte.map((d) => d.data));
    const wspolne = [...unikalne].filter((d) => odbyte.filter((x) => x.data === d).length > 1).sort();
    const sumy = {
      posiedzen: wybrane.filter((p) => p.numer !== null).length,
      dniObrad: odbyte.length,
      unikalneDni: unikalne.size,
      ...(wspolne.length ? { dniDwochPosiedzen: wspolne } : {}),
      dniZaplanowane: dniWZakresie.length - odbyte.length,
      glosowan: odbyte.reduce((s, d) => s + d.glosowan, 0),
    };

    const uwagi: string[] = [];
    if (kz.uwaga) uwagi.push(kz.uwaga);
    if (a.od && a.do && a.od > a.do) uwagi.push(`Data do (${a.do}) jest wcześniejsza niż od (${a.od}), więc nic nie pasuje; zamień je miejscami.`);
    if (zGlosowaniami.length) {
      uwagi.push(
        'dni[].glosowan to liczba z rejestru RAZEM z apelami o kworum; statystyka Sejmu (profil_posla) apeli z reguły nie liczy. ' +
          (zrodlaApeli.length
            ? 'Przy dniach podano apeliOKworum i glosowanBezApeli.'
            : 'Liczbę apeli podaje glosowania_posiedzenia (bilans.apeliOKworum); zawęź od/do do 1–3 posiedzeń, a policzę je tutaj.'),
      );
    }
    // Pusty zakres: sąsiedzi względem pytanej daty, nie względem dziś (06-2: 10 IX 2026 między 64. a 65.).
    const zakresPodany = !!(a.od || a.do);
    const krotko = (p: (typeof wszystkie)[number] | undefined) => (p ? { numer: p.numer, stan: p.stan, dni: p.dni.map((d) => d.data) } : null);
    const sasiedzi =
      zakresPodany && sumy.posiedzen === 0
        ? {
            przedZakresem: krotko(wszystkie.filter((p) => p.numer !== null && a.od && p.dni.some((d) => d.data < a.od!)).at(-1)),
            poZakresie: krotko(wszystkie.find((p) => p.numer !== null && a.do && p.dni.some((d) => d.data > a.do!))),
          }
        : null;
    const zakres = a.od && a.do ? `od ${a.od} do ${a.do}` : a.od ? `od ${a.od}` : a.do ? `do ${a.do}` : 'cała kadencja';
    const odpowiedz =
      sumy.posiedzen === 0
        ? `Kadencja ${k}, ${zakres}: brak posiedzeń Sejmu` +
          (sasiedzi
            ? `${sasiedzi.przedZakresem ? `; najbliższe wcześniej: ${sasiedzi.przedZakresem.numer}. (${sasiedzi.przedZakresem.dni.join(', ')})` : ''}` +
              `${sasiedzi.poZakresie ? `; najbliższe później: ${sasiedzi.poZakresie.numer}. (${sasiedzi.poZakresie.dni.join(', ')})` : ''}`
            : '') +
          '.'
        : `Kadencja ${k}, ${zakres}: ${odmiana(sumy.posiedzen, ['posiedzenie', 'posiedzenia', 'posiedzeń'])} z numerem ` +
          (sumy.posiedzen === 1
            ? `(${wybrane.find((p) => p.numer !== null)!.numer}.); `
            : `(od ${wybrane.find((p) => p.numer !== null)!.numer}. do ${wybrane.filter((p) => p.numer !== null).at(-1)!.numer}.); `) +
          `dni obrad, które już minęły: ${sumy.dniObrad} (różnych dat ${sumy.unikalneDni}` +
          `${wspolne.length ? `; ${wspolne.join(', ')} to dzień dwóch posiedzeń` : ''})` +
          `${sumy.dniZaplanowane ? `; dni zaplanowanych jeszcze ${sumy.dniZaplanowane}` : ''}; głosowań w tych dniach ${sumy.glosowan} (razem z apelami o kworum).`;
    // Przegląd bez od/do: ostatnie odbyte i najbliższe, a nie 66 posiedzeń (ok. 11 tys. znaków) przy każdym pytaniu
    // „kiedy następne posiedzenie”. Sumy wyżej zostają policzone z całej kadencji.
    const skrocona = !zakresPodany && !a.wszystkie;
    const pokazane = skrocona ? przeglad(wybrane, a.planowane) : wybrane;
    if (skrocona && pokazane.length < wybrane.length) {
      uwagi.push(
        `Lista posiedzeń jest skrócona: ${pokazane.length} z ${wybrane.length} (${OSTATNICH_POSIEDZEN} ostatnich odbytych, najbliższe` +
          `${a.planowane ? ` i ${NAJBLIZSZYCH_TERMINOW} najbliższe terminy bez numeru` : ''}). sumy dotyczą całej kadencji. ` +
          'Całą listę daje wszystkie=true, a dawniejsze posiedzenia: od/do z datami.',
      );
    }
    return {
      odpowiedz,
      ...(czesciowyApeli ? { wynikCzesciowy: czesciowyApeli } : {}),
      dzis,
      kadencja: k,
      liczba: wybrane.length,
      ...(pokazane.length < wybrane.length ? { pokazano: pokazane.length } : {}),
      sumy,
      ostatnieZakonczone: ostatnie?.numer ?? null,
      najblizsze: krotko(wszystkie.find((p) => p.stan !== 'zakończone' && p.numer !== null)),
      ...(sasiedzi ? { sasiedzi } : {}),
      posiedzenia: pokazane,
      zrodla: [zrodlo.adres(sP), zrodlo.adres(sG), ...zrodlaApeli],
      ...(uwagi.length ? { uwagi } : {}),
    };
  },
});

export const glosowaniaPosiedzenia = narzedzie({
  nazwa: 'glosowania_posiedzenia',
  tytul: 'Głosowania na posiedzeniu',
  opis:
    'Głosowania jednego posiedzenia (lub jednego jego dnia) z werdyktem liczonym z progu, plus bilans: ile przyjęto, ile odrzucono, ' +
    'ile było apeli o kworum i wyborów z listy. Na pytanie „ile głosowań / ile przyjęto na posiedzeniu” wołaj BEZ parametru data ' +
    '(np. z limit 1): bilans obejmuje wtedy całe posiedzenie; nie sumuj bilansów dziennych. Lista idzie porcjami (domyślnie i najwyżej 30; ' +
    'przy bardzo długich tytułach porcja kurczy się, żeby wynik nie przekroczył ok. 20 tys. znaków): resztę pobierasz z przesuniecie RÓWNYM nastepnePrzesuniecie, nie przesuniecie+limit. ' +
    'Bez kadencji, z datą spoza bieżącej kadencji, kadencję wyznacza data. ' +
    'Z porzadek=true zamiast listy po kolei: porządek obrad z głosowaniami pod każdym punktem (każde głosowanie z werdyktem, ' +
    'punkty bez głosowań też), a na końcu „Pozostałe głosowania” (wnioski formalne, apele o kworum, głosowania bez numeru punktu). ' +
    'Szczegóły i rozbicie na kluby daje narzędzie glosowanie.',
  wejscie: z.object({
    posiedzenie: z.number().int().min(1).describe('Numer posiedzenia'),
    data: data.optional().describe('Tylko głosowania z tego dnia posiedzenia (RRRR-MM-DD)'),
    // 30, nie 60: przy 60 porcja kurczyła się do 39, a model sam ustawiał przesuniecie=60 i gubił
    // głosowania 40–60 (20-b). 30 głosowań to ok. 15 tys. znaków, więc przycinanie jest wyjątkiem.
    limit: limit(30, 30),
    przesuniecie,
    porzadek: z
      .boolean()
      .default(false)
      .describe('Porządek obrad z głosowaniami pod punktami (zamiast listy po kolei); limit i przesuniecie wtedy nie działają'),
    odPunktu: z.coerce.number().int().min(1).optional().describe('Z porzadek=true: głosowania od tego punktu porządku (dalsza porcja długiego porządku)'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const kz = a.data ? kadencjaZDat(a.kadencja, a.data) : { kadencja: a.kadencja, uwaga: null };
    const k = kz.kadencja;
    const uwagaKadencji = kz.uwaga ? [kz.uwaga] : [];
    const sciezka = `${T(k)}/votings/${a.posiedzenie}`;
    const lista = jakoLista<GlosowanieZRejestru>(await zrodlo.json<unknown>(sciezka), 'głosowania posiedzenia');
    if (lista.length === 0) {
      // Rejestr oddaje [] także dla posiedzenia, którego nie ma (9999): „0 głosowań” byłoby fałszywym faktem.
      // Istnienie rozstrzyga proceedings/{nr}; zaplanowane posiedzenie istnieje, tylko jeszcze bez głosowań.
      const sP = `${T(k)}/proceedings/${a.posiedzenie}`;
      const p = jakoRekord<{ number: number; title?: string; dates?: string[] }>(await zrodlo.json<unknown>(sP), 'posiedzenie');
      if (!p) {
        return {
          znaleziono: false,
          zrodla: [zrodlo.adres(sciezka), zrodlo.adres(sP)],
          uwagi: [...uwagaKadencji, `Rejestr nie zna posiedzenia ${a.posiedzenie} w kadencji ${k}. Numery i daty posiedzeń daje lista_posiedzen.`],
        };
      }
      const dni = p.dates ?? [];
      const stan = stanWgDat(dni);
      const kiedy = dni.length ? ` (${dni.join(', ')})` : '';
      return {
        znaleziono: true,
        odpowiedz:
          stan === 'zaplanowane'
            ? `Posiedzenie ${a.posiedzenie}${kiedy} jest zaplanowane i jeszcze się nie odbyło, więc nie ma głosowań.`
            : `Posiedzenie ${a.posiedzenie}${kiedy}, stan: ${stan}; rejestr nie ma z niego żadnego głosowania${stan === 'trwa' ? ' (jeszcze)' : ''}.`,
        stan,
        dni,
        bilans: bilans([]),
        glosowania: [],
        zrodla: [zrodlo.adres(sciezka), zrodlo.adres(sP)],
        ...(uwagaKadencji.length ? { uwagi: uwagaKadencji } : {}),
      };
    }
    const wybrane = (a.data ? lista.filter((g) => dataWarszawa(g.date) === a.data) : lista).map((g) => {
      jakoRekord(g, 'głosowanie', LICZBY_GLOSOWANIA);
      return skrotGlosowania(g);
    });
    if (a.data && wybrane.length === 0 && lista.length > 0) {
      const dni = [...new Set(lista.map((g) => dataWarszawa(g.date)))].sort();
      return {
        bilans: bilans([]),
        glosowania: [],
        zrodla: [zrodlo.adres(sciezka)],
        uwagi: [...uwagaKadencji, `Dzień ${a.data} nie należy do posiedzenia ${a.posiedzenie} (jego dni z głosowaniami: ${dni.join(', ')}). Numer posiedzenia danego dnia daje lista_posiedzen z od/do.`],
      };
    }
    const b = bilans(wybrane);
    const s = b.nadUchwalamiSenatu;
    const zdanieSenat = s.glosowan
      ? `; nad uchwałami Senatu ${s.glosowan} (głosowano wnioski o odrzucenie stanowiska Senatu, liczone osobno)` +
        (s.glosowanNadPoprawkami ? `: głosowań nad poprawkami ${s.glosowanNadPoprawkami}, w tym poprawki przyjęte w ${odmiana(s.glosowanPoprawkaPrzyjeta, ['głosowaniu', 'głosowaniach', 'głosowaniach'])}, odrzucone w ${odmiana(s.glosowanPoprawkaOdrzucona, ['głosowaniu', 'głosowaniach', 'głosowaniach'])} (to liczba głosowań, nie poprawek: jedno głosowanie może dotyczyć kilku poprawek)` : '') +
        (s.nadOdrzuceniemUstawy ? `; nad uchwałą Senatu odrzucającą ustawę ${s.nadOdrzuceniemUstawy}` : '')
      : '';
    const odpowiedz =
      `Posiedzenie ${a.posiedzenie}${a.data ? `, dzień ${a.data}` : ''}${k !== 10 ? ` (kadencja ${k})` : ''}: ${odmiana(b.wszystkich, ['głosowanie', 'głosowania', 'głosowań'])}; przyjęto ${b.przyjetych}, odrzucono ${b.odrzuconych}${zdanieSenat}; ` +
      `apele o kworum ${b.apeliOKworum}${b.kworum.length ? ` (${b.kworum.map((q) => `${q.glosowanie}: obecnych ${q.obecnych}, ${q.kworumJest ? 'kworum stwierdzone' : 'brak kworum'}`).join('; ')})` : ''}` +
      `${b.apeliOKworum ? `, więc bez apeli ${odmiana(b.wszystkich - b.apeliOKworum, ['głosowanie', 'głosowania', 'głosowań'])} (tyle z reguły liczy statystyka Sejmu)` : ''}; ` +
      `wybory z listy ${b.wyborowZListy}; głosowania nad całością projektu: ustaw ${b.nadCaloscia.ustaw.razem} (przyjęto ${b.nadCaloscia.ustaw.przyjetych}), ` +
      `uchwał ${b.nadCaloscia.uchwal.razem} (przyjęto ${b.nadCaloscia.uchwal.przyjetych}).`;
    if (a.porzadek) {
      const surowe = a.data ? lista.filter((g) => dataWarszawa(g.date) === a.data) : lista;
      // Zapas na resztę odpowiedzi (zdanie, bilans, uwagi), żeby całość zmieściła się w MAKS_ZNAKOW.
      const zapas = JSON.stringify({ odpowiedz, bilans: b, uwagi: uwagiDoGlosowan(wybrane) }).length + 1500;
      const zPorzadkiem = await porzadekZGlosowaniami(zrodlo, k, a.posiedzenie, surowe, wybrane, a.odPunktu, !!a.data, zapas);
      if ('brak' in zPorzadkiem) uwagaKadencji.push(zPorzadkiem.brak as string);
      else {
        return {
          znaleziono: true,
          ...zPorzadkiem.wynik,
          odpowiedz: `${odpowiedz} ${zPorzadkiem.zdanie}`,
          bilans: b,
          zrodla: [zrodlo.adres(sciezka), ...zPorzadkiem.zrodla],
          uwagi: [...uwagaKadencji, ...zPorzadkiem.uwagi, ...uwagiDoGlosowan(wybrane), ...(b.apeliOKworum ? [UWAGA_APELE_STATYSTYKA] : [])],
        };
      }
    }
    const zadana = wybrane.slice(a.przesuniecie, a.przesuniecie + a.limit);
    const wynikDla = (porcja: SkrotGlosowania[]) => {
      const niepelna = porcja.length < wybrane.length;
      const dalej = a.przesuniecie + porcja.length < wybrane.length ? a.przesuniecie + porcja.length : null;
      const przycieta = porcja.length < zadana.length;
      const zakres = porcja.length ? `${a.przesuniecie + 1}–${a.przesuniecie + porcja.length}` : 'żadne';
      const pokazano = `głosowania ${zakres} z ${wybrane.length}${dalej !== null ? `; następna porcja: przesuniecie=${dalej}` : ''}`;
      const blizniaki = uwagaBlizniaki(porcja);
      const niejednoznaczne = niejednoznaczneGlosowania(porcja);
      // Pełny tytuł punktu raz w słowniku punkty, przy głosowaniu „Pkt. 8” (połowa objętości listy).
      const { punkty, glosyKrotko } = skrocPunkty(porcja);
      return {
        znaleziono: true,
        odpowiedz: niepelna ? `${odpowiedz} Lista niżej: ${pokazano}.` : odpowiedz,
        ...(niejednoznaczne ? { niejednoznaczne } : {}),
        bilans: b,
        ...(niepelna ? { pokazano } : {}),
        ...(Object.keys(punkty).length ? { punkty } : {}),
        glosowania: glosyKrotko.map(zwiezle),
        nastepnePrzesuniecie: dalej,
        zrodla: [zrodlo.adres(sciezka)],
        uwagi: [
          ...uwagaKadencji,
          ...(przycieta
            ? [
                `Porcję skrócono z ${zadana.length} do ${porcja.length} głosowań, żeby wynik zmieścił się w ok. ${MAKS_ZNAKOW / 1000} tys. znaków: pokazano ${zakres} z ${wybrane.length}. ` +
                  `Następna porcja: przesuniecie=${dalej}. Ustaw przesuniecie DOKŁADNIE na nastepnePrzesuniecie, nie na przesuniecie+limit, bo pominiesz głosowania.`,
              ]
            : []),
          ...(a.przesuniecie > 0
            ? [`Ta porcja zaczyna się od głosowania ${a.przesuniecie + 1}. Jeśli poprzednia porcja skończyła się wcześniej (jej nastepnePrzesuniecie było mniejsze niż ${a.przesuniecie}), pobierz brakujące.`]
            : []),
          ...(niepelna
            ? [
                'UWAGA: lista jest niepełna. bilans dotyczy całego posiedzenia, ale wymieniono tylko część głosowań; nie licz niczego z samej listy przed pobraniem reszty' +
                  (dalej !== null ? `: wywołaj ponownie z przesuniecie=${dalej} (ten sam limit) albo zawęź parametrem data.` : '.'),
              ]
            : []),
          ...(blizniaki ? [blizniaki] : []),
          ...(Object.keys(punkty).length ? ['Przy głosowaniu stoi numer punktu porządku („Pkt. 8”); pełny tytuł punktu podaje pole punkty.'] : []),
          UWAGA_ZWIEZLE,
          ...uwagiDoGlosowan(wybrane),
          ...(b.apeliOKworum ? [UWAGA_APELE_STATYSTYKA] : []),
        ],
      };
    };
    const ile = porcjaWRozmiarze(zadana, wynikDla);
    return wynikDla(zadana.slice(0, ile));
  },
});

/** Tytuł głosowania w porządku: dłuższy przycinamy na granicy słowa (pełny daje glosowanie). */
const MAKS_LINII = 140;

function przytnij(t: string, max = MAKS_LINII): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const spacja = cut.lastIndexOf(' ');
  return `${(spacja > 40 ? cut.slice(0, spacja) : cut).replace(/[\s,;:–-]+$/u, '')}…`;
}

/**
 * Porządek obrad z głosowaniami pod punktami, jak strona posiedzenia w serwisie leniwyposel.pl:
 * przypisanie robi `rozlozNaPunkty` (src/reguly/porzadek.ts), werdykt ten sam co w liście
 * (`skrotGlosowania`). Porządek przychodzi z `/proceedings/{n}` (pole agenda). `null`, gdy
 * porządku nie ma; awaria sieci przy porządku też daje `null` z uwagą, a nie błąd całości.
 */
async function porzadekZGlosowaniami(
  zrodlo: ZrodloSejmu,
  k: number,
  posiedzenie: number,
  surowe: GlosowanieZRejestru[],
  skroty: SkrotGlosowania[],
  odPunktu: number | undefined,
  jedenDzien: boolean,
  zapas: number,
) {
  const sP = `${T(k)}/proceedings/${posiedzenie}`;
  let agenda: string | null = null;
  try {
    agenda = jakoRekord<{ agenda?: string }>(await zrodlo.json<unknown>(sP), 'posiedzenie')?.agenda ?? null;
  } catch (e) {
    return { brak: `Porządku obrad nie udało się pobrać (${e instanceof Error ? e.message : String(e)}), więc głosowania idą po kolei; porzadek=true za kilka minut spróbuje ponownie.` };
  }
  const punkty = punktyPorzadku(agenda);
  if (punkty.length === 0) return { brak: 'Porządku obrad tego posiedzenia nie ma w rejestrze (pole agenda), więc głosowania idą po kolei.' };

  const wgNumeru = new Map(skroty.map((g) => [g.numer, g]));
  const rozklad = rozlozNaPunkty(punkty, surowe);
  const wiersz = (g: GlosowanieZRejestru, podPunktem: boolean) => {
    const s = wgNumeru.get(g.votingNumber);
    const w = wynikGlosowania(g);
    // Werdykt bez nawiasu z uzasadnieniem: przy poprawkach Senatu wyjaśnia go uwaga, a przy apelu etykieta mówi wszystko.
    const wynik = w.rodzaj === 'kworum' ? w.etykieta : String(s?.wynik ?? w.etykieta).replace(/\s*\([^()]*\)$/, '');
    return { glosowanie: `${g.sitting}/${g.votingNumber}`, tytul: przytnij(liniaGlosowania(g.title, g.topic, podPunktem)), wynik };
  };
  const wszystkiePunkty = jedenDzien ? rozklad.punkty.filter((p) => p.glosowania.length > 0) : rozklad.punkty;
  const od = odPunktu ? wszystkiePunkty.findIndex((p) => p.punkt.poz >= odPunktu) : 0;
  const start = od < 0 ? wszystkiePunkty.length : od;
  const podPunktami = rozklad.punkty.reduce((s, p) => s + p.glosowania.length, 0);

  const wynikDla = (porcja: typeof wszystkiePunkty) => {
    const pelne = new Set(porcja);
    const dalej = start + porcja.length < wszystkiePunkty.length ? wszystkiePunkty[start + porcja.length].punkt.poz : null;
    return {
      porzadek: {
        punktow: punkty.length,
        glosowanPodPunktami: podPunktami,
        pozostalychGlosowan: rozklad.poza.length,
        punkty: wszystkiePunkty.map((p) => {
          const etap = etapPunktu(p.punkt.tekst);
          return {
            punkt: p.punkt.poz,
            nazwa: krotkaNazwaPunktu(p.punkt.tekst) || p.punkt.tekst,
            ...(etap ? { etap } : {}),
            ...(p.punkt.druki.length ? { druki: p.punkt.druki } : {}),
            ...(p.punkt.procesy.length ? { procesy: p.punkt.procesy } : {}),
            // Poza porcją sama liczba głosowań: model widzi cały porządek, a głosowania dobiera odPunktu.
            ...(pelne.has(p) ? { glosowania: p.glosowania.map((g) => wiersz(g, true)) } : { glosowan: p.glosowania.length }),
          };
        }),
        pozostaleGlosowania: {
          nazwa: POZOSTALE_GLOSOWANIA,
          opis: POZOSTALE_GLOSOWANIA_PODPIS,
          glosowania: rozklad.poza.map((g) => wiersz(g, false)),
        },
      },
      ...(dalej !== null || start > 0
        ? {
            pokazano: `głosowania punktów ${porcja.length ? `${porcja[0].punkt.poz}–${porcja[porcja.length - 1].punkt.poz}` : 'żadnych'}` +
              `${dalej !== null ? `; dalsze: porzadek=true, odPunktu=${dalej}` : ''}`,
            nastepnyPunkt: dalej,
          }
        : {}),
    };
  };
  const doPorcji = wszystkiePunkty.slice(start);
  const ile = porcjaWRozmiarze(doPorcji, (p) => wynikDla(p), zapas);
  const wynik = wynikDla(doPorcji.slice(0, ile));
  const uwagi = [
    'Głosowanie stoi pod punktem, gdy jego tytuł zaczyna się od „Pkt. N” (i druki się zgadzają) albo gdy tytuł bez numeru wymienia druk, który ma dokładnie jeden punkt; ' +
      'reszta jest w pozostaleGlosowania, w kolejności rejestru. Punkty bez głosowań mają pustą listę. Pod punktem tytul to temat z rejestru (np. „poprawka 1”), nazwę niesie punkt.',
    ...('nastepnyPunkt' in wynik && typeof wynik.nastepnyPunkt === 'number'
      ? [`Porządek jest długi: głosowania wypisano do punktu ${wynik.nastepnyPunkt - 1} (dalsze punkty mają samą liczbę glosowan). Resztę daje porzadek=true, odPunktu=${wynik.nastepnyPunkt}.`]
      : []),
    ...(jedenDzien ? ['Z parametrem data porządek pokazuje tylko punkty z głosowaniami tego dnia.'] : []),
  ];
  return {
    wynik,
    zdanie: `Porządek obrad: ${odmiana(punkty.length, ['punkt', 'punkty', 'punktów'])}; pod punktami ${odmiana(podPunktami, ['głosowanie', 'głosowania', 'głosowań'])}, w grupie „${POZOSTALE_GLOSOWANIA}” ${rozklad.poza.length}.`,
    zrodla: [zrodlo.adres(sP)],
    uwagi,
  };
}

/** Do tylu trafień szukaj_glosowan liczy podsumowanie według rodzaju (najwyżej 5 dodatkowych zapytań po 100). */
const PODSUMOWANIE_DO = 500;

const NAZWA_RODZAJU: Record<string, string> = {
  kworum: 'apele o kworum',
  'za-przeciw': 'głosowania za/przeciw',
  lista: 'wybory z listy',
};

function zliczRodzaje(lista: Array<{ rodzaj: string }>): Record<string, number> {
  const wynik: Record<string, number> = {};
  for (const g of lista) wynik[g.rodzaj] = (wynik[g.rodzaj] ?? 0) + 1;
  return Object.fromEntries(Object.entries(wynik).sort((x, y) => y[1] - x[1]));
}

/** Ile rdzeni najwyżej pobieramy osobno, gdy pełna fraza nie trafia (po 5 zapytań na rdzeń). */
const MAKS_RDZENI = 2;
/** Tyle najnowszych trafień jednego rdzenia przeglądamy (porcjami po 100). */
const OKNO_RDZENIA = 500;

export const szukajGlosowan = narzedzie({
  nazwa: 'szukaj_glosowan',
  tytul: 'Szukaj głosowań',
  opis:
    'Wyszukuje głosowania po słowie w tytule (wyszukiwarka rejestru Sejmu), opcjonalnie w przedziale dat lub na jednym posiedzeniu. ' +
    'Domyślnie najnowsze najpierw. Tytuły są w dopełniaczu i bez skrótów: szukaj "ustawy budżetowej na rok 2024", ' +
    '"Krajowej Radzie Sądownictwa", nie "budżetowa 2024" ani "KRS"; rdzeń słowa też działa ("budżet", "podatk"). ' +
    'Fraza z nazwiskiem posła (np. „Mejza immunitet”) szuka tego nazwiska w TYTUŁACH głosowań (wnioski o uchylenie immunitetu, sprawy z oskarżenia prywatnego); ' +
    'jak dany poseł głosował, daje glosowanie z poselId albo glosy_posla_w_dniu, nie to narzędzie. ' +
    'Pytanie „jak głosował poseł nad ustawą X”: szukaj tu po tytule ustawy i opisie „całość projektu”, albo przez szukaj_procesow → proces (pole glosowanieKoncowe); ' +
    'sprawdź, czy data, tytuł i druk zgadzają się z pytaniem, zanim wybierzesz głosowanie: kilka ustaw ma identyczny tytuł i różni się tylko numerem druku. ' +
    'Uwaga: ustawa „o zmianie ustawy budżetowej” albo „o szczególnych rozwiązaniach służących realizacji ustawy budżetowej” to INNE ustawy niż sama ustawa budżetowa. ' +
    'Pytanie o ustawę: bierz głosowanie z opisem „całość projektu ustawy”; „całość projektu uchwały” to uchwała, nie ustawa. ' +
    'Nazw potocznych („lex TVN”, „ustawa kagańcowa”, „nowelizacja”) nie ma w tytułach: szukaj przedmiotem ustawy („radiofonii i telewizji”) z datą od/do. ' +
    'Daty od/do z innej kadencji wybierają tę kadencję. Wynik mieści się w ok. 20 tys. znaków; resztę daje przesuniecie=nastepnePrzesuniecie.' + OPIS_CZESCIOWY,
  wejscie: z.object({
    fraza: z.string().min(2).max(200).optional().describe('Słowo lub fraza z tytułu głosowania'),
    posiedzenie: z.number().int().min(1).optional(),
    od: data.optional().describe('Od dnia (RRRR-MM-DD)'),
    do: data.optional().describe('Do dnia (RRRR-MM-DD)'),
    najnowszeNajpierw: z.boolean().default(true),
    limit: limit(20, 50),
    przesuniecie,
    kadencja,
  }),
  async wykonaj(a, zrodlo): Promise<Wynik> {
    const kz = kadencjaZDat(a.kadencja, a.od, a.do);
    if (kz.kadencja !== a.kadencja) {
      const w: Wynik = await szukajGlosowan.wykonaj({ ...a, kadencja: kz.kadencja }, zrodlo);
      return { ...w, uwagi: [kz.uwaga!, ...(w.uwagi ?? [])] };
    }
    // „ustawy o statusie osoby najbliższej” nie trafia w głosowanie nad wetem („… ustawy z dnia 29 maja
    // 2026 r. o statusie …”); część od „o …” trafia w oba. Szukamy więc przedmiotem ustawy.
    const przedmiot = a.fraza ? /^(?:projekt\S*\s+)?(?:ustaw\S*|uchwa\S*)\s+(o\s.{3,})$/iu.exec(a.fraza.trim()) : null;
    if (przedmiot && !a.fraza!.startsWith('o ')) {
      const w: Wynik = await szukajGlosowan.wykonaj({ ...a, fraza: przedmiot[1] }, zrodlo);
      return { ...w, uwagi: [`Szukano przedmiotem ustawy („${przedmiot[1]}”), żeby objąć też głosowania nad wetem i poprawkami Senatu.`, ...(w.uwagi ?? [])] };
    }
    const sciezka = `${T(a.kadencja)}/votings/search`;
    const filtr = { title: a.fraza, proceeding: a.posiedzenie, dateFrom: a.od, dateTo: a.do };

    // Rejestr oddaje wyniki od najstarszych i nie umie odwrócić kolejności. Najpierw pytamy
    // o liczbę trafień, potem o ostatnią porcję, i odwracamy ją u siebie.
    let offset = a.przesuniecie;
    let ile = a.limit;
    let razem: number | null = null;
    if (a.najnowszeNajpierw) {
      razem = (await zrodlo.lista<unknown>(sciezka, { parametry: { ...filtr, limit: 1, offset: 0 } })).razem;
      if (razem !== null) {
        const koniec = Math.max(0, razem - a.przesuniecie);
        offset = Math.max(0, koniec - a.limit);
        ile = koniec - offset;
      }
    }
    const parametry = { ...filtr, limit: Math.max(ile, 1), offset };
    const odp = ile > 0 ? await zrodlo.lista<unknown>(sciezka, { parametry }) : { dane: [], razem };
    // Kolejność rejestru (po odwróceniu: najnowsze najpierw): porcję przycinamy w TEJ kolejności,
    // żeby nastepnePrzesuniecie trafiało dokładnie w pierwszy niepokazany rekord.
    const daneSurowe = jakoLista<GlosowanieZRejestru>(odp.dane, 'wyniki wyszukiwania').map((g) => {
      jakoRekord(g, 'głosowanie', LICZBY_GLOSOWANIA);
      return skrotGlosowania(g);
    });
    if (a.najnowszeNajpierw) daneSurowe.reverse();
    const uporzadkuj = (x: SkrotGlosowania[]) => porzadekDnia(wprowadzajaceNaKoniec(x, a.fraza));
    const dane = uporzadkuj(daneSurowe);
    const lacznie = razem ?? odp.razem;

    let wynik = dane;
    let wszystkich = lacznie;
    let zRdzeni = false;
    let pelnaLista: SkrotGlosowania[] | null = lacznie !== null && lacznie <= dane.length ? dane : null;
    // Wszystkie trafienia (nie porcja) do podsumowania według rodzaju; null, gdy za dużo.
    let doPodsumowania: Array<{ rodzaj: string }> | null = lacznie !== null && lacznie <= dane.length ? dane : null;
    let zrodlaAdresy = [zrodlo.adres(sciezka, parametry)];
    const dodatkowe: string[] = [];
    const czesci: WynikCzesciowy[] = [];
    if (kz.uwaga) dodatkowe.push(kz.uwaga);
    const skrot = lacznie === 0 ? rozwinSkroty(a.fraza) : null;
    if (skrot) {
      const zRozwinieciem: Wynik = await szukajGlosowan.wykonaj({ ...a, fraza: skrot.fraza }, zrodlo);
      return { ...zRozwinieciem, uwagi: [skrot.uwaga, ...(zRozwinieciem.uwagi ?? [])] };
    }
    if (lacznie === 0 && a.fraza) {
      const rdz = rdzenie(a.fraza);
      if (rdz.length > 0) {
        // Rdzenie nazw własnych (słowo z wielkiej litery, np. nazwisko): pytanie „Mejza immunitet” jest
        // o osobę, a najrzadszy rdzeń „immuni” dawał 3 głosowania bez związku i gubił 7 z „Mejzą” (19-5).
        const wlasne = new Set(a.fraza.split(/\s+/).filter((s) => /^\p{Lu}\p{Ll}/u.test(s)).flatMap((s) => rdzenie(s)));
        const liczby = await Promise.all(
          rdz.map(async (r) => ({ r, ile: (await zrodlo.lista<unknown>(sciezka, { parametry: { ...filtr, title: r, limit: 1, offset: 0 } })).razem ?? 0 })),
        );
        // Najrzadsze najpierw, nie najdłuższe: „Rzeczypospoli” trafia w setki tytułów, „kryptoakty” w kilka.
        const zTrafieniami = liczby.filter((x) => x.ile > 0).sort((x, y) => x.ile - y.ile);
        const kolejka = [...zTrafieniami.filter((x) => wlasne.has(x.r)).slice(0, 1), ...zTrafieniami]
          .filter((x, i, t) => t.findIndex((y) => y.r === x.r) === i)
          .slice(0, MAKS_RDZENI);
        if (kolejka.length) {
          const tekst = (g: GlosowanieZRejestru) => `${g.title ?? ''} ${g.topic ?? ''} ${g.description ?? ''}`;
          const zebrane = new Map<string, GlosowanieZRejestru>();
          const pobrane: typeof kolejka = [];
          // Rdzeń po rdzeniu, aż któryś tytuł ma wszystkie rdzenie: zwykle wystarcza pierwszy.
          for (const x of kolejka) {
            const porcje = [];
            for (let off = Math.max(0, x.ile - OKNO_RDZENIA); off < x.ile; off += 100) porcje.push({ ...filtr, title: x.r, limit: 100, offset: off });
            const surowe = (await Promise.all(porcje.map((par) => zrodlo.lista<unknown>(sciezka, { parametry: par })))).flatMap((o) =>
              jakoLista<GlosowanieZRejestru>(o.dane, 'wyniki wyszukiwania'),
            );
            for (const g of surowe) zebrane.set(`${g.sitting}/${g.votingNumber}`, g);
            pobrane.push(x);
            zrodlaAdresy = pobrane.map((p) => zrodlo.adres(sciezka, { ...filtr, title: p.r }));
            if ([...zebrane.values()].some((g) => maWszystkie(tekst(g), rdz))) break;
          }
          const surowe = [...zebrane.values()].sort((x, y) => y.date.localeCompare(x.date));
          let wybrane = surowe.filter((g) => maWszystkie(tekst(g), rdz));
          const rok = tylkoZRokiem(wybrane, lataZFrazy(a.fraza), tekst);
          wybrane = rok.lista;
          if (rok.uwaga) dodatkowe.push(rok.uwaga);
          let czesciowe = false;
          if (wybrane.length === 0 && rdz.length > 1) {
            // Słowo z pytania, którego nie ma w tytule („weta” przy „wniosku Prezydenta o ponowne rozpatrzenie”),
            // nie może wyzerować wyniku: bierzemy tytuły z największą liczbą rdzeni.
            const ilu = (g: GlosowanieZRejestru) => rdz.filter((r) => maWszystkie(tekst(g), [r])).length;
            const najwiecej = Math.max(...surowe.map(ilu), 0);
            if (najwiecej >= 1) {
              wybrane = surowe.filter((g) => ilu(g) === najwiecej);
              czesciowe = true;
              dodatkowe.push(`Żaden tytuł nie ma wszystkich rdzeni; pokazano tytuły z ${najwiecej} z ${rdz.length} rdzeni. Sprawdź, czy tytuł i data zgadzają się z pytaniem.`);
            }
          }
          dodatkowe.push(
            `Jak szukano: trafienia w rejestrze dla każdego rdzenia: ${liczby.map((x) => `„${x.r}” ${x.ile}${wlasne.has(x.r) ? ' (nazwa własna)' : ''}`).join(', ')}; ` +
              `pobrano tytuły z rdzeniem ${pobrane.map((x) => `„${x.r}”`).join(' i ')} i zostawiono te, które mają ${czesciowe ? 'najwięcej rdzeni' : 'wszystkie rdzenie'} z frazy.`,
          );
          for (const x of pobrane) {
            if (x.ile > OKNO_RDZENIA) {
              dodatkowe.push(`Przejrzano ${OKNO_RDZENIA} najnowszych z ${x.ile} tytułów z rdzeniem „${x.r}”; starsze zawęzisz datami od/do.`);
              czesci.push(
                czesciowy(
                  `rejestr ma ${x.ile} głosowań z tytułem zawierającym „${x.r}”, a serwer przegląda najwyżej ${OKNO_RDZENIA} najnowszych`,
                  `starszych głosowań (sprzed ${OKNO_RDZENIA} najnowszych z tym słowem), więc lista i liczba trafień mogą być niepełne`,
                  'podać daty od/do (np. rok, o który chodzi) albo dokładniejszą frazę',
                ),
              );
            }
          }
          let trafienia = porzadekDnia(
            wprowadzajaceNaKoniec(
              wybrane.map((g) => {
                jakoRekord(g, 'głosowanie', LICZBY_GLOSOWANIA);
                return skrotGlosowania(g);
              }),
              a.fraza,
            ),
          );
          // Przy częściowym trafieniu tytuły z nazwą własną idą pierwsze: pytanie jest o tę osobę albo instytucję.
          if (czesciowe && wlasne.size) {
            const zWlasna = (g: SkrotGlosowania) => [...wlasne].some((r) => maWszystkie(`${g.punkt ?? ''} ${g.temat ?? ''} ${g.opis ?? ''}`, [r]));
            const pierwsze = trafienia.filter(zWlasna);
            if (pierwsze.length && pierwsze.length < trafienia.length) {
              trafienia = [...pierwsze, ...trafienia.filter((g) => !zWlasna(g))];
              dodatkowe.push(`Najpierw ${pierwsze.length} tytułów z nazwą własną z frazy (${[...wlasne].map((r) => `„${r}”`).join(', ')}), potem pozostałe.`);
            }
          }
          // „weto” nie występuje w tytułach: głosowanie nad wetem to „wniosek Prezydenta o ponowne rozpatrzenie”.
          // Przy pytaniu o weto te głosowania idą pierwsze, bo inaczej giną pod poprawkami do tej samej ustawy.
          if (/(^|\s)(wet|veto)/iu.test(a.fraza)) {
            // rozstrzygniecie mają też poprawki Senatu (44/91–107 wchodziły przed weto); te mają przedmiotGlosowania.
            const nadWetem = (g: (typeof trafienia)[number]) => 'rozstrzygniecie' in g && !('przedmiotGlosowania' in g);
            const wetowe = trafienia.filter(nadWetem);
            if (wetowe.length) {
              trafienia = [...wetowe, ...trafienia.filter((g) => !nadWetem(g))];
              dodatkowe.push(`Pytanie o weto: najpierw ${odmiana(wetowe.length, ['głosowanie', 'głosowania', 'głosowań'])} nad wnioskiem Prezydenta o ponowne rozpatrzenie ustawy (${wetowe.map((g) => `${g.glosowanie} z ${g.data.slice(0, 10)}`).join(', ')}); dopasuj datę do pytania.`);
            }
          }
          wszystkich = trafienia.length;
          doPodsumowania = trafienia;
          pelnaLista = trafienia;
          wynik = trafienia.slice(a.przesuniecie, a.przesuniecie + a.limit);
          zRdzeni = true;
          dodatkowe.unshift(UWAGA_RDZENIE(a.fraza, rdz));
        } else {
          wszystkich = 0;
          wynik = [];
          dodatkowe.push(`Zero trafień dla pełnej frazy i dla rdzeni (${rdz.join(', ')}). Spróbuj jednego znaczącego słowa z przedmiotu ustawy z zakresem dat od/do.`);
        }
      } else {
        dodatkowe.push('Zero trafień. Rejestr szuka dosłownie w tytule: rozwiń skróty (KRS, NFZ, ZUS, TK) i spróbuj samego rdzenia słowa.');
      }
    }
    // Podsumowanie według rodzaju liczymy ze WSZYSTKICH trafień: model dostawał 57 trafień frazy
    // „kworum” i podawał 57 apeli, choć pole rodzaj mówiło 52 apele i 5 zwykłych głosowań (04-b).
    if (!doPodsumowania && lacznie !== null && lacznie > dane.length && lacznie <= PODSUMOWANIE_DO && wynik === dane) {
      const porcje = [];
      for (let off = 0; off < lacznie; off += 100) porcje.push({ ...filtr, limit: 100, offset: off });
      try {
        doPodsumowania = (await Promise.all(porcje.map((par) => zrodlo.lista<unknown>(sciezka, { parametry: par }))))
          .flatMap((o) => jakoLista<GlosowanieZRejestru>(o.dane, 'wyniki wyszukiwania'))
          .map((g) => {
            const w = wynikGlosowania(g);
            return { rodzaj: w.rodzaj === 'zwykle' ? 'za-przeciw' : w.rodzaj };
          });
      } catch (e) {
        doPodsumowania = null;
        czesci.push(czesciowyZBledu(e, 'podsumowania trafień według rodzaju głosowania (ile zwykłych, ile apeli o kworum); sama lista trafień jest pełna'));
      }
    }
    const wedlugRodzaju = doPodsumowania && doPodsumowania.length ? zliczRodzaje(doPodsumowania) : null;
    if (!wedlugRodzaju && (wszystkich ?? 0) > PODSUMOWANIE_DO) {
      dodatkowe.push(`Trafień jest ${wszystkich}; podsumowania według rodzaju nie policzono (ponad ${PODSUMOWANIE_DO}). Zawęź frazę albo daty od/do.`);
    }
    const kadencjaUwaga = wszystkich === 0 ? uwagaOKadencji(a.kadencja, a.od, a.do) : null;
    if (kadencjaUwaga) dodatkowe.unshift(kadencjaUwaga);

    const zloz = (porcja: SkrotGlosowania[]) => {
      const blizniaki = uwagaBlizniaki(porcja);
      const niejednoznaczne = niejednoznaczneGlosowania(porcja, pelnaLista ?? porcja);
      const dalej = wszystkich !== null && a.przesuniecie + porcja.length < wszystkich ? a.przesuniecie + porcja.length : null;
      const wynikCzesciowy = polaczCzesciowe(...czesci);
      return {
        ...(wynikCzesciowy ? { wynikCzesciowy } : {}),
        ...(wedlugRodzaju
          ? {
              odpowiedz: `${odmiana(doPodsumowania!.length, ['trafienie', 'trafienia', 'trafień'])}: ${Object.entries(wedlugRodzaju)
                .map(([r, n]) => `${NAZWA_RODZAJU[r] ?? r} ${n}`)
                .join(', ')} (liczone ze wszystkich trafień, nie z tej porcji).`,
              wedlugRodzaju,
            }
          : {}),
        ...(niejednoznaczne ? { niejednoznaczne } : {}),
        razem: wszystkich,
        ...(dalej !== null ? { pokazano: `${a.przesuniecie + 1}–${a.przesuniecie + porcja.length} z ${wszystkich}` } : {}),
        glosowania: porcja.map(zwiezle),
        nastepnePrzesuniecie: dalej,
        zrodla: zrodlaAdresy,
        uwagi: [
          ...dodatkowe,
          ...(dalej !== null ? [`Pokazano ${porcja.length} z ${wszystkich}; dalsze: przesuniecie=${dalej}.`] : []),
          ...(blizniaki ? [blizniaki] : []),
          ...(porcja.length ? [UWAGA_ZWIEZLE] : []),
          ...uwagiDoGlosowan(porcja),
        ],
      };
    };
    // Porcja ponad ok. 20 tys. znaków trafiała u klienta do pliku (20-5): przycinamy od końca w kolejności rejestru.
    const zrodlowa = zRdzeni || wynik !== dane ? wynik : daneSurowe;
    const uloz = zRdzeni || wynik !== dane ? (x: SkrotGlosowania[]) => x : uporzadkuj;
    const n = porcjaWRozmiarze(zrodlowa, (p) => zloz(uloz(p)));
    const w = zloz(uloz(zrodlowa.slice(0, n)));
    if (n < zrodlowa.length) w.uwagi.unshift(`Porcję skrócono z ${zrodlowa.length} do ${n} głosowań, żeby wynik zmieścił się w ok. ${MAKS_ZNAKOW / 1000} tys. znaków.`);
    return w;
  },
});

/**
 * Kandydaci z wyboru z listy. Starsze kadencje zapisują ich inicjałem („M. KUCHCIŃSKI”), a model
 * rozwijał inicjał z pamięci („Maciej”, choć Marek). Jeśli wśród posłów kadencji jest dokładnie
 * jedna osoba o tym nazwisku i inicjale, podajemy jej pełne imię i numer.
 */
async function kandydaciZNazwiskami(
  zrodlo: import('../klient.js').ZrodloSejmu,
  kadencja: number,
  opcje: Array<{ option: string; votes: number }>,
) {
  const inicjal = opcje.some((o) => /^[A-ZĄĆĘŁŃÓŚŹŻ]\.\s/u.test(o.option.trim()));
  const poslowie = inicjal
    ? jakoLista<{ id: number; firstName: string; lastName: string }>(await zrodlo.json<unknown>(`${T(kadencja)}/MP`), 'posłowie')
    : [];
  return opcje.map((o) => {
    const m = /^([A-ZĄĆĘŁŃÓŚŹŻ])\.\s+(.+)$/u.exec(o.option.trim());
    if (!m) return { kandydat: nazwaZListy(o.option), glosow: o.votes };
    const pasujacy = poslowie.filter((p) => klucz(p.lastName) === klucz(m[2]) && klucz(p.firstName).startsWith(klucz(m[1])));
    return pasujacy.length === 1
      ? { kandydat: `${pasujacy[0].firstName} ${pasujacy[0].lastName}`, poselId: pasujacy[0].id, wRejestrze: o.option, glosow: o.votes }
      : { kandydat: nazwaZListy(o.option), glosow: o.votes, uwaga: 'Rejestr podaje tylko inicjał imienia; nie rozwijaj go bez sprawdzenia w znajdz_posla.' };
  });
}

/** Dlaczego posła nie ma na liście imiennej: ślubował później albo mandat już wygasł. */
async function powodBraku(zrodlo: import('../klient.js').ZrodloSejmu, kadencja: number, id: number, kiedy: string): Promise<string> {
  const p = await zrodlo.json<{ firstLastName?: string; oathDate?: string; mandateExpiryDate?: string; inactiveCause?: string; waiverDesc?: string }>(`${T(kadencja)}/MP/${id}`);
  const dzien = kiedy.slice(0, 10);
  if (p?.oathDate && p.oathDate > dzien) return `${p.firstLastName ?? 'Poseł'} złożył(a) ślubowanie ${p.oathDate}, po tym głosowaniu.`;
  if (p?.mandateExpiryDate && p.mandateExpiryDate <= dzien) {
    return `Mandat ${p.firstLastName ?? 'posła'} wygasł ${p.mandateExpiryDate}${p.waiverDesc || p.inactiveCause ? ` (${p.waiverDesc || p.inactiveCause})` : ''}, przed tym głosowaniem.`;
  }
  return 'Tego posła nie ma na liście imiennej tego głosowania.';
}

/** Lista imienna całej izby w zwięzłej postaci: głos → klub → „Imię Nazwisko (id)”. */
function imiennaWgGlosu(glosy: GlosImienny[], etykieta: (v: GlosImienny) => string, nazwisko: (v: GlosImienny) => string) {
  const wynik: Record<string, Record<string, string[]>> = {};
  for (const v of glosy) {
    const glos = etykieta(v);
    const klub = (v.club ?? '').trim() || 'bez klubu';
    ((wynik[glos] ??= {})[klub] ??= []).push(`${nazwisko(v)} (${v.MP})`);
  }
  return wynik;
}

export const glosowanie = narzedzie({
  nazwa: 'glosowanie',
  tytul: 'Głosowanie: wynik, kluby, głos posła',
  opis:
    'Jedno głosowanie ze szczegółami: werdykt z progu, wymagana większość, rozbicie na kluby według przynależności Z DNIA GŁOSOWANIA, ' +
    'opcjonalnie głos jednego posła i lista imienna (cała izba zgrupowana: głos → klub → posłowie; wiersz po wierszu dla jednego klubu z parametrem klub). ' +
    'Przy wyborze z listy kluby[] mają kartOddanych i nieobecni. ' +
    'Przy wyborze z listy zwraca kandydatów i liczbę głosów. ' +
    'Przy poprawce Senatu Sejm głosuje wniosek o jej ODRZUCENIE (bezwzględna większość): gdy wniosek nie przejdzie, poprawka jest PRZYJĘTA, a głos „przeciw” to głos za poprawką (pole rozstrzygniecie). ' +
    'Jak poseł głosował w serii głosowań jednego dnia (np. nad wszystkimi poprawkami Senatu): glosy_posla_w_dniu, jedno wywołanie zamiast wielu.',
  wejscie: z.object({
    posiedzenie: z.number().int().min(1),
    numer: z.number().int().min(1).describe('Numer głosowania na posiedzeniu'),
    poselId: z
      .union([z.coerce.number().int().min(1), z.array(z.coerce.number().int().min(1)).max(10)])
      .optional()
      .describe('Pokaż, jak głosował ten poseł, albo kilku posłów naraz (np. imienników: [147, 148]). Jeśli znajdz_posla zwrócił niejednoznaczne, przekaż tablicę wszystkich pasujących id.'),
    listaImienna: z.boolean().default(false).describe('Dołącz głos każdego posła'),
    klub: z.string().max(50).optional().describe('Lista imienna tylko tego klubu (skrót z dnia głosowania, np. "PiS")'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const sciezka = `${T(a.kadencja)}/votings/${a.posiedzenie}/${a.numer}`;
    const g = jakoRekord<GlosowanieZRejestru>(await zrodlo.json<unknown>(sciezka), 'głosowanie', LICZBY_GLOSOWANIA);
    if (!g) return { ...brak404('Rejestr nie zna takiego głosowania.'), zrodla: [zrodlo.adres(sciezka)] };

    const w = wynikGlosowania(g);
    const kworum = w.rodzaj === 'kworum';
    const glosy = jakoLista<GlosImienny>(g.votes, 'lista imienna');
    const etykieta = (v: GlosImienny) => {
      try {
        return etykietaGlosu(v.vote, g.kind, kworum, w.senat ?? null);
      } catch {
        return String(v.vote);
      }
    };
    const nazwisko = (v: GlosImienny) => `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim();
    // Karta z wyboru z listy: {"1": "YES", "2": "NO"} po numerze kandydata → {kandydat: głos}.
    const kandydatNr = new Map((g.votingOptions ?? []).map((o, i) => [String(o.optionIndex ?? i + 1), nazwaZListy(o.option)]));
    const GLOS_NA_LISCIE: Record<string, string> = { YES: 'za', NO: 'przeciw', ABSTAIN: 'wstrzymanie się' };
    const wybory = (v: GlosImienny) =>
      w.rodzaj === 'lista' && v.listVotes
        ? Object.fromEntries(Object.entries(v.listVotes).map(([nr, glos]) => [kandydatNr.get(nr) ?? `kandydat ${nr}`, GLOS_NA_LISCIE[glos] ?? glos]))
        : undefined;

    // Nieznana wartość głosu nie może wywrócić całej odpowiedzi: rozbicie znika, reszta zostaje.
    const uwagi: string[] = [];
    const czesciGlosowania: WynikCzesciowy[] = [];
    if (w.rodzaj === 'lista' && a.listaImienna && !a.klub) {
      uwagi.push('Pełna lista wyboru z listy z kartą każdego posła jest bardzo długa: wybory przy kandydatach pokazano tylko dla jednego klubu (parametr klub) albo jednego posła (poselId).');
    }
    let kluby: Array<ReturnType<typeof klubPoPolsku> | ReturnType<typeof obecnosciNaApelu>[number]> | null;
    try {
      const rozklad = rozkladKlubow(glosy, g.kind);
      // Apel o kworum: za, przeciw i wstrzymanie to tylko naciśnięty przycisk, więc klub ma obecnych i tych, którzy apel opuścili.
      kluby = kworum ? obecnosciNaApelu(rozklad) : rozklad.map((k) => klubPoPolsku(k, w.rodzaj === 'lista'));
    } catch (e) {
      kluby = null;
      uwagi.push(`Rozbicia na kluby nie policzono: ${e instanceof Error ? e.message : String(e)}`);
      czesciGlosowania.push(
        czesciowy(
          'lista imienna ma wartość głosu, której ten serwer nie zna, więc nie policzył rozbicia na kluby',
          'wyniku klubów (pole kluby); wynik całego głosowania jest pełny',
          'sprawdzić rozkład klubów w protokole PDF z pola zrodla',
        ),
      );
    }
    const ids = a.poselId === undefined ? [] : Array.isArray(a.poselId) ? a.poselId : [a.poselId];
    let klubyImiennej = a.klub ? [a.klub.toLowerCase()] : [];
    const imiennaDla = () => (klubyImiennej.length ? glosy.filter((v) => klubyImiennej.includes((v.club ?? '').toLowerCase())) : glosy);
    const niejasnosci: Array<{ powod: string; coZrobic: string; wynikiKlubow?: unknown[] }> = [];
    if (a.klub) {
      const wszystkieKluby = [...new Set(glosy.map((v) => v.club ?? ''))];
      const dokladny = wszystkieKluby.find((k) => k.toLowerCase() === a.klub!.toLowerCase());
      const rdzen = a.klub.toLowerCase().split(/[_-]/)[0];
      const podobne = wszystkieKluby.filter((k) => k !== dokladny && k.toLowerCase().startsWith(rdzen));
      if (podobne.length) {
        // Model sumował Konfederację z Konfederacją_KP, gdy dostał jedną wspólną listę. Przy dokładnym
        // trafieniu lista imienna zostaje przy tym jednym klubie, a każdy klub ma osobny wynik.
        if (!dokladny) klubyImiennej = podobne.map((k) => k.toLowerCase());
        const nazwy = [...(dokladny ? [dokladny] : []), ...podobne];
        niejasnosci.push({
          powod: `W dniu głosowania istniały OSOBNE kluby o podobnym skrócie: ${nazwy.join(', ')}.`,
          coZrobic: dokladny
            ? `Nie sumuj ich. Lista imienna obejmuje tylko klub „${dokladny}” (dokładnie ta nazwa); wynik każdego klubu podawaj osobno, z liczbami z wynikiKlubow.`
            : `Nie sumuj ich. Żaden klub nie nazywa się dokładnie „${a.klub}”; lista imienna obejmuje wszystkie te kluby (pole klub przy każdym pośle). Wynik każdego podawaj osobno, z wynikiKlubow.`,
          wynikiKlubow: (kluby ?? []).filter((k) => nazwy.includes((k as { klub: string }).klub)),
        });
      }
    }

    // Imiennicy: model szukał „posła Króla”, dostał ostrzeżenie w znajdz_posla, a potem pytał tu
    // o jednego i ostrzeżenie ginęło. Powtarzamy je w miejscu odpowiedzi, razem z głosem imiennika.
    const imiennicy: string[] = [];
    if (ids.length) {
      // Pomocnicze: awaria listy posłów nie może zabrać wyniku głosowania.
      const poslowie = await zrodlo
        .json<unknown>(`${T(a.kadencja)}/MP`)
        .then((x) => jakoLista<{ id: number; firstLastName?: string; lastName?: string }>(x, 'posłowie'))
        .catch((e: unknown) => {
          czesciGlosowania.push(
            czesciowyZBledu(e, 'sprawdzenia, czy inny poseł nosi to samo nazwisko (imiennicy); głos posła i wynik głosowania są pełne', 'jeśli pytanie nie podaje imienia, sprawdzić nazwisko narzędziem znajdz_posla'),
          );
          return [];
        });
      const nazwiskaPytanych = new Set(poslowie.filter((p) => ids.includes(p.id)).map((p) => klucz(p.lastName)));
      for (const p of poslowie) {
        if (ids.includes(p.id) || !nazwiskaPytanych.has(klucz(p.lastName))) continue;
        const v = glosy.find((x) => x.MP === p.id);
        imiennicy.push(`${p.firstLastName ?? p.lastName} (id ${p.id}): ${v ? etykieta(v) : 'brak na liście imiennej tego głosowania'}`);
      }
      if (imiennicy.length) {
        niejasnosci.push({
          powod: `To nazwisko nosi w tej kadencji także: ${imiennicy.join('; ')}.`,
          coZrobic: 'Jeśli pytanie nie podaje imienia, odpowiedz o każdym z nich (także o pośle, którego głosowanie dotyczy) albo zapytaj użytkownika.',
        });
      }
    }
    const niejednoznaczne =
      niejasnosci.length === 0 ? undefined : niejasnosci.length === 1 ? niejasnosci[0] : { powod: niejasnosci.map((n) => n.powod).join(' '), coZrobic: niejasnosci.map((n) => n.coZrobic).join(' '), wynikiKlubow: niejasnosci.find((n) => n.wynikiKlubow)?.wynikiKlubow };

    const skrot = skrotGlosowania(g);
    uwagi.push(...uwagiDoGlosowan([skrot]));
    if (a.listaImienna && !a.klub) {
      uwagi.push(
        'listaImienna całej izby jest zgrupowana: głos → klub z dnia głosowania → „Imię Nazwisko (id)” (460 wierszy po osobnym rekordzie to ok. 37 tys. znaków). ' +
          'Wiersz po wierszu, z wyborami przy kandydatach, daje parametr klub.',
      );
    }
    // Wybór z listy: zdanie mówi, ilu posłów oddało kartę i ilu było nieobecnych (03-2: „bez karty” czytano zamiast „nieobecny”).
    const zdanieListy =
      w.rodzaj === 'lista' && kluby
        ? (() => {
            const suma = (pole: string) => kluby!.reduce((s, k) => s + (((k as Record<string, unknown>)[pole] as number | undefined) ?? 0), 0);
            const inne = [
              suma('kartNiewaznych') ? `kart nieważnych ${suma('kartNiewaznych')}` : null,
              suma('obecniBezKarty') ? `obecnych bez karty ${suma('obecniBezKarty')}` : null,
              suma('nieuczestniczacy') ? `nieuczestniczących ${suma('nieuczestniczacy')}` : null,
            ].filter(Boolean);
            return `Według listy imiennej karty oddało ${suma('kartOddanych')} posłów, nieobecnych ${suma('nieobecni')}${inne.length ? `, ${inne.join(', ')}` : ''}.`;
          })()
        : null;
    uwagi.push('Kluby to przynależność w dniu głosowania, tak jak podaje ją lista imienna Sejmu, nie dzisiejszy klub posła.');

    const glosyPoslow = await Promise.all(
      ids.map(async (id) => {
        const v = glosy.find((x) => x.MP === id);
        return v
          ? { id, imieNazwisko: nazwisko(v), klubWDniuGlosowania: v.club ?? null, glos: etykieta(v), wybory: wybory(v) }
          : { id, glos: null, uwaga: await powodBraku(zrodlo, a.kadencja, id, g.date) };
      }),
    );
    const zdaniePosla = glosyPoslow.length
      ? glosyPoslow
          .map((p) => ('imieNazwisko' in p ? `${p.imieNazwisko} (klub w dniu głosowania: ${p.klubWDniuGlosowania ?? 'bez klubu'}): ${p.glos}.` : `Poseł ${p.id}: ${p.uwaga}`))
          .join(' ')
      : null;
    const wynikCzesciowyGlosowania = polaczCzesciowe(...czesciGlosowania);
    return {
      znaleziono: true,
      ...(wynikCzesciowyGlosowania ? { wynikCzesciowy: wynikCzesciowyGlosowania } : {}),
      odpowiedz: [zdanieOGlosowaniu(g), zdanieListy, zdaniePosla, imiennicy.length ? `Imiennicy w tej kadencji: ${imiennicy.join('; ')}.` : null].filter(Boolean).join(' '),
      ...(niejednoznaczne ? { niejednoznaczne } : {}),
      ...skrot,
      glosowalo: g.totalVoted,
      przeciwWszystkim: w.rodzaj === 'lista' ? (g.againstAll ?? null) : undefined,
      wybrani: w.rodzaj === 'lista' ? w.wybrani.map(nazwaZListy) : undefined,
      kandydaci: w.rodzaj === 'lista' ? await kandydaciZNazwiskami(zrodlo, a.kadencja, g.votingOptions ?? []) : undefined,
      kluby,
      glosPosla: glosyPoslow.length === 1 ? glosyPoslow[0] : glosyPoslow.length ? glosyPoslow : undefined,
      listaImienna: a.klub
        ? imiennaDla().map((v) => ({
            id: v.MP,
            imieNazwisko: nazwisko(v),
            klub: v.club ?? null,
            glos: etykieta(v),
            // Cała izba z wyborami przy każdym kandydacie to ok. 65 tys. znaków: wybory tylko dla jednego klubu.
            wybory: wybory(v),
          }))
        : a.listaImienna
          ? imiennaWgGlosu(glosy, etykieta, nazwisko)
          : undefined,
      zrodla: [zrodlo.adres(sciezka), `${zrodlo.adres(sciezka)}/pdf`],
      uwagi,
    };
  },
});

/**
 * Tytuł punktu porządku powtarzał się przy każdym głosowaniu (poprawki jednej ustawy: kilkanaście
 * razy po 200 znaków) i był prawie połową wyniku. Przy głosie zostaje „Pkt. 16”, a pełny tytuł
 * raz w słowniku punkty. Tytuł bez numeru punktu albo numer z dwoma różnymi tytułami zostaje w całości.
 */
function skrocPunkty<G extends { punkt: string | null }>(glosy: G[]) {
  const tytuly = new Map<string, Set<string>>();
  const klucz = (t: string) => /^(Pkt\.\s*\d+[a-z]?)\s+(.+)$/su.exec(t);
  for (const g of glosy) {
    const m = g.punkt ? klucz(g.punkt) : null;
    if (m) tytuly.set(m[1], (tytuly.get(m[1]) ?? new Set()).add(m[2]));
  }
  const punkty: Record<string, string> = {};
  for (const [k, t] of tytuly) if (t.size === 1) punkty[k] = [...t][0];
  const glosyKrotko = glosy.map((g) => {
    const m = g.punkt ? klucz(g.punkt) : null;
    return m && m[1] in punkty ? { ...g, punkt: m[1] } : g;
  });
  return { punkty, glosyKrotko };
}

export const glosyPoslaWDniu = narzedzie({
  nazwa: 'glosy_posla_w_dniu',
  tytul: 'Jak głosował poseł danego dnia',
  opis:
    'Wszystkie głosy jednego posła w jednym dniu posiedzenia, z tematem, punktem porządku obrad i rozstrzygnięciem przy poprawkach Senatu i wecie. ' +
    'Jak poseł głosował w serii głosowań jednego dnia (np. nad wszystkimi poprawkami Senatu): to narzędzie, jedno wywołanie, a nie glosowanie po kolei. ' +
    'Dni posiedzeń daje lista_posiedzen albo profil_posla z dni=true.',
  wejscie: z.object({
    id: z.number().int().min(1).describe('Numer posła'),
    posiedzenie: z.number().int().min(1),
    data: data.describe('Dzień posiedzenia (RRRR-MM-DD)'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const sciezka = `${T(a.kadencja)}/MP/${a.id}/votings/${a.posiedzenie}/${a.data}`;
    const lista = jakoLista<{ votingNumber: number; date: string; kind: string; topic?: string; title?: string; description?: string; vote: string }>(
      await zrodlo.json<unknown>(sciezka),
      'głosy posła',
    );
    // Głos posła nie niesie wyniku ani liczb, więc bez głosowań posiedzenia nie odróżnimy apelu o kworum
    // od „obecny bez głosu” ani nie powiemy, czy poprawka Senatu przeszła. Pomocnicze: awaria nie zabiera głosów.
    const sG = `${T(a.kadencja)}/votings/${a.posiedzenie}`;
    let czesciowyDnia: WynikCzesciowy | undefined;
    const posiedzenie = lista.length
      ? await zrodlo
          .json<unknown>(sG)
          .then((x) => jakoLista<GlosowanieZRejestru>(x, 'głosowania posiedzenia'))
          .catch((e: unknown) => {
            czesciowyDnia = czesciowyZBledu(
              e,
              'odróżnienia apeli o kworum od zwykłych głosowań, liczby głosowań bez oddanego głosu i rozstrzygnięć poprawek Senatu; same głosy posła są pełne',
            );
            return null;
          })
      : null;
    const wgNumeru = new Map((posiedzenie ?? []).map((g) => [g.votingNumber, g]));
    const glosy = lista.map((g) => {
      const pelne = wgNumeru.get(g.votingNumber);
      const w = pelne && typeof pelne.yes === 'number' ? wynikGlosowania(pelne) : null;
      const kworum = w?.rodzaj === 'kworum';
      const senat = w ? (w.senat ?? null) : glosowanieSenackie(g);
      let glos: string;
      try {
        glos = etykietaGlosu(g.vote, g.kind, kworum, senat);
      } catch {
        glos = g.vote;
      }
      const opis = czysty(g.description);
      // Dzień jest w pytaniu, więc przy głosie sama godzina; nawias etykiety Senatu („wniosek
      // o odrzucenie nie uzyskał…”) wynika z UWAGA_SENAT i powtarzał się przy każdej poprawce.
      const rozstrzygniecie = w && (w.senat || rozstrzygniecieWeta(pelne!)) ? (rozstrzygniecieWeta(pelne!) ?? w.etykieta.replace(/\s*\([^()]*\)$/, '')) : null;
      return {
        numer: g.votingNumber,
        godzina: String(g.date ?? '').slice(11, 19) || null,
        temat: czysty(g.topic),
        ...(opis ? { opis } : {}),
        punkt: tytulPunktu(g.title),
        glos,
        ...(kworum ? { apelOKworum: true } : {}),
        ...(rozstrzygniecie ? { rozstrzygniecie } : {}),
      };
    });
    const { punkty, glosyKrotko } = skrocPunkty(glosy);
    const uwagi: string[] = [];
    if (lista.length === 0) {
      uwagi.push('Pusta lista: tego dnia nie było głosowań na tym posiedzeniu albo poseł nie miał wtedy mandatu. Sprawdź datę w lista_posiedzen.');
    }
    const apele = posiedzenie ? glosy.filter((g) => 'apelOKworum' in g).length : null;
    // Na apelu (oba tryby) każde naciśnięcie to obecność, brak naciśnięcia to opuszczony apel: poza liczbą nieobecności.
    const naApelach = posiedzenie
      ? lista.filter((_, i) => 'apelOKworum' in glosy[i]).map((g) => {
          try {
            return poselNaApelu(g.vote);
          } catch {
            return null;
          }
        })
      : null;
    const apeleObecny = naApelach ? naApelach.filter((x) => x === 'obecny').length : null;
    const apeleOpuszczone = naApelach ? naApelach.filter((x) => x === 'opuszczony').length : null;
    // Poza apelami: nieobecność, obecność bez głosu i nieuczestniczenie to brak oddanego głosu.
    const bezGlosu = posiedzenie
      ? lista.filter((g, i) => !('apelOKworum' in glosy[i]) && g.kind !== 'ON_LIST' && ['ABSENT', 'PRESENT', 'NOT_PARTICIPATING', 'NO_VOTE'].includes((g.vote ?? '').toUpperCase())).length
      : null;
    if (apele === null && lista.some((g) => g.vote === 'PRESENT')) {
      uwagi.push('„Obecność bez oddania głosu” na apelu o kworum jest udziałem; rodzaj głosowania sprawdzisz narzędziem glosowanie.');
    }
    if (apele) uwagi.push(UWAGA_APELE_STATYSTYKA);
    if (glosy.some(senackieZTekstu)) uwagi.push(UWAGA_SENAT);
    for (const g of posiedzenie ?? []) {
      if (!lista.some((x) => x.votingNumber === g.votingNumber) || typeof g.yes !== 'number') continue;
      const ostrzezenie = apelDoPrzegladu(g);
      if (ostrzezenie) uwagi.push(ostrzezenie);
    }
    if (Object.keys(punkty).length) uwagi.push('Przy głosie stoi numer punktu porządku („Pkt. 16”); pełny tytuł punktu podaje pole punkty. Godziny są z dnia z pytania.');
    return {
      ...(czesciowyDnia ? { wynikCzesciowy: czesciowyDnia } : {}),
      ...(lista.length
        ? {
            odpowiedz:
              `Poseł ${a.id}, ${a.data} (posiedzenie ${a.posiedzenie}): ${odmiana(lista.length, ['głosowanie', 'głosowania', 'głosowań'])}` +
              (apele === null
                ? '.'
                : `${apele ? `, w tym ${odmiana(apele, ['apel', 'apele', 'apeli'])} o kworum (bez nich ${lista.length - apele}; statystyka Sejmu apeli z reguły nie liczy)` : ''}; ` +
                  `bez oddanego głosu (nieobecność, obecność bez głosu, nieuczestniczenie) poza apelami: ${bezGlosu}` +
                  `${apele ? `; na apelach obecność ${apeleObecny}, opuszczone apele ${apeleOpuszczone} (osobno, poza liczbą nieobecności)` : ''}.`),
          }
        : {}),
      glosowan: lista.length,
      apeliOKworum: apele,
      glosowanBezApeli: apele === null ? null : lista.length - apele,
      bezOddanegoGlosu: bezGlosu,
      ...(apele ? { apeleObecnosc: apeleObecny, apeleOpuszczone } : {}),
      ...(Object.keys(punkty).length ? { punkty } : {}),
      glosy: glosyKrotko,
      zrodla: [zrodlo.adres(sciezka), ...(posiedzenie ? [zrodlo.adres(sG)] : [])],
      uwagi,
    };
  },
});
