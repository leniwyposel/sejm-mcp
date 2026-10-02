/**
 * Akty prawne z API ELI Kancelarii Sejmu (https://api.sejm.gov.pl/eli): Dziennik Ustaw
 * i Monitor Polski. Uzupełnia część parlamentarną: proces legislacyjny kończy się aktem,
 * a tu widać, czy akt obowiązuje, od kiedy, co go zmieniło i co w nim jest napisane.
 */

import { z } from 'zod';
import { dzisWarszawa } from '../reguly/daty.js';
import { czytajPdf, OPCJE_AKTU, UWAGA_PDF, UWAGA_PRZYPISY, uwagaOdczytuPdf, type TekstPdf } from '../pdf.js';
import { bezpiecznyLink, czysty, fragment, htmlNaTekst, klucz } from '../tekst.js';
import { brak404, OPIS_CZESCIOWY, czesciowy, czesciowyZBledu, dolaczCzesciowe, type Wynik, type WynikCzesciowy, data, jakoLista, jakoRekord, limit, maWszystkie, narzedzie, przesuniecie, rdzenie, UWAGA_RDZENIE, UWAGA_TEKST_Z_ZEWNATRZ } from './wspolne.js';

interface AktZRejestru {
  ELI?: string;
  address: string;
  publisher: string;
  year: number;
  pos: number;
  title: string;
  type?: string;
  status?: string;
  inForce?: string;
  displayAddress?: string;
  announcementDate?: string;
  promulgation?: string;
  entryIntoForce?: string | null;
  validFrom?: string | null;
  expirationDate?: string | null;
  repealDate?: string | null;
  textHTML?: boolean;
  textPDF?: boolean;
  keywords?: string[];
  releasedBy?: string[];
  legalStatusDate?: string | null;
  comments?: string | null;
  prints?: Array<{ link?: string; number?: string; term?: number; linkProcessAPI?: string; linkPrintAPI?: string }>;
  references?: Record<string, Array<{ id: string; art?: string; date?: string }>>;
}

/** Adres aktu w postaci ELI: wydawca/rok/pozycja, np. DU/2026/62 albo MP/2023/1261. */
const adresAktu = z
  .string()
  .regex(/^(DU|MP)\/\d{4}\/\d{1,6}$/, 'Adres w postaci DU/2026/62 albo MP/2023/1261')
  .describe(
    'Adres aktu: wydawca/rok/pozycja, np. "DU/2026/62" (Dziennik Ustaw) albo "MP/2023/1261" (Monitor Polski). ' +
      'Dla aktów sprzed 2012 r. adres to rok/POZYCJA, nie numer dziennika (Dz.U. 1997 nr 78 poz. 483 → DU/1997/483); Konstytucja RP to DU/1997/483. ' +
      'Adresu nie zgaduj: bez pewności weź go z szukaj_aktow.',
  );

const W_MOCY: Record<string, string> = { IN_FORCE: 'tak', NOT_IN_FORCE: 'nie', UNKNOWN: 'nie wiadomo' };

const MIESIACE: Record<string, number> = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7, sierpnia: 8, wrzesnia: 9, września: 9, pazdziernika: 10, października: 10, listopada: 11, grudnia: 12,
};

function dzienIso(r: number, m: number, d: number): string {
  return new Date(Date.UTC(r, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * Terminy wejścia w życie części przepisów z komentarza ELI („… wchodzą w życie z dniem 1 września 2028 r.”,
 * „… po upływie 9 września 2026 r.”, „… po upływie 14 dni od dnia ogłoszenia”), jako daty RRRR-MM-DD.
 * Termin z komunikatu (bez daty) pomijamy: nie wiadomo, kiedy nastąpi.
 */
export function terminyZKomentarza(komentarz: string | null | undefined, ogloszono?: string | null): string[] {
  if (!komentarz) return [];
  const t = komentarz.replace(/\s+/g, ' ');
  const daty = new Set<string>();
  for (const m of t.matchAll(/(z dniem|po upływie)\s+(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})\s*r/gi)) {
    const mies = MIESIACE[m[3].toLowerCase()];
    if (!mies) continue;
    // „Po upływie 9 września” to od 10 września: dzień wskazany jeszcze się nie liczy.
    daty.add(dzienIso(Number(m[4]), mies, Number(m[2]) + (/upływie/i.test(m[1]) ? 1 : 0)));
  }
  if (ogloszono && /^\d{4}-\d{2}-\d{2}$/.test(ogloszono)) {
    const [r, mi, d] = ogloszono.split('-').map(Number);
    for (const m of t.matchAll(/po upływie\s+(\d{1,3})\s+(dni|miesięcy|miesiąca|miesiące|tygodni)\s+od dnia (?:jej |jego )?ogłoszenia/gi)) {
      const n = Number(m[1]);
      // Termin z dni liczy się od dnia po ogłoszeniu, a przepis wchodzi w życie dzień po jego upływie.
      if (/^dni/.test(m[2])) daty.add(dzienIso(r, mi, d + n + 1));
      else if (/^tygodni/.test(m[2])) daty.add(dzienIso(r, mi, d + 7 * n + 1));
      else daty.add(dzienIso(r, mi + n, d + 1));
    }
  }
  return [...daty].sort();
}

/**
 * ELI ma IN_FORCE także dla ustawy ogłoszonej, która wejdzie w życie za pół roku (vacatio legis),
 * więc „tak” z samego inForce mówiło czytelnikowi, że może już korzystać z przepisów, których jeszcze nie ma.
 * Termin główny to nie wszystko: DU/2026/1123 wchodzi w życie 2028-01-01, a część przepisów obowiązuje
 * od 2026-09-10 (komentarz ELI); wtedy piszemy „częściowo”, a nie „jeszcze nie”.
 */
function obowiazujeDzis(
  a: Pick<AktZRejestru, 'inForce' | 'entryIntoForce' | 'comments' | 'promulgation'>,
  dzis = dzisWarszawa(),
): string | null {
  if (!a.inForce) return null;
  if (a.inForce === 'IN_FORCE' && a.entryIntoForce && a.entryIntoForce > dzis) {
    const wczesniej = terminyZKomentarza(a.comments, a.promulgation).filter((d) => d <= dzis);
    if (wczesniej.length) return `częściowo (część przepisów od ${wczesniej[0]}, reszta od ${a.entryIntoForce}; szczegóły: przepisyOInnymTerminie w narzędziu akt)`;
    return `jeszcze nie (wchodzi w życie ${a.entryIntoForce})`;
  }
  return W_MOCY[a.inForce] ?? a.inForce;
}

function adresEli(a: Pick<AktZRejestru, 'publisher' | 'year' | 'pos'>): string {
  return `${a.publisher}/${a.year}/${a.pos}`;
}

function skrotAktu(a: AktZRejestru) {
  return {
    adres: adresEli(a),
    zrodlo: `https://api.sejm.gov.pl/eli/acts/${adresEli(a)}`,
    oznaczenie: a.displayAddress ?? null,
    tytul: czysty(a.title),
    rodzaj: a.type ?? null,
    // Surowy status ELI mówi „obowiązujący” także w vacatio legis; o obowiązywaniu dziś mówi pole obowiazuje.
    statusWELI: a.status ?? null,
    obowiazuje: obowiazujeDzis(a),
    wejscieWZycie: a.entryIntoForce ?? null,
    // Wyszukiwarka zna komentarz ELI: bez tej flagi „wejscieWZycie” wyglądało na jedyny termin aktu.
    ...(a.comments ? { czescPrzepisowWInnymTerminie: true } : {}),
    dataAktu: a.announcementDate ?? null,
    ogloszono: a.promulgation ?? null,
  };
}

const UWAGA_OBOWIAZYWANIE =
  'Ogłoszenie w dzienniku to nie wejście w życie: datę daje wejscieWZycie, a to, czy akt obowiązuje dziś, pole obowiazuje ' +
  '(„jeszcze nie” = ogłoszony, w okresie vacatio legis; „częściowo” = część przepisów już weszła w życie przed terminem głównym). ' +
  'wejscieWZycie to termin główny: przy czescPrzepisowWInnymTerminie część przepisów wchodzi w życie w innych dniach (lista: narzędzie akt, pole przepisyOInnymTerminie). Pole statusWELI to surowy status z bazy ELI („obowiązujący” także przed wejściem w życie): ' +
  'o tym, czy akt obowiązuje, mówi pole obowiazuje, nie statusWELI. ' +
  '„Obwieszczenie Marszałka Sejmu … w sprawie ogłoszenia jednolitego tekstu” to tekst jednolity innej ustawy, nie nowe przepisy.';

/** Dzień wcześniej, RRRR-MM-DD. */
function dzienWczesniej(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/**
 * Fraza z wyciekłym znacznikiem wywołania („Sądownictwa</fraza>\n<parameter …”) cięła się na
 * rdzenie „<parame”, „name="rok">2” i szukała po śmieciach. Bierzemy tekst do pierwszego
 * znacznika albo nowej linii.
 */
export function oczyscFraze(fraza: string): { fraza: string; uwaga: string | null } {
  const ciecie = fraza.search(/[<>\r\n]/);
  if (ciecie === -1) return { fraza: fraza.trim(), uwaga: null };
  const czysta = fraza.slice(0, ciecie).replace(/\s+/g, ' ').trim();
  if (czysta.length < 2) throw new Error('Fraza zawiera znaczniki albo nowe linie i po ich usunięciu nic z niej nie zostaje. Podaj same słowa z tytułu aktu.');
  return { fraza: czysta, uwaga: `Fraza zawierała znaczniki albo nową linię; szukano tylko „${czysta}”. Pozostałe parametry podaj osobno (np. rok jako rok).` };
}

/**
 * Filtry dat ELI (dateFrom, pubDateFrom, dateEffectFrom, since) pomijają sam dzień graniczny:
 * dateEffectFrom=2026-10-01 nie zwraca ustaw wchodzących w życie 1 października (sprawdzone
 * 2026-09-24; „do” jest włączne). Pytamy więc od dnia wcześniej i odcinamy ten dzień u siebie.
 */
const DATY_OD = [
  { pole: 'od', parametr: 'dateFrom', wAkcie: 'announcementDate' },
  { pole: 'ogloszoneOd', parametr: 'pubDateFrom', wAkcie: 'promulgation' },
  { pole: 'wchodzaOd', parametr: 'dateEffectFrom', wAkcie: 'entryIntoForce' },
] as const;

/**
 * Pytania „ile nowelizacji / ostatnia nowelizacja” model kierował do wyszukiwania po tytule i
 * gubił zmiany zawarte w ustawach o innych tytułach (PIT w 2025: 5 z 16 aktów zmieniających).
 */
export const UWAGA_NOWELIZACJE =
  'Wyszukiwanie po tytule gubi nowelizacje zawarte w ustawach o innych tytułach (np. ustawa o finansach publicznych zmienia też ustawę o PIT). ' +
  'Liczbę i listę nowelizacji danej ustawy, także ostatnią, daje narzędzie akt z jej adresem i powiazania="Akty zmieniające" (pole ogloszono przy każdej pozycji i rozkład po latach ogłoszenia).';
/** Fraza, która pyta o nowelizacje, a nie o sam akt. */
const O_NOWELIZACJE = /zmian|nowel|zmieniaj/i;

export const szukajAktow = narzedzie({
  nazwa: 'szukaj_aktow',
  tytul: 'Szukaj aktów prawnych (Dziennik Ustaw, Monitor Polski)',
  opis:
    'Wyszukuje opublikowane akty prawne w bazie ELI Kancelarii Sejmu: ustawy, rozporządzenia, obwieszczenia, uchwały. ' +
    'Po słowach z tytułu (w przypadku zależnym, np. "o Krajowej Radzie Sądownictwa"; rdzeń też działa), słowach kluczowych, roku, rodzaju ' +
    'i tym, czy akt obowiązuje. O obowiązywaniu dziś mówi pole obowiazuje (statusWELI to surowy status ELI). Daty od/do są włączne. Ustawy idą przed obwieszczeniami o tekstach jednolitych. Adres z wyniku (np. DU/2019/914) podaj do narzędzia akt. ' +
    UWAGA_NOWELIZACJE + OPIS_CZESCIOWY,
  wejscie: z.object({
    fraza: z.string().min(2).max(200).optional().describe('Słowa z tytułu aktu'),
    slowaKluczowe: z.string().max(200).optional().describe('Słowa kluczowe ELI po przecinku, np. "budżet" albo "podatek dochodowy"'),
    rok: z.coerce.number().int().min(1000).max(2100).optional().describe('Rok publikacji (Dziennik Ustaw od 1918, Monitor Polski od 1918/1930)'),
    wydawca: z.enum(['DU', 'MP']).default('DU').describe('DU = Dziennik Ustaw, MP = Monitor Polski'),
    rodzaj: z.string().max(60).optional().describe('Rodzaj aktu, np. "Ustawa", "Rozporządzenie", "Obwieszczenie"'),
    tylkoObowiazujace: z.boolean().default(false).describe('Tylko akty obowiązujące dziś'),
    od: data.optional().describe('Wydane od dnia (data aktu)'),
    do: data.optional().describe('Wydane do dnia (data aktu)'),
    ogloszoneOd: data.optional().describe('Ogłoszone w dzienniku od dnia'),
    ogloszoneDo: data.optional().describe('Ogłoszone w dzienniku do dnia'),
    wchodzaOd: data.optional().describe('Wchodzące w życie od dnia'),
    wchodzaDo: data.optional().describe('Wchodzące w życie do dnia'),
    zmienioneOd: data
      .optional()
      .describe('Tylko akty, których opis w bazie ELI zmienił się od tego dnia (nowe akty, zmiana statusu); pomija pozostałe filtry poza wydawcą'),
    limit: limit(20, 50),
    przesuniecie,
  }),
  async wykonaj(wejscie, zrodlo) {
    let a = wejscie;
    if (a.rok !== undefined && a.rok < 1918) {
      return {
        razem: 0,
        akty: [],
        zrodla: [],
        uwagi: ['Baza ELI obejmuje akty od odzyskania niepodległości (Dziennik Ustaw od 1918 r.); aktów wcześniejszych, np. Konstytucji 3 Maja, w niej nie ma.'],
      };
    }
    if (a.zmienioneOd) {
      const sciezkaZ = 'eli/changes/acts';
      // `since` też pomija swoją chwilę: zmiany z 00:00:00 danego dnia przepadały.
      const parZ = { since: `${dzienWczesniej(a.zmienioneOd)}T23:59:59`, limit: a.limit, offset: a.przesuniecie };
      const odp = jakoRekord<{ totalCount?: number; count: number; items: unknown }>(await zrodlo.json<unknown>(sciezkaZ, { parametry: parZ }), 'zmiany aktów', ['count']);
      const akty = jakoLista<AktZRejestru & { changeDate?: string }>(odp?.items, 'akty').filter(
        (x) => x.publisher === a.wydawca && !(x.changeDate && x.changeDate.slice(0, 10) < a.zmienioneOd!),
      );
      return {
        razem: odp?.totalCount ?? odp?.count ?? 0,
        akty: akty.map((x) => ({ ...skrotAktu(x), zmienionoWBazie: x.changeDate ?? null })),
        zrodla: [zrodlo.adres(sciezkaZ, parZ)],
        uwagi: [UWAGA_OBOWIAZYWANIE, 'razem liczy zmiany w obu dziennikach (DU i MP); lista pokazuje wybranego wydawcę.'],
      };
    }
    const sciezka = 'eli/acts/search';
    const uwagi = [UWAGA_OBOWIAZYWANIE];
    let oknoAktow: WynikCzesciowy | undefined;
    // W ELI kodeksy i Konstytucja mają rodzaj „Ustawa” („Ustawa z dnia … – Kodeks cywilny”): rodzaj „Kodeks”
    // dawał 0 trafień, a model wnioskował, że kodeksu nie ma. Szukamy ustaw z tym słowem w tytule.
    const rodzajSlowem = /^(kodeks|konstytucj)/i.exec((a.rodzaj ?? '').trim());
    if (rodzajSlowem) {
      const slowo = /^kodeks/i.test(rodzajSlowem[1]) ? 'Kodeks' : 'Konstytucja';
      uwagi.unshift(
        `W bazie ELI nie ma rodzaju „${a.rodzaj}”: ${slowo === 'Kodeks' ? 'kodeksy mają' : 'Konstytucja ma'} rodzaj „Ustawa”. ` +
          `Szukano ustaw ze słowem „${slowo}” w tytule. ${slowo === 'Konstytucja' ? 'Konstytucja RP to DU/1997/483. ' : ''}Listę rodzajów daje slownik_eli (rodzaje).`,
      );
      // „cywilny” z rodzajem „Kodeks” to „Kodeks cywilny”: pełna nazwa stawia sam kodeks na początku listy.
      const fraza = !a.fraza ? slowo : new RegExp(slowo.slice(0, 6), 'i').test(a.fraza) ? a.fraza : `${slowo} ${a.fraza}`;
      a = { ...a, rodzaj: 'Ustawa', fraza };
    }
    if (a.fraza) {
      const o = oczyscFraze(a.fraza);
      a = { ...a, fraza: o.fraza };
      if (o.uwaga) uwagi.unshift(o.uwaga);
    }
    const baza = {
      keyword: a.slowaKluczowe,
      year: a.rok,
      publisher: a.wydawca,
      type: a.rodzaj,
      inForce: a.tylkoObowiazujace ? '1' : undefined,
      dateFrom: a.od ? dzienWczesniej(a.od) : undefined,
      dateTo: a.do,
      pubDateFrom: a.ogloszoneOd ? dzienWczesniej(a.ogloszoneOd) : undefined,
      pubDateTo: a.ogloszoneDo,
      dateEffectFrom: a.wchodzaOd ? dzienWczesniej(a.wchodzaOd) : undefined,
      dateEffectTo: a.wchodzaDo,
    };
    const graniczne = DATY_OD.filter((d) => a[d.pole]);
    // Dzień przed granicą przyszedł tylko dlatego, że przesunęliśmy filtr: odcinamy go.
    const wZakresie = (x: AktZRejestru) => graniczne.every((d) => !x[d.wAkcie] || String(x[d.wAkcie]) >= a[d.pole]!);
    // Cała pula trafień naraz (API oddaje do 500), bo „Kodeks pracy” ma ponad 170 nowelizacji,
    // a sam kodeks jest najstarszy i przy porcji najnowszych nie trafiłby na listę.
    const PULA = 500;
    // Przy przesuniętej dacie „od” stronicujemy u siebie, bo z porcji API wypadają akty z dnia przed granicą.
    const lokalnie = !!a.fraza || graniczne.length > 0;
    let parametry: Record<string, string | number | undefined> = a.fraza
      ? { ...baza, title: a.fraza, limit: PULA, offset: 0 }
      : lokalnie
        ? { ...baza, limit: PULA, offset: 0 }
        : { ...baza, limit: a.limit, offset: a.przesuniecie };
    let przyblizone = false;
    const pobierz = async (p: Record<string, string | number | undefined>) => {
      const odp = jakoRekord<{ count: number; items: unknown }>(await zrodlo.json<unknown>(sciezka, { parametry: p }), 'wyszukiwanie aktów', ['count']);
      const wszystkie = jakoLista<AktZRejestru>(odp?.items, 'akty');
      const akty = wszystkie.filter(wZakresie);
      const liczba = odp?.count ?? 0;
      if (liczba > wszystkie.length && akty.length < wszystkie.length) przyblizone = true;
      return { razem: Math.max(0, liczba - (wszystkie.length - akty.length)), akty };
    };
    let { razem, akty } = await pobierz(parametry);

    if (a.fraza) {
      const rdz = rdzenie(a.fraza);
      if (rdz.length > 1 || (rdz.length === 1 && razem === 0)) {
        const najdluzszy = [...rdz].sort((x, y) => y.length - x.length)[0];
        const parR = { ...baza, title: najdluzszy, limit: PULA, offset: 0 };
        const zRdzeni = (await pobierz(parR)).akty;
        const byly = new Set(akty.map(adresEli));
        const nowe = zRdzeni.filter((x) => !byly.has(adresEli(x)) && maWszystkie(x.title, rdz));
        if (nowe.length > 0) {
          uwagi.unshift(razem === 0 ? UWAGA_RDZENIE(a.fraza, rdz) : `Dołączono ${nowe.length} aktów z rdzeniami słów (${rdz.join(', ')}).`);
          akty = [...akty, ...nowe];
          razem += nowe.length;
          parametry = parR;
        } else if (razem === 0) {
          uwagi.unshift(UWAGA_RDZENIE(a.fraza, rdz));
        }
      }
      // Ustawy przed obwieszczeniami i rozporządzeniami, w środku pełna fraza przed rdzeniami.
      const fraza = klucz(a.fraza);
      const bezKropki = (t: string) => klucz(t).replace(/[.\s]+$/, '');
      // Najpierw sam akt, którego nazwę podano („… Kodeks pracy.”, „… o Krajowej Radzie Sądownictwa”),
      // potem inne ustawy z frazą, potem reszta; nowelizacje i obwieszczenia za aktem podstawowym.
      // Nazwa aktu to tytuł bez „Ustawa z dnia … r.”: „Kodeks pracy”, „o Krajowej Radzie Sądownictwa”.
      const nazwa = (t: string) => bezKropki(t).replace(/^ustawa z dnia .*? r\.\s*(-\s*)?/, '');
      const ranga = (x: AktZRejestru) => {
        const ustawa = /^ustawa/i.test(x.type ?? '');
        const zmiana = /o zmianie|zmieniając/i.test(x.title);
        const n = nazwa(x.title);
        if (ustawa && (n === fraza || n === `o ${fraza}`)) return 0;
        if (ustawa && !zmiana && n.endsWith(fraza)) return 1;
        return 2 + (ustawa ? 0 : 2) + (klucz(x.title).includes(fraza) ? 0 : 1);
      };
      akty = akty
        .map((x, i) => ({ x, i }))
        .sort((p, q) => ranga(p.x) - ranga(q.x) || p.i - q.i)
        .map(({ x }) => x);
      if (razem > PULA) {
        uwagi.push(`Trafień jest ${razem}; uporządkowano ${PULA} pierwszych. Zawęź frazę, rok albo rodzaj.`);
        oknoAktow = czesciowy(
          `baza aktów ma ${razem} trafień, a serwer porządkuje i przegląda najwyżej ${PULA} pierwszych`,
          `aktów spoza ${PULA} pierwszych trafień: szukany akt może być wśród pominiętych`,
          'zawęzić frazę albo podać rok lub rodzaj aktu',
        );
      }
    } else if (lokalnie && razem > PULA) {
      uwagi.push(`Trafień jest ok. ${razem}; przejrzano ${PULA} pierwszych. Zawęź przedział dat, rok albo rodzaj.`);
      oknoAktow = czesciowy(
        `baza aktów ma ok. ${razem} trafień, a serwer przegląda najwyżej ${PULA} pierwszych`,
        `aktów spoza ${PULA} pierwszych trafień, więc lista (i liczba po filtrze) może być niepełna`,
        'zawęzić przedział dat, rok albo rodzaj aktu',
      );
    }
    if (lokalnie) akty = akty.slice(a.przesuniecie, a.przesuniecie + a.limit);
    if (przyblizone) uwagi.push('Liczba razem jest przybliżona: filtr dat „od” wymagał odcięcia dnia granicznego po stronie serwera.');

    if (razem === 0) {
      uwagi.unshift(
        'Brak aktu w dzienniku. Ustawa uchwalona przez Sejm, ale jeszcze nieogłoszona (w Senacie, u Prezydenta albo zawetowana), ' +
          'jest tylko w rejestrze procesów: szukaj_procesow → proces (pole stan).',
      );
    }
    // Fraza z wejścia, nie oczyszczona: oczyscFraze może zdjąć właśnie „o zmianie”.
    if (O_NOWELIZACJE.test(wejscie.fraza ?? '')) uwagi.unshift(UWAGA_NOWELIZACJE);
    if (/^obwieszczenie/i.test(a.rodzaj ?? '') || /jednolit/i.test(a.fraza ?? '')) {
      uwagi.push('Wyszukiwarka miesza teksty jednolite ustaw o podobnych tytułach (np. Kodeks karny, karny wykonawczy, karny skarbowy): pełną listę tekstów jednolitych jednej ustawy daje narzędzie akt z jej adresem i powiazania="Inf. o tekście jednolitym".');
    }
    return {
      ...(oknoAktow ? { wynikCzesciowy: oknoAktow } : {}),
      razem,
      akty: akty.map(skrotAktu),
      zrodla: [zrodlo.adres(sciezka, parametry)],
      uwagi,
    };
  },
});

/** Rodzaje powiązań w słowniku ELI (eli/references), do dopasowania nazwy podanej swobodnie. */
const RODZAJE_POWIAZAN = [
  'Akty wykonawcze z art.', 'Nowelizacje po tekście jednolitym', 'Orzeczenie TK', 'Akty wykonawcze', 'Odesłania', 'Sprostowanie',
  'Tekst jednolity dla aktu', 'Uchylenia wynikające z', 'Akty uznane za uchylone', 'Przepisy wprowadzane', 'Podstawa prawna',
  'Podstawa prawna z art.', 'Orzeczenie TK dla aktu', 'Akty zmieniające', 'Akty zmienione', 'Akty uchylone', 'Przepisy wprowadzające',
  'Akty uchylające', 'Inf. o tekście jednolitym', 'Sprostowanie dla aktów',
];

/** Nazwy potoczne → nazwa ELI. Klucze bez polskich znaków i wielkości liter. */
const SYNONIMY_POWIAZAN: Record<string, string> = {
  'teksty jednolite': 'Inf. o tekście jednolitym',
  'tekst jednolity': 'Inf. o tekście jednolitym',
  'teksty jednolite aktu': 'Inf. o tekście jednolitym',
  'obwieszczenia': 'Inf. o tekście jednolitym',
  'nowelizacje': 'Akty zmieniające',
  'nowelizacja': 'Akty zmieniające',
  'zmiany': 'Akty zmieniające',
  'akty zmieniajace': 'Akty zmieniające',
  'zmieniajace': 'Akty zmieniające',
  'uchylajace akty': 'Akty uchylające',
  'uchylenie': 'Akty uchylające',
  'uchylajace': 'Akty uchylające',
  'orzeczenia tk': 'Orzeczenie TK',
  'orzeczenia': 'Orzeczenie TK',
  'wyroki tk': 'Orzeczenie TK',
  'wyrok tk': 'Orzeczenie TK',
  'rozporzadzenia wykonawcze': 'Akty wykonawcze',
  'wykonawcze': 'Akty wykonawcze',
};

/**
 * Nazwa rodzaju powiązania podana przez model („Orzeczenia TK”, „Teksty jednolite”) → nazwa ELI.
 * Najpierw dokładnie, potem synonim, potem po początkach słów (liczba mnoga, odmiana).
 */
export function dopasujRodzajPowiazan(podany: string, dostepne: readonly string[]): string | null {
  const k = klucz(podany).replace(/\s+/g, ' ');
  const wszystkie = [...new Set([...dostepne, ...RODZAJE_POWIAZAN])];
  const dokladny = wszystkie.find((r) => klucz(r) === k);
  if (dokladny) return dokladny;
  if (SYNONIMY_POWIAZAN[k]) return SYNONIMY_POWIAZAN[k];
  const slowa = k.split(/[\s.]+/).filter((w) => w.length >= 2);
  if (!slowa.length) return null;
  const pasuje = (r: string) => {
    const sr = klucz(r).split(/[\s.]+/).filter((w) => w.length >= 2);
    return slowa.every((w) => sr.some((x) => x.startsWith(w.slice(0, Math.min(w.length, 5))) || w.startsWith(x.slice(0, Math.min(x.length, 5)))));
  };
  // Najpierw wśród powiązań tego aktu, potem w całym słowniku; przy remisie najkrótsza nazwa.
  const zAktu = dostepne.filter(pasuje).sort((x, y) => x.length - y.length)[0];
  return zAktu ?? RODZAJE_POWIAZAN.filter(pasuje).sort((x, y) => x.length - y.length)[0] ?? null;
}

/** Numer procesu z linkProcessAPI („…/term10/processes/2600” → kadencja 10, proces 2600). */
function drukSejmowy(p: NonNullable<AktZRejestru['prints']>[number]) {
  const m = /\/term(\d+)\/processes\/([0-9A-Za-z-]+)$/.exec(p.linkProcessAPI ?? '');
  return {
    numer: p.number ?? null,
    kadencja: p.term ?? (m ? Number(m[1]) : null),
    proces: m ? m[2] : null,
    link: bezpiecznyLink(p.link),
  };
}

interface PowiazanieRodzaju {
  rodzaj: string;
  liczba: number;
  zestawienie?: {
    wedlugStatusu: Record<string, number>;
    wedlugObowiazywania: Record<string, number>;
    wedlugRodzaju: Record<string, number>;
    wedlugRokuOgloszenia: Record<string, number>;
    lata: { od: number; do: number } | null;
  };
  /** Brak przy filtrze na inny rodzaj: wtedy ten rodzaj to sama liczba. */
  akty?: Array<{ adres: string; tytul?: string | null; status?: string | null; ogloszono?: string | null; przepis?: string; data?: string }>;
}

/**
 * Status ELI → czy akt jest w mocy, tak jak liczy to samo ELI (pole inForce). /references nie niesie
 * inForce, a „akt objęty tekstem jednolitym”, „akt posiada tekst jednolity”, „akt jednorazowy” i „bez statusu”
 * to w ELI IN_FORCE (sprawdzone 2026-09-25 na aktach wykonawczych PoRD i zmianach ustawy o PIT):
 * liczenie samych „obowiązujących” zaniżało wynik ponad dwukrotnie.
 */
const STATUS_W_MOCY: Record<string, 'tak' | 'nie'> = {
  'obowiązujący': 'tak',
  'akt objęty tekstem jednolitym': 'tak',
  'akt posiada tekst jednolity': 'tak',
  'akt jednorazowy': 'tak',
  'bez statusu': 'tak',
  'uchylony': 'nie',
  'uchylony wykazem': 'nie',
  'uznany za uchylony': 'nie',
  'wygaśnięcie aktu': 'nie',
  'brak mocy prawnej': 'nie',
  'nieobowiązujący - przyczyna nieustalona': 'nie',
  'nieobowiązujący - uchylona podstawa prawna': 'nie',
};

/** Ile odwołań jednego rodzaju pokazujemy bez prośby o listę. */
const ODWOLAN_NA_RODZAJ = 10;

export const akt = narzedzie({
  nazwa: 'akt',
  tytul: 'Akt prawny: status, wejście w życie, zmiany',
  opis:
    'Jeden akt z bazy ELI: czy obowiązuje, od kiedy (wejście w życie), kiedy ogłoszony, kto wydał, słowa kluczowe, druki sejmowe ' +
    'i powiązania z innymi aktami (akty zmieniające, uchylające, wykonawcze, teksty jednolite, orzeczenia TK). ' +
    'Pole eli z narzędzia proces to właśnie adres dla tego narzędzia. Przy obwieszczeniu o tekście jednolitym stanPrawnyNa to dzień, według ' +
    'którego sporządzono tekst. Pole tekst dotyczy tylko tego aktu; format najnowszego tekstu jednolitego podaje najnowszyTekstJednolity.html. ' +
    'Liczbę powiązań każdego rodzaju masz w polu odpowiedz i powiazania[].liczba; nie pobieraj listy, żeby je policzyć. Aktualne brzmienie ustawy zmienianej wiele razy jest ' +
    'w najnowszym tekście jednolitym (pole najnowszyTekstJednolity) i w zmianach ogłoszonych po nim. ' +
    'Ostatnią nowelizację podaje ten akt z powiazania="Akty zmieniające", nie wyszukiwanie po tytule. ' +
    'Podpis prezydenta, weto i skierowanie do TK są w rejestrze procesów: pole drukiSejmowe[].proces podaj do narzędzia proces.',
  wejscie: z.object({
    adres: adresAktu,
    powiazania: z
      .string()
      .max(60)
      .optional()
      .describe(
        'Rodzaj powiązań do przejrzenia porcjami z tytułami, np. "Akty zmieniające", "Akty uchylające", "Inf. o tekście jednolitym", "Orzeczenie TK", ' +
          '"Akty wykonawcze" (nazwa z pola powiazania; potoczne „nowelizacje”, „teksty jednolite” też zadziałają)',
      ),
    powiazaniaLimit: limit(30, 50),
    powiazaniaPrzesuniecie: przesuniecie,
  }),
  async wykonaj(wejscie, zrodlo) {
    let a = wejscie;
    const sciezka = `eli/acts/${a.adres}`;
    const x = jakoRekord<AktZRejestru>(await zrodlo.json<unknown>(sciezka), 'akt', ['year', 'pos'], ['publisher', 'title']);
    if (!x) return { ...brak404('Baza ELI nie zna takiego aktu.'), zrodla: [zrodlo.adres(sciezka)] };

    const odwolania = x.references && typeof x.references === 'object' ? x.references : {};
    // Nazwa rodzaju spoza słownika była cicho ignorowana i model dostawał wszystko, myśląc, że dostał filtr.
    const uwagiRodzaju: string[] = [];
    if (a.powiazania) {
      const dostepne = Object.keys(odwolania);
      const rodzaj = dopasujRodzajPowiazan(a.powiazania, dostepne);
      if (!rodzaj) {
        uwagiRodzaju.push(
          `Nieznany rodzaj powiązania „${a.powiazania}”. Ten akt ma: ${dostepne.length ? dostepne.join(', ') : 'żadnych powiązań'}. ` +
            'Poniżej przegląd wszystkich rodzajów bez pełnej listy.',
        );
        a = { ...a, powiazania: undefined };
      } else {
        if (klucz(rodzaj) !== klucz(a.powiazania)) uwagiRodzaju.push(`Rodzaj powiązania „${a.powiazania}” odczytano jako „${rodzaj}” (nazwa w ELI).`);
        if (!dostepne.some((d) => klucz(d) === klucz(rodzaj))) {
          uwagiRodzaju.push(`Ten akt nie ma w ELI powiązań rodzaju „${rodzaj}” (liczba 0). Ma: ${dostepne.length ? dostepne.join(', ') : 'żadnych powiązań'}.`);
        }
        a = { ...a, powiazania: rodzaj };
      }
    }
    // Przy prośbie o pełną listę jednego rodzaju bierzemy /references, które niesie też tytuły i statusy.
    const tytuly = new Map<string, { tytul: string | null; status: string | null; ogloszono: string | null }>();
    const opisy = new Map<string, { rodzaj: string | null; status: string | null; rok: number | null; ogloszono: string | null }>();
    const zrodla = [zrodlo.adres(sciezka)];
    const razemOdwolan = Object.values(odwolania).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
    // Tytuły bierzemy z /references przy prośbie o listę albo gdy powiązań jest mało: goły adres
    // kusił model do nazwania aktu z pamięci (DU/2000/718 „ustawa o KRS”, a to ustawa o ogłaszaniu aktów).
    if (a.powiazania || (razemOdwolan > 0 && razemOdwolan <= 60)) {
      const sRef = `${sciezka}/references`;
      const pelne = jakoRekord<Record<string, unknown>>(await zrodlo.json<unknown>(sRef), 'powiązania') ?? {};
      for (const lista of Object.values(pelne)) {
        for (const p of jakoLista<{ act?: { ELI?: string; title?: string; status?: string; type?: string; year?: number; promulgation?: string } }>(lista, 'powiązania')) {
          if (p.act?.ELI) {
            // Data ogłoszenia, nie data zmiany: „ile nowelizacji ogłoszono w 2025” liczy się po niej.
            const ogloszono = p.act.promulgation ?? null;
            tytuly.set(p.act.ELI, { tytul: czysty(p.act.title), status: p.act.status ?? null, ogloszono });
            opisy.set(p.act.ELI, { rodzaj: p.act.type ?? null, status: p.act.status ?? null, rok: p.act.year ?? null, ogloszono });
          }
        }
      }
      zrodla.push(zrodlo.adres(sRef));
    }
    const powiazania = Object.entries(odwolania).map(([rodzaj, lista]): PowiazanieRodzaju => {
      // Od najnowszych: po dacie powiązania, a bez niej po roku i pozycji z adresu.
      const klucznik = (p: { id: string; date?: string }) => p.date ?? `${p.id.split('/')[1] ?? ''}-${(p.id.split('/')[2] ?? '').padStart(6, '0')}`;
      const pozycje = jakoLista<{ id: string; art?: string; date?: string }>(lista, 'powiązania').sort((x, y) => klucznik(y).localeCompare(klucznik(x)));
      const wszystkie = a.powiazania && klucz(a.powiazania) === klucz(rodzaj);
      const zlicz = (f: (o: { rodzaj: string | null; status: string | null; rok: number | null; ogloszono: string | null }) => string | null) => {
        const w: Record<string, number> = {};
        for (const p of pozycje) {
          const o = opisy.get(p.id);
          const k = (o && f(o)) ?? 'nieznany';
          w[k] = (w[k] ?? 0) + 1;
        }
        return w;
      };
      const lata = pozycje.map((p) => opisy.get(p.id)?.rok).filter((r): r is number => typeof r === 'number');
      // Przy filtrze pozostałe rodzaje to same liczby: po 10 adresów każdego dawało ok. 10 tys. znaków, o które nikt nie prosił.
      if (a.powiazania && !wszystkie) return { rodzaj, liczba: pozycje.length };
      return {
        rodzaj,
        liczba: pozycje.length,
        // Zestawienie, gdy lista nie mieści się w jednej porcji: „ile ogłoszono w 2025”, „ile obowiązuje” z jednego wywołania.
        ...(wszystkie && pozycje.length > a.powiazaniaLimit && opisy.size
          ? {
              zestawienie: {
                wedlugStatusu: zlicz((o) => o.status),
                wedlugObowiazywania: zlicz((o) => (o.status ? (STATUS_W_MOCY[o.status] ?? 'nie wiadomo') : null)),
                wedlugRodzaju: zlicz((o) => o.rodzaj),
                wedlugRokuOgloszenia: Object.fromEntries(
                  Object.entries(zlicz((o) => o.ogloszono?.slice(0, 4) ?? (o.rok ? String(o.rok) : null))).sort(([p], [q]) => q.localeCompare(p)),
                ),
                lata: lata.length ? { od: Math.min(...lata), do: Math.max(...lata) } : null,
              },
            }
          : {}),
        akty: (wszystkie ? pozycje.slice(a.powiazaniaPrzesuniecie, a.powiazaniaPrzesuniecie + a.powiazaniaLimit) : pozycje.slice(0, ODWOLAN_NA_RODZAJ)).map((p) => ({
          adres: p.id,
          ...(tytuly.has(p.id) ? tytuly.get(p.id) : {}),
          ...(p.art ? { przepis: p.art } : {}),
          ...(p.date ? { data: p.date } : {}),
        })),
      };
    });
    const najnowszyZ = (odw: Record<string, unknown>) =>
      jakoLista<{ id: string }>(odw['Inf. o tekście jednolitym'], 'teksty jednolite')
        .map((p) => ({ id: p.id, rok: Number(p.id.split('/')[1]), poz: Number(p.id.split('/')[2]) }))
        .sort((p, q) => q.rok - p.rok || q.poz - p.poz)[0];
    let najnowszy = najnowszyZ(odwolania)?.id;
    // Obwieszczenie o tekście jednolitym nie wie, co je zastąpiło: to wie dopiero ustawa bazowa
    // (jej „Inf. o tekście jednolitym”). Bez tego wygasły tekst jednolity nie miał następcy.
    const obwieszczenie = /^obwieszczenie/i.test(x.type ?? '');
    const bazowa = obwieszczenie ? jakoLista<{ id: string }>(odwolania['Tekst jednolity dla aktu'], 'akt bazowy')[0]?.id : undefined;
    let zastapionyPrzez: string | null = null;
    if (bazowa) {
      const sBaz = `eli/acts/${bazowa}`;
      const b = jakoRekord<AktZRejestru>(await zrodlo.json<unknown>(sBaz), 'akt bazowy', ['year', 'pos'], ['publisher']);
      const odwB = b?.references && typeof b.references === 'object' ? b.references : {};
      const nowszy = najnowszyZ(odwB);
      const ten = { rok: Number(x.year), poz: Number(x.pos) };
      if (nowszy && (nowszy.rok > ten.rok || (nowszy.rok === ten.rok && nowszy.poz > ten.poz))) {
        najnowszy = nowszy.id;
        zastapionyPrzez = nowszy.id;
      }
      zrodla.push(zrodlo.adres(sBaz));
    }

    const uwagi = [...uwagiRodzaju, UWAGA_OBOWIAZYWANIE];
    if (!a.powiazania && powiazania.some((p) => p.liczba > ODWOLAN_NA_RODZAJ)) {
      uwagi.push(`Przy każdym rodzaju powiązań pokazano najwyżej ${ODWOLAN_NA_RODZAJ} aktów; całą listę daje parametr powiazania.`);
    }
    if (!x.textHTML) uwagi.push('Ten akt ma tekst tylko w PDF: tresc_aktu odczyta go z PDF jako zwykły tekst, bez spisu jednostek.');
    if (/^obwieszczenie/i.test(x.type ?? '') && odwolania['Tekst jednolity dla aktu']) {
      uwagi.push(
        `To tekst jednolity ustawy ${bazowa ?? '(powiązanie „Tekst jednolity dla aktu”)'}. ` +
          (zastapionyPrzez ? 'Nowszy tekst jednolity tej ustawy: pole zastapionyPrzez. ' : 'To najnowszy tekst jednolity tej ustawy w ELI. ') +
          'Zmiany ogłoszone po nim daje akt tej ustawy z powiazania="Akty zmieniające".',
      );
    }
    if (a.powiazania && powiazania.length > 1) uwagi.push('Pozostałe rodzaje powiązań podano tylko jako liczby; ich listę daje parametr powiazania z nazwą rodzaju.');
    if (powiazania.some((p) => p.zestawienie)) {
      uwagi.push(
        'Lista powiązań idzie od najnowszych; charakterystykę całości bierz z pola zestawienie, nie z pierwszej porcji. ' +
          'wedlugRokuOgloszenia liczy po dacie ogłoszenia aktu w dzienniku (pole ogloszono), a pole data przy pozycji to data powiązania w ELI (zwykle wejście w życie zmiany). ' +
          'wedlugObowiazywania to stan w mocy według ELI (tak: także „akt objęty tekstem jednolitym”, „akt posiada tekst jednolity”, „akt jednorazowy”, „bez statusu”), bez vacatio legis.',
      );
    }
    if (x.comments) uwagi.push('Część przepisów wchodzi w życie w innym terminie niż wejscieWZycie: pole przepisyOInnymTerminie (z rejestru ELI).');
    const przycieteLista = a.powiazania ? powiazania.find((p) => klucz(p.rodzaj) === klucz(a.powiazania!)) : null;
    if (przycieteLista?.akty && przycieteLista.liczba > a.powiazaniaPrzesuniecie + a.powiazaniaLimit) {
      uwagi.push(`Pokazano ${przycieteLista.akty.length} z ${przycieteLista.liczba} aktów rodzaju „${przycieteLista.rodzaj}”; dalej: powiazaniaPrzesuniecie=${a.powiazaniaPrzesuniecie + a.powiazaniaLimit}.`);
    }
    if (!a.powiazania && powiazania.some((p) => (p.akty?.length ?? 0) > 0)) {
      uwagi.push('Powiązania to same adresy aktów: nie nazywaj aktu po adresie z pamięci; tytuły daje parametr powiazania albo narzędzie akt dla danego adresu.');
    }

    const opisNajnowszego = najnowszy
      ? await (async () => {
          const t = jakoRekord<AktZRejestru>(await zrodlo.json<unknown>(`eli/acts/${najnowszy}`), 'tekst jednolity', ['year', 'pos'], ['publisher']);
          return {
            adres: najnowszy,
            oznaczenie: t?.displayAddress ?? null,
            ogloszono: t?.promulgation ?? null,
            stanPrawnyNa: t?.legalStatusDate ?? null,
            html: t?.textHTML === true,
            pdf: t?.textPDF ? zrodlo.adres(`eli/acts/${najnowszy}/text.pdf`) : null,
          };
        })()
      : null;

    const dzis = dzisWarszawa();
    const wejscieWZycie = x.entryIntoForce ?? null;
    const wczesniejsze = terminyZKomentarza(x.comments, x.promulgation).filter((d) => d <= dzis);
    const obowiazywanie =
      x.inForce === 'IN_FORCE' && wejscieWZycie && wejscieWZycie > dzis && wczesniejsze.length
        ? `obowiązuje częściowo: część przepisów od ${wczesniejsze[0]}, termin główny wejścia w życie ${wejscieWZycie} (przepisyOInnymTerminie)`
        : x.inForce === 'IN_FORCE' && wejscieWZycie && wejscieWZycie > dzis
        ? `ogłoszony, ale jeszcze nie obowiązuje: wchodzi w życie ${wejscieWZycie}`
        : x.inForce === 'IN_FORCE'
          ? `obowiązuje${wejscieWZycie ? ` od ${wejscieWZycie}` : ''}`
          : x.inForce === 'NOT_IN_FORCE'
            ? `nie obowiązuje (status: ${x.status ?? 'brak'})`
            : `status: ${x.status ?? 'brak'}`;
    const druki = (x.prints ?? []).map(drukSejmowy);
    const zProcesem = druki.filter((d) => d.proces);
    if (zProcesem.length) {
      uwagi.push(
        `Podpis prezydenta, weto i skierowanie do TK są w rejestrze procesów: narzędzie proces z numerem ${zProcesem.map((d) => `${d.proces}${d.kadencja && d.kadencja !== 10 ? ` (kadencja ${d.kadencja})` : ''}`).join(', ')}.`,
      );
    }
    return {
      znaleziono: true,
      odpowiedz:
        `${x.displayAddress ?? a.adres} („${czysty(x.title)}”): ${obowiazywanie}; ogłoszony ${x.promulgation ?? 'brak daty'}` +
        `${zProcesem.length ? `; druk sejmowy ${zProcesem.map((d) => d.numer).join(', ')} (podpis, weto i TK: narzędzie proces ${zProcesem.map((d) => d.proces).join(', ')})` : ''}` +
        `${x.comments ? '; część przepisów wchodzi w życie w innym terminie (przepisyOInnymTerminie)' : ''}` +
        `${x.textHTML ? '' : '; tekst tylko w PDF'}` +
        `${x.validFrom && x.validFrom !== wejscieWZycie ? `; stosuje się od ${x.validFrom} (pole stosujeSieOd, inna data niż wejście w życie)` : ''}` +
        `${zastapionyPrzez && opisNajnowszego ? `; zastąpiony przez nowszy tekst jednolity ${opisNajnowszego.oznaczenie ?? zastapionyPrzez} (ogłoszony ${opisNajnowszego.ogloszono ?? 'brak daty'})` : ''}` +
        `${powiazania.length ? `. Powiązania w ELI: ${powiazania.map((p) => `${p.rodzaj} ${p.liczba}`).join(', ')}` : ''}.`,
      ...skrotAktu(x),
      // validFrom z ELI: od kiedy akt się stosuje (ustawa budżetowa na 2026 r. weszła w życie 2026-01-20, a stosuje się od 2026-01-01).
      stosujeSieOd: x.validFrom ?? null,
      wygasa: x.expirationDate ?? null,
      stanPrawnyNa: x.legalStatusDate ?? null,
      przepisyOInnymTerminie: x.comments ? czysty(x.comments) : null,
      uchylono: x.repealDate ?? null,
      wydal: (x.releasedBy ?? []).map((w) => czysty(w)),
      slowaKluczowe: (x.keywords ?? []).map((k) => czysty(k)),
      drukiSejmowe: druki,
      najnowszyTekstJednolity: opisNajnowszego,
      ...(obwieszczenie && bazowa ? { zastapionyPrzez: zastapionyPrzez ? opisNajnowszego : null } : {}),
      powiazania,
      tekst: {
        html: x.textHTML === true,
        pdf: x.textPDF ? zrodlo.adres(`${sciezka}/text.pdf`) : null,
      },
      zrodla,
      uwagi,
    };
  },
});

/**
 * Kawałek HTML-a aktu: jednostka (artykuł, paragraf…) razem ze wszystkim, co w niej leży.
 *
 * Każda jednostka to `<div class="unit …" id="pełna-ścieżka">`, np. w tekście jednolitym
 * kodeksu „bran_DRUGI-chpt_II-schp_5-arti_52”, a w krótkiej ustawie po prostu „arti_2”. Szukamy
 * jednostki, której ścieżka kończy się podanym id, i tniemy do pierwszej jednostki spoza niej.
 */
export function wytnijJednostke(html: string, id: string): string | null {
  const jednostka = /<div class="unit [^"]*" id="([^"]+)"/g;
  const wszystkie = [...html.matchAll(jednostka)].map((m) => ({ id: m[1], poz: m.index }));
  const artow = (x: string) => x.split('-').filter((seg) => seg.startsWith('arti_')).length;
  // Najpierw dokładne id, potem jednostka tego samego poziomu (art. ustawy, nie art. cytowany
  // w przepisie zmieniającym albo w części obwieszczenia), dopiero na końcu jakakolwiek.
  const pasujace = wszystkie.filter((j) => j.id === id || j.id.endsWith(`-${id}`));
  const trafienie = pasujace.find((j) => j.id === id) ?? pasujace.find((j) => artow(j.id) === artow(id)) ?? pasujace[0];
  if (!trafienie) return null;
  const start = trafienie.poz;
  const sciezka = trafienie.id;
  const dalej = wszystkie.find((j) => j.poz > start && !j.id.startsWith(`${sciezka}-`));
  if (dalej) return html.slice(start, dalej.poz);
  // Ostatni artykuł ciągnął za sobą wszystkie przypisy aktu (w kodeksie ok. 360 tys. znaków).
  const przypisy = html.indexOf('<div class="gloss-section"', start);
  return przypisy === -1 ? html.slice(start) : html.slice(start, przypisy);
}

const INDEKS_GORNY: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '(': '⁽', ')': '⁾', '+': '⁺', '-': '⁻',
};
const Z_INDEKSU = Object.fromEntries(Object.entries(INDEKS_GORNY).map(([k, v]) => [v, k]));

/** „5” → „⁵”; to, czego nie da się zapisać indeksem Unicode, idzie jako „^tekst”. */
export function indeksGorny(t: string): string {
  const s = t.trim();
  return [...s].every((c) => INDEKS_GORNY[c]) ? [...s].map((c) => INDEKS_GORNY[c]).join('') : `^${s}`;
}

/**
 * ELI zapisuje artykuł 764⁵ jako „Art.&nbsp;764<SUP>5</SUP>”, a htmlNaTekst zdejmuje znacznik i
 * zostaje „Art. 7645”: model i czytelnik widzieli nieistniejący artykuł. Zamieniamy <sup> na znaki
 * indeksu górnego, zanim HTML stanie się tekstem.
 */
export function zachowajIndeksy(html: string): string {
  // Odnośnik ELI („§ 1<a class="gloss-link"><sup>101)</sup><span class="tooltip-text">treść</span></a>”) dawał
  // „§ 1101)Ze zmianą…”: numer przypisu sklejał się z numerem paragrafu, a treść przypisu z przepisem.
  const bezPrzypisow = html.replace(/<a\b[^<>]*gloss-link[^<>]*>([\s\S]{0,4000}?)<\/a\s*>/gi, (_, srodek: string) => {
    const numer = /<sup\b[^<>]*>([^<>]{1,12})<\/sup\s*>/i.exec(srodek)?.[1]?.replace(/\)\s*$/, '').trim();
    const tresc = srodek.replace(/<sup\b[^<>]*>[^<>]*<\/sup\s*>/gi, '').replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return ` [przypis${numer ? ` ${numer}` : ''}${tresc ? `: ${tresc}` : ''}]`;
  });
  return bezPrzypisow.replace(/<sup\b[^<>]*>([^<>]{1,12})<\/sup\s*>/gi, (_, t: string) => indeksGorny(t.replace(/&nbsp;/g, ' ')));
}

/** Id jednostki („764_5”, „52a”) → numer do czytania („764⁵”, „52a”). */
function numerZId(ogon: string): string {
  return ogon.replace(/_([0-9]+)/g, (_, n: string) => indeksGorny(n));
}

/**
 * Numer artykułu tak, jak go piszą ludzie i modele („764^5”, „764⁵”, „764_5”, „764(5)”, „52a”)
 * → ogon id w HTML ELI („764_5”, „52a”).
 */
export function artykulNaId(artykul: string): string {
  const s = artykul.trim().toLowerCase().replace(/\s+/g, '');
  // „446[1]” to zapis indeksu z PDF tekstu jednolitego KC: to samo co „446(1)”.
  const m = /^([0-9]{1,4}[a-z]{0,3})(?:\^|_)?(?:[([]([0-9]{1,3})[)\]]|([0-9]{1,3})|([⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3}))?$/.exec(s);
  if (!m) return s;
  // „7645” bez znacznika to zwykły numer; indeks tylko po ^, _, nawiasie albo znaku indeksu.
  const indeks = m[2] ?? (/[\^_]/.test(s) ? m[3] : undefined) ?? (m[4] ? [...m[4]].map((c) => Z_INDEKSU[c]).join('') : undefined);
  if (!indeks && m[3]) return `${m[1]}${m[3]}`;
  return indeks ? `${m[1]}_${indeks}` : m[1];
}

interface ArtykulWTekscie {
  ogon: string;
  numer: number;
  litery: string;
  indeks: number;
}

/**
 * Obwieszczenie o tekście jednolitym ma dwie części: „Treść obwieszczenia” (z przytoczonymi przepisami
 * nowelizacji nieobjętymi tekstem, np. id „pass_2-pint_11-arti_20”) i „Załącznik – Tekst jednolity ustawy”.
 * Artykuł ustawy trzeba brać z załącznika: art. 20 z DU/2024/1251 to był art. 20 cudzej nowelizacji.
 * Zwraca HTML od załącznika z tekstem ustawy albo cały, gdy takiej części nie ma.
 */
export function tekstUstawyZObwieszczenia(html: string): string {
  for (const m of html.matchAll(/<div class="part"[^>]*>/g)) {
    const naglowek = html.slice(m.index, m.index + 1500).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    if (/^\s*Załącznik\b[^<]{0,40}?Tekst jednolity/i.test(naglowek)) return html.slice(m.index);
  }
  return html;
}

/**
 * Artykuły samego aktu (bez artykułów cytowanych w przepisach zmieniających, które leżą głębiej
 * w drzewie jednostek), po kolei. Z nich bierzemy ostatni artykuł, gdy pytanie trafia w pustkę.
 */
function artykulyWTekscie(html: string): ArtykulWTekscie[] {
  const wynik: ArtykulWTekscie[] = [];
  const widziane = new Set<string>();
  for (const m of html.matchAll(/<div class="unit [^"]*" id="([^"]+)"/g)) {
    const segmenty = m[1].split('-');
    const ostatni = segmenty[segmenty.length - 1];
    if (!ostatni.startsWith('arti_') || segmenty.filter((s) => s.startsWith('arti_')).length !== 1) continue;
    const ogon = ostatni.slice(5);
    const r = /^([0-9]+)([a-z]*)(?:_([0-9]+))?$/i.exec(ogon);
    if (!r || widziane.has(ogon)) continue;
    widziane.add(ogon);
    wynik.push({ ogon, numer: Number(r[1]), litery: r[2].toLowerCase(), indeks: r[3] ? Number(r[3]) : 0 });
  }
  return wynik;
}

function ostatniArtykul(lista: ArtykulWTekscie[]): ArtykulWTekscie | null {
  return [...lista].sort((p, q) => q.numer - p.numer || q.litery.localeCompare(p.litery) || q.indeks - p.indeks)[0] ?? null;
}

/**
 * Nagłówek artykułu na początku wiersza tekstu z PDF: „Art. 154.”, „Art. 9¹.”, „Art. 52a.”, „Art. 18^3a.”.
 * Po kropce bywa odnośnik przypisu: „Art. 23¹.³⁾ § 1.” w Kodeksie pracy, „Art. 446¹.⁶⁾ Z chwilą…” w KC;
 * bez niego artykuł z przypisem był „nieznaleziony”, a wycinek poprzedniego obejmował go w całości.
 */
const NAGLOWEK_ARTYKULU = /(?:^|\n)[ \t]*Art\. ([0-9]{1,4}[a-z]{0,3}(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3}[a-z]{0,2}|\^[0-9]{1,3}[a-z]{0,3})?)\.(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3}⁾|[0-9]{1,3}\))?(?=[ \n])/g;
/** Nagłówek jednostki nad artykułem: tu kończy się ostatni artykuł rozdziału. */
const NAGLOWEK_WYZEJ = /\n(?:KSIĘGA|CZĘŚĆ|TYTUŁ|DZIAŁ|Rozdział|Oddział) [^\n]{0,40}(?=\n)/g;
/** Podpis pod aktem i stopka wydawcy: tu kończy się ostatni artykuł aktu (art. 243 Konstytucji ciągnął stopkę dziennika). */
const KONIEC_AKTU = /\n(?:(?:Prezydent Rzeczypospolitej Polskiej|Marszałek Sejmu|Prezes Rady Ministrów)(?:: [^\n]{1,60})?(?=\n|$)|Wydawca: |Redakcja: )/g;

/**
 * Indeks górny zapisany w PDF w nawiasie („Art. 446[1].”, „art. 22[1]” w tekście jednolitym KC 2026)
 * → znaki indeksu („446¹”), tak jak w HTML ELI i w pozostałych PDF-ach. Tylko zaraz po cyfrze albo literze numeru.
 */
export function indeksyZNawiasow(tekst: string): string {
  return tekst.replace(/(\d[a-z]{0,3})\[([0-9]{1,3}[a-z]{0,2})\]/g, (_, p: string, n: string) => p + indeksGorny(n));
}

/**
 * Jeden artykuł z tekstu odczytanego z PDF (PDF nie ma drzewa jednostek jak HTML ELI): od nagłówka
 * „Art. N.” na początku wiersza do następnego nagłówka artykułu albo rozdziału. W tekście jednolitym
 * szukamy dopiero w załączniku, bo obwieszczenie cytuje przepisy przejściowe z własnymi „Art. 2.”.
 * Numer z indeksem górnym musi się zgadzać co do znaku: „Art. 9¹.” to nie „Art. 91.”, a „52a” to nie „52”.
 */
export function artykulZTekstuPdf(tekst: string, numer: string): { tekst: string | null; innych: number; ostatni: string | null } {
  const zal = /\n[ \t]*Załącznik\s+do\s+obwieszczenia/i.exec(tekst);
  const od = zal ? zal.index : 0;
  const naglowki = [...tekst.slice(od).matchAll(NAGLOWEK_ARTYKULU)].map((m) => ({ numer: m[1], poz: od + m.index + (m[0].startsWith('\n') ? 1 : 0) }));
  const liczba = (n: string) => Number(/^\d+/.exec(n)?.[0] ?? 0);
  const ostatni = naglowki.reduce<string | null>((max, n) => (max === null || liczba(n.numer) >= liczba(max) ? n.numer : max), null);
  const trafione = naglowki.filter((n) => n.numer === numer);
  if (!trafione.length) return { tekst: null, innych: 0, ostatni };
  const start = trafione[0].poz;
  const kolejny = naglowki.find((n) => n.poz > start)?.poz;
  const nastepny = kolejny ?? tekst.length;
  NAGLOWEK_WYZEJ.lastIndex = start;
  const wyzej = NAGLOWEK_WYZEJ.exec(tekst);
  let koniec = wyzej && wyzej.index < nastepny ? wyzej.index : nastepny;
  if (kolejny === undefined) {
    // Ostatni artykuł: do podpisu albo stopki wydawcy, nie do końca pliku.
    KONIEC_AKTU.lastIndex = start;
    const podpis = KONIEC_AKTU.exec(tekst);
    if (podpis && podpis.index < koniec) koniec = podpis.index;
  }
  return { tekst: tekst.slice(start, koniec).trim(), innych: trafione.length - 1, ostatni };
}

interface JednostkaStruktury {
  id: string;
  type?: string;
  title?: string;
  children?: JednostkaStruktury[];
}

interface ZmianaUstawy {
  adres: string;
  /** Data ogłoszenia w dzienniku: to ją porównujemy ze stanem prawnym tekstu jednolitego. */
  ogloszono: string | null;
  wZyciuOd: string | null;
  wNowszymTekscieJednolitym?: boolean;
}

/**
 * Czy zmiana NIE jest ujęta w tekście jednolitym o danym stanie prawnym. Obwieszczenie obejmuje
 * „zmiany wynikające z przepisów ogłoszonych przed dniem” stanu prawnego, także te, które weszły
 * w życie później (DU/2025/277 obejmuje DU/2024/1871, w życiu od 2025-03-19), więc decyduje data
 * ogłoszenia, nie wejścia w życie. Bez daty ogłoszenia: rok z adresu (pozycja w dzienniku danego
 * roku to ogłoszenie w tym roku), a w roku stanu prawnego ostrożnie data wejścia w życie.
 */
export function zmianaPoStanie(z: { id: string; date?: string }, ogloszono: string | undefined, stan: string): boolean {
  if (ogloszono) return ogloszono >= stan;
  const rok = Number(z.id.split('/')[1]);
  const rokStanu = Number(stan.slice(0, 4));
  if (Number.isFinite(rok) && rok < rokStanu) return false;
  if (Number.isFinite(rok) && rok > rokStanu) return true;
  return !z.date || z.date > stan;
}

/** „1 akt zmieniający”, „2 akty zmieniające”, „5 aktów zmieniających” („2 aktów” raziło w każdej odpowiedzi). */
function aktowZmieniajacych(n: number): string {
  if (n === 1) return '1 akt zmieniający';
  const d = n % 10;
  const s = n % 100;
  return d >= 2 && d <= 4 && !(s >= 12 && s <= 14) ? `${n} akty zmieniające` : `${n} aktów zmieniających`;
}

/** Łączny czas zapytań jednego wywołania tresc_aktu (z PDF), z zapasem pod limit klienta MCP ok. 60 s. */
const BUDZET_WYWOLANIA_MS = 50_000;

/** Ile zmian wymieniamy z nazwy w uwadze; reszta idzie w polu zmianyPoTekscie. */
const ZMIAN_W_UWADZE = 12;

const SEGMENT = '[a-z]{3,5}_[0-9A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż_]{1,24}';

export const trescAktu = narzedzie({
  nazwa: 'tresc_aktu',
  tytul: 'Treść aktu prawnego',
  opis:
    'Tekst aktu z bazy ELI jako zwykły tekst: cały w porcjach po 12 tys. znaków, jeden artykuł (artykul: "52", "52a", "764^5") albo jedna jednostka ' +
    '(fragment: id ze spisu). Ze spis=true zwraca spis artykułów i rozdziałów z ich id. Długie akty (kodeksy) czytaj artykułami, nie w całości. ' +
    'Każda odpowiedź podaje tytuł, rodzaj i oznaczenie aktu (pole akt): sprawdź, że to ten akt, o który pytano. ' +
    'Indeksy górne są zachowane (Art. 764⁵, § 2¹). Gdy akt albo jego najnowszy tekst jednolity ma tekst tylko w PDF, czyta tekst z PDF ' +
    '(pole zPdf; bez spisu jednostek, artykuł wycięty po nagłówku „Art. N.”); skanu bez warstwy tekstowej nie odczyta.' + OPIS_CZESCIOWY,
  wejscie: z.object({
    adres: adresAktu,
    artykul: z
      .string()
      .max(12)
      .regex(/^\s*[0-9]{1,4}[a-z]{0,3}(?:[\^_]?[0-9]{1,3}|\([0-9]{1,3}\)|\[[0-9]{1,3}\]|[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3})?\s*$/i, 'Numer artykułu, np. "52", "52a" albo "764^5"')
      .optional()
      .describe('Numer artykułu, np. "52", "52a"; z indeksem górnym "764^5" (art. 764⁵)'),
    fragment: z
      .string()
      .max(200)
      .regex(new RegExp(`^${SEGMENT}(-${SEGMENT}){0,8}$`, 'i'))
      .optional()
      .describe('Id jednostki ze spisu, np. "arti_1-pint_2" albo "book_PIERWSZA-part_OGÓLNA-titl_VI-arti_117-para_2_1"'),
    spis: z.boolean().default(false).describe('Zwróć spis jednostek zamiast tekstu'),
    brzmienie: z
      .enum(['aktualne', 'pierwotne'])
      .default('aktualne')
      .describe('aktualne: z najnowszego tekstu jednolitego, z HTML albo, gdy ELI ma go tylko w PDF, z PDF (domyślnie); pierwotne: z dnia ogłoszenia'),
    od: z.number().int().min(0).default(0).describe('Od którego znaku zacząć (dla długich tekstów)'),
  }),
  async wykonaj(a, zrodlo) {
    // Powody częściowości zbierane po drodze (awaria pomocniczego zapytania, PDF nieodczytany albo ucięty)
    // trafiają do jednego pola wynikCzesciowy, niezależnie od tego, którą drogą narzędzie odpowiada.
    const czesci: WynikCzesciowy[] = [];
    const wynik = await (async (): Promise<Wynik> => {
      // Jedno wywołanie to kilka zapytań JSON, PDF i jego odczyt; klient MCP czeka ok. 60 s na całość.
      const termin = Date.now() + BUDZET_WYWOLANIA_MS;
      const json = (sciezka: string) => zrodlo.json<unknown>(sciezka, { termin });
      const sPodany = `eli/acts/${a.adres}`;
      const podany = jakoRekord<AktZRejestru>(await json(sPodany), 'akt', ['year', 'pos'], ['publisher']);
      if (!podany) return { ...brak404('Baza ELI nie zna takiego aktu.'), zrodla: [zrodlo.adres(sPodany)] };

      // Tytuł zawsze: model wziął DU/1997/78 (rozporządzenie MF) za Konstytucję, bo odpowiedź „tylko PDF” nie mówiła, czym jest akt.
      const opisAktu = {
        adres: a.adres,
        tytul: czysty(podany.title),
        rodzaj: podany.type ?? null,
        oznaczenie: podany.displayAddress ?? null,
        statusWELI: podany.status ?? null,
      };
      const nazwaAktu = `${a.adres} („${opisAktu.tytul ?? 'bez tytułu'}”${opisAktu.oznaczenie ? `, ${opisAktu.oznaczenie}` : ''})`;

      // Adres samego tekstu jednolitego (obwieszczenia, np. DU/2025/734): obwieszczenie nie zna zmian
      // ustawy, zna je dopiero akt bazowy, więc bez niego zmiany po tekście (DU/2025/1818) umykały.
      const adresBazowy = /^obwieszczenie/i.test(podany.type ?? '')
        ? jakoLista<{ id: string }>(podany.references?.['Tekst jednolity dla aktu'], 'akt bazowy')[0]?.id
        : undefined;
      let bazowy: AktZRejestru | null = null;
      if (adresBazowy && /^(DU|MP)\/\d{4}\/\d+$/.test(adresBazowy)) {
        try {
          bazowy = jakoRekord<AktZRejestru>(await json(`eli/acts/${adresBazowy}`), 'akt bazowy', ['year', 'pos'], ['publisher']);
        } catch (e) {
          bazowy = null;
          czesci.push(
            czesciowyZBledu(
              e,
              `danych ustawy ${adresBazowy}, której tekstem jednolitym jest ${a.adres}: bez nich nie ma listy zmian ogłoszonych po tym tekście (zmianyPoTekscie), więc brzmienie mogło się od tego czasu zmienić`,
              `wywołać tresc_aktu jeszcze raz za kilka minut albo z adresem ${adresBazowy}`,
            ),
          );
        }
      }

      // Aktualne brzmienie ustawy zmienianej wiele razy jest w tekście jednolitym, nie w akcie pierwotnym.
      // Najnowszy bywa tylko w PDF, więc bierzemy najnowszy z HTML i mówimy wprost, z którego cytujemy.
      const uwagiBrzmienia: string[] = [];
      let x = podany;
      let adres = a.adres;
      let sAkt = sPodany;
      let nowszyPdf: AktZRejestru | null = null;
      // Tekst z PDF czytamy, gdy pytanie dotyczy treści; spis i fragment potrzebują drzewa jednostek z HTML.
      const moznaPdf = !a.spis && !a.fragment;
      let tekstPdf: TekstPdf | null = null;
      let bladPdf: string | null = null;
      const jednolite = jakoLista<{ id: string }>(podany.references?.['Inf. o tekście jednolitym'], 'teksty jednolite')
        .map((p) => p.id)
        .filter((id) => /^(DU|MP)\/\d{4}\/\d+$/.test(id))
        .sort((p, q) => Number(q.split('/')[1]) - Number(p.split('/')[1]) || Number(q.split('/')[2]) - Number(p.split('/')[2]));
      if (a.brzmienie === 'aktualne' && jednolite.length > 0) {
        const pominiete: string[] = [];
        for (const id of jednolite.slice(0, 4)) {
          const t = jakoRekord<AktZRejestru>(await json(`eli/acts/${id}`), 'tekst jednolity', ['year', 'pos'], ['publisher']);
          if (t?.textHTML) {
            x = t;
            adres = id;
            sAkt = `eli/acts/${id}`;
            break;
          }
          // Najnowszy tekst jednolity jest tylko w PDF: czytamy go zamiast starszego HTML-a.
          if (t && !nowszyPdf && moznaPdf && t.textPDF) {
            const w = await czytajPdf(zrodlo, zrodlo.adres(`eli/acts/${id}/text.pdf`), OPCJE_AKTU, termin);
            if (w.ok) {
              x = t;
              adres = id;
              sAkt = `eli/acts/${id}`;
              tekstPdf = w;
              break;
            }
            bladPdf = `${id}: ${w.powod}`;
          }
          if (t && !nowszyPdf) nowszyPdf = t;
          pominiete.push(id);
        }
        if (adres !== a.adres) {
          uwagiBrzmienia.push(
            `Cytuję z tekstu jednolitego ${adres} (${czysty(x.displayAddress) ?? ''}${x.legalStatusDate ? `, stan prawny na ${x.legalStatusDate}` : ''})` +
              (tekstPdf ? `, najnowszego w ELI; ELI ma go tylko w PDF, więc tekst odczytano z PDF: ${zrodlo.adres(`${sAkt}/text.pdf`)}` : '') +
              (pominiete.length
                ? `; NOWSZY tekst jednolity ${pominiete.join(', ')}${nowszyPdf?.legalStatusDate ? ` (stan prawny na ${nowszyPdf.legalStatusDate})` : ''} jest tylko w PDF: ${zrodlo.adres(`eli/acts/${pominiete[0]}/text.pdf`)}.`
                : '.'),
          );
        } else {
          uwagiBrzmienia.push(`Żaden z najnowszych tekstów jednolitych (${jednolite.slice(0, 4).join(', ')}) nie ma HTML; poniżej brzmienie pierwotne z ${a.adres}.`);
        }
        if (bladPdf) {
          uwagiBrzmienia.push(`Najnowszego tekstu jednolitego nie udało się odczytać z PDF (${bladPdf}), więc cytuję starszy tekst z HTML.`);
          czesci.push(
            czesciowy(
              `najnowszy tekst jednolity jest tylko w pliku PDF, a serwer nie zdołał go odczytać (${bladPdf})`,
              'najnowszego brzmienia: zacytowano starszy tekst jednolity, więc przepis mógł się od tego czasu zmienić',
              'otworzyć najnowszy tekst jednolity w PDF (adres w uwagach) albo zapytać ponownie za kilka minut',
            ),
          );
        }
        if (!moznaPdf && nowszyPdf) uwagiBrzmienia.push('spis i fragment działają tylko na tekście HTML; nowszy tekst jednolity z PDF da wywołanie bez nich (artykul albo cały tekst).');
      }

      // Cytujemy tekst jednolity: albo znaleziony dla ustawy, albo podany wprost adresem obwieszczenia.
      const cytowanyTj = adres !== a.adres || bazowy !== null;
      const aktZmian = bazowy ?? podany;
      if (bazowy) {
        const najnowszyTj = jakoLista<{ id: string }>(bazowy.references?.['Inf. o tekście jednolitym'], 'teksty jednolite')
          .map((p) => p.id)
          .filter((id) => /^(DU|MP)\/\d{4}\/\d+$/.test(id))
          .sort((p, q) => Number(q.split('/')[1]) - Number(p.split('/')[1]) || Number(q.split('/')[2]) - Number(p.split('/')[2]))[0];
        uwagiBrzmienia.push(
          `${a.adres} to tekst jednolity ustawy ${adresBazowy} („${czysty(bazowy.title) ?? ''}”)${x.legalStatusDate ? ` według stanu prawnego na ${x.legalStatusDate}` : ''}. ` +
            (najnowszyTj && najnowszyTj !== a.adres
              ? `To NIE jest najnowszy tekst jednolity tej ustawy: nowszy to ${najnowszyTj} (tresc_aktu z adresem ${adresBazowy} cytuje najnowszy). `
              : '') +
            'Zmiany ogłoszone po stanie prawnym tego tekstu: pole zmianyPoTekscie.',
        );
      }

      // Zmiany ustawy, których cytowany tekst nie ujmuje. ELI nie mówi, które artykuły zmieniają
      // (powiązania nie mają pola art., a ustawy zmieniające są zwykle tylko w PDF), więc wymieniamy je z datą.
      const dzis = dzisWarszawa();
      const granica = cytowanyTj ? (x.legalStatusDate ?? null) : null;
      const wszystkieZmiany = jakoLista<{ id: string; date?: string }>(aktZmian.references?.['Akty zmieniające'], 'akty zmieniające');
      // Datę ogłoszenia zmian niesie dopiero /references ustawy: bierzemy ją zawsze, gdy są zmiany, bo pole
      // ogloszono w zmianyPoTekscie było puste (Konstytucja: DU/2006/1471, DU/2009/946). Awaria zostawia
      // ostrożne porównanie dat z roku adresu.
      const ogloszenia = new Map<string, string>();
      if (wszystkieZmiany.length > 0) {
        const sRef = `eli/acts/${bazowy ? adresBazowy : a.adres}/references`;
        try {
          const pelne = jakoRekord<Record<string, unknown>>(await json(sRef), 'powiązania') ?? {};
          for (const p of jakoLista<{ act?: { ELI?: string; promulgation?: string } }>(pelne['Akty zmieniające'], 'akty zmieniające')) {
            if (p.act?.ELI && p.act.promulgation) ogloszenia.set(p.act.ELI, p.act.promulgation);
          }
        } catch (e) {
          // Bez dat ogłoszenia zostaje rok z adresu i data wejścia w życie (zmianaPoStanie), ale mówimy, czego brak.
          czesci.push(
            czesciowyZBledu(
              e,
              'dat ogłoszenia aktów zmieniających (pole ogloszono w zmianyPoTekscie); to, które zmiany są po stanie tekstu, oszacowano z roku i daty wejścia w życie',
              'zapytać ponownie za kilka minut albo sprawdzić akty zmieniające narzędziem akt',
            ),
          );
        }
      }
      const zmianyPo: ZmianaUstawy[] = (granica ? wszystkieZmiany.filter((z) => zmianaPoStanie(z, ogloszenia.get(z.id), granica)) : wszystkieZmiany)
        .map((z) => ({
          adres: z.id,
          ogloszono: ogloszenia.get(z.id) ?? null,
          wZyciuOd: z.date ?? null,
          ...(nowszyPdf?.legalStatusDate ? { wNowszymTekscieJednolitym: !zmianaPoStanie(z, ogloszenia.get(z.id), nowszyPdf.legalStatusDate) } : {}),
        }))
        .sort((p, q) => (p.wZyciuOd ?? '9999').localeCompare(q.wZyciuOd ?? '9999'));
      const opisZmiany = (z: ZmianaUstawy) => `${z.adres}${z.wZyciuOd ? ` (${z.wZyciuOd > dzis ? 'wejdzie w życie' : 'w życiu od'} ${z.wZyciuOd})` : ''}`;
      const lista = (l: ZmianaUstawy[]) => l.slice(0, ZMIAN_W_UWADZE).map(opisZmiany).join(', ') + (l.length > ZMIAN_W_UWADZE ? ` i ${l.length - ZMIAN_W_UWADZE} innych (pole zmianyPoTekscie)` : '');
      let uwagaZmian: string | null = null;
      if (zmianyPo.length) {
        const ujete = zmianyPo.filter((z) => z.wNowszymTekscieJednolitym);
        const nieujete = zmianyPo.filter((z) => !z.wNowszymTekscieJednolitym);
        uwagaZmian =
          (cytowanyTj
            ? `UWAGA: tekst jednolity obejmuje zmiany ogłoszone przed dniem stanu prawnego${granica ? ` (${granica})` : ''}; od tego dnia ogłoszono ${aktowZmieniajacych(zmianyPo.length)} tę ustawę (według ELI). `
            : `UWAGA: to brzmienie z dnia ogłoszenia; ELI notuje ${aktowZmieniajacych(zmianyPo.length)} tę ustawę. `) +
          (ujete.length && nowszyPdf ? `Ujmuje je już nowszy tekst jednolity ${nowszyPdf.displayAddress ?? ''} (tylko PDF): ${lista(ujete)}. ` : '') +
          (nieujete.length ? `${ujete.length ? 'Nieujęte w żadnym tekście jednolitym' : 'Zmiany'}: ${lista(nieujete)}. ` : '') +
          'ELI nie podaje, które artykuły zmienia każdy z nich. Zanim nazwiesz cytowane brzmienie aktualnym, powiedz czytelnikowi, że mogło się zmienić, ' +
          'i sprawdź tytuły tych aktów (akt z powiazania="Akty zmieniające").';
      }

      const pdf = x.textPDF ? zrodlo.adres(`${sAkt}/text.pdf`) : null;
      // Zawsze mówimy, z którego tekstu pochodzi odpowiedź: spis bywał z HTML z 2024 r., a artykuł z PDF z 2026 r.
      const tekstZ = cytowanyTj ? { adres, oznaczenie: x.displayAddress ?? null, stanPrawnyNa: x.legalStatusDate ?? null } : null;
      const opisNowszegoPdf = nowszyPdf
        ? `${nowszyPdf.displayAddress ?? adresEli(nowszyPdf)}${nowszyPdf.legalStatusDate ? `, stan prawny na ${nowszyPdf.legalStatusDate}` : ''}`
        : null;
      const zrodloTekstu = (format: 'html' | 'pdf') => ({
        adres,
        oznaczenie: x.displayAddress ?? null,
        brzmienie: cytowanyTj ? 'tekst jednolity' : 'z dnia ogłoszenia',
        stanPrawnyNa: cytowanyTj ? (x.legalStatusDate ?? null) : null,
        format,
        // HTML starszy niż najnowszy tekst jednolity (ten jest tylko w PDF): model musi to widzieć przy każdym cytacie.
        ...(nowszyPdf && format === 'html' ? { starszyNizNajnowszy: true, najnowszyTylkoPdf: opisNowszegoPdf } : {}),
      });
      const wspolne = { akt: opisAktu, ...(tekstZ ? { tekstZ } : {}) };

      /** Odpowiedź z tekstu odczytanego z PDF: cały tekst w porcjach albo jeden artykuł wycięty po nagłówkach. */
      const odpowiedzZPdf = (w: TekstPdf, adresPdf: string) => {
        const skad =
          (tekstZ ? `, cytowany z tekstu jednolitego ${tekstZ.oznaczenie ?? adres}${tekstZ.stanPrawnyNa ? ` (stan prawny na ${tekstZ.stanPrawnyNa})` : ''}` : ', brzmienie z dnia ogłoszenia') +
          ', tekst odczytany z PDF';
        const uwagiPdf = [UWAGA_PDF, uwagaOdczytuPdf(w)];
        // „Art. 446¹.⁶⁾”: znacznik zostaje, bo taki jest w dzienniku, ale model brał go za część numeru.
        if (/[⁰¹²³⁴⁵⁶⁷⁸⁹]+⁾/.test(w.tekst)) uwagiPdf.push(UWAGA_PRZYPISY);
        // Ile stron przeczytano i czy całość: bez tego model nie wiedział, czy brak czegoś w tekście to brak w pliku.
        const stronyPdf = { stronPdf: w.stron, przeczytanoStronPdf: w.przeczytanoStron, pdfUciety: w.uciety };
        if (w.uciety) {
          czesci.push(
            czesciowy(
              `plik PDF jest za długi: serwer odczytał ${w.przeczytanoStron} z ${w.stron} stron (limit stron albo znaków)`,
              'dalszej części tekstu aktu (artykułów z pominiętych stron)',
              `otworzyć PDF z adresu ${adresPdf}; brak artykułu w odczytanym tekście nie znaczy, że go w akcie nie ma`,
            ),
          );
        }
        const pelny = indeksyZNawiasow(w.tekst);
        let tekst = pelny;
        let jednostka: string | null = null;
        if (a.artykul) {
          const numer = numerZId(artykulNaId(a.artykul));
          const c = artykulZTekstuPdf(pelny, numer);
          if (c.tekst === null) {
            return {
              znaleziono: false,
              odpowiedz:
                `Art. ${numer}: w tekście ${tekstZ?.oznaczenie ?? adres} odczytanym z PDF nie ma nagłówka „Art. ${numer}.”` +
                (c.ostatni ? `; ostatni artykuł w tym tekście to ${c.ostatni}` : '') +
                '.',
              ...wspolne,
              zrodloTekstu: zrodloTekstu('pdf'),
              adres,
              zPdf: true,
              ostatniArtykul: c.ostatni,
              ...stronyPdf,
              pdf: adresPdf,
              zrodla: [adresPdf],
              uwagi: [
                'Artykułu szukano jako nagłówka „Art. N.” na początku wiersza tekstu z PDF. Artykuł z indeksem górnym podaj z indeksem (artykul: "9^1" dla art. 9¹); ' +
                  'jeśli numer się zgadza, a artykułu nie ma, przeczytaj tekst w porcjach (bez artykul) albo podaj czytelnikowi adres PDF. Nie podawaj treści artykułu z pamięci.',
                ...uwagiPdf,
                ...uwagiBrzmienia,
              ],
            };
          }
          tekst = c.tekst;
          jednostka = `Art. ${numer}`;
          uwagiPdf.push(
            'PDF nie ma struktury jednostek: artykuł wycięto od nagłówka „Art. N.” do następnego artykułu albo nagłówka rozdziału. ' +
              'Sprawdź, czy granice się zgadzają; przypis ze stopki strony może wpaść w środek artykułu.',
          );
          if (c.innych > 0) uwagiPdf.push(`Nagłówek „Art. ${numer}.” występuje w tekście jeszcze ${c.innych === 1 ? 'raz' : `${c.innych} razy`} (np. w przepisie cytowanym); wzięto pierwszy.`);
        }
        return {
          znaleziono: true,
          odpowiedz:
            `${jednostka ? `${jednostka}: ` : ''}${nazwaAktu}${skad}` +
            (zmianyPo.length ? `; po tym tekście ELI notuje ${aktowZmieniajacych(zmianyPo.length)} (uwagi)` : '') +
            '.',
          ...wspolne,
          zrodloTekstu: zrodloTekstu('pdf'),
          adres,
          zPdf: true,
          jednostka,
          ...fragment(tekst, a.od),
          pdf: adresPdf,
          ...stronyPdf,
          ...(zmianyPo.length ? { zmianyPoTekscie: zmianyPo } : {}),
          zrodla: [adresPdf],
          uwagi: [
            ...uwagiPdf,
            ...(uwagaZmian ? [uwagaZmian] : []),
            ...(uwagiBrzmienia.length
              ? uwagiBrzmienia
              : zmianyPo.length
                ? []
                : ['To brzmienie z dnia ogłoszenia tego aktu. Późniejsze zmiany są w aktach zmieniających i w tekstach jednolitych (narzędzie akt).']),
            UWAGA_TEKST_Z_ZEWNATRZ,
          ],
        };
      };
      if (!x.textHTML) {
        let wPdf = tekstPdf;
        let powod: string | null = null;
        if (!wPdf && moznaPdf && pdf) {
          const w = await czytajPdf(zrodlo, pdf, OPCJE_AKTU, termin);
          if (w.ok) wPdf = w;
          else {
            powod = w.powod;
            czesci.push(czesciowy(`tekst aktu jest tylko w pliku PDF, a serwer nie zdołał go odczytać (${powod})`, 'treści aktu', `otworzyć PDF z adresu ${pdf}; nie cytować przepisów z pamięci`));
          }
        }
        if (wPdf && pdf) return odpowiedzZPdf(wPdf, pdf);
        return {
          znaleziono: true,
          odpowiedz: `${nazwaAktu}, rodzaj: ${opisAktu.rodzaj ?? 'brak'}. Tekst tylko w PDF: ${pdf ?? 'brak adresu'}.`,
          ...wspolne,
          adres,
          tekstHtml: false,
          pdf,
          ...(zmianyPo.length ? { zmianyPoTekscie: zmianyPo } : {}),
          zrodla: [zrodlo.adres(sAkt)],
          uwagi: [
            ...(uwagaZmian ? [uwagaZmian] : []),
            'Sprawdź tytuł w polu akt: czy to ten akt, o który pytano? Adres aktu sprzed 2012 r. to rok/POZYCJA, nie numer dziennika.',
            (powod
              ? `Ten akt ma w bazie ELI tylko tekst PDF, a serwer nie zdołał go odczytać (${powod}). `
              : moznaPdf
                ? 'Ten akt ma w bazie ELI tylko tekst PDF, a ELI nie podaje jego adresu. '
                : 'Ten akt ma w bazie ELI tylko tekst PDF: spis i fragment wymagają HTML, a bez nich tresc_aktu odczyta tekst z PDF. ') +
              'Podaj adres PDF. Nie cytuj i nie streszczaj przepisów tego aktu z pamięci; ' +
              'jeśli podajesz cokolwiek spoza API, oznacz to wprost jako wiedzę ogólną, niepotwierdzoną w bazie ELI. ' +
              'Jeśli to tekst jednolity, wcześniejszy tekst jednolity (narzędzie akt, powiązania „Inf. o tekście jednolitym”) często ma HTML; ' +
              'wtedy powiedz, z którego roku jest brzmienie, które cytujesz.',
          ],
        };
      }

      if (a.spis) {
        const sStr = `${sAkt}/struct`;
        const drzewo = jakoLista<JednostkaStruktury>(await json(sStr), 'struktura aktu');
        const spis: Array<{ id: string; tytul: string | null; poziom: number }> = [];
        const zbierz = (lista: JednostkaStruktury[], poziom: number) => {
          for (const j of lista) {
            // Artykuły i wszystko nad nimi (części, działy, rozdziały); punkty i litery pomijamy.
            // Tytuł „Art. 764_5.” to w ELI art. 764⁵: oddajemy go z indeksem górnym.
            if (!/^(pint|lett|pass|tire|ust|para)$/.test(j.type ?? '')) {
              spis.push({ id: j.id, tytul: j.type === 'arti' ? (czysty(j.title) ?? '').replace(/(\d[a-z]*)_(\d+)/g, (_, p: string, n: string) => p + indeksGorny(n)) || null : czysty(j.title), poziom });
            }
            if (j.type !== 'arti') zbierz(j.children ?? [], poziom + 1);
          }
        };
        zbierz(drzewo, 0);
        const porcja = spis.slice(a.od, a.od + 300);
        return {
          znaleziono: true,
          odpowiedz:
            `Spis jednostek ${nazwaAktu}` +
            (tekstZ ? ` z tekstu jednolitego ${tekstZ.oznaczenie ?? adres}${tekstZ.stanPrawnyNa ? ` (stan prawny na ${tekstZ.stanPrawnyNa})` : ''}` : ', brzmienie z dnia ogłoszenia') +
            ', z HTML' +
            (opisNowszegoPdf
              ? `; UWAGA: to STARSZY tekst, najnowszy tekst jednolity ${opisNowszegoPdf} jest tylko w PDF (bez spisu), a tresc_aktu z artykul cytuje z niego, więc numeracja może się różnić od tego spisu`
              : '') +
            '.',
          ...wspolne,
          zrodloTekstu: zrodloTekstu('html'),
          adres,
          jednostek: spis.length,
          spis: porcja,
          nastepnyOd: a.od + 300 < spis.length ? a.od + 300 : null,
          zrodla: [zrodlo.adres(sStr)],
          uwagi: ['Id z pola id podaj jako fragment, a numer artykułu jako artykul (z indeksem górnym jako "764^5").', ...uwagiBrzmienia],
        };
      }

      const sTekst = `${sAkt}/text.html`;
      const html = await zrodlo.tekst(sTekst, { termin });
      if (html === null) return { znaleziono: false, ...wspolne, pdf, zrodla: [zrodlo.adres(sTekst)], uwagi: ['Baza ELI nie oddała tekstu HTML.'] };

      const ogon = a.artykul ? artykulNaId(a.artykul) : null;
      const id = a.fragment ?? (ogon ? `arti_${ogon}` : null);
      const oznaczenieTekstu = x.displayAddress ?? adres;
      // Numer artykułu dotyczy ustawy, więc w obwieszczeniu szukamy go w załączniku z tekstem jednolitym;
      // id z spisu (fragment) jest dokładne i może wskazywać część obwieszczenia, więc tam cały HTML.
      const htmlArtykulow = ogon && !a.fragment && /^obwieszczenie/i.test(x.type ?? '') ? tekstUstawyZObwieszczenia(html) : html;
      let tekst: string;
      if (id) {
        const kawalek = wytnijJednostke(htmlArtykulow, id);
        if (kawalek === null) {
          if (ogon) {
            // Odpowiedź wprost, zamiast „sprawdź id”: ta wskazówka posłała model w 16 dodatkowych wywołań.
            const artykuly = artykulyWTekscie(htmlArtykulow);
            const ostatni = ostatniArtykul(artykuly);
            const liczba = Number(/^\d+/.exec(ogon)?.[0] ?? NaN);
            // „7645” to często spłaszczone 764⁵: podpowiadamy artykuły, których cyfry dają ten sam napis.
            const podobne = artykuly.filter((r) => r.indeks && `${r.numer}${r.litery}${r.indeks}` === ogon).map((r) => numerZId(r.ogon));
            const zdanie =
              ostatni && liczba > ostatni.numer
                ? `Art. ${numerZId(ogon)} nie istnieje w tym tekście (${oznaczenieTekstu}); ostatni artykuł to ${numerZId(ostatni.ogon)}.`
                : `Art. ${numerZId(ogon)} nie istnieje w tym tekście (${oznaczenieTekstu})${ostatni ? `; artykuły mają numery od 1 do ${numerZId(ostatni.ogon)}` : ''}.`;
            return {
              znaleziono: false,
              odpowiedz: zdanie + (podobne.length ? ` Czy chodziło o art. ${podobne.join(' albo art. ')} (artykul: "${podobne.map((p) => artykulNaId(p).replace('_', '^')).join('" albo "')}")?` : ''),
              ...wspolne,
              adres,
              // Liczba jednostek „Art.” (z 764¹, 52a i uchylonymi) nie była liczbą artykułów kodeksu, a model tak ją przepisywał; zostaje ostatni numer.
              ostatniArtykul: ostatni ? numerZId(ostatni.ogon) : null,
              zrodloTekstu: zrodloTekstu('html'),
              zrodla: [zrodlo.adres(sTekst)],
              uwagi: [
                'Nie szukaj tego artykułu pod innym id ani w porcjach całego tekstu: numeracja pochodzi z tego samego HTML-a. Nie podawaj jego treści z pamięci.',
                ...uwagiBrzmienia,
              ],
            };
          }
          return {
            znaleziono: false,
            ...wspolne,
            adres,
            zrodla: [zrodlo.adres(sTekst)],
            uwagi: [`W tekście nie ma jednostki ${id}. Id jednostek podaje spis (spis=true).`, ...uwagiBrzmienia],
          };
        }
        tekst = htmlNaTekst(zachowajIndeksy(kawalek));
      } else {
        tekst = htmlNaTekst(zachowajIndeksy(html));
      }

      const jednostka = ogon ? `Art. ${numerZId(ogon)}` : id;
      return {
        znaleziono: true,
        odpowiedz:
          `${jednostka ? `${jednostka}: ` : ''}${nazwaAktu}` +
          (tekstZ ? `, cytowany z tekstu jednolitego ${tekstZ.oznaczenie ?? adres}${tekstZ.stanPrawnyNa ? ` (stan prawny na ${tekstZ.stanPrawnyNa})` : ''}` : ', brzmienie z dnia ogłoszenia') +
          (opisNowszegoPdf ? `; UWAGA: to starszy tekst, nowszy tekst jednolity ${opisNowszegoPdf} jest tylko w PDF` : '') +
          (zmianyPo.length ? `; po tym tekście ELI notuje ${aktowZmieniajacych(zmianyPo.length)} (uwagi)` : '') +
          '.',
        ...wspolne,
        zrodloTekstu: zrodloTekstu('html'),
        adres,
        jednostka: id,
        ...fragment(tekst, a.od),
        pdf,
        ...(zmianyPo.length ? { zmianyPoTekscie: zmianyPo } : {}),
        zrodla: [zrodlo.adres(sTekst)],
        uwagi: [
          ...(uwagaZmian ? [uwagaZmian] : []),
          ...(uwagiBrzmienia.length
            ? uwagiBrzmienia
            : zmianyPo.length
              ? []
              : ['To brzmienie z dnia ogłoszenia tego aktu. Późniejsze zmiany są w aktach zmieniających i w tekstach jednolitych (narzędzie akt).']),
          UWAGA_TEKST_Z_ZEWNATRZ,
        ],
      };
    })();
    return dolaczCzesciowe(wynik, czesci);
  },
});

// ---------------------------------------------------------------------------
// Słowniki ELI
// ---------------------------------------------------------------------------

const SLOWNIKI = {
  rodzaje: 'eli/types',
  statusy: 'eli/statuses',
  instytucje: 'eli/institutions',
  slowa_kluczowe: 'eli/keywords',
  powiazania: 'eli/references',
  wydawcy: 'eli/acts',
} as const;

export const slownikEli = narzedzie({
  nazwa: 'slownik_eli',
  tytul: 'Słowniki bazy aktów prawnych',
  opis:
    'Dopuszczalne wartości do wyszukiwania aktów: rodzaje aktów, statusy, instytucje, słowa kluczowe (ok. 2500), rodzaje powiązań, ' +
    'wydawcy z liczbą aktów; oraz podpowiedzi słów z tytułów (tytuly z frazą). Użyj, zanim podasz słowo kluczowe albo rodzaj do szukaj_aktow.',
  wejscie: z.object({
    slownik: z.enum(['rodzaje', 'statusy', 'instytucje', 'slowa_kluczowe', 'powiazania', 'wydawcy', 'tytuly']),
    fraza: z.string().min(2).max(100).optional().describe('Zawęź do pozycji zawierających frazę (przy tytuly: wymagana)'),
  }),
  async wykonaj(a, zrodlo) {
    if (a.slownik === 'tytuly') {
      if (!a.fraza) throw new Error('Przy slownik="tytuly" podaj frazę.');
      const sciezka = 'eli/titles';
      const lista = jakoLista<string>(await zrodlo.json<unknown>(sciezka, { parametry: { q: a.fraza } }), 'tytuły');
      return { pozycje: lista.map((t) => czysty(String(t))), zrodla: [zrodlo.adres(sciezka, { q: a.fraza })] };
    }
    const sciezka = SLOWNIKI[a.slownik];
    const surowe = await zrodlo.json<unknown>(sciezka);
    if (a.slownik === 'wydawcy') {
      const wydawcy = jakoLista<{ code: string; name: string; actsCount: number; years?: number[] }>(surowe, 'wydawcy');
      return {
        pozycje: wydawcy.map((w) => ({
          kod: w.code,
          nazwa: czysty(w.name),
          aktow: w.actsCount,
          lata: w.years?.length ? `${Math.min(...w.years)}–${Math.max(...w.years)}` : null,
        })),
        zrodla: [zrodlo.adres(sciezka)],
      };
    }
    let pozycje = jakoLista<unknown>(surowe, a.slownik).map((x) => czysty(String(x)) ?? '');
    if (a.fraza) pozycje = pozycje.filter((x) => klucz(x).includes(klucz(a.fraza)));
    const NAJWYZEJ = 300;
    return {
      liczba: pozycje.length,
      pozycje: pozycje.slice(0, NAJWYZEJ),
      zrodla: [zrodlo.adres(sciezka)],
      uwagi: pozycje.length > NAJWYZEJ ? [`Pokazano ${NAJWYZEJ} z ${pozycje.length}; zawęź frazą.`] : [],
    };
  },
});
