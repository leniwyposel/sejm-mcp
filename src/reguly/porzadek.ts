/**
 * Porządek obrad posiedzenia Sejmu i głosowania pod jego punktami.
 *
 * Ta sama reguła co strona posiedzenia w serwisie leniwyposel.pl (`shared/porzadek-posiedzenia.ts`,
 * `shared/glosowania-punktow.ts`, `shared/porzadek-nazwy.ts`, stan z 2.10.2026). Moduł jest czysty:
 * dostaje pole `agenda` z `/proceedings/{n}` i listę `/votings/{n}`, nie pyta sieci.
 *
 * Co wiemy o `agenda` (HTML):
 *  - porządek zapowiedzianego posiedzenia ma kilka list `<ol>`: właściwy porządek, „Porządek dzienny
 *    może być uzupełniony o:”, „oraz o ewentualne uchwały Senatu…”. Tylko pierwsza jest porządkiem,
 *    a wszystkie numerują od 1;
 *  - porządek zrealizowany dzieli JEDNĄ numerację na kilka list (`<ol>`, potem `<ol start="42">`).
 *  Bierzemy pierwszą listę i każdą następną, która numerację KONTYNUUJE; lista zaczynająca od nowa
 *  kończy porządek.
 *
 * Głosowanie → punkt (jedna deterministyczna reguła, bez zgadywania):
 *  1. numer punktu WYŁĄCZNIE z początku tytułu głosowania („Pkt. 44 Sprawozdanie…”; przy
 *     „Pkt. 10., 11. i 12 …” pierwszy, który stoi w porządku);
 *  2. numer musi być punktem porządku;
 *  3. gdy tytuł niesie numery druków, punkt musi mieć co najmniej jeden z nich (bezpiecznik na
 *     przenumerowany porządek);
 *  4. tytuł BEZ „Pkt.”, który wymienia druk, staje pod punktem z tym drukiem, ale tylko gdy taki
 *     punkt jest dokładnie jeden.
 *  Wszystko inne (wnioski formalne, apel o kworum, przerwa, tytuły bez druku) trafia do grupy
 *  „Pozostałe głosowania”, w kolejności rejestru. Każde głosowanie stoi dokładnie raz.
 *
 * Pomiar serwisu na X kadencji (2.10.2026, 4775 głosowań): pod punktami 90,5 %; posiedzenie 65:
 * 53 punkty, 137 ze 147 głosowań pod punktami, 10 pozostałych.
 */

/** Punkt porządku obrad. */
export interface PunktPorzadku {
  /** Numer punktu z porządku. */
  poz: number;
  /** Treść punktu bez HTML, najwyżej {@link MAKS_TEKSTU} znaków. */
  tekst: string;
  /** Numery druków z grup „druk(i) nr …”, z przyrostkiem (`1661-A`). */
  druki: string[];
  /** Numery procesów legislacyjnych z odnośników `PrzebiegProc.xsp?nr=`. */
  procesy: string[];
}

/** Treść punktu ucinamy tu (z wielokropkiem). */
export const MAKS_TEKSTU = 1000;

/** Nazwa i podpis grupy na końcu: głosowania, których reguła nie stawia pod żadnym punktem. */
export const POZOSTALE_GLOSOWANIA = 'Pozostałe głosowania';
export const POZOSTALE_GLOSOWANIA_PODPIS = 'Wnioski formalne, sprawdzenia kworum i głosowania bez numeru punktu w rejestrze.';

const ENCJE: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '–',
  oacute: 'ó', Oacute: 'Ó', bdquo: '„', rdquo: '”', ldquo: '“', hellip: '…', shy: '',
};

function odkoduj(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nazwa: string) => ENCJE[nazwa] ?? m)
    .replace(/—/g, '–');
}

/** HTML → tekst w jednej linii: znaczniki na spację, encje odkodowane, białe znaki zwinięte. */
export function tekstBezHtml(html: string): string {
  return odkoduj(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();
}

function utnij(tekst: string): string {
  return tekst.length <= MAKS_TEKSTU ? tekst : `${tekst.slice(0, MAKS_TEKSTU - 1).trimEnd()}…`;
}

const NUMER_DRUKU = /\b\d+(?:-[A-Z]{1,2})?\b/g;

/** Druki z grup „druk nr …” / „druki nr …” w tekście (bez HTML). */
export function drukiZTekstu(tekst: string): string[] {
  const out: string[] = [];
  const grupa = /druk(?:i|ów)?\s+nr\s+([^)]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = grupa.exec(tekst)) !== null) {
    for (const n of m[1].match(NUMER_DRUKU) ?? []) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Procesy z odnośników `PrzebiegProc.xsp?nr=<N>`, bez powtórzeń. */
export function procesyZOdnosnikow(html: string): string[] {
  const out: string[] = [];
  const re = /PrzebiegProc\.xsp\?nr=(\d+(?:-[A-Z]{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

interface Lista {
  start: number | null;
  punkty: Array<{ value: number | null; html: string }>;
}

/** Listy `<ol>` najwyższego poziomu i ich punkty `<li>` najwyższego poziomu (lista w punkcie zostaje częścią punktu). */
function listyNajwyzszegoPoziomu(html: string): Lista[] {
  const listy: Lista[] = [];
  const re = /<(\/?)(ol|li)\b([^>]*)>/gi;
  let glebokoscOl = 0;
  let glebokoscLi = 0;
  let biezaca: Lista | null = null;
  let poczatekLi = -1;
  let wartoscLi: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const zamkniecie = m[1] === '/';
    const znacznik = m[2].toLowerCase();
    if (znacznik === 'ol') {
      if (!zamkniecie) {
        glebokoscOl += 1;
        if (glebokoscOl === 1) {
          const start = /\bstart\s*=\s*"?(\d+)/i.exec(m[3]);
          biezaca = { start: start ? Number(start[1]) : null, punkty: [] };
        }
      } else if (glebokoscOl > 0) {
        if (glebokoscOl === 1 && biezaca) {
          if (poczatekLi >= 0) biezaca.punkty.push({ value: wartoscLi, html: html.slice(poczatekLi, m.index) });
          poczatekLi = -1;
          glebokoscLi = 0;
          listy.push(biezaca);
          biezaca = null;
        }
        glebokoscOl -= 1;
      }
      continue;
    }
    if (glebokoscOl !== 1 || !biezaca) continue;
    if (!zamkniecie) {
      if (glebokoscLi === 0) {
        // Rejestr nie zawsze zamyka `</li>`; nowy punkt zamyka poprzedni.
        if (poczatekLi >= 0) biezaca.punkty.push({ value: wartoscLi, html: html.slice(poczatekLi, m.index) });
        const value = /\bvalue\s*=\s*"?(\d+)/i.exec(m[3]);
        wartoscLi = value ? Number(value[1]) : null;
        poczatekLi = re.lastIndex;
        glebokoscLi = 1;
      } else {
        glebokoscLi += 1;
      }
    } else if (glebokoscLi > 0) {
      glebokoscLi -= 1;
      if (glebokoscLi === 0 && poczatekLi >= 0) {
        biezaca.punkty.push({ value: wartoscLi, html: html.slice(poczatekLi, m.index) });
        poczatekLi = -1;
      }
    }
  }
  return listy;
}

/** Punkty porządku z HTML-u `agenda`: pierwsza lista i listy, które kontynuują jej numerację. */
export function punktyPorzadku(agenda: string | null | undefined): PunktPorzadku[] {
  if (typeof agenda !== 'string' || agenda.trim() === '') return [];
  const out: PunktPorzadku[] = [];
  let ostatni = 0;
  for (const [i, lista] of listyNajwyzszegoPoziomu(agenda).entries()) {
    const punkty: PunktPorzadku[] = [];
    let nastepny = lista.start ?? (i === 0 ? 1 : ostatni + 1);
    for (const p of lista.punkty) {
      const poz = p.value ?? nastepny;
      nastepny = poz + 1;
      const tekst = tekstBezHtml(p.html);
      if (tekst === '') continue;
      punkty.push({ poz, tekst: utnij(tekst), druki: drukiZTekstu(tekst), procesy: procesyZOdnosnikow(p.html) });
    }
    if (punkty.length === 0) continue;
    // Lista od nowa to już nie porządek (uzupełnienia, uchwały Senatu); luka w górę nie przerywa
    // (65. posiedzenie: punkt 41 nie został zrealizowany, druga lista ma start="42").
    if (out.length > 0 && punkty[0].poz <= ostatni) break;
    out.push(...punkty);
    ostatni = punkty[punkty.length - 1].poz;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Krótka nazwa i etap punktu (z tekstu rejestru, regułą, bez redakcji)
// ---------------------------------------------------------------------------

/** Najdłuższa krótka nazwa; dłuższa kończy się wielokropkiem na granicy słowa. */
export const MAKS_NAZWY = 85;

function utnijNaSlowie(s: string, maks = MAKS_NAZWY): string {
  const t = s.trim().replace(/[\s,;:–-]+$/u, '');
  if (t.length <= maks) return t;
  const cut = t.slice(0, maks - 1);
  const spacja = cut.lastIndexOf(' ');
  return `${(spacja > 20 ? cut.slice(0, spacja) : cut).replace(/[\s,;:–-]+$/u, '')}…`;
}

const wielka = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function bezOgona(tekst: string): string {
  let t = tekst.replace(/\s+/g, ' ').trim();
  const druk = t.search(/\s*\(druk/i);
  if (druk > 0) t = t.slice(0, druk);
  const osoba = t.search(/\s+[-–]\s+(sprawozdawc|uzasadnia|przedstawia)/i);
  if (osoba > 0) t = t.slice(0, osoba);
  return t.trim();
}

function przedmiot(rodzaj: string, reszta: string): string {
  let r = reszta.trim();
  r = r.replace(/^o zmianie ustaw[ y]?\s*/i, '');
  if (/^[–-]\s*/.test(r)) {
    r = r.replace(/^[–-]\s*/, '');
    return utnijNaSlowie(r.split(/ oraz |, /)[0]);
  }
  r = r.split(/ oraz |, /)[0];
  return utnijNaSlowie(`${rodzaj} ${r}`);
}

/** Krótka nazwa punktu porządku z jego tekstu („Ustawa o …”, „Wniosek o …”); niepusta przy niepustym tekście. */
export function krotkaNazwaPunktu(tekst: string): string {
  const t = bezOgona(tekst);
  if (t === '') return '';
  const projekt = /projek\w*\s+(ustaw|uchwał)\w*\s*:?\s*(.*)$/iu.exec(t);
  if (projekt) {
    const rodzaj = projekt[1].toLowerCase() === 'ustaw' ? 'Ustawa' : 'Uchwała';
    const reszta = projekt[2].trim();
    const lista = reszta.split(/,?\s*-\s+(?=o\s)/).map((x) => x.trim()).filter(Boolean);
    if (reszta.startsWith('-') && lista.length > 1) {
      return `${przedmiot(rodzaj, lista[0])} (${lista.length} ${lista.length < 5 ? 'projekty' : 'projektów'})`;
    }
    return przedmiot(rodzaj, reszta.replace(/^-\s*/, ''));
  }
  const wniosek = /w sprawie wniosku\b.*?\s(o\s.*)$/iu.exec(t);
  if (wniosek) return utnijNaSlowie(`Wniosek ${wniosek[1]}`);
  const sprawa = /\b(w sprawie\s.*)$/iu.exec(t);
  if (sprawa && !/^(sprawozdanie|informacja)/i.test(sprawa[1])) {
    const przed = t.slice(0, sprawa.index).trim();
    const pierwsze = przed.split(' ')[0] ?? '';
    const rodzaj = /^sprawozdanie$/i.test(pierwsze) ? '' : wielka(pierwsze);
    return utnijNaSlowie(rodzaj ? `${rodzaj} ${sprawa[1]}` : wielka(sprawa[1]));
  }
  return utnijNaSlowie(wielka(t));
}

/** Etap punktu z tekstu rejestru („II czytanie”, „Sprawozdanie komisji”); `null`, gdy reguła nic nie rozpoznaje. */
export function etapPunktu(tekst: string): string | null {
  const t = tekst.replace(/\s+/g, ' ');
  if (/trzecie czytanie/i.test(t)) return 'III czytanie';
  if (/drugie czytanie/i.test(t)) return 'II czytanie';
  if (/pierwsze czytanie/i.test(t)) return 'I czytanie';
  if (/^\s*pytania w sprawach bieżących/i.test(t)) return 'Pytania w sprawach bieżących';
  if (/^\s*informacja bieżąca/i.test(t)) return 'Informacja bieżąca';
  if (/^\s*(sprawozdanie|informacja)\b[^(]*?\bz działalności/i.test(t)) return 'Sprawozdanie z działalności';
  if (/^\s*sprawozdanie komisji/i.test(t)) return 'Sprawozdanie komisji';
  if (/^\s*informacja/i.test(t)) return 'Informacja';
  if (/^\s*(wybór|zmiany w składach)/i.test(t)) return 'Wybór';
  if (/^\s*ślubowanie/i.test(t)) return 'Ślubowanie';
  return null;
}

// ---------------------------------------------------------------------------
// Głosowanie → punkt porządku
// ---------------------------------------------------------------------------

/** Numery punktów z początku tytułu („Pkt. 10., 11. i 12 …” → [10, 11, 12]); pusta bez „Pkt.” na początku. */
export function punktyZTytulu(tytul: string | null | undefined): number[] {
  const m = /^\s*[Pp]kt\.?\s*(\d+(?:\s*\.?\s*(?:,|i(?=\s))\s*\d+)*)\.?(?=\s|$)/.exec(tytul ?? '');
  if (!m) return [];
  const out: number[] = [];
  for (const n of m[1].match(/\d+/g) ?? []) {
    const nr = Number(n);
    if (nr > 0 && !out.includes(nr)) out.push(nr);
  }
  return out;
}

const DRUKU = /\bdruku\s+(?:nr\s+)?(\d+(?:-[A-Z]{1,2})?)\b/giu;

/** Numery druków w tytule głosowania („(druki nr 2875 i 3077)”, „druku nr 3100”, „druku 2821”). */
export function drukiTytulu(tytul: string | null | undefined): string[] {
  const t = tytul ?? '';
  const out = drukiZTekstu(t);
  for (const m of t.matchAll(DRUKU)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Krok 4: tytuł bez „Pkt.” z drukiem staje pod punktem z tym drukiem, gdy taki punkt jest dokładnie jeden. */
function punktPoDruku(tytul: string | null | undefined, punkty: ReadonlyMap<number, PunktPorzadku>): number | null {
  const druki = drukiTytulu(tytul);
  if (druki.length === 0) return null;
  const kandydaci = [...punkty.values()].filter((p) => p.druki.some((d) => druki.includes(d)));
  return kandydaci.length === 1 ? kandydaci[0].poz : null;
}

/** Numer punktu porządku, pod którym stoi głosowanie, albo `null` (grupa „Pozostałe głosowania”). */
export function punktGlosowania(tytul: string | null | undefined, punkty: ReadonlyMap<number, PunktPorzadku>): number | null {
  const numery = punktyZTytulu(tytul);
  if (numery.length === 0) return punktPoDruku(tytul, punkty);
  const drukiT = drukiZTekstu(tytul ?? '');
  for (const nr of numery) {
    const p = punkty.get(nr);
    if (!p) continue;
    if (drukiT.length > 0 && !drukiT.some((d) => p.druki.includes(d))) continue;
    return nr;
  }
  return null;
}

export interface RozkladNaPunkty<G> {
  /** Wszystkie punkty porządku rosnąco, każdy z głosowaniami (także bez żadnego). */
  punkty: Array<{ punkt: PunktPorzadku; glosowania: G[] }>;
  /** Głosowania bez punktu, w kolejności wejścia. */
  poza: G[];
}

/** Rozkłada głosowania posiedzenia na punkty porządku; każde głosowanie stoi dokładnie raz. */
export function rozlozNaPunkty<G extends { title?: string | null }>(punkty: readonly PunktPorzadku[], glosowania: readonly G[]): RozkladNaPunkty<G> {
  const mapa = new Map<number, { punkt: PunktPorzadku; glosowania: G[] }>();
  for (const p of [...punkty].sort((a, b) => a.poz - b.poz)) if (!mapa.has(p.poz)) mapa.set(p.poz, { punkt: p, glosowania: [] });
  const doDopasowania = new Map<number, PunktPorzadku>([...mapa].map(([poz, w]) => [poz, w.punkt]));
  const poza: G[] = [];
  for (const g of glosowania) {
    const nr = punktGlosowania(g.title, doDopasowania);
    const cel = nr === null ? undefined : mapa.get(nr);
    if (cel) cel.glosowania.push(g);
    else poza.push(g);
  }
  return { punkty: [...mapa.values()], poza };
}

// ---------------------------------------------------------------------------
// Linia głosowania na liście posiedzenia
// ---------------------------------------------------------------------------

/** „Głosowanie”, „Głosowanie nr 12”: nasza etykieta, nie temat. */
const SAM_NUMER = /^głosowanie(\s+nr)?\s*\d*\.?$/iu;
/** Nazwa posiedzenia w polu `title` („65. posiedzenie Sejmu … w dniach …”): rejestr wpisuje ją, gdy głosowanie nie ma punktu. */
const NAZWA_POSIEDZENIA = /^\d+\.\s*posiedzenie\s+Sejmu\b.*\bw\s+dni(?:u|ach)\b/iu;
/** „Głosowanie proceduralne dotyczące druku 2821” (64/2), „… druku nr 3100”, „… projektu uchwały z druku nr 3071”: treść jest w `topic`. */
const PROCEDURALNE = /^Głosowanie\s+proceduralne\s+dotyczące\s+(?:projektu\s+\S+\s+z\s+)?druku\s+(?:nr\s+)?(\S+)$/iu;
const ODSYLACZ_REGULAMINU = /,?\s*o\s+którym\s+mowa\s+w\s+art\.\s*[^,]*?\s+regulaminu\s+Sejmu/iu;
const W_SPRAWIE_DRUKU = /\s+w\s+sprawie\s+(?:(?:przedłożenia|sprawozdania)(?:\s+dotyczącego\s+projektu)?\s+z\s+)?druku\s+nr\s+\S+\s*$/iu;
const PUNKT_NA_POCZATKU = /^Pkt\.?\s*\d+[a-z]?(?:\s*\.?\s*(?:,|i(?=\s))\s*\d+[a-z]?)*\.?\s+/iu;

/** Czy tytuł rejestru mówi, czego głosowanie dotyczy (a nie jest samym numerem ani nazwą posiedzenia). */
export function maTematZRejestru(tytul: string | null | undefined): boolean {
  const t = String(tytul ?? '').trim();
  return t !== '' && !SAM_NUMER.test(t) && !NAZWA_POSIEDZENIA.test(t);
}

/** Pole `topic` bez kropki na końcu i bez odsyłacza do regulaminu; słowa zostają z rejestru. */
function tematZTopic(topic: string | null | undefined): string {
  return String(topic ?? '').replace(/\s+/gu, ' ').replace(ODSYLACZ_REGULAMINU, '').trim().replace(/[.\s]+$/u, '');
}

/**
 * Główna linia głosowania na liście posiedzenia (jak wiersz strony posiedzenia w serwisie):
 *  - tytuł proceduralny („Głosowanie proceduralne dotyczące druku N”): temat z `topic` i „(druk N)”;
 *  - tytuł bez tematu (nazwa posiedzenia, sam numer): temat z `topic` („Wniosek o przerwę”);
 *  - pod punktem porządku: temat z rejestru („poprawka 1”, „głosowanie nad całością projektu”),
 *    bo nazwę punktu niesie punkt;
 *  - inaczej tytuł rejestru bez „Pkt. N” na początku.
 */
export function liniaGlosowania(tytul: string | null | undefined, topic: string | null | undefined, podPunktem: boolean): string {
  const t = String(tytul ?? '').trim();
  const temat = tematZTopic(topic);
  const proceduralne = PROCEDURALNE.exec(t);
  if (proceduralne && temat) return `${wielka(temat.replace(W_SPRAWIE_DRUKU, '').trim())} (druk ${proceduralne[1]})`;
  if (!maTematZRejestru(t)) return temat ? wielka(temat) : t || 'Brak tytułu';
  if (podPunktem && temat) return temat;
  return t.replace(PUNKT_NA_POCZATKU, '').trim() || t;
}
