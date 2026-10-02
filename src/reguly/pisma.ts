/**
 * Interpelacje i zapytania: termin 21 dni i stan odpowiedzi.
 *
 * Termin odpowiedzi (21 dni od doręczenia adresatowi) i stan odpowiedzi na każde pismo.
 */

import { klucz } from '../tekst.js';
import { dataWarszawa, dodajDni, dzisWarszawa, roznicaDni } from './daty.js';

/** Adresat pisma z `recipientDetails`. */
export interface AdresatPisma {
  name: string;
  /** Data doręczenia ministrowi, 'YYYY-MM-DD'. */
  sent: string | null;
  answerDelayedDays?: number | null;
}

export interface OdpowiedzPisma {
  receiptDate?: string | null;
  prolongation?: boolean | null;
  key?: string | null;
  /** Podpis: osoba, czasem z resortem („podsekretarz stanu w Ministerstwie … - Imię Nazwisko”). */
  from?: string | null;
}

/** Ustawowy termin na odpowiedź w dniach. */
export const DNI_NA_ODPOWIEDZ = 21;

/** Wcześniejsza data w rejestrze pism to błąd zapisu, nie fakt (interpelacja 20000 z VII kadencji: „0000-12-30”). */
const NAJWCZESNIEJSZY_ROK = 1990;

/**
 * Czy data z rejestru może być prawdziwa: rok od 1990 i najpóźniej jutro. „0000-12-30” liczone
 * dosłownie dawało -735101 dni po terminie i werdykt „w terminie” (17-b).
 */
export function wiarygodnaData(d: string | null | undefined, dzis: string = dzisWarszawa()): boolean {
  if (!d) return false;
  const dzien = dataWarszawa(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dzien) || Number(dzien.slice(0, 4)) < NAJWCZESNIEJSZY_ROK) return false;
  return dzien <= dodajDni(dataWarszawa(dzis), 1);
}

/**
 * Termin odpowiedzi: 21 dni od doręczenia ministrowi, nie od wpływu do Sejmu. Liczony od
 * wpływu dawał 23,5% odpowiedzi w terminie zamiast 55,4%.
 */
export function terminOdpowiedzi(adresat: AdresatPisma, dni: number = DNI_NA_ODPOWIEDZ): string | null {
  if (!adresat || !adresat.sent || !wiarygodnaData(adresat.sent)) return null;
  return dodajDni(adresat.sent, dni);
}

/** Prolongata to nie odpowiedź. */
export function czyOdpowiedziano(odpowiedzi: OdpowiedzPisma[] | null | undefined): boolean {
  return (odpowiedzi ?? []).some((r) => r && !r.prolongation);
}

/** Pierwsza odpowiedź, która nie jest prolongatą, po dacie wpływu (daty błędne pomijamy). */
export function pierwszaOdpowiedz(odpowiedzi: OdpowiedzPisma[] | null | undefined, dzis?: string): OdpowiedzPisma | null {
  const realne = (odpowiedzi ?? []).filter((r) => r && !r.prolongation && wiarygodnaData(r.receiptDate, dzis));
  if (realne.length === 0) return (odpowiedzi ?? []).find((r) => r && !r.prolongation) ?? null;
  return realne.reduce((a, b) => ((a.receiptDate as string) <= (b.receiptDate as string) ? a : b));
}

export interface StanPisma {
  odpowiedziano: boolean;
  termin: string | null;
  /** Ile dni po terminie. Ujemne, gdy odpowiedź przyszła przed terminem. */
  spoznienieDni: number | null;
  /** Ile dni czeka pismo bez odpowiedzi, licząc od doręczenia. */
  czekaDni: number | null;
  /** Data wpływu odpowiedzi z rejestru, gdy jest błędna: odpowiedź jest, terminowości nie da się ustalić. */
  bladDatyOdpowiedzi?: string;
}

/**
 * Stan jednej pary pismo-adresat na dzień `dzis`. `answerDelayedDays` z API to licznik na
 * żywo, który Sejm zeruje po odpowiedzi, więc opóźnienie liczymy z daty pierwszej odpowiedzi.
 */
export function stanPisma(
  adresat: AdresatPisma,
  odpowiedzi: OdpowiedzPisma[] | null | undefined,
  dzis: string,
): StanPisma {
  const termin = terminOdpowiedzi(adresat);
  if (czyOdpowiedziano(odpowiedzi)) {
    const data = pierwszaOdpowiedz(odpowiedzi, dzis)?.receiptDate ?? null;
    const bledna = !!data && !wiarygodnaData(data, dzis);
    return {
      odpowiedziano: true,
      termin,
      spoznienieDni: termin && data && !bledna ? roznicaDni(termin, data) : null,
      czekaDni: null,
      ...(bledna ? { bladDatyOdpowiedzi: data } : {}),
    };
  }
  const dzien = dataWarszawa(dzis);
  return {
    odpowiedziano: false,
    termin,
    spoznienieDni: termin ? Math.max(0, roznicaDni(termin, dzien)) : null,
    czekaDni: adresat?.sent ? roznicaDni(adresat.sent, dzien) : null,
  };
}

// ---------------------------------------------------------------------------
// Kilku adresatów: czyja jest która odpowiedź
// ---------------------------------------------------------------------------

/**
 * Resort z podpisu. Dwie postaci w rejestrze: „podsekretarz stanu w Ministerstwie Rodziny, Pracy
 * i Polityki Społecznej - Katarzyna Nowakowska” oraz, w prolongatach, „minister rodziny, pracy
 * i polityki społecznej - Agnieszka Dziemianowicz-Bąk”. Sam „Minister Agnieszka Dziemianowicz-Bąk”
 * resortu nie ma (łącznik w nazwisku nie ma spacji, więc nie myli się z „ - ”).
 */
function resortZPodpisu(podpis: string): string | null {
  const m = /ministerstw(?:ie|a|o)\s+(.+?)(?:\s+-\s+|$)/i.exec(podpis) ?? /^\s*minister\s+(.+?)\s+-\s+\S/i.exec(podpis);
  if (m) return bezSkrotow(m[1]);
  return /kancelari\w* prezesa rady ministr/.test(klucz(podpis)) ? KPRM : null;
}

/** Osoba z podpisu: po myślniku („… - Katarzyna Nowakowska”) albo dwa ostatnie słowa. */
function osobaZPodpisu(podpis: string): string {
  const poMysliku = podpis.split(/\s+-\s+/).at(-1) ?? podpis;
  return klucz(poMysliku.trim().split(/\s+/).slice(-2).join(' '));
}

/** Kancelaria premiera występuje pod kilkoma nazwami; wszystkie sprowadzamy do jednej. */
const KPRM = 'kancelaria prezesa rady ministrow';

/** „ds.” w nazwie urzędu to „do spraw”; bez tego „minister ds. polityki senioralnej” nie pasuje do treści. */
function bezSkrotow(s: string): string {
  return klucz(s).replace(/\bds\.\s*/g, 'do spraw ').replace(/\s+/g, ' ');
}

/**
 * „minister rodziny, pracy i polityki społecznej” → „rodziny, pracy i polityki spolecznej”.
 * „minister - członek Rady Ministrów, szef Kancelarii Prezesa Rady Ministrów” i „prezes Rady
 * Ministrów” → jedna nazwa kancelarii, bo odpowiada za nich zawsze Kancelaria (zapytanie 3442).
 */
function resortAdresata(nazwa: string): string {
  const k = bezSkrotow(nazwa);
  if (/kancelari\w* prezesa rady ministrow|^prezes rady ministrow/.test(k)) return KPRM;
  return k.replace(/^minister\s+(?:-\s+czlonek rady ministrow,?\s*)?/, '');
}

/**
 * Linia „Odpowiadający: …” z treści odpowiedzi (HTML z /reply/KLUCZ/body). Rejestr pisze tam
 * urząd, którego w polu `from` często brak: „Sekretarz stanu Wiesław Szczepański” w polu `from`,
 * a w treści „sekretarz stanu w Ministerstwie Spraw Wewnętrznych i Administracji Wiesław
 * Szczepański” (zapytanie 3442).
 */
export function odpowiadajacyZTresci(tekst: string | null | undefined): string | null {
  const m = /Odpowiadaj[aą]cy\s*:\s*([^\n<]+)/i.exec(tekst ?? '');
  const linia = m?.[1].trim();
  return linia ? linia : null;
}

/**
 * Indeks adresata, którego urząd stoi w linii „Odpowiadający”. Po nazwie urzędu jest imię
 * i nazwisko, więc szukamy adresata, którego nazwa jest POCZĄTKIEM reszty linii; przy kilku
 * (minister finansów oraz minister finansów i gospodarki) wygrywa najdłuższa. Remis to brak
 * dopasowania: nie zgadujemy.
 */
export function adresatOdpowiadajacego(linia: string, adresaci: readonly AdresatPisma[]): number | null {
  const k = bezSkrotow(linia);
  const ogon = /ministerstw(?:ie|a|o|em)\s+(.+)$/.exec(k)?.[1] ?? (/kancelari\w* prezesa rady ministrow/.test(k) ? KPRM : k.replace(/^minister\s+/, ''));
  let najlepszy: number | null = null;
  let dlugosc = 0;
  let remis = false;
  adresaci.forEach((a, i) => {
    const r = resortAdresata(a.name);
    if (!r || !(ogon === r || ogon.startsWith(`${r} `) || ogon.startsWith(`${r},`))) return;
    if (r.length > dlugosc) [najlepszy, dlugosc, remis] = [i, r.length, false];
    else if (r.length === dlugosc) remis = true;
  });
  return remis ? null : najlepszy;
}

/**
 * Skąd wiemy, czyja jest odpowiedź. Tylko `jeden-adresat` i `resort-w-podpisie` czyta się wprost
 * z rekordu; dwa pozostałe to wnioski i tak trzeba je podawać.
 */
export type SposobPrzypisania = 'jeden-adresat' | 'resort-w-podpisie' | 'tresc-odpowiedzi' | 'ta-sama-osoba' | 'po-datach' | 'jedyny-pozostaly';

export const OPIS_PRZYPISANIA: Record<SposobPrzypisania, string> = {
  'jeden-adresat': 'pismo ma jednego adresata',
  'resort-w-podpisie': 'resort w podpisie odpowiedzi',
  'tresc-odpowiedzi': 'wniosek z treści odpowiedzi: urząd z linii „Odpowiadający” dopasowany do nazwy adresata',
  'ta-sama-osoba': 'wniosek: tę odpowiedź podpisała ta sama osoba, która podpisywała prolongaty lub odpowiedzi tego resortu',
  'po-datach': 'wniosek z dat: odpowiedź wpłynęła, zanim pismo doręczono pozostałym adresatom, więc nie mogła być ich',
  'jedyny-pozostaly':
    'wniosek: to jedyny adresat, który mógł jej udzielić (pozostali już po niej prosili o przedłużenie terminu albo licznik Sejmu mówi, że nie odpowiedzieli)',
};

export interface PrzypisanieOdpowiedzi {
  /** Odpowiedzi (bez prolongat i z prolongatami) przypisane do adresata o tym samym indeksie. */
  adresatow: OdpowiedzPisma[][];
  /** Odpowiedzi, których nie da się przypisać żadnemu adresatowi. */
  nieprzypisane: OdpowiedzPisma[];
  /** Jak przypisano każdą przypisaną odpowiedź. */
  sposob: Map<OdpowiedzPisma, SposobPrzypisania>;
}

/**
 * Rejestr nie mówi, od którego adresata jest odpowiedź, ale podpis często mówi: „podsekretarz
 * stanu w Ministerstwie Rodziny, Pracy i Polityki Społecznej - Katarzyna Nowakowska”. Resort
 * z podpisu dopasowujemy do nazwy adresata; podpis bez resortu dziedziczy resort tej samej
 * osoby z innych podpisów pod pismem (prolongaty zwykle go mają). Przy jednym adresacie każda
 * odpowiedź jest jego. Na końcu jedna nieprzypisana odpowiedź trafia do jedynego adresata, który
 * mógł jej udzielić, ale tylko gdy pozostałych wyklucza licznik Sejmu (większy od zera znaczy
 * brak odpowiedzi) albo podpisał ją sam „Minister …” (zapytanie 3550). Reszta zostaje
 * nieprzypisana: nie zgadujemy. Równa liczba odpowiedzi i adresatów nie jest dowodem
 * (interpelacja 6746: obie odpowiedzi podpisał sekretarz stanu MSZ).
 */
export function przypiszOdpowiedzi(
  adresaci: readonly AdresatPisma[],
  odpowiedzi: OdpowiedzPisma[] | null | undefined,
  odpowiadajacy?: ReadonlyMap<string, string>,
): PrzypisanieOdpowiedzi {
  const lista = odpowiedzi ?? [];
  const wynik: PrzypisanieOdpowiedzi = { adresatow: adresaci.map(() => []), nieprzypisane: [], sposob: new Map() };
  if (adresaci.length === 1) {
    wynik.adresatow[0] = [...lista];
    for (const r of lista) wynik.sposob.set(r, 'jeden-adresat');
    return wynik;
  }
  const resorty = adresaci.map((a) => resortAdresata(a.name));
  const pasujace = (resort: string) =>
    resorty.map((x, i) => (x === resort || x.startsWith(resort) || resort.startsWith(x) ? i : -1)).filter((i) => i >= 0);
  const przypisz = (r: OdpowiedzPisma, i: number, sposob: SposobPrzypisania) => {
    wynik.adresatow[i].push(r);
    wynik.sposob.set(r, sposob);
  };
  let reszta: OdpowiedzPisma[] = [];
  // 1. Resort w samym podpisie.
  for (const r of lista) {
    const resort = r.from ? resortZPodpisu(r.from) : null;
    const trafienia = resort ? pasujace(resort) : [];
    if (trafienia.length === 1) przypisz(r, trafienia[0], 'resort-w-podpisie');
    else reszta.push(r);
  }
  // 2. Urząd z linii „Odpowiadający” w treści odpowiedzi (gdy wywołujący ją pobrał).
  if (odpowiadajacy?.size) {
    reszta = reszta.filter((r) => {
      const linia = r.key ? odpowiadajacy.get(r.key) : undefined;
      const i = linia ? adresatOdpowiadajacego(linia, adresaci) : null;
      if (i === null) return true;
      przypisz(r, i, 'tresc-odpowiedzi');
      return false;
    });
  }
  // 3. Podpis bez resortu dziedziczy adresata tej samej osoby z innych, już przypisanych podpisów.
  const osoby = new Map<string, number | null>();
  adresaci.forEach((_, i) => {
    for (const r of wynik.adresatow[i]) {
      if (!r.from) continue;
      const o = osobaZPodpisu(r.from);
      osoby.set(o, osoby.has(o) && osoby.get(o) !== i ? null : i);
    }
  });
  reszta = reszta.filter((r) => {
    const i = r.from ? osoby.get(osobaZPodpisu(r.from)) : undefined;
    if (i === undefined || i === null) return true;
    przypisz(r, i, 'ta-sama-osoba');
    return false;
  });
  // 4. Daty: odpowiedź, która wpłynęła przed doręczeniem pisma adresatowi, nie jest jego
  // (interpelacja 18694: odpowiedź 2026-08-07, a ministrowi infrastruktury doręczono 2026-08-13).
  // Gdy zostaje dokładnie jeden adresat, któremu doręczono wcześniej, odpowiedź jest jego.
  reszta = reszta.filter((r) => {
    if (!r.receiptDate || !wiarygodnaData(r.receiptDate)) return true;
    const dzien = r.receiptDate.slice(0, 10);
    if (adresaci.some((a) => !a.sent)) return true;
    const mogli = adresaci.map((a, i) => ((a.sent as string).slice(0, 10) <= dzien ? i : -1)).filter((i) => i >= 0);
    if (mogli.length !== 1) return true;
    przypisz(r, mogli[0], 'po-datach');
    return false;
  });
  wynik.nieprzypisane = reszta;

  const nieprzypisaneOdp = wynik.nieprzypisane.filter((r) => !r.prolongation);
  const licznikMowiBrak = (i: number) => (adresaci[i].answerDelayedDays ?? 0) > 0;
  const kandydaci = adresaci.map((_, i) => i).filter((i) => !czyOdpowiedziano(wynik.adresatow[i]) && !licznikMowiBrak(i));
  if (kandydaci.length === 1 && nieprzypisaneOdp.length === 1) {
    const r = nieprzypisaneOdp[0];
    // Resort, który PO tej odpowiedzi prosił o przedłużenie terminu, nie był jej autorem: jeszcze
    // nie odpowiedział. Interpelacja 12789: odpowiedź Wrony 2025-11-04, a resort rodziny prosił
    // o przedłużenie 2025-11-12 i później; bez tego stan całego pisma zostawał „nie wiadomo”.
    const prolongowalPo = (i: number) =>
      wiarygodnaData(r.receiptDate) &&
      wynik.adresatow[i].some((x) => x.prolongation && wiarygodnaData(x.receiptDate) && (x.receiptDate as string) > (r.receiptDate as string));
    const inniWykluczeni = adresaci.every((_, i) => i === kandydaci[0] || licznikMowiBrak(i) || prolongowalPo(i));
    const podpisMinistra = /^\s*minister\s+\S/i.test(r.from ?? '') && !resortZPodpisu(r.from ?? '');
    if (inniWykluczeni || podpisMinistra) {
      wynik.adresatow[kandydaci[0]].push(r);
      wynik.nieprzypisane = wynik.nieprzypisane.filter((x) => x !== r);
      wynik.sposob.set(r, 'jedyny-pozostaly');
    }
  }
  return wynik;
}

export interface StanAdresata extends StanPisma {
  /** Nie wiadomo, czy ten adresat odpowiedział: pod pismem są odpowiedzi, których nie da się przypisać. */
  odpowiedzNieprzypisana: boolean;
  /** Podpis odpowiedzi przypisanej temu adresatowi. */
  podpisal: string | null;
  /** Jak przypisano odpowiedź temu adresatowi (null, gdy nie ma przypisanej odpowiedzi). */
  przypisanie: SposobPrzypisania | null;
}

/**
 * Stan każdej pary pismo-adresat.
 *
 * 1. Odpowiedź przypisana adresatowi (podpis, a przy jednym adresacie każda) zamyka jego sprawę,
 *    z własną datą, więc liczymy też, czy przyszła w terminie.
 * 2. Licznik opóźnienia Sejmu większy od zera znaczy, że adresat nie odpowiedział.
 * 3. Zero na liczniku NIC nie mówi: Sejm zeruje go też adresatowi, który nie odpowiedział
 *    (interpelacja 12176: minister finansów nie odpowiedział, a licznik ma 0). Jeśli pod pismem
 *    została odpowiedź nieprzypisana, stan adresata jest „nie wiadomo”; jeśli nie, adresat nie
 *    odpowiedział i liczymy spóźnienie od terminu.
 */
export function stanyAdresatow(
  adresaci: readonly AdresatPisma[] | null | undefined,
  odpowiedzi: OdpowiedzPisma[] | null | undefined,
  dzis: string,
  odpowiadajacy?: ReadonlyMap<string, string>,
): StanAdresata[] {
  const lista = adresaci ?? [];
  const przypisanie = przypiszOdpowiedzi(lista, odpowiedzi, odpowiadajacy);
  const nieprzypisaneOdpowiedzi = przypisanie.nieprzypisane.filter((r) => !r.prolongation);
  return lista.map((a, i) => {
    const wlasne = przypisanie.adresatow[i];
    if (czyOdpowiedziano(wlasne)) {
      const pierwsza = pierwszaOdpowiedz(wlasne, dzis);
      return {
        ...stanPisma(a, wlasne, dzis),
        odpowiedzNieprzypisana: false,
        podpisal: pierwsza?.from ?? null,
        przypisanie: (pierwsza && przypisanie.sposob.get(pierwsza)) ?? null,
      };
    }
    const bez = stanPisma(a, [], dzis);
    if ((a.answerDelayedDays ?? 0) > 0) return { ...bez, odpowiedzNieprzypisana: false, podpisal: null, przypisanie: null };
    if (nieprzypisaneOdpowiedzi.length > 0) {
      return { ...bez, spoznienieDni: null, czekaDni: null, odpowiedzNieprzypisana: true, podpisal: null, przypisanie: null };
    }
    return { ...bez, odpowiedzNieprzypisana: false, podpisal: null, przypisanie: null };
  });
}

/**
 * Co da się powiedzieć o adresatach „nie wiadomo” bez przypisywania odpowiedzi.
 *
 * - Mniej nieprzypisanych odpowiedzi niż adresatów o nieznanym stanie: co najmniej różnica nie
 *   odpowiedziała (interpelacja 17177: 1 odpowiedź na 2 adresatów). To pewne.
 * - Równa albo większa liczba NIE jest dowodem, że odpowiedzieli wszyscy: jeden resort bywa
 *   autorem dwóch odpowiedzi (6746).
 * - Wspólny termin (ta sama data doręczenia) pozwala powiedzieć, które odpowiedzi przyszły po
 *   terminie, bez wiedzy, czyje są (4637).
 */
export interface WnioskiPisma {
  /** Adresaci o nieznanym stanie (odpowiedzi nie da się przypisać). */
  nieznanych: number;
  /** Odpowiedzi (bez prolongat), których nie przypisano. */
  nieprzypisanychOdpowiedzi: number;
  /** Co najmniej tylu adresatów o nieznanym stanie nie odpowiedziało. */
  coNajmniejBezOdpowiedzi: number;
  /** Termin wspólny adresatom o nieznanym stanie; null, gdy różny albo nieznany. */
  terminNieznanych: string | null;
  /** Terminy adresatów o nieznanym stanie (różne, gdy doręczono im w różne dni). */
  terminyNieznanych: string[];
  /**
   * Ile dni po terminie są ci bez odpowiedzi (0, gdy wspólny termin jeszcze nie minął). Przy
   * różnych terminach to dolna granica: najmniej dni po terminie spośród nieznanych, podawana
   * tylko, gdy wszystkim nieznanym termin już minął.
   */
  bezOdpowiedziDniPoTerminie: number | null;
  /** true, gdy bezOdpowiedziDniPoTerminie to „co najmniej” (różne terminy). */
  dniPoTerminieNajmniej: boolean;
  /** Termin wspólny WSZYSTKIM adresatom; null, gdy różne. */
  wspolnyTermin: string | null;
}

export function wnioskiPisma(
  adresaci: readonly AdresatPisma[] | null | undefined,
  odpowiedzi: OdpowiedzPisma[] | null | undefined,
  dzis: string,
  stany?: StanAdresata[],
  odpowiadajacy?: ReadonlyMap<string, string>,
): WnioskiPisma {
  stany ??= stanyAdresatow(adresaci, odpowiedzi, dzis, odpowiadajacy);
  const lista = adresaci ?? [];
  const wspolny = (terminy: Array<string | null>) =>
    terminy.length > 0 && terminy.every((t) => t !== null && t === terminy[0]) ? terminy[0] : null;
  const nieznani = stany.filter((s) => s.odpowiedzNieprzypisana);
  const przypisanie = przypiszOdpowiedzi(lista, odpowiedzi, odpowiadajacy);
  const nieprzypisanych = przypisanie.nieprzypisane.filter((r) => !r.prolongation).length;
  const coNajmniej = Math.max(0, nieznani.length - nieprzypisanych);
  const terminNieznanych = wspolny(nieznani.map((s) => s.termin));
  const terminy = nieznani.map((s) => s.termin);
  const dzien = dataWarszawa(dzis);
  let dni: number | null = null;
  let najmniej = false;
  if (coNajmniej > 0 && terminNieznanych) dni = Math.max(0, roznicaDni(terminNieznanych, dzien));
  else if (coNajmniej > 0 && terminy.length && terminy.every((t) => t !== null)) {
    // Różne terminy (interpelacja 2183): ktoś nie odpowiedział, nie wiadomo kto, ale jeśli
    // wszystkim termin minął, jest po terminie co najmniej tyle dni, ile najmłodszy termin.
    const najmniejDni = Math.min(...terminy.map((t) => roznicaDni(t as string, dzien)));
    if (najmniejDni > 0) [dni, najmniej] = [najmniejDni, true];
  }
  return {
    nieznanych: nieznani.length,
    nieprzypisanychOdpowiedzi: nieznani.length ? nieprzypisanych : 0,
    coNajmniejBezOdpowiedzi: coNajmniej,
    terminNieznanych,
    terminyNieznanych: [...new Set(terminy.filter((t): t is string => t !== null))].sort(),
    bezOdpowiedziDniPoTerminie: dni,
    dniPoTerminieNajmniej: najmniej,
    wspolnyTermin: lista.length > 1 ? wspolny(stany.map((s) => s.termin)) : null,
  };
}

export interface StanPismaWLiscie {
  /**
   * odpowiedziano: wszyscy adresaci odpowiedzieli w terminie; odpowiedziano-po-terminie: wszyscy
   * odpowiedzieli, ktoś po terminie; po-terminie: komuś termin minął bez odpowiedzi (także gdy
   * odpowiedzi jest mniej niż adresatów, a wspólny termin minął); w-terminie: nikomu termin nie
   * minął; nie-wiadomo: są odpowiedzi, których nie da się przypisać adresatom; bez-terminu: rejestr
   * nie podał daty doręczenia; odpowiedziano-termin-nieznany: wszyscy odpowiedzieli, ale rejestr
   * podaje błędną datę odpowiedzi, więc terminowości nie da się ustalić.
   */
  rodzaj: 'odpowiedziano' | 'odpowiedziano-po-terminie' | 'odpowiedziano-termin-nieznany' | 'po-terminie' | 'w-terminie' | 'nie-wiadomo' | 'bez-terminu';
  adresatow: number;
  poTerminie: number;
  najdluzejPoTerminieDni: number | null;
  najblizszyTermin: string | null;
}

/** Pismo jako całość, w jednym określeniu, złożone ze stanów adresatów. */
export function stanPismaWLiscie(
  adresaci: AdresatPisma[] | null | undefined,
  odpowiedzi: OdpowiedzPisma[] | null | undefined,
  dzis: string,
  odpowiadajacy?: ReadonlyMap<string, string>,
): StanPismaWLiscie {
  const stany = stanyAdresatow(adresaci, odpowiedzi, dzis, odpowiadajacy);
  return zlozStan(stany, czyOdpowiedziano(odpowiedzi), wnioskiPisma(adresaci, odpowiedzi, dzis, stany, odpowiadajacy));
}

/**
 * `wnioski` (opcjonalne) pozwalają zamienić „nie wiadomo” na pewny stan: gdy odpowiedzi jest
 * mniej niż adresatów o nieznanym stanie, a ich wspólny termin minął, to komuś termin minął bez
 * odpowiedzi; gdy termin jeszcze nie minął, nikt nie jest spóźniony.
 */
export function zlozStan(stany: StanAdresata[], jestOdpowiedz: boolean, wnioski?: WnioskiPisma): StanPismaWLiscie {
  const zalegle = stany.filter((s) => !s.odpowiedziano && !s.odpowiedzNieprzypisana && s.termin !== null && (s.spoznienieDni ?? 0) > 0);
  const czekajace = stany.filter((s) => !s.odpowiedziano && !s.odpowiedzNieprzypisana && s.termin !== null && (s.spoznienieDni ?? 0) === 0);
  const pewneZalegle = wnioski && wnioski.coNajmniejBezOdpowiedzi > 0 && (wnioski.bezOdpowiedziDniPoTerminie ?? 0) > 0 ? wnioski : null;
  const dniZalegle = [...zalegle.map((s) => s.spoznienieDni ?? 0), ...(pewneZalegle ? [pewneZalegle.bezOdpowiedziDniPoTerminie as number] : [])];
  const wynik = {
    adresatow: stany.length,
    poTerminie: zalegle.length + (pewneZalegle ? pewneZalegle.coNajmniejBezOdpowiedzi : 0),
    najdluzejPoTerminieDni: dniZalegle.length ? Math.max(...dniZalegle) : null,
    najblizszyTermin: czekajace.length ? czekajace.map((s) => s.termin as string).reduce((a, b) => (a <= b ? a : b)) : null,
  };
  if (stany.length === 0) return { ...wynik, rodzaj: jestOdpowiedz ? 'odpowiedziano' : 'bez-terminu' };
  if (wynik.poTerminie > 0) return { ...wynik, rodzaj: 'po-terminie' };
  if (stany.every((s) => s.odpowiedziano)) {
    if (stany.some((s) => (s.spoznienieDni ?? 0) > 0)) return { ...wynik, rodzaj: 'odpowiedziano-po-terminie' };
    return { ...wynik, rodzaj: stany.some((s) => s.bladDatyOdpowiedzi) ? 'odpowiedziano-termin-nieznany' : 'odpowiedziano' };
  }
  if (stany.some((s) => s.odpowiedzNieprzypisana)) {
    // Termin nieznanych jeszcze nie minął, a któryś na pewno nie odpowiedział: nikt nie jest spóźniony.
    const wTerminie = wnioski && wnioski.coNajmniejBezOdpowiedzi > 0 && wnioski.bezOdpowiedziDniPoTerminie === 0;
    return { ...wynik, rodzaj: wTerminie ? 'w-terminie' : 'nie-wiadomo' };
  }
  if (czekajace.length > 0) return { ...wynik, rodzaj: 'w-terminie' };
  return { ...wynik, rodzaj: 'bez-terminu' };
}
