import { z } from 'zod';
import { dzisWarszawa, odmiana, roznicaDni } from '../reguly/daty.js';
import {
  DNI_NA_ODPOWIEDZ,
  OPIS_PRZYPISANIA,
  czyOdpowiedziano,
  odpowiadajacyZTresci,
  przypiszOdpowiedzi,
  stanyAdresatow,
  wiarygodnaData,
  wnioskiPisma,
  zlozStan,
  type AdresatPisma,
  type OdpowiedzPisma,
  type WnioskiPisma,
} from '../reguly/pisma.js';
import type { ZrodloSejmu } from '../klient.js';
import { czytajPdf, OPCJE_PISMA, UWAGA_PDF } from '../pdf.js';
import { naCzas } from './na-czas.js';
import { bezpiecznyLink, czysty, fragment, htmlNaTekst, klucz } from '../tekst.js';
import { brak404, OPIS_CZESCIOWY, czesciowy, polaczCzesciowe, type WynikCzesciowy, autorzy, data, jakoLista, jakoRekord, kadencja, limit, maWszystkie, narzedzie, nazwiskaPoslow, przesuniecie, sprawdzPrzedzial, T, UWAGA_TEKST_Z_ZEWNATRZ } from './wspolne.js';

interface PismoZRejestru {
  num: number;
  title: string;
  receiptDate?: string;
  sentDate?: string;
  lastModified?: string;
  from?: string[];
  to?: string[];
  recipientDetails?: AdresatPisma[];
  replies?: Array<OdpowiedzPisma & { from?: string; onlyAttachment?: boolean; lastModified?: string; attachments?: Array<{ URL: string; name: string }> }>;
}

const rodzajPisma = z
  .enum(['interpelacja', 'zapytanie'])
  .describe('interpelacja = /interpellations, zapytanie = zapytanie pisemne /writtenQuestions');

const sciezkaRodzaju = (r: 'interpelacja' | 'zapytanie') => (r === 'interpelacja' ? 'interpellations' : 'writtenQuestions');

const UWAGA_TERMIN =
  `Termin odpowiedzi to ${DNI_NA_ODPOWIEDZ} dni od doręczenia pisma adresatowi (pole doreczono), nie od wpływu do Sejmu. ` +
  'Prolongata to pismo ministra zapowiadające późniejszą odpowiedź; Sejm jej nie zatwierdza, a opóźnienie liczy się od terminu mimo prolongat. Prolongata nie jest odpowiedzią. Przy kilku adresatach odpowiedź przypisujemy adresatowi po podpisie ' +
  '(resort albo ta sama osoba co w prolongatach), po linii „Odpowiadający” w treści odpowiedzi i po datach (odpowiedź sprzed doręczenia adresatowi nie jest jego); czego nie da się przypisać, to „nie wiadomo”, a licznik Sejmu równy zero nie jest dowodem odpowiedzi. ' +
  'poTerminieU: adresaci bez odpowiedzi po terminie; odpowiedzPoTerminieU: adresaci, którzy odpowiedzieli po terminie. dniPoTerminie liczymy od dnia terminu (dzień po terminie = 1); ' +
  'licznik Sejmu bywa o jeden dzień mniejszy. odpowiedzDniPoTerminie ujemne znaczy: odpowiedź przed terminem.';

/**
 * Licznik Sejmu (answerDelayedDays) i nasze „dni po terminie” liczą co innego; model, który widzi
 * „0” obok spóźnionej odpowiedzi, musi wiedzieć dlaczego.
 */
const UWAGA_LICZNIK =
  'licznikOpoznieniaSejmu to licznik samego Sejmu (answerDelayedDays): liczy dni zwłoki tylko adresatowi, który jeszcze nie odpowiedział, ' +
  'a po odpowiedzi, zwykle też po prolongacie złożonej w terminie, pokazuje 0 (bywa 0 także u adresata bez odpowiedzi, np. interpelacja 12176). ' +
  'Nasze dni po terminie liczymy od doręczenia plus 21 dni, bez przedłużeń z prolongat. Gdy licznik mówi 0, a dni po terminie są dodatnie, podaj oba i to wyjaśnienie, nie samo 0.';

/** Uwaga dla pism, którym rejestr nie podał doręczenia żadnemu adresatowi. */
const UWAGA_SENT_DATE =
  'Rejestr nie podał daty doręczenia (recipientDetails puste); termin liczymy od daty wysłania pisma z Sejmu (sentDate). ' +
  'Doręczenie jest zwykle tego samego dnia lub niewiele później, więc to przybliżenie, oznaczone polem terminOd="wysłanie".';

type AdresatZTerminem = AdresatPisma & { zWyslania?: boolean; niewyslane?: boolean };

/**
 * Adresaci z datą doręczenia. Gdy rejestr jej nie podał (interpelacja 13144: recipientDetails
 * puste, a sentDate jest), bierzemy datę wysłania z Sejmu: bez tego pismo z 300 dniami zwłoki
 * wychodziło „bez terminu”. Bez obu dat (interpelacja 20000, świeżo złożona) adresaci są tylko
 * w polu `to`: podajemy ich bez terminu, bo pusta lista czytała się jak „pismo bez adresata”.
 */
function adresaciPisma(p: PismoZRejestru): AdresatZTerminem[] {
  if ((p.recipientDetails ?? []).length > 0) return p.recipientDetails as AdresatPisma[];
  if (!p.sentDate) return (p.to ?? []).map((name) => ({ name, sent: null, answerDelayedDays: null, niewyslane: true }));
  const nazwy = (p.to ?? []).length ? (p.to as string[]) : ['adresat nieznany'];
  return nazwy.map((name) => ({ name, sent: p.sentDate as string, answerDelayedDays: null, zWyslania: true }));
}

/** Doręczenie tyle dni po wpływie to anomalia rejestru warta zdania (interpelacja 1279: 2024 → 2026). */
const DORECZENIE_ANOMALIA_DNI = 60;

function dniWplywDoreczenie(p: PismoZRejestru, ad: AdresatZTerminem): number | null {
  if (!p.receiptDate || !ad.sent || ad.zWyslania) return null;
  const dni = roznicaDni(p.receiptDate, ad.sent);
  return dni > DORECZENIE_ANOMALIA_DNI ? dni : null;
}

/** Najwięcej treści odpowiedzi pobieranych w jednym wywołaniu po linię „Odpowiadający”. */
const TRESCI_PISMO = 10;
const TRESCI_LISTA = 12;
/**
 * Do tej chwili od startu wywołania czytamy treści odpowiedzi (lista i pojedyncze pismo). Klient MCP
 * przerywa po ok. 60 s, a minister zdrowia z 12 treściami trwał 69 s: resztę oddajemy jako częściowe.
 */
const CZAS_TRESCI_LISTA_MS = 22_000;
const CZAS_TRESCI_PISMO_MS = 30_000;

/**
 * Przeczytane linie „Odpowiadający” (null: treść jest, linii brak), osobno dla każdego źródła.
 * Treść wysłanej odpowiedzi się nie zmienia, a Sejm oddaje ją po 4 do 30 s (07-b: 44 s na liście),
 * więc ponowne pytanie o tego samego adresata nie czyta jej drugi raz.
 */
const pamiecLinii = new WeakMap<ZrodloSejmu, Map<string, string | null>>();
const MAKS_LINII = 5000;

function liniePamieci(zrodlo: ZrodloSejmu): Map<string, string | null> {
  let pam = pamiecLinii.get(zrodlo);
  if (!pam) pamiecLinii.set(zrodlo, (pam = new Map()));
  return pam;
}

const sciezkaTresci = (baza: string, k: string) => `${baza}/reply/${k}/body`;

/**
 * Linie „Odpowiadający” z treści odpowiedzi, których nie przypisał podpis ani daty. Pole `from`
 * bywa samym „Sekretarz stanu Jan Kowalski”, a treść mówi, z którego to ministerstwa (3442).
 * Jedna kolejka na wszystkie pisma, z terminem: czego nie zdążono, wraca w `niePobrane`.
 */
async function odpowiadajacyWielu(zrodlo: ZrodloSejmu, pisma: ReadonlyArray<{ baza: string; klucze: string[] }>, termin: number) {
  const pam = liniePamieci(zrodlo);
  const zadania = pisma.flatMap((p, i) => p.klucze.map((k) => ({ i, k, sciezka: sciezkaTresci(p.baza, k) })));
  // Przeczytane wcześniej nie zajmują miejsca w kolejce.
  const doPobrania = zadania.filter((z) => !pam.has(z.sciezka));
  await naCzas(doPobrania, termin, async (z) => {
    const html = await zrodlo.tekst(z.sciezka, { termin });
    if (pam.size >= MAKS_LINII) pam.delete(pam.keys().next().value as string);
    // Brak treści (404) też pamiętamy: to odpowiedź rejestru, nie awaria.
    pam.set(z.sciezka, html === null ? null : odpowiadajacyZTresci(htmlNaTekst(html)));
    return true;
  });
  const wyniki = pisma.map(() => ({ linie: new Map<string, string>(), zrodla: [] as string[], niePobrane: [] as string[] }));
  for (const z of zadania) {
    const w = wyniki[z.i];
    if (!pam.has(z.sciezka)) {
      w.niePobrane.push(z.k);
      continue;
    }
    const linia = pam.get(z.sciezka);
    if (!linia) continue;
    w.linie.set(z.k, linia);
    w.zrodla.push(zrodlo.adres(z.sciezka));
  }
  return wyniki;
}

/** Klucze odpowiedzi (bez prolongat), których nie przypisał ani podpis, ani daty. */
function nieprzypisaneKlucze(adresaci: AdresatPisma[], odpowiedzi: PismoZRejestru['replies']): string[] {
  if (adresaci.length < 2) return [];
  return przypiszOdpowiedzi(adresaci, odpowiedzi)
    .nieprzypisane.filter((r) => !r.prolongation && r.key && /^[A-Za-z0-9]{1,20}$/.test(r.key))
    .map((r) => r.key as string);
}

/** Najwięcej pism pobieranych stronami po 500 do policzenia u siebie. */
const MAKS_PULA = 3000;

/**
 * Cała pula pism stronami po 500, najwyżej MAKS_PULA. Z `tylkoCala` przerywa po pierwszej
 * stronie, gdy pula jest większa niż MAKS_PULA (wtedy wywołujący wybiera inną drogę).
 */
async function pobierzPule(zrodlo: ZrodloSejmu, sciezka: string, parametry: Record<string, string | number | undefined>, tylkoCala = false) {
  const strona = async (offset: number) => {
    const odp = await zrodlo.lista<unknown>(sciezka, { parametry: { ...parametry, limit: PELNA_PORCJA, offset } });
    return { porcja: jakoLista<PismoZRejestru>(odp.dane, 'lista pism'), razem: odp.razem };
  };
  // Pierwsza strona podaje liczbę pism; resztę stron bierzemy naraz (klient i tak puszcza 4).
  // Po kolei pięć stron ministra zdrowia to było ok. 14 s.
  const pierwsza = await strona(0);
  if (pierwsza.razem !== null) {
    const razem = pierwsza.razem;
    const dane = [...pierwsza.porcja];
    const zaDuza = razem > MAKS_PULA;
    if ((tylkoCala && zaDuza) || pierwsza.porcja.length < PELNA_PORCJA) return { dane, razem };
    const offsety: number[] = [];
    for (let o = PELNA_PORCJA; o < Math.min(razem, MAKS_PULA); o += PELNA_PORCJA) offsety.push(o);
    for (const s of await Promise.all(offsety.map(strona))) dane.push(...s.porcja);
    return { dane, razem };
  }
  const dane: PismoZRejestru[] = [...pierwsza.porcja];
  let razem: number | null = null;
  if (pierwsza.porcja.length < PELNA_PORCJA) return { dane, razem: dane.length };
  for (let offset = PELNA_PORCJA; offset < MAKS_PULA; offset += PELNA_PORCJA) {
    const odp = await zrodlo.lista<unknown>(sciezka, { parametry: { ...parametry, limit: PELNA_PORCJA, offset } });
    const porcja = jakoLista<PismoZRejestru>(odp.dane, 'lista pism');
    razem ??= odp.razem;
    dane.push(...porcja);
    if (tylkoCala && (razem ?? 0) > MAKS_PULA) break;
    if (porcja.length < PELNA_PORCJA || (razem !== null && dane.length >= razem)) break;
  }
  return { dane, razem: razem ?? dane.length };
}

/**
 * Tekst odpowiedzi, która jest tylko w załączniku PDF (zapytanie 3015: kwota nagród jest tylko
 * w z03015-o1_1.pdf). `null`, gdy PDF-a nie da się przeczytać: wtedy wynik zostaje przy adresie PDF.
 */
export async function tekstZalacznika(adresPdf: string, zrodlo: ZrodloSejmu): Promise<string | null> {
  const w = await czytajPdf(zrodlo, adresPdf, OPCJE_PISMA);
  return w.ok ? w.tekst : null;
}

/** Najwięcej załączników jednej odpowiedzi czytanych naraz. */
const ZALACZNIKOW = 5;

/**
 * Wszystkie załączniki odpowiedzi po kolei (odpowiedź i jej załącznik z tabelą to osobne pliki),
 * każdy z nazwą pliku w nagłówku. Czego nie da się przeczytać, idzie do `nieprzeczytane` z powodem.
 */
async function tekstZalacznikow(adresy: string[], zrodlo: ZrodloSejmu) {
  const czesci: string[] = [];
  const przeczytane: string[] = [];
  const nieprzeczytane: Array<{ pdf: string; powod: string }> = [];
  // Ile stron przeczytano, zawsze, także przy jednym pliku przeczytanym w całości: bez tego model
  // odsyłał do PDF-u po kwoty, których w piśmie po prostu nie ma.
  const strony: string[] = [];
  let uciete = false;
  for (const adres of adresy.slice(0, ZALACZNIKOW)) {
    const w = await czytajPdf(zrodlo, adres, OPCJE_PISMA);
    if (!w.ok) {
      nieprzeczytane.push({ pdf: adres, powod: w.powod });
      continue;
    }
    const nazwa = adres.split('/').pop() ?? adres;
    const ile = `przeczytano ${w.przeczytanoStron} z ${odmiana(w.stron, ['strony', 'stron', 'stron'])}${w.uciety ? ' (tekst niepełny)' : ' (cały plik)'}`;
    strony.push(`${nazwa}: ${ile}`);
    czesci.push(adresy.length > 1 ? `[załącznik ${przeczytane.length + 1}: ${nazwa}, ${ile}]\n${w.tekst}` : w.tekst);
    przeczytane.push(adres);
    uciete ||= w.uciety;
  }
  for (const adres of adresy.slice(ZALACZNIKOW)) nieprzeczytane.push({ pdf: adres, powod: `serwer czyta najwyżej ${ZALACZNIKOW} załączników jednej odpowiedzi` });
  const calosc = przeczytane.length > 0 && !uciete && nieprzeczytane.length === 0;
  return { tekst: czesci.length ? czesci.join('\n\n') : null, przeczytane, nieprzeczytane, uciete, strony, calosc };
}

/** Zdania-wnioski o pismie do kilku adresatów, gotowe do przepisania czytelnikowi. */
function opisWnioskow(w: WnioskiPisma, liczbaAdresatow: number): string[] {
  const zdania: string[] = [];
  if (w.coNajmniejBezOdpowiedzi > 0) {
    const ktos = odmiana(w.coNajmniejBezOdpowiedzi, ['adresat', 'adresatów', 'adresatów']);
    const dni = w.bezOdpowiedziDniPoTerminie;
    const kiedy =
      dni === null
        ? '.'
        : dni > 0
          ? w.dniPoTerminieNajmniej
            ? `, co najmniej ${dni} dni po terminie (terminy: ${w.terminyNieznanych.join(', ')}).`
            : `, ${dni} dni po terminie ${w.terminNieznanych}.`
          : `; termin ${w.terminNieznanych} jeszcze nie minął.`;
    // „Co najmniej jeden nie odpowiedział” model czytał jako „żaden nie odpowiedział” (07-4), więc
    // zdanie mówi wprost, że część odpowiedzi jest.
    zdania.push(
      `Pewne: odpowiedzi jest mniej niż adresatów, których stanu nie znamy (${w.nieprzypisanychOdpowiedzi} na ${w.nieznanych}), więc co najmniej ` +
        `${ktos} nie ${w.coNajmniejBezOdpowiedzi === 1 ? 'odpowiedział' : 'odpowiedziało'}${kiedy} ` +
        `To nie znaczy, że nie odpowiedział żaden: ${odmiana(w.nieprzypisanychOdpowiedzi, ['odpowiedź jest', 'odpowiedzi są', 'odpowiedzi jest'])}, tylko nie wiadomo czyja. Którego adresata to dotyczy, rejestr nie mówi.`,
    );
  } else if (w.nieznanych > 0) {
    zdania.push(
      `Niepewne: ${odmiana(w.nieprzypisanychOdpowiedzi, ['nieprzypisana odpowiedź', 'nieprzypisane odpowiedzi', 'nieprzypisanych odpowiedzi'])} na ` +
        `${odmiana(w.nieznanych, ['adresata', 'adresatów', 'adresatów'])} o nieznanym stanie: ${w.nieznanych === 1 ? 'prawdopodobnie odpowiedział' : 'prawdopodobnie odpowiedzieli wszyscy'}, ` +
        'ale to nie jest dowód, bo jeden resort bywa autorem dwóch odpowiedzi (interpelacja 6746). Podawaj jako „prawdopodobnie”.',
    );
  }
  if (liczbaAdresatow > 1 && w.wspolnyTermin) {
    zdania.push(`Wszyscy adresaci mają wspólny termin ${w.wspolnyTermin}; przy każdej odpowiedzi podano dni względem niego (dniPoWspolnymTerminie).`);
  }
  return zdania;
}

/**
 * Nazwy urzędów, z których jedna jest początkiem drugiej („minister finansów” i „minister finansów
 * i gospodarki”): tak zwykle wygląda zmiana nazwy resortu w kadencji. Nie łączymy ich, bo formalnie
 * to różne urzędy, ale model bez tej uwagi pomijał sumę (07-b: 5 + 4 = 9, remis z pierwszym miejscem).
 */
export function zmienioneNazwy(wpisy: ReadonlyArray<{ adresat: string; pism: number }>) {
  const grupy: Array<{ nazwy: Array<{ adresat: string; pism: number }>; razem: number }> = [];
  const krotsze = [...wpisy].sort((x, y) => x.adresat.length - y.adresat.length);
  const uzyte = new Set<string>();
  for (const k of krotsze) {
    if (uzyte.has(k.adresat)) continue;
    const baza = klucz(k.adresat);
    const dluzsze = krotsze.filter((d) => d !== k && !uzyte.has(d.adresat) && /^[ ,]/.test(klucz(d.adresat).slice(baza.length)) && klucz(d.adresat).startsWith(baza));
    if (!dluzsze.length) continue;
    const nazwy = [k, ...dluzsze];
    for (const n of nazwy) uzyte.add(n.adresat);
    grupy.push({ nazwy: nazwy.map(({ adresat, pism }) => ({ adresat, pism })), razem: nazwy.reduce((s, n) => s + n.pism, 0) });
  }
  return grupy;
}

/** Ile najwyżej pism pobieramy naraz, gdy trzeba je policzyć lub posortować u siebie. */
const PELNA_PORCJA = 500;

/** Słowa, które nic nie zawężają w tytułach pism („w sprawie …” ma prawie każde). */
const SLOWA_PUSTE = /^(i|w|z|o|a|na|do|od|za|po|nad|pod|przez|dla|oraz|lub|sprawa|sprawie|sprawy|interpelacja|zapytanie|pismo)$/;
/** Końcówki przypadków odcinane przed samogłoskami: „ogólnej” → „ogóln”, „szpitalach” → „szpital”. */
const KONCOWKI = /(ami|ach|owi|ego|emu|ych|ich|ymi|imi|om|ów|ej|ym|im)$/;

/**
 * Rdzenie słów frazy do szukania w tytułach pism. Rejestr szuka dosłownego kawałka tytułu
 * (bez wielkości liter, ale z polskimi znakami), a tytuły są w przypadkach zależnych: „rezerwa”
 * nie trafiała w „rezerwy … ogólnej” (08-b). Obcinamy łagodniej niż rdzenie() ze wspólnych, bo
 * „reze” trafiałoby w każdego „prezesa”.
 */
export function rdzenieTytulu(fraza: string): string[] {
  return fraza
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !SLOWA_PUSTE.test(w))
    .map((w) => {
      const bez = w.length > 6 ? w.replace(KONCOWKI, '') : w;
      const r = bez.replace(/[aeiouyąęó]+$/u, '');
      return r.length >= 4 ? r : w.length >= 4 ? w.slice(0, 4) : w;
    });
}

/** Rdzeń do filtra rejestru: najdłuższy bez polskich znaków (pasuje niezależnie od pisowni pytającego), inaczej najdłuższy. */
function rdzenDoRejestru(rdz: string[]): string {
  const dlugie = [...rdz].sort((x, y) => y.length - x.length);
  return dlugie.find((r) => klucz(r) === r) ?? dlugie[0];
}

/** Budżet znaków całego wyniku listy: klient MCP odkłada większy wynik do pliku, którego model nie czyta. */
const MAKS_ZNAKOW_LISTY = 18_000;
/** Tylu autorów pokazujemy przy piśmie na liście; resztę daje pismo (liczbaAutorow jest zawsze). */
const AUTOROW_NA_LISCIE = 3;

/** Stan pisma u wybranych adresatów (pozostali adresaci pisma nie mają wpływu na wynik). */
function stanU(p: PismoZRejestru, ktorzy: (a: AdresatPisma) => boolean, dzis: string, linie?: ReadonlyMap<string, string>) {
  const wszyscy = adresaciPisma(p);
  const wszystkieStany = stanyAdresatow(wszyscy, p.replies, dzis, linie);
  const stany = wszystkieStany.map((s, i) => ({ a: wszyscy[i], s })).filter(({ a }) => ktorzy(a));
  const poTerminie = stany
    .filter(({ s }) => !s.odpowiedziano && !s.odpowiedzNieprzypisana && s.termin !== null && (s.spoznienieDni ?? 0) > 0)
    .map(({ a, s }) => ({ adresat: czysty(a.name), dni: s.spoznienieDni as number }))
    .sort((x, y) => y.dni - x.dni);
  const odpowiedzPoTerminie = stany
    .filter(({ s }) => s.odpowiedziano && (s.spoznienieDni ?? 0) > 0)
    .map(({ a, s }) => ({ adresat: czysty(a.name), dni: s.spoznienieDni as number }));
  // Wniosek „co najmniej jeden nie odpowiedział” dotyczy wszystkich nieznanych razem; gdy filtr
  // adresata wybiera tylko część z nich, nie wiadomo, czy dotyczy wybranego.
  const wnioski = wnioskiPisma(wszyscy, p.replies, dzis, wszystkieStany, linie);
  const filtrObejmujeNieznanych = wszystkieStany.every((s, i) => !s.odpowiedzNieprzypisana || ktorzy(wszyscy[i]));
  const zlozony = zlozStan(stany.map(({ s }) => s), czyOdpowiedziano(p.replies), filtrObejmujeNieznanych ? wnioski : undefined);
  const nieWiadomoKto =
    filtrObejmujeNieznanych && wnioski.coNajmniejBezOdpowiedzi > 0
      ? {
          coNajmniej: wnioski.coNajmniejBezOdpowiedzi,
          sposrod: wszystkieStany.map((s, i) => (s.odpowiedzNieprzypisana ? czysty(wszyscy[i].name) : null)).filter(Boolean),
          dniPoTerminie: wnioski.bezOdpowiedziDniPoTerminie,
          ...(wnioski.dniPoTerminieNajmniej ? { dniPoTerminieToCoNajmniej: true } : {}),
        }
      : null;
  const liczniki = stany.map(({ a }) => a.answerDelayedDays).filter((x): x is number => typeof x === 'number');
  return {
    stan: zlozony.rodzaj,
    poTerminie,
    odpowiedzPoTerminie,
    nieWiadomoKto,
    najdluzej: zlozony.najdluzejPoTerminieDni ?? 0,
    licznikSejmu: liczniki.length ? Math.max(...liczniki) : null,
    wnioski,
    zWyslania: wszyscy.some((a) => a.zWyslania),
  };
}

export const szukajPism = narzedzie({
  nazwa: 'szukaj_pism',
  tytul: 'Szukaj interpelacji i zapytań',
  opis:
    'Wyszukuje interpelacje albo zapytania pisemne w rejestrze Sejmu: po autorze (numer posła), adresacie, słowie w tytule, dacie. ' +
    'Każde pismo dostaje stan liczony z terminu 21 dni (odpowiedziano, w terminie, po terminie, bez terminu) i listę adresatów, ' +
    'u których termin minął (poTerminieU). Z parametrem adresat stan i opóźnienie dotyczą TYLKO tego adresata, nie pozostałych. ' +
    'Na pytanie „które najbardziej się spóźniają” użyj sortuj="opoznienie"; domyślnie lista idzie od najnowszych pism.' + OPIS_CZESCIOWY,
  wejscie: z.object({
    rodzaj: rodzajPisma,
    fraza: z.string().min(2).max(200).optional().describe('Słowa z tytułu, np. "szpital"; szukane po rdzeniach, więc „rezerwa ogólna” znajdzie „rezerwy … ogólnej”'),
    autorId: z.coerce.number().int().min(1).optional().describe('Numer posła-autora (z znajdz_posla)'),
    adresat: z
      .string()
      .max(200)
      .optional()
      .describe('Pełna nazwa urzędu tak, jak w rejestrze, np. "minister zdrowia", "prezes Rady Ministrów"'),
    od: data.optional().describe('Wysłane od dnia'),
    do: data.optional().describe('Wysłane do dnia'),
    tylkoOpoznione: z
      .boolean()
      .default(false)
      .describe('Tylko pisma po terminie (z parametrem adresat: po terminie u tego adresata). Serwer liczy termin sam, nie z licznika Sejmu'),
    sortuj: z.enum(['najnowsze', 'opoznienie']).default('najnowsze').describe('opoznienie: najdłużej spóźnione najpierw'),
    limit: limit(20, 100),
    przesuniecie,
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const start = Date.now();
    sprawdzPrzedzial(a.od, a.do);
    const sciezka = `${T(a.kadencja)}/${sciezkaRodzaju(a.rodzaj)}`;
    const opoznienia = a.tylkoOpoznione || a.sortuj === 'opoznienie';
    // Opóźnienie liczymy SAMI na całej puli (stronami), a nie filtrem Sejmu delayed=true: ten
    // opiera się na liczniku Sejmu i gubi pisma z licznikiem 0 albo jeszcze nieprzeliczonym
    // (interpelacja 2183 do ministra sportu: 890 dni po terminie, licznik 0). Z autorem też cała
    // pula: pytania o posła to zwykle liczby, które muszą objąć wszystkie jego pisma.
    // Fraza po rdzeniach słów: rejestr szuka dosłownego kawałka tytułu (z polskimi znakami), a tytuły
    // są odmienione: „rezerwa ogólna” nie trafiała w „rezerwy … ogólnej” (08-b). Rejestr filtruje po
    // najdłuższym rdzeniu, resztę rdzeni sprawdzamy u siebie bez polskich znaków, więc liczymy na całej puli.
    const rdzFrazy = a.fraza ? rdzenieTytulu(a.fraza) : [];
    const rdzen = rdzFrazy.length ? rdzenDoRejestru(rdzFrazy) : null;
    const pelna = opoznienia || !!a.autorId || !!rdzen;
    const filtry = { title: rdzen ?? a.fraza, from: a.autorId, to: a.adresat, since: a.od, till: a.do, sort_by: '-num' };
    let parametry: Record<string, string | number | undefined> = pelna
      ? { ...filtry, limit: PELNA_PORCJA, offset: 0 }
      : { ...filtry, limit: a.limit, offset: a.przesuniecie };
    let zFiltremSejmu = false;
    let pulaBezFiltra: number | null = null;
    let odp: { dane: unknown[]; razem: number | null };
    const nazwiskaP = nazwiskaPoslow(zrodlo, a.kadencja);
    if (pelna) {
      odp = await pobierzPule(zrodlo, sciezka, filtry, opoznienia);
      if (opoznienia && (odp.razem ?? 0) > MAKS_PULA) {
        pulaBezFiltra = odp.razem;
        // Pula za duża, by ją przeliczyć (np. cały rejestr bez adresata): zostaje filtr Sejmu,
        // z uwagą, czego nie widzi.
        zFiltremSejmu = true;
        parametry = { ...filtry, delayed: 'true', limit: PELNA_PORCJA, offset: 0 };
        odp = await pobierzPule(zrodlo, sciezka, { ...filtry, delayed: 'true' });
      }
    } else odp = await zrodlo.lista<unknown>(sciezka, { parametry });
    let dane = jakoLista<PismoZRejestru>(odp.dane, 'lista pism');
    const pobrano = dane.length;
    if (rdzen) dane = dane.filter((p) => maWszystkie(p.title, rdzFrazy));
    const nazwiska = await nazwiskaP;
    const dzis = dzisWarszawa();
    const szukany = a.adresat ? klucz(a.adresat) : null;
    const ktorzy = (ad: AdresatPisma) => !szukany || klucz(ad.name).includes(szukany);

    // Przy pytaniu o spóźnienia odpowiedź nieprzypisana u szukanego adresata zmienia wynik, więc
    // czytamy linię „Odpowiadający” z treści tych odpowiedzi (najpierw pisma z najmniejszą liczbą
    // nieprzypisanych odpowiedzi), w granicach TRESCI_LISTA zapytań.
    const linieDo = new Map<number, Map<string, string>>();
    const zrodlaTresci: string[] = [];
    const niesprawdzone: number[] = [];
    let zabraklo = 0;
    if (opoznienia) {
      const pam = liniePamieci(zrodlo);
      const doSprawdzenia = dane
        .map((p) => {
          const wszyscy = adresaciPisma(p);
          const st = stanyAdresatow(wszyscy, p.replies, dzis);
          const dotyczy = st.some((x, i) => x.odpowiedzNieprzypisana && ktorzy(wszyscy[i]));
          return { p, klucze: dotyczy ? nieprzypisaneKlucze(wszyscy, p.replies) : [] };
        })
        .filter((x) => x.klucze.length > 0)
        .sort((x, y) => x.klucze.length - y.klucze.length || x.p.num - y.p.num);
      // Budżet liczy tylko treści jeszcze nieprzeczytane: przeczytane leżą w pamięci, więc kolejne
      // wywołanie o tego samego adresata sprawdza następne pisma.
      let budzet = TRESCI_LISTA;
      const wybrane: typeof doSprawdzenia = [];
      for (const x of doSprawdzenia) {
        const nowe = x.klucze.filter((k) => !pam.has(sciezkaTresci(`${sciezka}/${x.p.num}`, k))).length;
        if (nowe > budzet) niesprawdzone.push(x.p.num);
        else {
          budzet -= nowe;
          wybrane.push(x);
        }
      }
      // Sejm oddaje jedną treść po 4 do 30 s; po CZAS_TRESCI_LISTA_MS od startu przestajemy czekać.
      const termin = start + CZAS_TRESCI_LISTA_MS;
      const wyniki = await odpowiadajacyWielu(zrodlo, wybrane.map(({ p, klucze }) => ({ baza: `${sciezka}/${p.num}`, klucze })), termin);
      wyniki.forEach((w, i) => {
        if (w.linie.size) linieDo.set(wybrane[i].p.num, w.linie);
        zrodlaTresci.push(...w.zrodla);
        if (w.niePobrane.length) {
          niesprawdzone.push(wybrane[i].p.num);
          zabraklo += w.niePobrane.length;
        }
      });
    }

    // Rozbicie po adresatach liczymy tu, a nie w modelu: ręczne liczenie z listy 77 pism dawało błędy.
    const adresatow = new Map<string, { adresat: string; pism: number; odpowiedzial: number; bezOdpowiedziPoTerminie: number; bezOdpowiedziWTerminie: number; bezTerminu: number; nieWiadomo: number }>();
    let pisma = dane.map((p) => {
      const linie = linieDo.get(p.num);
      const u = stanU(p, ktorzy, dzis, linie);
      const wszyscy = adresaciPisma(p);
      stanyAdresatow(wszyscy, p.replies, dzis, linie).forEach((st, i) => {
        const nazwa = czysty(wszyscy[i].name) ?? '?';
        const w = adresatow.get(nazwa) ?? { adresat: nazwa, pism: 0, odpowiedzial: 0, bezOdpowiedziPoTerminie: 0, bezOdpowiedziWTerminie: 0, bezTerminu: 0, nieWiadomo: 0 };
        w.pism++;
        if (st.odpowiedzNieprzypisana) w.nieWiadomo++;
        else if (st.odpowiedziano) w.odpowiedzial++;
        else if ((st.spoznienieDni ?? 0) > 0) w.bezOdpowiedziPoTerminie++;
        else if (st.termin === null) w.bezTerminu++;
        else w.bezOdpowiedziWTerminie++;
        adresatow.set(nazwa, w);
      });
      const liczbaOdpowiedzi = (p.replies ?? []).filter((r) => !r.prolongation).length;
      const dniNasze = Math.max(u.najdluzej, ...u.odpowiedzPoTerminie.map((x) => x.dni), 0);
      // Rekord listy jest chudy (08-b: 100 pism dawało 59,5 KB): puste listy i brakujący licznik
      // pomijamy, autorów najwyżej trzech; szczegóły daje narzędzie pismo.
      return {
        numer: p.num,
        tytul: czysty(p.title),
        wplynelo: wiarygodnaData(p.receiptDate, dzis) ? (p.receiptDate as string) : null,
        // Z autorId jedyny autor to ten szukany: pole nic by nie wniosło.
        ...(a.autorId && (p.from ?? []).length === 1 && Number(p.from?.[0]) === a.autorId ? {} : { autorzy: autorzy(p.from, nazwiska).slice(0, AUTOROW_NA_LISCIE) }),
        adresaci: (p.to ?? []).map((n) => czysty(n)),
        stan: u.stan,
        ...(u.stan === 'nie-wiadomo'
          ? { stanOpis: `${liczbaOdpowiedzi} ${liczbaOdpowiedzi === 1 ? 'odpowiedź' : 'odpowiedzi'} na ${wszyscy.length} adresatów, nie da się ich przypisać: prawdopodobnie odpowiedzieli, ale to niepewne` }
          : {}),
        ...(u.nieWiadomoKto ? { bezOdpowiedziNieWiadomoKto: u.nieWiadomoKto } : {}),
        ...(u.poTerminie.length ? { poTerminieU: u.poTerminie } : {}),
        ...(u.odpowiedzPoTerminie.length ? { odpowiedzPoTerminieU: u.odpowiedzPoTerminie } : {}),
        ...(u.licznikSejmu !== null ? { licznikOpoznieniaSejmu: u.licznikSejmu } : {}),
        ...(u.licznikSejmu === 0 && dniNasze > 0 ? { licznikSejmuInaczej: true } : {}),
        ...(u.zWyslania ? { terminOd: 'wysłanie' } : {}),
        odpowiedzi: liczbaOdpowiedzi,
        liczbaAutorow: (p.from ?? []).length,
        ...((wszyscy.length || (p.to ?? []).length) !== (p.to ?? []).length ? { liczbaAdresatow: wszyscy.length } : {}),
        _liczbaAdresatow: wszyscy.length || (p.to ?? []).length,
        _najdluzej: u.najdluzej,
      };
    });
    const nieWiadomoPrzedFiltrem = pisma.filter((p) => p.stan === 'nie-wiadomo').map((p) => p.numer);
    if (a.tylkoOpoznione || a.sortuj === 'opoznienie') pisma = pisma.filter((p) => p.stan === 'po-terminie');
    if (a.sortuj === 'opoznienie') pisma.sort((x, y) => y._najdluzej - x._najdluzej || y.numer - x.numer);
    const lacznie = pelna ? pisma.length : odp.razem;
    const zlicz = (f: (p: (typeof pisma)[number]) => boolean) => pisma.filter(f).length;
    const kompletne = !pelna && (odp.razem ?? 0) <= dane.length && dane.length > 1 && !a.tylkoOpoznione;
    const podsumowanie =
      a.autorId || kompletne
        ? {
            razem: pisma.length,
            jedynyAutor: zlicz((p) => p.liczbaAutorow === 1),
            zeWspolautorami: zlicz((p) => p.liczbaAutorow > 1),
            doWieluAdresatow: zlicz((p) => p._liczbaAdresatow > 1),
            doWieluAdresatowJedynyAutor: zlicz((p) => p._liczbaAdresatow > 1 && p.liczbaAutorow === 1),
            wedlugStanu: Object.fromEntries(
              ['odpowiedziano', 'odpowiedziano-po-terminie', 'odpowiedziano-termin-nieznany', 'po-terminie', 'w-terminie', 'nie-wiadomo', 'bez-terminu'].map((s) => [s, zlicz((p) => p.stan === s)]),
            ),
            wedlugAdresata: [...adresatow.values()].sort((x, y) => y.pism - x.pism || x.adresat.localeCompare(y.adresat, 'pl')),
          }
        : undefined;
    const pelnaPorcja = (pelna ? pisma.slice(a.przesuniecie, a.przesuniecie + a.limit) : pisma).map(({ _najdluzej, _liczbaAdresatow, ...reszta }) => reszta);

    const uwagi = [UWAGA_TERMIN, `Stan liczony na dzień ${dzis}.`];
    const czesciListy: WynikCzesciowy[] = [];
    if (a.sortuj === 'opoznienie' && !a.tylkoOpoznione) uwagi.push('sortuj="opoznienie" pokazuje tylko pisma po terminie.');
    if (opoznienia && !zFiltremSejmu) {
      uwagi.push(
        `Spóźnienie policzono samodzielnie (doręczenie danemu adresatowi + ${DNI_NA_ODPOWIEDZ} dni) na wszystkich ${dane.length} pasujących pismach, nie filtrem Sejmu delayed=true, ` +
          'który pomija pisma z licznikiem Sejmu 0 lub jeszcze nieprzeliczonym. licznikOpoznieniaSejmu podano obok dla porównania.',
      );
    }
    if (zFiltremSejmu) {
      uwagi.push(
        `Pasujących pism jest ${pulaBezFiltra}, więcej niż ${MAKS_PULA}, które serwer przelicza sam, więc pulę wybrał filtr Sejmu delayed=true. ` +
          'Ten filtr pomija pisma z licznikiem Sejmu 0 lub jeszcze nieprzeliczonym, więc lista może być niepełna. Zawęź adresatem, autorem albo datami od/do, żeby policzyć spóźnienia samodzielnie.',
      );
      czesciListy.push(
        czesciowy(
          `pasujących pism jest ${pulaBezFiltra}, więcej niż ${MAKS_PULA}, które serwer przelicza sam, więc spóźnione wybrał filtr Sejmu, który część pism pomija`,
          'spóźnionych pism, których Sejm jeszcze nie oznaczył jako spóźnione; liczba to dolna granica („co najmniej”)',
          'zawęzić pytanie adresatem, autorem albo datami od/do',
        ),
      );
    }
    if (linieDo.size) {
      uwagi.push(
        `W ${odmiana(linieDo.size, ['piśmie', 'pismach', 'pismach'])} odpowiedź przypisano adresatowi z linii „Odpowiadający” w treści odpowiedzi (przypisanie to wniosek z treści).`,
      );
    }
    if (niesprawdzone.length) {
      const nr = [...new Set(niesprawdzone)].sort((x, y) => x - y);
      uwagi.push(
        `${odmiana(nr.length, ['pismo ma', 'pisma mają', 'pism ma'])} odpowiedzi, których nie przypisano i których treści nie sprawdzono ` +
          `(limit ${TRESCI_LISTA} treści${zabraklo ? ` albo czasu: Sejm oddaje jedną treść po kilka do kilkudziesięciu sekund, ${odmiana(zabraklo, ['treść nie zdążyła', 'treści nie zdążyły', 'treści nie zdążyło'])}` : ''}): ` +
          `${nr.slice(0, 30).join(', ')}${nr.length > 30 ? ' i inne' : ''}. Stan tych pism u szukanego adresata to „nie wiadomo” (nie wchodzą do spóźnionych); szczegóły daje narzędzie pismo. ` +
          'Wynik jest częściowy; to samo wywołanie powtórzone w ciągu kilku minut sprawdzi kolejne treści, bo przeczytane serwer pamięta.',
      );
      czesciListy.push(
        czesciowy(
          zabraklo
            ? 'zabrakło czasu: żeby ustalić, który urząd odpowiedział, serwer czyta treść każdej odpowiedzi osobno, a Sejm oddaje jedną po kilka do kilkudziesięciu sekund'
            : `serwer czyta najwyżej ${TRESCI_LISTA} treści odpowiedzi w jednym wywołaniu, żeby ustalić, który urząd odpowiedział`,
          `ustalenia stanu u szukanego adresata w ${odmiana(nr.length, ['piśmie', 'pismach', 'pismach'])} (stan „nie wiadomo”, nie wchodzą do spóźnionych), więc liczba spóźnionych może być zaniżona`,
          'wywołać narzędzie jeszcze raz z tymi samymi parametrami: przeczytane treści serwer pamięta, więc kolejne wywołanie sprawdzi następne pisma',
        ),
      );
    }
    if (a.tylkoOpoznione && nieWiadomoPrzedFiltrem.length) {
      uwagi.push(
        `razem (${pisma.length}) to dolna granica: ${odmiana(nieWiadomoPrzedFiltrem.length, ['pismo ma', 'pisma mają', 'pism ma'])} u tego adresata stan „nie wiadomo” i może być spóźnione. ` +
          'Podając liczbę spóźnionych, powiedz „co najmniej” i ile jest niewiadomych.',
      );
      czesciListy.push(
        czesciowy(
          `przy ${odmiana(nieWiadomoPrzedFiltrem.length, ['piśmie', 'pismach', 'pismach'])} nie da się ustalić, czy ten adresat odpowiedział (odpowiedzi bez wskazania urzędu)`,
          `pewności co do ${nieWiadomoPrzedFiltrem.length} pism: liczba spóźnionych (${pisma.length}) to dolna granica, mów „co najmniej ${pisma.length}”`,
          'sprawdzić niepewne pisma narzędziem pismo albo wywołać to samo jeszcze raz, żeby serwer doczytał kolejne treści odpowiedzi',
        ),
      );
    }
    if (rdzen && dane.length > 0) {
      uwagi.unshift(
        `Frazę „${a.fraza}” szukano po rdzeniach ${rdzFrazy.map((r) => `„${r}”`).join(', ')} (tytuły są odmienione, a rejestr nie odmienia słów): ` +
          `rejestr zwrócił ${odmiana(odp.razem ?? pobrano, ['tytuł', 'tytuły', 'tytułów'])} z „${rdzen}”, z nich wszystkie rdzenie ${dane.length === 1 ? 'ma 1' : `ma ${dane.length}`}.`,
      );
    }
    if (a.fraza && dane.length === 0) {
      const krotsze = [...new Set(rdzFrazy.map((r) => r.slice(0, Math.max(4, r.length - 2))))];
      uwagi.unshift(
        `Brak pism z „${a.fraza}” w tytule${rdzFrazy.length ? ` ani z rdzeniami ${rdzFrazy.join(', ')}` : ''}. Rejestr szuka w samym tytule, nie w treści. ` +
          `Spróbuj jednego słowa albo krótszego rdzenia${krotsze.length ? `, np. ${krotsze.map((k) => `„${k}”`).join(' lub ')}` : ''}, albo innego słowa, jakim tytuł mógł nazwać sprawę.`,
      );
    }
    if (szukany) uwagi.push(`stan i poTerminieU dotyczą tylko adresatów pasujących do „${a.adresat}”.`);
    if (!pelna && (odp.razem ?? 0) > dane.length) {
      uwagi.push(
        `razem (${odp.razem}) to liczba wszystkich pasujących pism; tu jest ${dane.length}. Liczbę spóźnionych daje to samo wywołanie z tylkoOpoznione=true (razem to wtedy liczba spóźnionych).`,
      );
    }
    if (pelna && (odp.razem ?? 0) > pobrano) {
      uwagi.push(`Rejestr ma ${odp.razem} pism pasujących do filtrów; policzono i posortowano ${pobrano} najnowszych. Zawęź datami od/do.`);
      czesciListy.push(
        czesciowy(
          `rejestr ma ${odp.razem} pasujących pism, a serwer przelicza najwyżej ${pobrano} najnowszych`,
          `${(odp.razem ?? 0) - pobrano} starszych pism: podsumowanie i sortowanie ich nie obejmują`,
          'zawęzić pytanie datami od/do',
        ),
      );
    }
    uwagi.push(UWAGA_LICZNIK);
    uwagi.push(`Na liście pomijamy puste poTerminieU i odpowiedzPoTerminieU oraz brakujący licznik; autorów jest najwyżej ${AUTOROW_NA_LISCIE} (liczbaAutorow podaje wszystkich, pełną listę daje pismo)${a.autorId ? ', a pismo, którego jedynym autorem jest szukany poseł, pola autorzy nie ma' : ''}; liczbaAdresatow jest tylko, gdy różni się od długości listy adresaci.`);
    if (pisma.some((p) => p.stan === 'odpowiedziano-termin-nieznany')) {
      uwagi.push('Stan „odpowiedziano-termin-nieznany”: odpowiedź jest, ale rejestr podaje błędną datę jej wpływu, więc terminowości nie da się ustalić. Nie pisz „w terminie”.');
    }
    if (pisma.some((p) => p.stan === 'nie-wiadomo')) {
      uwagi.push('stan „nie-wiadomo” znaczy: są odpowiedzi, których nie da się przypisać adresatom (pole stanOpis). To NIE jest „czeka na odpowiedź”.');
    }
    if (pisma.some((p) => 'terminOd' in p)) uwagi.push(UWAGA_SENT_DATE);
    if (podsumowanie) {
      uwagi.push(
        'Liczby w podsumowanie obejmują wszystkie pobrane pisma, także spoza tej porcji listy; nie przeliczaj ich z listy. ' +
          'wedlugAdresata liczy pisma do każdego urzędu (pismo do kilku adresatów liczy się u każdego) i stan u tego adresata.',
      );
      const zmiany = zmienioneNazwy(podsumowanie.wedlugAdresata);
      if (zmiany.length) {
        uwagi.push(
          `W wedlugAdresata są nazwy urzędów, z których jedna jest początkiem drugiej: ${zmiany
            .map((z) => `${z.nazwy.map((n) => `„${n.adresat}” (${n.pism})`).join(' i ')}, razem ${z.razem}`)
            .join('; ')}. ` +
            'Zwykle to ten sam resort po zmianie nazwy w kadencji; formalnie to różne urzędy i rejestr liczy je osobno. ' +
            'Pytany, do kogo poseł pisał najczęściej, podaj obie liczby i ich sumę, bo suma może zmienić kolejność.',
        );
      }
    }
    // Porcja przycięta do budżetu znaków (podsumowanie i tak liczy całą pulę); dalszy ciąg daje nastepnePrzesuniecie.
    const wynikCzesciowyListy = polaczCzesciowe(...czesciListy);
    const wynik: Record<string, unknown> & { zrodla: string[]; uwagi: string[] } = {
      ...(wynikCzesciowyListy ? { wynikCzesciowy: wynikCzesciowyListy } : {}),
      razem: lacznie,
      podsumowanie,
      pisma: [] as unknown[],
      zrodla: [zrodlo.adres(sciezka, parametry), ...zrodlaTresci],
      uwagi,
    };
    let zostalo = MAKS_ZNAKOW_LISTY - JSON.stringify(wynik).length - 400;
    const porcja: typeof pelnaPorcja = [];
    for (const p of pelnaPorcja) {
      const dl = JSON.stringify(p).length + 1;
      if (dl > zostalo && porcja.length > 0) break;
      porcja.push(p);
      zostalo -= dl;
    }
    wynik.pisma = porcja;
    if (porcja.length < pelnaPorcja.length) {
      const dalej = a.przesuniecie + porcja.length;
      wynik.nastepnePrzesuniecie = dalej;
      wynik.pokazano = `pisma ${a.przesuniecie + 1}–${dalej} z ${lacznie}`;
      uwagi.push(
        `Pokazano ${porcja.length} z ${pelnaPorcja.length} pism tej porcji (limit rozmiaru odpowiedzi, ok. ${MAKS_ZNAKOW_LISTY / 1000} tys. znaków). ` +
          `Dalsze: to samo wywołanie z przesuniecie=${dalej}. podsumowanie obejmuje wszystkie pisma, nie tylko pokazane.`,
      );
    }
    return wynik;
  },
});

export const pismo = narzedzie({
  nazwa: 'pismo',
  tytul: 'Interpelacja lub zapytanie: szczegóły i treść',
  opis:
    'Jedno pismo: adresaci z terminem i stanem każdego, odpowiedzi z adresem PDF, a na życzenie treść pisma lub odpowiedzi jako zwykły tekst (w porcjach). ' +
    'Przy kilku adresatach podaje, czyja jest odpowiedź (z podpisu albo jako oznaczony wniosek) i co wynika z samej liczby odpowiedzi. ' +
    'Odpowiedź, której treść jest tylko w załączniku PDF (tak jest prawie zawsze), serwer czyta z PDF po podaniu odpowiedzKlucz; ' +
    'skanu bez warstwy tekstowej nie odczyta i wtedy podaje adres PDF.' + OPIS_CZESCIOWY,
  wejscie: z.object({
    rodzaj: rodzajPisma,
    numer: z.coerce.number().int().min(1),
    tresc: z.boolean().default(false).describe('Dołącz treść samego pisma'),
    odpowiedzKlucz: z
      .string()
      .regex(/^[A-Za-z0-9]{1,20}$/, 'Klucz odpowiedzi to litery i cyfry z pola klucz')
      .optional()
      .describe('Klucz odpowiedzi (pole klucz z listy odpowiedzi): dołącz jej treść'),
    od: z.coerce.number().int().min(0).default(0).describe('Od którego znaku treści zacząć (dla długich tekstów)'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const start = Date.now();
    const baza = `${T(a.kadencja)}/${sciezkaRodzaju(a.rodzaj)}/${a.numer}`;
    const [surowe, nazwiska] = await Promise.all([zrodlo.json<unknown>(baza), nazwiskaPoslow(zrodlo, a.kadencja)]);
    const p = jakoRekord<PismoZRejestru>(surowe, 'pismo', ['num']);
    if (!p) return { ...brak404('Rejestr nie zna takiego pisma.'), zrodla: [zrodlo.adres(baza)] };

    const dzis = dzisWarszawa();
    const adresaci = adresaciPisma(p);
    const zWyslania = adresaci.some((ad) => ad.zWyslania);
    const zrodla = [zrodlo.adres(baza)];
    const odpowiedzi = [...(p.replies ?? [])].sort((x, y) => String(x.receiptDate ?? '').localeCompare(String(y.receiptDate ?? '')));
    const pdfOdpowiedzi = (r: (typeof odpowiedzi)[number]) => (r.attachments ?? []).map((z) => bezpiecznyLink(z.URL)).filter((x): x is string => !!x);

    // Klucz spoza pisma: jasny błąd z listą kluczy, a nie „rejestr nie ma tej treści” (08: model
    // wziął to za nieodczytany PDF).
    if (a.odpowiedzKlucz && !odpowiedzi.some((r) => r.key === a.odpowiedzKlucz)) {
      const klucze = odpowiedzi.map((r) => `${r.key}${r.prolongation ? ' (prolongata)' : ''}`).filter((k) => !k.startsWith('undefined') && !k.startsWith('null'));
      throw new Error(
        `${a.rodzaj === 'interpelacja' ? 'Interpelacja' : 'Zapytanie'} nr ${p.num} nie ma odpowiedzi o kluczu ${a.odpowiedzKlucz}; ` +
          (klucze.length ? `dostępne: ${klucze.join(', ')}.` : 'to pismo nie ma jeszcze żadnej odpowiedzi ani prolongaty.'),
      );
    }

    let tresc;
    const czesciPisma: WynikCzesciowy[] = [];
    let odczytanoPdf = false;
    let pdfWCalosci = false;
    let htmlWybranej: string | null = null;
    if (a.tresc || a.odpowiedzKlucz) {
      const sciezka = a.odpowiedzKlucz ? `${baza}/reply/${a.odpowiedzKlucz}/body` : `${baza}/body`;
      const html = await zrodlo.tekst(sciezka);
      zrodla.push(zrodlo.adres(sciezka));
      if (a.odpowiedzKlucz) htmlWybranej = html;
      const wybrana = a.odpowiedzKlucz ? odpowiedzi.find((r) => r.key === a.odpowiedzKlucz) : undefined;
      const pdf = wybrana ? pdfOdpowiedzi(wybrana) : [];
      const tekst = html === null ? null : htmlNaTekst(html);
      // Flaga onlyAttachment bywa false, choć treść to samo zdanie „treść w załączniku” (zapytanie 3015).
      const tylkoWPdf = !!wybrana && pdf.length > 0 && (wybrana.onlyAttachment === true || tekst === null || /znajduje się w załącznik/i.test(tekst));
      if (tylkoWPdf) {
        const zPdf = await tekstZalacznikow(pdf, zrodlo);
        if (zPdf.tekst) {
          odczytanoPdf = true;
          pdfWCalosci = zPdf.calosc;
          zrodla.push(...zPdf.przeczytane);
          tresc = {
            ...fragment(zPdf.tekst, a.od),
            zPdf: true,
            przeczytanoStron: zPdf.strony.join('; '),
            ...(zPdf.calosc ? { przeczytanoCaly: true } : {}),
            zalacznikPdf: pdf,
            ...(zPdf.nieprzeczytane.length ? { nieprzeczytane: zPdf.nieprzeczytane } : {}),
            ...(zPdf.uciete ? { uciete: 'Tekst z PDF jest niepełny (limit stron lub znaków); resztę zawiera PDF.' } : {}),
          };
          if (zPdf.uciete || zPdf.nieprzeczytane.length) {
            czesciPisma.push(
              czesciowy(
                [
                  zPdf.uciete ? `załącznik PDF jest za długi, serwer odczytał tylko część (${zPdf.strony.join('; ')})` : '',
                  zPdf.nieprzeczytane.length ? `nie odczytano ${zPdf.nieprzeczytane.length} z ${pdf.length} załączników (${zPdf.nieprzeczytane.map((n) => n.powod).join('; ')})` : '',
                ]
                  .filter(Boolean)
                  .join('; '),
                'części treści odpowiedzi (dalsze strony albo nieodczytane załączniki)',
                `otworzyć załączniki PDF z pola zalacznikPdf; brak czegoś w odczytanym tekście nie znaczy, że nie ma tego w odpowiedzi`,
              ),
            );
          }
        } else {
          tresc = {
            ...(tekst ? fragment(tekst, a.od) : {}),
            tylkoWZalaczniku:
              `Treść tej odpowiedzi jest tylko w załączniku PDF (zalacznikPdf), a serwer nie zdołał jej odczytać: ${zPdf.nieprzeczytane.map((n) => n.powod).join('; ') || 'brak powodu'}. ` +
              'Podaj czytelnikowi adres PDF.',
            zalacznikPdf: pdf,
          };
          czesciPisma.push(
            czesciowy(
              `treść odpowiedzi jest tylko w załączniku PDF, a serwer nie zdołał go odczytać (${zPdf.nieprzeczytane.map((n) => n.powod).join('; ') || 'brak powodu'})`,
              'treści tej odpowiedzi',
              'otworzyć plik PDF z pola zalacznikPdf; nie streszczać odpowiedzi z domysłów',
            ),
          );
        }
      } else {
        tresc = tekst === null ? { brak: 'Rejestr nie ma tej treści (odpowiedź bywa tylko w załączniku PDF).', zalacznikPdf: pdf } : fragment(tekst, a.od);
      }
    }

    // Odpowiedzi, których nie przypisał podpis ani daty: urząd z linii „Odpowiadający” w treści.
    const klucze = nieprzypisaneKlucze(adresaci, p.replies);
    const linie = new Map<string, string>();
    if (a.odpowiedzKlucz && htmlWybranej && klucze.includes(a.odpowiedzKlucz)) {
      const linia = odpowiadajacyZTresci(htmlNaTekst(htmlWybranej));
      if (linia) linie.set(a.odpowiedzKlucz, linia);
    }
    const doPobrania = klucze.filter((k) => !linie.has(k) && k !== a.odpowiedzKlucz);
    const [zTresci] = await odpowiadajacyWielu(zrodlo, [{ baza, klucze: doPobrania.slice(0, TRESCI_PISMO) }], start + CZAS_TRESCI_PISMO_MS);
    for (const [k, v] of zTresci.linie) linie.set(k, v);
    zrodla.push(...zTresci.zrodla);

    const stany = stanyAdresatow(adresaci, p.replies, dzis, linie);
    const wnioski = wnioskiPisma(adresaci, p.replies, dzis, stany, linie);
    const przypisanie = przypiszOdpowiedzi(adresaci, p.replies, linie);
    const czyja = (r: OdpowiedzPisma) => {
      const i = przypisanie.adresatow.findIndex((lista) => lista.includes(r));
      if (i < 0) return null;
      const sposob = przypisanie.sposob.get(r);
      return { adresat: czysty(adresaci[i].name), przypisanie: sposob ? OPIS_PRZYPISANIA[sposob] : null };
    };
    const uwagi = [UWAGA_TERMIN, `Stan liczony na dzień ${dzis}.`, UWAGA_LICZNIK];
    if (zWyslania) uwagi.push(UWAGA_SENT_DATE);
    const tylkoPdf = odpowiedzi.filter((r) => !r.prolongation && r.onlyAttachment);
    if (pdfWCalosci) {
      // Przeczytany w całości PDF to cała odpowiedź: odsyłanie do niego po brakujące liczby wprowadza w błąd.
      uwagi.push(
        `Odpowiedź ${a.odpowiedzKlucz} serwer przeczytał z PDF w całości (tresc.przeczytanoStron). Czego nie ma w odczytanym tekście (np. kwot), ` +
          'nie ma też w pliku: napisz, że odpowiedź tego nie podaje, zamiast odsyłać do PDF.',
      );
    } else if (tylkoPdf.length) {
      uwagi.push(
        'Treść odpowiedzi oznaczonych tylkoZalacznik jest tylko w załączniku PDF (pole pdf): serwer odczyta ją, gdy wywołasz pismo z odpowiedzKlucz. ' +
          'Nie pisz, że treści nie ma; jeśli jej nie czytasz, podaj adres PDF.',
      );
    }
    if (tresc) uwagi.push(UWAGA_TEKST_Z_ZEWNATRZ);
    if (odczytanoPdf) uwagi.push(UWAGA_PDF);
    const zdaniaWnioskow = opisWnioskow(wnioski, adresaci.length);

    const dniDni = (d: number) => odmiana(d, ['dzień', 'dni', 'dni']);
    // Dni od terminu do dziś dla adresata, o którym nie wiadomo, czy odpowiedział: liczba gotowa,
    // bo model liczący sam pomylił się o 21 dni (07-4).
    const dniGdyBez = (i: number) => (stany[i].termin ? Math.max(0, roznicaDni(stany[i].termin as string, dzis)) : null);
    const oAdresacie = (ad: AdresatZTerminem, i: number) => {
      const st = stany[i];
      if (ad.niewyslane) return `${czysty(ad.name)}: rejestr nie podaje wysłania ani doręczenia (pismo jeszcze niewysłane), więc termin jeszcze nie biegnie`;
      const anomalia = dniWplywDoreczenie(p, ad);
      const kto =
        `${czysty(ad.name)} (${ad.zWyslania ? 'wysłano' : 'doręczono'} ${ad.sent ?? 'brak daty'}` +
        `${anomalia ? `, ${dniDni(anomalia)} po wpływie do Sejmu` : ''}${st.termin ? `, termin ${st.termin}` : ''})`;
      if (st.odpowiedzNieprzypisana) {
        const d = dniGdyBez(i);
        return `${kto}: nie wiadomo, czy odpowiedział (odpowiedzi nie da się przypisać)${d ? `; jeśli nie odpowiedział, to ${dniDni(d)} po terminie` : ''}`;
      }
      if (st.odpowiedziano && st.bladDatyOdpowiedzi) {
        return `${kto}: odpowiedź jest, ale rejestr podaje błędną datę jej wpływu (${st.bladDatyOdpowiedzi}), więc terminowości nie da się ustalić`;
      }
      if (st.odpowiedziano) {
        const d = st.spoznienieDni ?? 0;
        const wniosek = st.przypisanie && st.przypisanie !== 'jeden-adresat' && st.przypisanie !== 'resort-w-podpisie' ? ' (przypisanie to wniosek, patrz adresaci[].przypisanie)' : '';
        return `${kto}: odpowiedź${d > 0 ? ` ${dniDni(d)} po terminie` : ' w terminie'}${wniosek}`;
      }
      if (!st.termin) return `${kto}: brak odpowiedzi, termin nieznany`;
      return (st.spoznienieDni ?? 0) > 0 ? `${kto}: brak odpowiedzi, ${odmiana(st.spoznienieDni ?? 0, ['dzień', 'dni', 'dni'])} po terminie` : `${kto}: brak odpowiedzi, termin jeszcze nie minął`;
    };
    const liczbaProlongat = odpowiedzi.filter((r) => r.prolongation).length;
    const zdaniePdf = odczytanoPdf
      ? `treść odpowiedzi ${a.odpowiedzKlucz} jest w załączniku PDF i serwer ją odczytał (pole tresc, zPdf=true)`
      : tylkoPdf.length
        ? `${tylkoPdf.length === 1 ? 'treść odpowiedzi jest' : `treść ${tylkoPdf.length} odpowiedzi jest`} w załączniku PDF (${tylkoPdf.map((r) => pdfOdpowiedzi(r)[0]).filter(Boolean).join(', ')}): tekst daje pismo z odpowiedzKlucz`
        : '';
    // Zdanie składane z części; pusta część nie zostawia „; .” (interpelacja 20000 bez adresatów).
    const czesci = [
      ...adresaci.map(oAdresacie),
      liczbaProlongat ? `prolongaty: ${liczbaProlongat} (to nie są odpowiedzi)` : '',
      zdaniePdf,
    ].filter(Boolean);
    const anomalie = adresaci.map((ad) => ({ ad, dni: dniWplywDoreczenie(p, ad) })).filter((x) => x.dni !== null);
    if (anomalie.length) {
      uwagi.push(
        `Anomalia rejestru: pismo wpłynęło do Sejmu ${p.receiptDate}, a doręczono je ${anomalie.map((x) => `${czysty(x.ad.name)} ${x.ad.sent} (${dniDni(x.dni as number)} później)`).join(', ')}. ` +
          'Termin liczy się od doręczenia, więc długi czas przed doręczeniem nie jest spóźnieniem ministra; warto o tej przerwie wspomnieć.',
      );
    }
    if (adresaci.some((ad) => ad.niewyslane)) {
      uwagi.push('Rejestr nie podał dat wysłania ani doręczenia (recipientDetails puste, brak sentDate): adresatów wzięto z pola to, termin 21 dni jeszcze nie biegnie.');
    }
    if (linie.size) uwagi.push('Przypisanie „wniosek z treści odpowiedzi” pochodzi z linii „Odpowiadający” w treści odpowiedzi (pole odpowiedzi[].odpowiadajacy), nie z podpisu w rejestrze.');
    if (klucze.length > TRESCI_PISMO) uwagi.push(`Treść sprawdzono tylko dla ${TRESCI_PISMO} z ${klucze.length} nieprzypisanych odpowiedzi.`);
    if (zTresci.niePobrane.length) {
      uwagi.push(
        `Treści ${odmiana(zTresci.niePobrane.length, ['odpowiedzi', 'odpowiedzi', 'odpowiedzi'])} (${zTresci.niePobrane.join(', ')}) Sejm nie oddał na czas, więc ich przypisanie zostaje „nie wiadomo”. ` +
          'Ponowne wywołanie za chwilę może je doczytać.',
      );
      czesciPisma.push(
        czesciowy(
          'Sejm nie oddał na czas treści części odpowiedzi, z których serwer ustala, który urząd odpowiedział',
          `przypisania ${odmiana(zTresci.niePobrane.length, ['odpowiedzi', 'odpowiedzi', 'odpowiedzi'])} do adresata (stan „nie wiadomo”)`,
          'wywołać pismo jeszcze raz za chwilę: przeczytane treści serwer pamięta',
        ),
      );
    }
    // Daty spoza rozsądnego zakresu (rok przed 1990, przyszłość) to błąd rejestru: nie liczymy z nich terminów.
    const bledneDaty = [
      ...[p.receiptDate, p.sentDate].filter((d) => d && !wiarygodnaData(d, dzis)),
      ...odpowiedzi.map((r) => r.receiptDate).filter((d) => d && !wiarygodnaData(d, dzis)),
      ...adresaci.map((ad) => ad.sent).filter((d) => d && !wiarygodnaData(d, dzis)),
    ] as string[];
    if (bledneDaty.length) {
      uwagi.push(
        `Rejestr podaje błędną datę (${[...new Set(bledneDaty)].join(', ')}); w wyniku jest w jej miejscu null (bladDatyWRejestrze), a terminowości opartej na niej nie da się ustalić. ` +
          'Nie pisz ani „w terminie”, ani „po terminie”; powiedz, że odpowiedź jest, a data w rejestrze jest błędna.',
      );
    }
    const dataLubNull = (d: string | null | undefined) => (d && wiarygodnaData(d, dzis) ? d : null);
    const bladDaty = (d: string | null | undefined) => (d && !wiarygodnaData(d, dzis) ? { bladDatyWRejestrze: d } : {});
    const wynikCzesciowyPisma = polaczCzesciowe(...czesciPisma);
    return {
      znaleziono: true,
      ...(wynikCzesciowyPisma ? { wynikCzesciowy: wynikCzesciowyPisma } : {}),
      odpowiedz:
        `${a.rodzaj === 'interpelacja' ? 'Interpelacja' : 'Zapytanie'} nr ${p.num} (${a.rodzaj === 'interpelacja' ? 'wpłynęła' : 'wpłynęło'} do Sejmu ${dataLubNull(p.receiptDate) ?? '?'})` +
        `, ${odmiana((p.from ?? []).length, ['autor', 'autorów', 'autorów'])}` +
        `${czesci.length ? `; ${czesci.join('; ')}` : ''}.` +
        (zdaniaWnioskow.length ? ` ${zdaniaWnioskow.join(' ')}` : ''),
      rodzaj: a.rodzaj,
      numer: p.num,
      tytul: czysty(p.title),
      wplynelo: dataLubNull(p.receiptDate),
      wyslano: dataLubNull(p.sentDate),
      ostatniaZmiana: p.lastModified ?? null,
      // Liczba gotowa: model liczący 41 obiektów podał 40 (07-b).
      liczbaAutorow: (p.from ?? []).length,
      autorzy: autorzy(p.from, nazwiska),
      stan: zlozStan(stany, czyOdpowiedziano(p.replies), wnioski).rodzaj,
      ...(zdaniaWnioskow.length ? { wnioski: zdaniaWnioskow } : {}),
      adresaci: adresaci.map((ad, i) => {
        const s = stany[i];
        const dniNasze = s.spoznienieDni ?? 0;
        const licznik = ad.answerDelayedDays ?? null;
        return {
          adresat: czysty(ad.name),
          doreczono: ad.zWyslania ? null : dataLubNull(ad.sent),
          ...bladDaty(ad.sent),
          ...(ad.zWyslania ? { terminOd: 'wysłanie', wyslano: ad.sent } : {}),
          ...(ad.niewyslane ? { stanDoreczenia: 'jeszcze nie wysłano, brak doręczenia' } : {}),
          ...(dniWplywDoreczenie(p, ad) ? { doreczonoDniPoWplywie: dniWplywDoreczenie(p, ad) } : {}),
          termin: s.termin,
          odpowiedziano: s.odpowiedzNieprzypisana ? 'nie wiadomo' : s.odpowiedziano,
          podpisOdpowiedzi: czysty(s.podpisal),
          ...(s.przypisanie ? { przypisanie: OPIS_PRZYPISANIA[s.przypisanie] } : {}),
          dniPoTerminie: s.odpowiedziano ? null : s.spoznienieDni,
          ...(s.odpowiedzNieprzypisana ? { dniPoTerminieGdyBezOdpowiedzi: dniGdyBez(i) } : {}),
          odpowiedzDniPoTerminie: s.odpowiedziano ? s.spoznienieDni : null,
          ...(s.bladDatyOdpowiedzi ? { terminowosc: 'nie da się ustalić: rejestr podaje błędną datę odpowiedzi' } : {}),
          licznikOpoznieniaSejmu: licznik,
          ...(licznik === 0 && dniNasze > 0
            ? { licznikObjasnienie: `Sejm pokazuje 0, a od terminu minęło ${odmiana(dniNasze, ['dzień', 'dni', 'dni'])}: licznik Sejmu zeruje się po odpowiedzi lub prolongacie; nasze dni liczone bez przedłużeń.` }
            : {}),
        };
      }),
      prolongaty: odpowiedzi.filter((r) => r.prolongation).map((r) => ({ podpisal: czysty(r.from), wplynela: dataLubNull(r.receiptDate), ...bladDaty(r.receiptDate), ...(czyja(r) ?? {}) })),
      odpowiedzi: odpowiedzi.filter((r) => !r.prolongation).map((r) => {
        const pdf = pdfOdpowiedzi(r);
        return {
          klucz: r.key ?? null,
          podpisal: czysty(r.from),
          wplynela: dataLubNull(r.receiptDate),
          ...bladDaty(r.receiptDate),
          ...(czyja(r) ?? { adresat: null }),
          ...(r.key && linie.has(r.key) ? { odpowiadajacy: linie.get(r.key) } : {}),
          ...(wnioski.wspolnyTermin && dataLubNull(r.receiptDate) ? { dniPoWspolnymTerminie: roznicaDni(wnioski.wspolnyTermin, r.receiptDate as string) } : {}),
          tylkoZalacznik: r.onlyAttachment === true,
          ...(r.onlyAttachment ? { tresc: 'Treść jest tylko w załączniku PDF (pole pdf); tekst daje pismo z odpowiedzKlucz.' } : {}),
          pdf: pdf[0] ?? null,
          zalaczniki: pdf,
        };
      }),
      tresc,
      zrodla,
      uwagi,
    };
  },
});
