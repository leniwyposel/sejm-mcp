import { z } from 'zod';
import { dzisWarszawa, odmiana, roznicaDni } from '../reguly/daty.js';
import { wynikGlosowania, type GlosowanieSurowe } from '../reguly/glosowania.js';
import { MAKS_ZNAKOW, porcjaWRozmiarze, rozstrzygniecieWeta } from './glosowania.js';
import { bezpiecznyLink, czysty, klucz } from '../tekst.js';
import type { ZrodloSejmu } from '../klient.js';
import { brak404, OPIS_CZESCIOWY, czesciowy, czesciowyZBledu, type WynikCzesciowy, data, jakoLista, jakoRekord, kadencja, limit, maWszystkie, narzedzie, przesuniecie, rdzenie, rozwinSkroty, sprawdzPrzedzial, T, type Wynik } from './wspolne.js';

interface EtapZRejestru {
  date?: string;
  stageName?: string;
  stageType?: string;
  printNumber?: string;
  committeeCode?: string;
  decision?: string;
  sittingNum?: number;
  rapporteurID?: string;
  rapporteurName?: string;
  /** Stanowisko Senatu („wniósł poprawki”, „nie wniósł poprawek”), tylko w etapie SenatePosition. */
  position?: string;
  /** Wniosek komisji w sprawozdaniu („załączony projekt ustawy”, „przyjąć poprawki”). */
  proposal?: string;
  minorityMotions?: number;
  comment?: string;
  otherDocuments?: DokumentInny[];
  voting?: GlosowanieSurowe & { sitting: number; votingNumber: number };
  children?: EtapZRejestru[];
}

/** Pola aktu z ELI, których proces nie ma. */
interface AktEli {
  promulgation?: string;
  entryIntoForce?: string | null;
}

/** Autopoprawki i inne druki dołączone do procesu (np. 2865-A, 128-BA). */
interface DokumentInny {
  number?: string;
  title?: string;
  documentDate?: string;
  registeredDate?: string;
}

interface ProcesZRejestru {
  number: string;
  title: string;
  titleFinal?: string;
  /** Streszczenie projektu: tu jest temat, gdy tytuł to samo „o zmianie ustawy…”. */
  description?: string;
  /** Uwaga Sejmu do procesu, np. o oświadczeniu posła zrzekającego się immunitetu (16825-z). */
  comments?: string;
  documentType?: string;
  documentDate?: string;
  processStartDate?: string;
  closureDate?: string;
  changeDate?: string;
  passed?: boolean;
  urgencyStatus?: string;
  ELI?: string;
  displayAddress?: string;
  printsConsideredJointly?: string[];
  otherDocuments?: DokumentInny[];
  stages?: EtapZRejestru[];
  links?: Array<{ href: string; rel: string }>;
}

const UWAGA_STAN =
  'Pole stan mówi, gdzie jest akt według OSTATNIEGO etapu rejestru, z datą: opublikowany, podpisany, u Prezydenta, zawetowany, w Trybunale Konstytucyjnym, ' +
  'w Senacie (albo po stanowisku Senatu), uchwalony przez Sejm, zakończony bez uchwalenia albo w toku. Pole ostatniEtap podaje ten etap wprost. ' +
  'Publikacja nie oznacza wejścia w życie: termin wejścia w życie jest w treści ustawy. Datę uchwalenia podawaj tylko z glosowanieKoncowe (narzędzie proces).';
const UWAGA_DATA = 'Datę uchwalenia przez Sejm daje glosowanieKoncowe; zamknietoWSejmie to tylko data ostatniego etapu w Sejmie (np. stanowiska Senatu).';

/** Głosowanie nad całością projektu (III czytanie); przy uchwałach bez III czytania ostatnie głosowanie na sali. */
function glosowanieKoncowe(stages: EtapZRejestru[] | undefined) {
  const glosowania: Array<NonNullable<EtapZRejestru['voting']>> = [];
  const zbierz = (lista: EtapZRejestru[] | undefined) => {
    for (const e of lista ?? []) {
      if (e.voting) glosowania.push(e.voting);
      zbierz(e.children);
    }
  };
  zbierz(stages);
  const calosc = glosowania.filter((v) => /całoś/i.test(`${v.description ?? ''} ${v.topic ?? ''}`));
  const v = calosc.at(-1) ?? glosowania.at(-1);
  if (!v) return null;
  return {
    posiedzenie: v.sitting,
    numer: v.votingNumber,
    data: v.date,
    opis: czysty(v.description),
    wynik: wynikGlosowania(v).etykieta,
    za: v.yes,
    przeciw: v.no,
    wstrzymalo: v.abstain,
    pewne: calosc.length > 0,
  };
}

const PULA = 100;
/** Ilu uchwalonym, nieopublikowanym procesom z listy dociągamy etapy (po jednym zapytaniu). */
const SZCZEGOLY = 5;
/** Tytuł ustawy, która zmienia albo wykonuje inną: nie jest tą ustawą. */
const POCHODNA = /(o zmianie|zmieniając|o szczególnych rozwiązaniach|realizacji ustawy|wykonaniu ustawy)/i;

const TRYB: Record<string, string> = { NORMAL: 'zwykły', URGENT: 'pilny', URGENT_WITHDRAWN: 'pilny, pilność wycofana', PRIORITY: 'priorytetowy' };

/** Drzewo etapów spłaszczone w kolejności rejestru (dzieci zaraz po rodzicu). */
function splaszcz(stages: EtapZRejestru[] | undefined): EtapZRejestru[] {
  const plaskie: EtapZRejestru[] = [];
  const zbierz = (lista: EtapZRejestru[] | undefined) => {
    for (const e of lista ?? []) {
      plaskie.push(e);
      zbierz(e.children);
    }
  };
  zbierz(stages);
  return plaskie;
}

/** Tylko ustawa idzie do Senatu i Prezydenta; uchwała i informacja kończą się w Sejmie. */
const jestUstawa = (p: ProcesZRejestru) => /ustaw/i.test(p.documentType ?? '');
const jestWeto = (e: EtapZRejestru) => e.stageType === 'Veto' || /weto/i.test(e.stageName ?? '');
const jestTrybunal = (e: EtapZRejestru) => e.stageType === 'PresidentToTribunal' || /trybuna\S* konstytucyjn/iu.test(e.stageName ?? '');
const kiedy = (d: string | undefined) => (d ? ` ${d}` : '');

const BRAK_DALSZEGO_ETAPU = 'rejestr Sejmu nie ma dalszego etapu';
const NAD_WETEM = 'Sejm nie głosował jeszcze nad wetem';

/**
 * Weto Prezydenta z etapów procesu. Rejestr zostawia `passed: true` także po wecie, więc bez
 * tego stan brzmiałby „uchwalona, czeka na publikację”, choć ustawa czeka na głosowanie nad wetem.
 */
function stanWeta(stages: EtapZRejestru[] | undefined): string | null {
  const plaskie = splaszcz(stages);
  const i = plaskie.map(jestWeto).lastIndexOf(true);
  if (i === -1) return null;
  const k = kiedy(plaskie[i].date);
  const glosowanie = plaskie.slice(i + 1).find((e) => e.voting)?.voting;
  if (!glosowanie) {
    return `zawetowana przez Prezydenta${k}; ${NAD_WETEM} (do odrzucenia weta potrzeba 3/5 głosujących)`;
  }
  return wynikGlosowania(glosowanie).przeszlo
    ? `weto Prezydenta${k} odrzucone przez Sejm (głosowanie ${glosowanie.sitting}/${glosowanie.votingNumber})`
    : `weto Prezydenta${k} utrzymane: ustawa nie wejdzie w życie (głosowanie ${glosowanie.sitting}/${glosowanie.votingNumber})`;
}

/** Konstytucja, art. 122 ust. 2: Prezydent podpisuje ustawę w ciągu 21 dni. */
const DNI_PREZYDENTA = 21;
const dniMiedzy = (od: string, do_: string) => Math.round((Date.parse(`${do_}T00:00:00Z`) - Date.parse(`${od}T00:00:00Z`)) / 86_400_000);

/** Sprawozdanie komisji wewnątrz etapu (np. nad stanowiskiem Senatu), żeby stan mówił, co komisja wnosi. */
function sprawozdanieW(e: EtapZRejestru): string {
  const s = [...(e.children ?? [])].reverse().find((x) => x.stageType === 'CommitteeReport' && !/podkomisji/i.test(x.stageName ?? ''));
  if (!s) return '';
  const szczegoly = [s.printNumber ? `druk ${s.printNumber}` : '', s.proposal ? `wniosek: „${czysty(s.proposal)}”` : ''].filter(Boolean);
  return `; sprawozdanie komisji${kiedy(s.date)}${szczegoly.length ? ` (${szczegoly.join(', ')})` : ''}`;
}

/**
 * Stan procesu z OSTATNIEGO etapu rejestru, z datą. Sama flaga `passed` nie odróżnia ustawy
 * w Senacie od leżącej u Prezydenta od dwóch lat ani od zawetowanej, a model brał ją za jedno.
 */
function stanZEtapow(p: ProcesZRejestru, dzis = dzisWarszawa()): string | null {
  const glowne = (p.stages ?? []).filter((e) => e.stageType !== 'End');
  const ost = glowne.at(-1);
  if (!ost) return null;
  const iWeta = glowne.map(jestWeto).lastIndexOf(true);
  // Po wecie odrzuconym ustawa wraca do Prezydenta: wtedy mówi ostatni etap, nie weto.
  const poWecie = iWeta === -1 ? [] : glowne.slice(iWeta + 1);
  if (iWeta !== -1 && !poWecie.some((e) => ['ToPresident', 'PresidentSignature', 'PresidentToTribunal'].includes(e.stageType ?? ''))) {
    return stanWeta(p.stages);
  }
  const ustawa = jestUstawa(p);
  switch (ost.stageType) {
    case 'PresidentToTribunal':
      return `skierowana przez Prezydenta do Trybunału Konstytucyjnego${kiedy(ost.date)} przed podpisem (kontrola prewencyjna); nieopublikowana, nie obowiązuje; to nie jest weto`;
    case 'PresidentSignature':
      return `podpisana przez Prezydenta${kiedy(ost.date)}; rejestr Sejmu nie ma jeszcze publikacji w Dzienniku Ustaw`;
    case 'ToPresident': {
      const ile = ost.date ? dniMiedzy(ost.date, dzis) : 0;
      // Same fakty: polecenie „nie zgaduj” stało tu i model przepisywał je czytelnikowi (09-b);
      // idzie teraz do uwag (uwagiStanu).
      const zwloka =
        ile > DNI_PREZYDENTA
          ? `; ${BRAK_DALSZEGO_ETAPU} (podpisu, weta ani skierowania do Trybunału Konstytucyjnego) po ${ile} dniach od przekazania, a Prezydent ma na decyzję ${DNI_PREZYDENTA} dni`
          : `; czeka na decyzję Prezydenta (podpis, weto albo Trybunał Konstytucyjny; ma na nią ${DNI_PREZYDENTA} dni)`;
      return `u Prezydenta: przekazana do podpisu${kiedy(ost.date)}${zwloka}; nieopublikowana`;
    }
    case 'SenatePosition': {
      const stanowisko = czysty(ost.position) ?? '';
      if (/nie wni\S* poprawek/i.test(stanowisko)) return `Senat nie wniósł poprawek${kiedy(ost.date)}; rejestr nie ma jeszcze przekazania ustawy Prezydentowi`;
      if (/odrzuc/i.test(stanowisko)) return `Senat${kiedy(ost.date)}: ${stanowisko}; Sejm jeszcze nie głosował nad uchwałą Senatu`;
      return `Senat ${stanowisko || 'zajął stanowisko'}${kiedy(ost.date)}${ost.printNumber ? ` (druk ${ost.printNumber})` : ''}; Sejm jeszcze nie głosował nad stanowiskiem Senatu`;
    }
    case 'SenatePositionConsideration':
      return `Sejm rozpatrzył stanowisko Senatu${kiedy(ost.date)}: ${czysty(ost.decision) || 'bez decyzji w rejestrze'}; rejestr nie ma jeszcze przekazania ustawy Prezydentowi`;
    case 'PresidentMotionConsideration':
      return `Sejm rozpatrzył wniosek Prezydenta${kiedy(ost.date)}: ${czysty(ost.decision) || 'bez decyzji w rejestrze'}`;
    case 'CommitteeWork':
      if (/senat/i.test(ost.stageName ?? '')) {
        const senat = [...glowne].reverse().find((e) => e.stageType === 'SenatePosition');
        const stanowisko = senat ? `Senat ${czysty(senat.position) || 'zajął stanowisko'}${kiedy(senat.date)}; ` : '';
        return `${stanowisko}komisja pracuje nad stanowiskiem Senatu${sprawozdanieW(ost)}; Sejm jeszcze nie głosował nad nim`;
      }
      break;
  }
  if (p.passed) {
    const trzecie = [...glowne].reverse().find((e) => e.stageType === 'SejmReading' && /uchwal|podj/i.test(e.decision ?? ''));
    const data = kiedy(trzecie?.date ?? p.closureDate);
    return ustawa
      ? `uchwalona przez Sejm${data}; rejestr nie ma jeszcze stanowiska Senatu (Senat ma na nie 30 dni)`
      : `przyjęta przez Sejm${data}; rejestr nie ma jeszcze publikacji`;
  }
  if (p.closureDate) return `zakończona w Sejmie bez uchwalenia (${czysty(ost.stageName) ?? ''}${kiedy(ost.date)}${ost.decision ? `: ${czysty(ost.decision)}` : ''})`;
  return `w toku: ostatni etap „${czysty(ost.stageName) ?? ''}”${kiedy(ost.date)}${ost.stageType === 'CommitteeWork' ? sprawozdanieW(ost) : ''}${ost.decision ? `, decyzja: ${czysty(ost.decision)}` : ''}`;
}

/**
 * Polecenia dla modelu do stanów z listy. Stoją w uwagach, nie w polu stan ani w odpowiedzi:
 * stamtąd model przepisywał je czytelnikowi („nie zgaduj”).
 */
function uwagiStanu(stany: string[]): string[] {
  const uwagi: string[] = [];
  if (stany.some((s) => s.includes(BRAK_DALSZEGO_ETAPU))) {
    uwagi.push(
      'Gdy stan mówi, że rejestr Sejmu nie ma dalszego etapu po przekazaniu Prezydentowi: brak etapu w rejestrze nie dowodzi, że decyzji nie było. ' +
        'Nie zgaduj, co się stało, i nie pisz, że ustawa „czeka bez podpisu i weta”; podaj datę przekazania i to, że rejestr nie ma dalszego etapu.',
    );
  }
  if (stany.some((s) => s.includes(NAD_WETEM))) {
    uwagi.push('Przed głosowaniem nad wetem nie ma liczbowego progu 3/5 (zależy od liczby głosujących); nie podawaj go.');
  }
  return uwagi;
}

/** Stan procesu jednym napisem, żeby model nie składał go z dwóch pól. */
function stanProcesu(p: ProcesZRejestru): string {
  if (p.displayAddress) {
    const podpis = splaszcz(p.stages).find((e) => e.stageType === 'PresidentSignature');
    return `${podpis?.date ? `podpisana przez Prezydenta ${podpis.date}, ` : ''}opublikowana (${p.displayAddress})`;
  }
  const zEtapow = p.stages?.length ? stanZEtapow(p) : null;
  if (zEtapow) return zEtapow;
  // Lista procesów nie ma etapów: tu stan jest tylko przybliżony.
  if (p.passed && !jestUstawa(p)) return 'przyjęta przez Sejm; rejestr nie ma publikacji';
  if (p.passed) return 'uchwalona przez Sejm, jeszcze nieopublikowana (Senat, Prezydent, weto albo Trybunał: sprawdź narzędziem proces)';
  if (p.closureDate) return 'zakończona w Sejmie bez uchwalenia';
  return 'w toku';
}

/** Ostatni etap z rejestru (data i nazwa), jeśli znamy etapy. */
function ostatniEtap(p: ProcesZRejestru) {
  const e = (p.stages ?? []).filter((x) => x.stageType !== 'End').at(-1);
  return e ? { data: e.date ?? null, etap: czysty(e.stageName), decyzja: czysty(e.decision) || null } : null;
}

/** Opis procesu skrócony do listy: dość, żeby odróżnić kilkanaście tytułów „o zmianie ustawy…”. */
const DLUGOSC_OPISU = 240;
function krotkiOpis(opis: string | undefined): string | null {
  const t = czysty(opis);
  if (!t) return null;
  return t.length <= DLUGOSC_OPISU ? t : `${t.slice(0, DLUGOSC_OPISU).replace(/\s+\S*$/, '')}…`;
}

function skrotProcesu(p: ProcesZRejestru) {
  return {
    stan: stanProcesu(p),
    ...(p.stages ? { ostatniEtap: ostatniEtap(p) } : {}),
    numer: p.number,
    tytul: czysty(p.title),
    opis: krotkiOpis(p.description),
    rodzajDokumentu: p.documentType ?? null,
    wszczeto: p.processStartDate ?? null,
    uchwalono: p.passed ?? null,
    publikacja: p.displayAddress ?? null,
  };
}

// ---------------------------------------------------------------------------
// Szukanie frazy w tytule i opisie (procesy, projekty)
// ---------------------------------------------------------------------------

type Miejsce = 'tytuł' | 'opis' | 'tytuł i opis';
interface Trafienie {
  miejsce: Miejsce;
  /** Cała fraza (true) czy same rdzenie słów (false). */
  pelna: boolean;
  /** Trafienie bez jednego słowa frazy (przy zerze pełnych trafień). */
  czesciowe?: boolean;
}

const gdzie = (wTytule: boolean, wOpisie: boolean): Miejsce => (wTytule && wOpisie ? 'tytuł i opis' : wTytule ? 'tytuł' : 'opis');

/** Słowa tekstu po `klucz`: rdzeń musi zaczynać słowo, inaczej „kar” trafia „zakaru”. */
const slowaTekstu = (tekst: string) => klucz(tekst).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const zaczyna = (slowa: string[], r: string) => slowa.some((s) => s.startsWith(r));

/**
 * Rdzenie z opisu, które stoją blisko siebie. Opis to kilka zdań: „składania wniosków … zakładów
 * opieki zdrowotnej” w opisie o KRS (1311) miało oba rdzenie „składki zdrowotnej”, ale 20 słów
 * od siebie (05-b). Liczymy najwięcej różnych rdzeni w jednym oknie słów.
 */
function rdzenieWOknie(slowa: string[], rdz: string[]): Set<string> {
  const okno = 2 * rdz.length + 4;
  const pozycje: Array<[number, string]> = [];
  slowa.forEach((s, i) => {
    for (const r of rdz) if (s.startsWith(r)) pozycje.push([i, r]);
  });
  let najlepsze = new Set<string>();
  for (let i = 0; i < pozycje.length; i++) {
    const w = new Set<string>();
    for (let j = i; j < pozycje.length && pozycje[j][0] - pozycje[i][0] < okno; j++) w.add(pozycje[j][1]);
    if (w.size > najlepsze.size) najlepsze = w;
  }
  return najlepsze;
}

/** Które rdzenie trafiają: tytuł (krótki) w całości, opis tylko w jednym oknie słów. */
function trafioneRdzenie(tytul: string, opis: string, rdz: string[]) {
  const sT = slowaTekstu(tytul);
  const wTytule = new Set(rdz.filter((r) => zaczyna(sT, r)));
  const wOpisie = rdzenieWOknie(slowaTekstu(opis), rdz);
  // Część w tytule, reszta blisko siebie w opisie: „składka zdrowotna” przy tytule „o świadczeniach opieki zdrowotnej”.
  const wOpisieReszta = rdzenieWOknie(slowaTekstu(opis), rdz.filter((r) => !wTytule.has(r)));
  const razem = new Set([...wTytule, ...(wTytule.size ? wOpisieReszta : wOpisie)]);
  return { wTytule, wOpisie, razem };
}

function trafienie(tytul: string, opis: string, fraza: string, rdz: string[], zRdzeniami: boolean): Trafienie | null {
  const f = klucz(fraza);
  const wT = klucz(tytul).includes(f);
  const wO = klucz(opis).includes(f);
  if (wT || wO) return { miejsce: gdzie(wT, wO), pelna: true };
  if (!zRdzeniami || rdz.length === 0) return null;
  const t = trafioneRdzenie(tytul, opis, rdz);
  if (t.razem.size < rdz.length) return null;
  const rT = t.wTytule.size === rdz.length;
  const rO = t.wOpisie.size === rdz.length;
  return { miejsce: rT || rO ? gdzie(rT, rO) : 'tytuł i opis', pelna: false };
}

/**
 * Fraza w tytule ALBO w opisie. Tytuły nowelizacji są jednakowe („o zmianie ustawy - Kodeks karny”),
 * a temat (depenalizacja aborcji, obniżka składki zdrowotnej) stoi tylko w opisie. Frazę z kilku
 * słów szukamy też rdzeniami (tytuły są w przypadkach zależnych); jedno słowo rdzeniem dopiero
 * przy zerze, bo krótki rdzeń („bud” z „budżet”) trafiałby setki opisów.
 */
function szukajFrazy<X>(lista: X[], fraza: string, tytul: (x: X) => string, opis: (x: X) => string) {
  const rdz = [...new Set(rdzenie(fraza).map(klucz))];
  const przebieg = (zRdzeniami: boolean) => {
    const m = new Map<X, Trafienie>();
    for (const x of lista) {
      const t = trafienie(tytul(x), opis(x), fraza, rdz, zRdzeniami);
      if (t) m.set(x, t);
    }
    return m;
  };
  let trafienia = przebieg(rdz.length > 1);
  if (trafienia.size === 0 && rdz.length === 1) trafienia = przebieg(true);
  const uwagi: string[] = [];
  let czesciowe = false;
  // Zero przy kilku słowach: pytający nazywa sprawę po swojemu („depenalizacja aborcji”, a opis
  // mówi o „terminacji ciąży”). Wtedy pokazujemy te, które mają wszystkie słowa poza jednym, ale
  // tylko z NAJRZADSZYM słowem frazy: samo pospolite słowo („zdrowotna” w 36 opisach) dawało
  // fałszywe trafienia (05-b: „składka zdrowotna” → proces o KRS).
  if (trafienia.size === 0 && rdz.length >= 2) {
    const czestosc = new Map(rdz.map((r) => [r, lista.filter((x) => zaczyna(slowaTekstu(`${tytul(x)} ${opis(x)}`), r)).length]));
    // Najrzadsze słowo spośród obecnych w rejestrze: słowa, którego nie ma nigdzie („aborcji”), brakuje wszystkim.
    const najrzadszy = rdz.filter((r) => czestosc.get(r)! > 0).sort((x, y) => czestosc.get(x)! - czestosc.get(y)!)[0];
    // Przy dwóch słowach „wszystkie poza jednym” to jedno słowo: tylko gdy jest naprawdę rzadkie.
    const rzadki = najrzadszy !== undefined && (rdz.length >= 3 || czestosc.get(najrzadszy)! <= Math.max(3, Math.floor(lista.length / 100)));
    if (rzadki) {
      for (const x of lista) {
        const t = trafioneRdzenie(tytul(x), opis(x), rdz);
        if (t.razem.size < rdz.length - 1 || !t.razem.has(najrzadszy)) continue;
        const wT = t.wTytule.size >= rdz.length - 1;
        const wO = t.wOpisie.size >= rdz.length - 1;
        trafienia.set(x, { miejsce: wT || wO ? gdzie(wT, wO) : 'tytuł i opis', pelna: false, czesciowe: true });
      }
    }
    if (trafienia.size > 0) {
      czesciowe = true;
      uwagi.push(
        `Żaden tytuł ani opis nie ma wszystkich słów frazy (rdzenie: ${rdz.join(', ')}); pokazuję ${trafienia.size} z wszystkimi poza jednym, ` +
          `zawsze z najrzadszym („${najrzadszy}”). Sprawdź w opisie, czy to ta sprawa, zanim ją nazwiesz; jeśli nie, powiedz, że rejestr nie ma takiego procesu.`,
      );
    }
  }
  const zOpisu = [...trafienia.values()].filter((t) => t.miejsce !== 'tytuł').length;
  const zRdzeni = [...trafienia.values()].filter((t) => !t.pelna).length;
  if (zRdzeni > 0) uwagi.push(`${zRdzeni} trafień pasuje rdzeniami słów (${rdz.join(', ')}), nie całą frazą, bo tytuły i opisy są w różnych przypadkach.`);
  if (zOpisu > 0) {
    uwagi.push(
      `${zOpisu} trafień ma frazę (także) w opisie, nie w samym tytule: pole trafienie mówi gdzie. Temat z opisu podawaj jako opis projektu, a nazwę ustawy bierz z tytułu.`,
    );
  }
  return { trafienia, uwagi, czesciowe };
}

/** Frazę z samych skrótów („KRS”) szukamy jeszcze raz rozwiniętą, gdy za pierwszym razem nie ma nic. */
function szukajZeSkrotami<X>(lista: X[], fraza: string, tytul: (x: X) => string, opis: (x: X) => string) {
  const pierwszy = szukajFrazy(lista, fraza, tytul, opis);
  const skrot = pierwszy.trafienia.size === 0 ? rozwinSkroty(fraza) : null;
  if (!skrot) return pierwszy;
  const drugi = szukajFrazy(lista, skrot.fraza, tytul, opis);
  return { ...drugi, uwagi: [skrot.uwaga, ...drugi.uwagi] };
}

// ---------------------------------------------------------------------------
// Stan procesu jako filtr
// ---------------------------------------------------------------------------

/** Stany, które daje sama lista procesów. */
const STANY_Z_LISTY = ['w toku', 'zakończona bez uchwalenia', 'uchwalona', 'uchwalona, nieopublikowana', 'opublikowana'] as const;
/** Stany, które wymagają etapów: tylko dla uchwalonych, nieopublikowanych ustaw. */
const STANY_Z_ETAPOW = ['w Senacie', 'u Prezydenta', 'podpisana, nieopublikowana', 'zawetowana', 'skierowana do TK'] as const;
type StanFiltra = (typeof STANY_Z_LISTY)[number] | (typeof STANY_Z_ETAPOW)[number];
const zEtapow = (s: StanFiltra | undefined): s is (typeof STANY_Z_ETAPOW)[number] => (STANY_Z_ETAPOW as readonly string[]).includes(s ?? '');

const opublikowana = (p: ProcesZRejestru) => Boolean(p.displayAddress || p.ELI);
/** Uchwalona ustawa bez publikacji: Senat, Prezydent, weto albo Trybunał. Tylko tu lista nie wystarcza. */
const czekaPoSejmie = (p: ProcesZRejestru) => Boolean(p.passed) && !opublikowana(p) && jestUstawa(p);

function stanZListy(p: ProcesZRejestru, s: (typeof STANY_Z_LISTY)[number]): boolean {
  switch (s) {
    case 'w toku':
      return !p.passed && !p.closureDate;
    case 'zakończona bez uchwalenia':
      return !p.passed && Boolean(p.closureDate);
    case 'uchwalona':
      return Boolean(p.passed);
    case 'uchwalona, nieopublikowana':
      return Boolean(p.passed) && !opublikowana(p);
    case 'opublikowana':
      return opublikowana(p);
  }
}

const ETAPY_PREZYDENTA = ['ToPresident', 'PresidentSignature', 'PresidentToTribunal', 'Veto'];

/** Czy proces z etapami jest w danym stanie; z datą etapu, który o tym stanowi. */
function stanZEtapowFiltra(p: ProcesZRejestru, s: (typeof STANY_Z_ETAPOW)[number]): { tak: boolean; data: string | null } {
  const plaskie = splaszcz(p.stages);
  const ost = (p.stages ?? []).filter((e) => e.stageType !== 'End').at(-1);
  const ostatni = (f: (e: EtapZRejestru) => boolean) => [...plaskie].reverse().find(f);
  switch (s) {
    case 'skierowana do TK': {
      const e = ostatni(jestTrybunal);
      return { tak: Boolean(e), data: e?.date ?? null };
    }
    case 'zawetowana': {
      const e = ostatni(jestWeto);
      return { tak: Boolean(e), data: e?.date ?? null };
    }
    case 'u Prezydenta':
      return { tak: ost?.stageType === 'ToPresident', data: ost?.date ?? null };
    case 'podpisana, nieopublikowana':
      return { tak: ost?.stageType === 'PresidentSignature', data: ost?.date ?? null };
    case 'w Senacie':
      // Po Sejmie, a przed Prezydentem: Senat albo Sejm nad stanowiskiem Senatu.
      return { tak: !plaskie.some((e) => ETAPY_PREZYDENTA.includes(e.stageType ?? '') || jestWeto(e) || jestTrybunal(e)), data: ost?.date ?? null };
  }
}

/**
 * Szczegóły procesów w pamięci procesu serwera. Stan „skierowana do TK” czy „zawetowana” jest
 * tylko w etapach, a te tylko w szczegółach, po jednym zapytaniu na proces (ok. 100 uchwalonych,
 * nieopublikowanych ustaw w kadencji). Klucz z datą zmiany: zmieniony proces pobieramy od nowa;
 * rejestr bywa uzupełniany bez tej daty, stąd także limit czasu życia.
 */
const PAMIEC_PROCESOW_MS = 10 * 60_000;
const pamiecProcesow = new Map<string, { czas: number; proces: ProcesZRejestru }>();
/** Ile procesów najwyżej doczytujemy w jednym wywołaniu. */
const MAX_SZCZEGOLOW = 200;
/**
 * Ile najwyżej trwa całe wywołanie z doczytywaniem etapów, licząc od jego początku. Klient MCP
 * przerywa po ok. 60 s, a 104 procesy szły 59 s (09-b); po tym czasie oddajemy wynik częściowy,
 * a następne wywołanie bierze sprawdzone już procesy z pamięci i dokańcza resztę.
 */
const BUDZET_SZCZEGOLOW_MS = 18_000;
/** Zapas dla zapytania, które wystartowało tuż przed końcem budżetu. */
const ZAPAS_ZAPYTANIA_MS = 3_000;
const NARAZ_SZCZEGOLOW = 4;

function zapamietajProces(k: string, proces: ProcesZRejestru) {
  const teraz = Date.now();
  if (pamiecProcesow.size > 2 * MAX_SZCZEGOLOW) {
    for (const [kk, w] of pamiecProcesow) if (teraz - w.czas >= PAMIEC_PROCESOW_MS) pamiecProcesow.delete(kk);
  }
  pamiecProcesow.set(k, { czas: teraz, proces });
}

async function szczegolyProcesow(zrodlo: ZrodloSejmu, sciezka: string, lista: ProcesZRejestru[], koniec: number) {
  const mapa = new Map<string, ProcesZRejestru>();
  const bledy: string[] = [];
  const niezdazono: string[] = [];
  const doPobrania: ProcesZRejestru[] = [];
  const kluczProcesu = (p: ProcesZRejestru) => `${sciezka}/${p.number}@${p.changeDate ?? ''}`;
  for (const p of lista) {
    const w = pamiecProcesow.get(kluczProcesu(p));
    if (w && Date.now() - w.czas < PAMIEC_PROCESOW_MS) mapa.set(p.number, w.proces);
    else doPobrania.push(p);
  }
  // Czterech pracowników biorących kolejny proces, gdy skończą poprzedni: porcje po cztery
  // czekały na najwolniejsze zapytanie w porcji (od 0,5 do 4 s).
  let i = 0;
  const pracownik = async () => {
    while (i < doPobrania.length && Date.now() < koniec) {
      const p = doPobrania[i++];
      try {
        const pelny = jakoRekord<ProcesZRejestru>(
          await zrodlo.json<unknown>(`${sciezka}/${p.number}`, { termin: koniec + ZAPAS_ZAPYTANIA_MS }),
          'proces',
          [],
          ['number'],
        );
        if (!pelny) {
          bledy.push(p.number);
          continue;
        }
        mapa.set(p.number, pelny);
        zapamietajProces(kluczProcesu(p), pelny);
      } catch {
        // Szczegóły są dodatkiem: bez nich zostaje przybliżony stan z listy, a brak liczymy.
        (Date.now() >= koniec ? niezdazono : bledy).push(p.number);
      }
    }
  };
  await Promise.all(Array.from({ length: NARAZ_SZCZEGOLOW }, pracownik));
  niezdazono.push(...doPobrania.slice(i).map((p) => p.number));
  return { mapa, bledy, niezdazono, brak: [...bledy, ...niezdazono] };
}

const numerJakoLiczba = (n: string) => Number.parseInt(n, 10) || 0;

type WedlugDaty = 'dowolnej' | 'wszczecia' | 'zmiany' | 'zamkniecia';
/** Daty procesu z listy, po których da się filtrować, z nazwą do odpowiedzi. */
function datyProcesu(p: ProcesZRejestru, wedlug: WedlugDaty): Array<[string, string]> {
  const wszystkie: Array<[WedlugDaty, string, string | undefined]> = [
    ['wszczecia', 'wszczęcia', p.processStartDate ?? p.documentDate],
    ['zamkniecia', 'zamknięcia w Sejmie', p.closureDate],
    ['zmiany', 'ostatniej zmiany w rejestrze', p.changeDate],
  ];
  return wszystkie
    .filter(([k, , d]) => d && (wedlug === 'dowolnej' || wedlug === k))
    .map(([, nazwa, d]) => [nazwa, d!.slice(0, 10)] as [string, string]);
}
const OPIS_DATY: Record<WedlugDaty, string> = {
  dowolnej: 'którejkolwiek z dat: wszczęcia, zamknięcia w Sejmie albo ostatniej zmiany w rejestrze',
  wszczecia: 'daty wszczęcia procesu',
  zmiany: 'daty ostatniej zmiany w rejestrze',
  zamkniecia: 'daty zamknięcia w Sejmie (procesy bez niej odpadają)',
};

export const szukajProcesow = narzedzie({
  nazwa: 'szukaj_procesow',
  tytul: 'Szukaj procesów legislacyjnych',
  opis:
    'Wyszukuje procesy legislacyjne (projekty ustaw i uchwał) po frazie w tytule ALBO w opisie projektu, rodzaju dokumentu, stanie i dacie. ' +
    'Fraza może być potoczna („składka zdrowotna przedsiębiorcy”, „depenalizacja aborcji”): tytuły nowelizacji są jednakowe, temat jest w opisie; ' +
    'pole trafienie mówi, gdzie ją znaleziono, a opis przy wyniku odróżnia projekty o tym samym tytule. Pytasz o ustawę? Dodaj rodzajDokumentu="projekt ustawy". ' +
    'Parametr stan liczy procesy w danym stanie w całej kadencji (np. "skierowana do TK", "zawetowana", "u Prezydenta", "opublikowana", "w toku"): ' +
    'tego wymagają pytania „ile ustaw…”. Daty od/do (włącznie) domyślnie łapią proces, którego KTÓRAKOLWIEK data leży w zakresie: wszczęcie, ' +
    'zamknięcie w Sejmie albo ostatnia zmiana w rejestrze (ustawa wszczęta w 2024, a uchwalona w 2025, jest w 2025); wedlugDaty zawęża do jednej. ' +
    'Wynik mieści się w ok. 20 tys. znaków; resztę daje przesuniecie=nastepnePrzesuniecie. Głosowanie końcowe i etapy daje narzędzie proces.' + OPIS_CZESCIOWY,
  wejscie: z.object({
    fraza: z.string().min(2).max(200).optional().describe('Słowa z tytułu albo z opisu projektu, bez względu na polskie znaki'),
    rodzajDokumentu: z.string().max(80).optional().describe('Np. "projekt ustawy", "projekt uchwały"'),
    uchwalone: z.boolean().optional().describe('true: tylko uchwalone przez Sejm, false: tylko nieuchwalone'),
    stan: z
      .enum([...STANY_Z_LISTY, ...STANY_Z_ETAPOW])
      .optional()
      .describe(
        'Stan procesu: "w toku" (w Sejmie, bez decyzji), "zakończona bez uchwalenia", "uchwalona", "uchwalona, nieopublikowana", "opublikowana", ' +
          'a z etapów uchwalonych, nieopublikowanych ustaw: "w Senacie", "u Prezydenta", "podpisana, nieopublikowana", "zawetowana", "skierowana do TK"',
      ),
    od: data.optional().describe('Od dnia (włącznie); której daty dotyczy, mówi wedlugDaty'),
    do: data.optional().describe('Do dnia (włącznie)'),
    wedlugDaty: z
      .enum(['dowolnej', 'wszczecia', 'zmiany', 'zamkniecia'])
      .default('dowolnej')
      .describe(
        'Po której dacie filtrować od/do: którejkolwiek (domyślnie: wszczęcia, zamknięcia w Sejmie albo ostatniej zmiany), tylko wszczęcia, ' +
          'tylko ostatniej zmiany w rejestrze albo tylko zamknięcia w Sejmie',
      ),
    limit: limit(20, 100),
    przesuniecie,
    kadencja,
  }),
  async wykonaj(a, zrodlo): Promise<Wynik> {
    sprawdzPrzedzial(a.od, a.do);
    const start = Date.now();
    const koniecSzczegolow = start + BUDZET_SZCZEGOLOW_MS;
    const sciezka = `${T(a.kadencja)}/processes`;
    const uwagi: string[] = [UWAGA_STAN];

    // Bez frazy, stanu i dat wystarcza strona z API. Z nimi bierzemy cały rejestr kadencji
    // (ok. 1700 procesów, jedno zapytanie) i filtrujemy u siebie: API szuka tylko w tytule
    // i nie zna ani opisu, ani stanu, ani dat.
    const lokalnie = Boolean(a.fraza || a.stan || a.od || a.do);
    let parametry: Record<string, string | number | undefined>;
    let pasujace: ProcesZRejestru[];
    let razem: number | null;
    let trafienia = new Map<ProcesZRejestru, Trafienie>();
    let czesciowe = false;
    let niepelnyStan: string | null = null;
    let wynikCzesciowy: WynikCzesciowy | undefined;
    const dataStanu = new Map<string, string | null>();
    const wZakresie = new Map<string, string>();
    const szczegoly = new Map<string, ProcesZRejestru>();
    const zrodlaSzczegolow: string[] = [];
    const zDatami = Boolean(a.od || a.do);

    if (!lokalnie) {
      parametry = {
        documentType: a.rodzajDokumentu,
        passed: a.uchwalone === undefined ? undefined : String(a.uchwalone),
        sort_by: '-number',
        limit: a.limit,
        offset: a.przesuniecie,
      };
      const odp = await zrodlo.lista<unknown>(sciezka, { parametry });
      pasujace = jakoLista<ProcesZRejestru>(odp.dane, 'procesy');
      razem = odp.razem;
      if (razem === 0) uwagi.unshift('Zero trafień.');
    } else {
      parametry = { limit: 5000, offset: 0 };
      const odp = await zrodlo.lista<unknown>(sciezka, { parametry, limitCzasu: 60_000 });
      const rodzaj = a.rodzajDokumentu ? klucz(a.rodzajDokumentu) : null;
      const wDatach = (p: ProcesZRejestru) => {
        if (!zDatami) return true;
        const daty = datyProcesu(p, a.wedlugDaty);
        // Proces bez żadnej z dat odpada tylko przy „do”; tak było przy samej dacie wszczęcia.
        if (daty.length === 0) return !a.do;
        const trafione = daty.filter(([, d]) => (!a.od || d >= a.od) && (!a.do || d <= a.do));
        if (trafione.length && a.wedlugDaty === 'dowolnej') wZakresie.set(p.number, trafione.map(([n, d]) => `${n} ${d}`).join(', '));
        return trafione.length > 0;
      };
      let pula = jakoLista<ProcesZRejestru>(odp.dane, 'procesy').filter(
        (p) => (!rodzaj || klucz(p.documentType).includes(rodzaj)) && (a.uchwalone === undefined || Boolean(p.passed) === a.uchwalone) && wDatach(p),
      );
      if (zDatami) {
        uwagi.push(
          `Filtr dat według ${OPIS_DATY[a.wedlugDaty]}, oba dni włącznie (${a.od ?? 'początek'} – ${a.do ?? 'dziś'}). To nie jest data uchwalenia ani publikacji` +
            (a.wedlugDaty === 'dowolnej'
              ? '; pole dataWZakresie mówi, która data procesu wpadła w zakres. Ostatnia zmiana w rejestrze bywa zbiorczą aktualizacją, nie etapem: rok uchwalenia sprawdź w glosowanieKoncowe (narzędzie proces).'
              : '.'),
        );
      }
      if (a.fraza) {
        const wynik = szukajZeSkrotami(pula, a.fraza, (p) => `${p.title ?? ''} ${p.titleFinal ?? ''}`, (p) => p.description ?? '');
        trafienia = wynik.trafienia;
        czesciowe = wynik.czesciowe;
        pula = pula.filter((p) => trafienia.has(p));
        uwagi.push(...wynik.uwagi);
      }

      if (a.stan && !zEtapow(a.stan)) {
        const s = a.stan;
        pula = pula.filter((p) => stanZListy(p, s));
      } else if (a.stan && zEtapow(a.stan)) {
        const s = a.stan;
        const kandydaci = pula.filter(czekaPoSejmie).sort((x, y) => numerJakoLiczba(y.number) - numerJakoLiczba(x.number));
        const doSprawdzenia = kandydaci.slice(0, MAX_SZCZEGOLOW);
        const { mapa, bledy, niezdazono } = await szczegolyProcesow(zrodlo, sciezka, doSprawdzenia, koniecSzczegolow);
        for (const [n, p] of mapa) szczegoly.set(n, p);
        pula = kandydaci.filter((p) => {
          const pelny = mapa.get(p.number);
          if (!pelny) return false;
          const w = stanZEtapowFiltra(pelny, s);
          if (w.tak) dataStanu.set(p.number, w.data);
          return w.tak;
        });
        const niesprawdzone = kandydaci.length - doSprawdzenia.length + bledy.length + niezdazono.length;
        uwagi.push(
          `Stan „${s}” liczony z etapów rejestru: sprawdzono etapy ${mapa.size} z ${kandydaci.length} uchwalonych, nieopublikowanych ustaw ` +
            `(po jednym zapytaniu /processes/{numer}). Ustawy już opublikowane (np. po wyroku Trybunału albo po odrzuceniu weta) nie są tu liczone, ` +
            'bo lista nie ma etapów; pole uchwalono zostaje true także po wecie.',
        );
        if (niesprawdzone > 0) {
          niepelnyStan = `sprawdzono ${mapa.size} z ${kandydaci.length} ustaw, więc to DOLNA granica`;
          wynikCzesciowy = czesciowy(
            niezdazono.length && !bledy.length
              ? 'zabrakło czasu: sprawdzenie etapów każdej ustawy wymaga osobnego zapytania do Sejmu, a jedno wywołanie ma ok. minuty'
              : niezdazono.length
                ? `zabrakło czasu, a przy ${bledy.length} ustawach Sejm odpowiedział błędem`
                : `przy ${bledy.length} ustawach Sejm odpowiedział błędem albo nie oddał etapów`,
            `nie sprawdzono ${niesprawdzone} z ${kandydaci.length} ustaw, więc liczba w stanie „${s}” to tylko DOLNA granica („co najmniej”)`,
            kandydaci.length > MAX_SZCZEGOLOW && niesprawdzone === kandydaci.length - doSprawdzenia.length
              ? 'zawęzić pytanie datami od/do albo frazą; jedno wywołanie sprawdza najwyżej ' + MAX_SZCZEGOLOW + ' ustaw'
              : 'wywołać narzędzie jeszcze raz z tymi samymi parametrami: sprawdzone etapy serwer pamięta 10 minut, więc drugie wywołanie dokończy resztę',
          );
          uwagi.unshift(
            `WYNIK CZĘŚCIOWY: nie sprawdzono ${niesprawdzone} z ${kandydaci.length} ustaw` +
              (niezdazono.length ? ` (${niezdazono.length} z braku czasu w tym wywołaniu` : ' (') +
              (bledy.length ? `${niezdazono.length ? '; ' : ''}${bledy.length} z powodu błędu Sejmu: ${bledy.slice(0, 10).join(', ')}` : '') +
              '). Wywołaj narzędzie jeszcze raz z tymi samymi parametrami: sprawdzone etapy są w pamięci serwera przez 10 minut, więc drugie wywołanie dokończy resztę. ' +
              'Nie podawaj tej liczby jako pełnej.',
          );
        }
        const pierwsze = pula.slice(0, 10).map((p) => `${sciezka}/${p.number}`);
        zrodlaSzczegolow.push(...pierwsze.map((x) => zrodlo.adres(x)));
        if (pula.length > 10) uwagi.push(`W zrodlach jest 10 z ${pula.length} adresów szczegółów; pozostałe: ${zrodlo.adres(`${sciezka}/`)}{numer}.`);
      }

      if (a.fraza) {
        const zFraza = (p: ProcesZRejestru) => trafienia.get(p)?.pelna === true && trafienia.get(p)?.miejsce !== 'opis';
        // Nowelizacje spadają niżej tylko wtedy, gdy na liście jest sama ustawa podstawowa:
        // przy pytaniu o KRS szukane są właśnie ustawy „o zmianie ustawy o KRS”.
        const jestPodstawowa = pula.some((p) => zFraza(p) && !POCHODNA.test(p.title ?? ''));
        // Projekty ustaw przed sprawozdaniami i uchwałami; w środku cała fraza w tytule, potem
        // rdzenie w tytule, potem sam opis; nowelizacje za ustawą podstawową, jeśli ta jest na liście.
        const ranga = (p: ProcesZRejestru) => {
          const t = trafienia.get(p);
          return (
            (/projekt ustawy/i.test(p.documentType ?? '') ? 0 : 8) +
            (zFraza(p) ? 0 : t?.miejsce === 'opis' ? 4 : 2) +
            (jestPodstawowa && POCHODNA.test(p.title ?? '') ? 1 : 0)
          );
        };
        pula = pula
          .map((p) => ({ p, i: -numerJakoLiczba(p.number) }))
          .sort((x, y) => ranga(x.p) - ranga(y.p) || x.i - y.i)
          .map(({ p }) => p);
        uwagi.push(
          'Z frazą najpierw idą tytuły z całą frazą, potem rdzenie i trafienia w opisie; nowelizacje („o zmianie ustawy…”) i ustawy wykonawcze dalej: to INNE ustawy niż ta, której dotyczą.',
        );
      } else {
        pula.sort((x, y) => numerJakoLiczba(y.number) - numerJakoLiczba(x.number));
      }
      razem = pula.length;
      pasujace = pula;
      if (razem === 0) {
        uwagi.unshift(
          'Zero trafień przy podanych filtrach.' + (zDatami && a.wedlugDaty !== 'dowolnej' ? ' Spróbuj bez wedlugDaty (domyślnie którakolwiek data procesu) albo szerszych dat.' : ''),
        );
      }
    }
    // Poza trybem lokalnym API oddało już tylko żądaną stronę.
    const zadane = lokalnie ? pasujace.slice(a.przesuniecie, a.przesuniecie + a.limit) : pasujace;

    // Lista nie ma etapów, a „uchwalona, nieopublikowana” to zarówno ustawa w Senacie, jak
    // i zawetowana albo leżąca u Prezydenta. Dla kilku pierwszych takich wyników dociągamy
    // szczegóły, żeby weto i Trybunał było widać już na liście.
    const doSzczegolow = zadane.filter((p) => czekaPoSejmie(p) && !szczegoly.has(p.number)).slice(0, SZCZEGOLY);
    if (doSzczegolow.length) {
      const { mapa } = await szczegolyProcesow(zrodlo, sciezka, doSzczegolow, Math.max(koniecSzczegolow, Date.now() + 3_000));
      for (const [n, p] of mapa) {
        szczegoly.set(n, p);
        zrodlaSzczegolow.push(zrodlo.adres(`${sciezka}/${n}`));
      }
    }
    const bezEtapow = zadane.filter((p) => czekaPoSejmie(p) && !szczegoly.has(p.number)).length;
    if (bezEtapow > 0) {
      uwagi.push(`Przy ${bezEtapow} uchwalonych, nieopublikowanych ustawach stan jest przybliżony (lista nie ma etapów): weto, Senat i Trybunał sprawdź narzędziem proces.`);
    }
    if (!a.stan) {
      uwagi.push(
        'Na pytanie zbiorcze („ile ustaw zawetowano / skierowano do Trybunału / leży u Prezydenta”) ta lista bez parametru stan NIE odpowiada: ' +
          'stan z etapów jest tylko przy kilku wynikach. Użyj parametru stan; kilka otwartych procesów to nie odpowiedź o całą kadencję.',
      );
    }

    const skrot = (p: ProcesZRejestru) => {
      const t = trafienia.get(p);
      return {
        ...skrotProcesu(szczegoly.get(p.number) ?? p),
        ...(t ? { trafienie: t.miejsce } : {}),
        ...(t?.czesciowe ? { dopasowanie: 'bez jednego słowa frazy' } : {}),
        ...(wZakresie.has(p.number) ? { dataWZakresie: wZakresie.get(p.number) } : {}),
        ...(dataStanu.has(p.number) ? { dataStanu: dataStanu.get(p.number) } : {}),
      };
    };
    const filtry = [
      a.rodzajDokumentu ? `rodzaj „${a.rodzajDokumentu}”` : '',
      a.fraza ? `fraza „${a.fraza}”` : '',
      zDatami ? `daty ${a.od ?? 'początek'} – ${a.do ?? 'dziś'} według ${OPIS_DATY[a.wedlugDaty]}` : '',
    ].filter(Boolean);
    let odpowiedz: string | undefined;
    if (a.stan) {
      const lista =
        dataStanu.size > 0 && (razem ?? 0) <= 20
          ? `: ${[...dataStanu.entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1]))).map(([n, d]) => `${n}${d ? ` (${d})` : ''}`).join(', ')}`
          : '';
      odpowiedz =
        `Rejestr procesów kadencji ${a.kadencja}: ${niepelnyStan ? (razem ? 'co najmniej ' : 'wśród sprawdzonych ') : ''}${razem} w stanie „${a.stan}”${filtry.length ? ` (${filtry.join(', ')})` : ''}${lista}` +
        `${niepelnyStan ? `; wynik częściowy: ${niepelnyStan}` : ''}.`;
    } else if (lokalnie) {
      odpowiedz =
        `Rejestr procesów kadencji ${a.kadencja}: ${odmiana(razem ?? 0, ['proces', 'procesy', 'procesów'])} (${filtry.join(', ')})` +
        (czesciowe ? '; żaden nie ma wszystkich słów frazy, pokazane mają wszystkie poza jednym, więc mogą dotyczyć innej sprawy' : '') +
        '.';
    }
    const uwagiKoncowe = [...uwagi, ...uwagiStanu(zadane.map((p) => skrot(p).stan))];
    return wPorcji(zadane, a.przesuniecie, razem, (porcja) => ({
      ...(odpowiedz ? { odpowiedz } : {}),
      ...(wynikCzesciowy ? { wynikCzesciowy } : {}),
      razem,
      procesy: porcja.map(skrot),
      zrodla: [zrodlo.adres(sciezka, parametry), ...zrodlaSzczegolow],
      uwagi: uwagiKoncowe,
    }), 'procesy');
  },
});

/**
 * Porcja listy przycięta do ok. 20 tys. znaków całego wyniku (klient MCP dłuższy wynik zapisuje
 * do pliku, którego model nie widzi). Gdy przycięto albo są dalsze pozycje, pokazano i
 * nastepnePrzesuniecie mówią wprost, skąd wziąć resztę.
 */
function wPorcji<X>(zadane: X[], przesuniecie: number, razem: number | null, zloz: (porcja: X[]) => Wynik, co: string): Wynik {
  const pelny = (porcja: X[]): Wynik => {
    const w = zloz(porcja);
    const koniec = przesuniecie + porcja.length;
    const dalej = razem !== null && koniec < razem ? koniec : null;
    const przycieto = porcja.length < zadane.length;
    const zakres = porcja.length ? `${przesuniecie + 1}–${koniec}` : 'żadne';
    return {
      ...w,
      ...(dalej !== null || przesuniecie > 0 ? { pokazano: `${co} ${zakres} z ${razem ?? '?'}` } : {}),
      nastepnePrzesuniecie: dalej,
      uwagi: [
        ...(przycieto
          ? [
              `Porcję skrócono z ${zadane.length} do ${porcja.length} pozycji, żeby wynik zmieścił się w ok. ${MAKS_ZNAKOW / 1000} tys. znaków: pokazano ${zakres} z ${razem}. ` +
                `Następna porcja: przesuniecie=${dalej}. Ustaw przesuniecie DOKŁADNIE na nastepnePrzesuniecie, nie na przesuniecie+limit, bo pominiesz pozycje.`,
            ]
          : dalej !== null
            ? [`Pokazano ${zakres} z ${razem}; następna porcja: przesuniecie=${dalej}.`]
            : []),
        ...(w.uwagi ?? []),
      ],
    };
  };
  const n = porcjaWRozmiarze(zadane, pelny);
  return pelny(zadane.slice(0, n));
}

/** Autopoprawki i inne dokumenty procesu po polsku. */
const inneDokumenty = (lista: DokumentInny[] | undefined) =>
  (lista ?? []).map((d) => ({
    druk: d.number ?? null,
    tytul: czysty(d.title),
    dataDokumentu: d.documentDate ?? null,
    zarejestrowano: d.registeredDate ?? null,
    autopoprawka: /autopoprawk/i.test(d.title ?? ''),
  }));

/** Drzewo etapów → płaska lista w kolejności rejestru, z werdyktem głosowania przy etapie. */
function etapy(lista: EtapZRejestru[] | undefined, poziom = 0): unknown[] {
  const wynik: unknown[] = [];
  for (const e of lista ?? []) {
    wynik.push({
      poziom,
      data: e.date ?? null,
      etap: czysty(e.stageName),
      druk: e.printNumber ?? null,
      komisja: e.committeeCode ?? null,
      decyzja: czysty(e.decision),
      posiedzenie: e.sittingNum ?? null,
      // Stanowisko Senatu i wniosek komisji: bez nich „czy Senat wniósł poprawki” i „co komisja
      // wnosi” nie miały odpowiedzi, choć rejestr ją ma.
      ...(e.position ? { stanowiskoSenatu: czysty(e.position) } : {}),
      ...(e.proposal ? { wniosekKomisji: czysty(e.proposal) } : {}),
      ...(e.minorityMotions != null ? { wnioskiMniejszosci: e.minorityMotions } : {}),
      ...(e.comment ? { zgloszoneWnioski: czysty(e.comment) } : {}),
      ...(e.otherDocuments?.length ? { inneDokumenty: inneDokumenty(e.otherDocuments) } : {}),
      sprawozdawca: e.rapporteurName
        ? { id: e.rapporteurID != null ? Number(e.rapporteurID) : null, imieNazwisko: czysty(e.rapporteurName) }
        : undefined,
      glosowanie: e.voting
        ? {
            posiedzenie: e.voting.sitting,
            numer: e.voting.votingNumber,
            // Bez tematu „Odrzucono” przy pierwszym czytaniu czyta się jak odrzucenie ustawy,
            // a zwykle to odrzucony wniosek o odrzucenie projektu.
            temat: czysty(e.voting.topic),
            opis: czysty(e.voting.description),
            wynik: rozstrzygniecieWeta(e.voting)
              ? wynikGlosowania(e.voting).przeszlo
                ? 'Uchwalono ponownie: weto odrzucone'
                : 'Nie uchwalono ponownie: weto utrzymane'
              : wynikGlosowania(e.voting).etykieta,
            wiekszosc: wynikGlosowania(e.voting).wiekszosc,
            progZa: wynikGlosowania(e.voting).prog,
            ...(rozstrzygniecieWeta(e.voting) ? { rozstrzygniecie: rozstrzygniecieWeta(e.voting) } : {}),
            za: e.voting.yes,
            przeciw: e.voting.no,
            wstrzymalo: e.voting.abstain,
          }
        : undefined,
    });
    wynik.push(...etapy(e.children, poziom + 1));
  }
  return wynik;
}

export const proces = narzedzie({
  nazwa: 'proces',
  tytul: 'Proces legislacyjny: etapy',
  opis:
    'Jeden proces legislacyjny z pełną listą etapów w kolejności rejestru: skierowania, czytania, sprawozdania komisji (wniosekKomisji, wnioskiMniejszosci), ' +
    'głosowania z wynikiem, stanowisko Senatu (czy wniósł poprawki), autopoprawki (inneDokumenty), a po Sejmie etapy Prezydenta: podpis, weto, ' +
    'skierowanie do Trybunału Konstytucyjnego (pola podpisPrezydenta, weto, trybunal i etapy). Pole glosowanieKoncowe to głosowanie nad całością projektu ' +
    '(posiedzenie, numer): podaj je do narzędzia glosowanie z poselId, żeby sprawdzić głos posła. Pole eli (np. DU/2026/62) to adres opublikowanego aktu ' +
    'dla narzędzia akt (czy obowiązuje, od kiedy); dataOgloszenia to dzień ogłoszenia w dzienniku. Numer procesu to zwykle numer druku, który go rozpoczął.',
  wejscie: z.object({
    numer: z.string().regex(/^[0-9A-Za-z-]{1,20}$/).describe('Numer procesu, np. "1" albo "125"'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const sciezka = `${T(a.kadencja)}/processes/${a.numer}`;
    const p = jakoRekord<ProcesZRejestru>(await zrodlo.json<unknown>(sciezka), 'proces', [], ['number']);
    if (!p) return { ...brak404('Rejestr nie zna takiego procesu.'), zrodla: [zrodlo.adres(sciezka)] };
    const koncowe = glosowanieKoncowe(p.stages);
    const plaskie = splaszcz(p.stages);
    const zrodla = [zrodlo.adres(sciezka)];
    const uwagiDodatkowe: string[] = [];

    // Datę ogłoszenia zna tylko ELI; rejestr procesów podaje sam adres w dzienniku.
    let akt: AktEli | null = null;
    let czesciowyEli: WynikCzesciowy | undefined;
    const eli = p.ELI && /^(DU|MP)\/\d{4}\/\d{1,6}$/.test(p.ELI) ? p.ELI : null;
    if (eli) {
      const sciezkaEli = `eli/acts/${eli}`;
      try {
        akt = await zrodlo.json<AktEli>(sciezkaEli);
        zrodla.push(zrodlo.adres(sciezkaEli));
      } catch (e) {
        uwagiDodatkowe.push('Nie udało się pobrać daty ogłoszenia z ELI; sprawdź narzędziem akt.');
        czesciowyEli = czesciowyZBledu(e, 'daty ogłoszenia ustawy w Dzienniku Ustaw i jej stanu w bazie aktów prawnych (ELI)', `sprawdzić narzędziem akt z adresem ${eli} albo zapytać ponownie za kilka minut`);
      }
    }

    const senat = [...plaskie].reverse().find((e) => e.stageType === 'SenatePosition');
    const podpis = [...plaskie].reverse().find((e) => e.stageType === 'PresidentSignature');
    const weto = [...plaskie].reverse().find(jestWeto);
    const trybunal = [...plaskie].reverse().find(jestTrybunal);
    const dokumenty = inneDokumenty(p.otherDocuments);
    // Bez tego pola „zakończona bez uchwalenia” przy wniosku o uchylenie immunitetu czytało się
    // jak „immunitet nie został uchylony”, choć poseł sam się go zrzekł (19-b, 16825-z).
    const uwagaSejmu = czysty(p.comments) || null;
    const stan = stanProcesu(p);
    return {
      znaleziono: true,
      ...(czesciowyEli ? { wynikCzesciowy: czesciowyEli } : {}),
      odpowiedz:
        `Proces ${p.number} („${czysty(p.titleFinal) || czysty(p.title)}”): ${stan}` +
        (koncowe
          ? `. Głosowanie końcowe w Sejmie ${koncowe.posiedzenie}/${koncowe.numer} (${String(koncowe.data ?? '').slice(0, 10)}): ` +
            `za ${koncowe.za}, przeciw ${koncowe.przeciw}, wstrzymało się ${koncowe.wstrzymalo}; ${koncowe.wynik}.`
          : '. Brak głosowania nad całością w etapach.') +
        (senat ? ` Senat${kiedy(senat.date)}: ${czysty(senat.position) || 'stanowisko bez opisu w rejestrze'}.` : '') +
        (akt?.promulgation ? ` Ogłoszona ${akt.promulgation}${akt.entryIntoForce ? `, wchodzi w życie ${akt.entryIntoForce}` : ''}.` : '') +
        (uwagaSejmu ? ` Uwaga Sejmu w rejestrze: „${uwagaSejmu}”.` : ''),
      ...skrotProcesu(p),
      // Pełny opis: przy jednakowych tytułach nowelizacji tylko on mówi, czego projekt dotyczy.
      opis: czysty(p.description) || null,
      uwagaSejmu,
      tytulKoncowy: czysty(p.titleFinal),
      zamknietoWSejmie: p.closureDate ?? null,
      tryb: p.urgencyStatus ? (TRYB[p.urgencyStatus] ?? p.urgencyStatus) : null,
      glosowanieKoncowe: glosowanieKoncowe(p.stages),
      drukiRozpatrywaneLacznie: p.printsConsideredJointly ?? [],
      eli: p.ELI ?? null,
      adresEli: eli ? zrodlo.adres(`eli/acts/${eli}`) : null,
      dataOgloszenia: akt?.promulgation ?? null,
      wejscieWZycie: akt?.entryIntoForce ?? null,
      stanowiskoSenatu: senat ? { data: senat.date ?? null, stanowisko: czysty(senat.position) || null, druk: senat.printNumber ?? null } : null,
      podpisPrezydenta: podpis?.date ?? null,
      weto: weto ? { data: weto.date ?? null, druk: weto.printNumber ?? null } : null,
      trybunal: trybunal?.date ?? null,
      inneDokumenty: dokumenty,
      autopoprawki: dokumenty.filter((d) => d.autopoprawka).map((d) => d.druk),
      // Na liście procesów etapów nie ma, więc tam weta nie widać; tu jest pełny stan.
      ostatniaZmiana: p.changeDate ?? null,
      etapy: etapy(p.stages),
      linki: (p.links ?? []).map((l) => bezpiecznyLink(l.href)).filter(Boolean),
      zrodla,
      uwagi: [
        ...uwagiDodatkowe,
        UWAGA_STAN,
        UWAGA_DATA,
        ...uwagiStanu([stan]),
        ...(uwagaSejmu
          ? ['Pole uwagaSejmu to adnotacja Sejmu do procesu (np. oświadczenie posła o zrzeczeniu się immunitetu, dodatkowy przedstawiciel wnioskodawców); uwzględnij ją, zanim wyciągniesz wniosek z samego stanu.']
          : []),
        ...(stan.startsWith('w toku')
          ? ['Czy sprawa jest w porządku najbliższego posiedzenia, sprawdzisz narzędziem porzadek_posiedzenia.']
          : []),
        'Przy głosowaniu w etapie czytaj temat: „Odrzucono” przy wniosku o odrzucenie projektu znaczy, że projekt idzie dalej. ' +
          'Próg większości bierz z pola progZa, nie licz go sam; przy głosowaniu nad wetem pole rozstrzygniecie mówi, czy weto utrzymano.',
        'Rejestr bywa uzupełniany o nowe etapy bez zmiany daty ostatniej modyfikacji procesu.',
        'Rejestr Sejmu zna stanowisko Senatu (czy wniósł poprawki), ale nie wyniki głosowań w Senacie.',
      ],
    };
  },
});

/** Pliki druku jako adresy do pokazania (nazwa pliku zakodowana, więc nie przez `zlozAdres`). */
const plikiDruku = (zrodlo: ZrodloSejmu, kadencja: number, d: DrukZRejestru) =>
  (d.attachments ?? []).map((plik) => new URL(encodeURIComponent(plik), `${zrodlo.adres(`${T(kadencja)}/prints/${d.number}`)}/`).href);

/**
 * Druki dodatkowe („Do druku nr 2874 - ocena skutków regulacji”, 2874-001) siedzą tylko w
 * `additionalPrints` druku głównego, także zagnieżdżone; na liście rejestru nie mają własnej pozycji.
 */
function dodatkowe(d: DrukZRejestru, rodzic = d.number): Array<{ druk: DrukZRejestru; rodzic: string }> {
  // Wpis o numerze druku głównego (599 w 599) to jego kolejna wersja, nie druk dodatkowy:
  // pomijamy go, ale jego dzieci (599-001) zostają.
  return (d.additionalPrints ?? []).flatMap((x) => [...(x.number === rodzic ? [] : [{ druk: x, rodzic }]), ...dodatkowe(x, rodzic)]);
}

const FORMY_DODATKOWYCH: [string, string, string] = ['druk dodatkowy', 'druki dodatkowe', 'druków dodatkowych'];

/** Najwyższy numer druku kadencji (bez liter i przyrostków), żeby odróżnić literówkę od „jeszcze nie ma”. */
function najwyzszyNumer(lista: DrukZRejestru[]): number | null {
  const numery = lista.map((d) => Number.parseInt(d.number, 10)).filter((n) => Number.isFinite(n));
  return numery.length ? Math.max(...numery) : null;
}

export const druk = narzedzie({
  nazwa: 'druk',
  tytul: 'Druk sejmowy',
  opis:
    'Jeden druk sejmowy: tytuł, daty, powiązane procesy, adresy plików (PDF, DOCX) i druki dodatkowe ' +
    '(drukiDodatkowe, np. 2874-001 „ocena skutków regulacji”, opinie) z datami doręczenia i plikami. ' +
    'Daty: dataDokumentu to dzień sporządzenia dokumentu przez autora (NIE dzień wpływu do Sejmu); doreczono to dzień doręczenia druku posłom. ' +
    'Na pytanie „kiedy wpłynął do Sejmu” nie podawaj dataDokumentu: rejestr zapisuje wpływ jako etap procesu „Projekt wpłynął do Sejmu” (pole wszczeto w narzędziu proces), ' +
    'a przy sprawach przeniesionych z poprzedniej kadencji wpływ, sporządzenie i doręczenie potrafią dzielić lata (druk 164: dokument 24.03.2022, wpływ 25.03.2022, doręczenie 16.01.2024); ' +
    'wtedy podaj, która to data.',
  wejscie: z.object({
    numer: z.string().regex(/^[0-9A-Za-z-]{1,20}$/).describe('Numer druku, np. "1", "1234-A" albo "2874-001"'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const sciezka = `${T(a.kadencja)}/prints/${a.numer}`;
    const d = jakoRekord<DrukZRejestru>(await zrodlo.json<unknown>(sciezka), 'druk', [], ['number']);
    if (!d) {
      // Przy braku druku podajemy najwyższy numer, żeby model odróżnił literówkę od druku, którego jeszcze nie ma.
      const sciezkaListy = `${T(a.kadencja)}/prints`;
      let najwyzszy: number | null = null;
      let bladListy: unknown = null;
      try {
        najwyzszy = najwyzszyNumer(jakoLista<DrukZRejestru>(await zrodlo.json<unknown>(sciezkaListy, { limitCzasu: 60_000 }), 'druki'));
      } catch (e) {
        // Lista jest tylko podpowiedzią; bez niej zostaje sam brak druku, ale mówimy, że podpowiedzi brak.
        bladListy = e;
      }
      return {
        ...brak404(`Rejestr nie zna druku ${a.numer} w kadencji ${a.kadencja}`),
        ...(bladListy
          ? { wynikCzesciowy: czesciowyZBledu(bladListy, 'najwyższego numeru druku w kadencji (podpowiedź, czy numer to literówka, czy druk, którego jeszcze nie ma)') }
          : {}),
        najwyzszyNumer: najwyzszy,
        zrodla: [zrodlo.adres(sciezka), ...(najwyzszy !== null ? [zrodlo.adres(sciezkaListy)] : [])],
        uwagi: [
          'Rejestr nie zna takiego druku.',
          ...(najwyzszy !== null ? [`Najwyższy numer druku w rejestrze kadencji ${a.kadencja}: ${najwyzszy}.`] : []),
        ],
      };
    }
    const doda = dodatkowe(d).map(({ druk: x }) => ({
      numer: x.number,
      tytul: czysty(x.title),
      dataDokumentu: x.documentDate ?? null,
      doreczono: x.deliveryDate ?? null,
      pliki: plikiDruku(zrodlo, a.kadencja, x),
    }));
    return {
      znaleziono: true,
      numer: d.number,
      tytul: czysty(d.title),
      dataDokumentu: d.documentDate ?? null,
      doreczono: d.deliveryDate ?? null,
      procesy: d.processPrint ?? [],
      pliki: plikiDruku(zrodlo, a.kadencja, d),
      drukiDodatkowe: doda,
      zrodla: [zrodlo.adres(sciezka)],
      uwagi: [
        'Treść druku (tekst strona po stronie, ze spisem artykułów) daje narzędzie tekst_druku z numerem druku i ewentualnie nazwą pliku.',
        'dataDokumentu to data sporządzenia dokumentu przez autora, nie data wpływu do Sejmu; doreczono to data doręczenia druku posłom. ' +
          'Datę wpływu do Sejmu (etap „Projekt wpłynął do Sejmu”) daje narzędzie proces w polu wszczeto.',
        ...(d.documentDate && d.deliveryDate && roznicaDni(d.documentDate, d.deliveryDate) > 30
          ? [
              `Uwaga: dokument sporządzono ${d.documentDate}, a posłom doręczono go dopiero ${d.deliveryDate} (${roznicaDni(d.documentDate, d.deliveryDate)} dni później). ` +
                'Pytany o datę, powiedz, której dotyczy odpowiedź; przy sprawie z poprzedniej kadencji wpływ do Sejmu (proces, wszczeto) bywa jeszcze inną datą.',
            ]
          : []),
        ...(doda.length
          ? [`Druk ma ${odmiana(doda.length, FORMY_DODATKOWYCH)} (drukiDodatkowe, np. ocena skutków regulacji albo opinie), każdy z własną datą doręczenia i plikami.`]
          : ['Rejestr nie ma druków dodatkowych do tego druku (np. oceny skutków regulacji jako osobnego druku).']),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Projekty wniesione do Sejmu (bills)
// ---------------------------------------------------------------------------

interface ProjektZRejestru {
  number: string;
  title: string;
  applicantType?: string;
  submissionType?: string;
  status?: string;
  dateOfReceipt?: string;
  print?: string;
  euRelated?: boolean;
  publicConsultation?: boolean;
  publicConsultationStartDate?: string;
  publicConsultationEndDate?: string;
  consultationResults?: boolean;
  description?: string;
}

const WNIOSKODAWCA: Record<string, string> = {
  DEPUTIES: 'posłowie',
  COMMITTEE: 'komisja',
  GOVERNMENT: 'Rada Ministrów',
  PRESIDIUM: 'Prezydium Sejmu',
  PRESIDENT: 'Prezydent',
  SENATE: 'Senat',
  CITIZENS: 'obywatele',
};
/**
 * Rejestr projektów zna tylko te trzy statusy. ACTIVE znaczy „nie wycofany, nadano bieg”, NIE
 * „w toku”: część takich projektów jest dawno uchwalona i ogłoszona (etykieta „w toku” dała
 * testerom „wszystkie projekty Senatu są w toku”, choć 6 z 13 było już w Dzienniku Ustaw).
 */
const STAN_PROJEKTU: Record<string, string> = {
  ACTIVE: 'aktywny (nie wycofany)',
  WITHDRAWN: 'wycofany',
  NOT_PROCEEDED: 'nie nadano biegu',
};
const STAN_PROJEKTU_WEJSCIE: Record<string, string> = { aktywny: 'ACTIVE', wycofany: 'WITHDRAWN', 'nie nadano biegu': 'NOT_PROCEEDED' };
const RODZAJ_PROJEKTU: Record<string, string> = {
  BILL: 'projekt ustawy',
  DRAFT_RESOLUTION: 'projekt uchwały',
  BILL_AMENDMENT: 'autopoprawka do projektu ustawy',
  RESOLUTION_AMENDMENT: 'autopoprawka do projektu uchwały',
};
/** Dzień przesunięty o n dni (RRRR-MM-DD, bez stref czasowych). */
function przesunDzien(dzien: string, n: number): string {
  const t = new Date(`${dzien}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const odwroc = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

export const szukajProjektow = narzedzie({
  nazwa: 'szukaj_projektow',
  tytul: 'Projekty wniesione do Sejmu',
  opis:
    'Rejestr projektów ustaw i uchwał wniesionych do Sejmu: kto wniósł (posłowie, Rada Ministrów, Prezydent, Senat, komisja, obywatele), ' +
    'data wpływu, numer druku, opis projektu, czy był w konsultacjach publicznych. Fraza szuka w tytule ALBO w opisie (tytuły nowelizacji są jednakowe). ' +
    'Pole stan ma tylko trzy wartości rejestru: aktywny (nie wycofany), wycofany, nie nadano biegu; etap (uchwalony, opublikowany) podaje pole uchwalony/publikacja ' +
    'albo narzędzie proces po numerze druku. Daty od/do to data WPŁYWU; o datę doręczenia posłom pytaj szukaj_drukow.',
  wejscie: z.object({
    fraza: z.string().min(2).max(200).optional().describe('Słowa z tytułu albo z opisu projektu, bez względu na polskie znaki'),
    wnioskodawca: z.enum(['posłowie', 'komisja', 'Rada Ministrów', 'Prezydium Sejmu', 'Prezydent', 'Senat', 'obywatele']).optional(),
    stan: z
      .enum(['aktywny', 'wycofany', 'nie nadano biegu'])
      .optional()
      .describe('Status w rejestrze projektów: aktywny znaczy tylko „nie wycofany”, nie „w toku” (część aktywnych jest uchwalona)'),
    rodzaj: z.enum(['projekt ustawy', 'projekt uchwały']).optional(),
    konsultacjePubliczne: z.boolean().optional().describe('Tylko projekty poddane kiedykolwiek konsultacjom publicznym'),
    konsultacjeTrwaja: z.boolean().optional().describe('Tylko projekty, których konsultacje publiczne trwają dziś'),
    unijne: z.boolean().optional().describe('Tylko projekty wdrażające prawo UE'),
    od: data.optional().describe('Wpłynęły od dnia (włącznie); data wpływu, nie doręczenia'),
    do: data.optional().describe('Wpłynęły do dnia (włącznie)'),
    limit: limit(20, 100),
    przesuniecie,
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    sprawdzPrzedzial(a.od, a.do);
    const sciezka = `${T(a.kadencja)}/bills`;
    const dzis = dzisWarszawa();
    // API nie filtruje po wnioskodawcy, nie sortuje i szuka tylko w tytule: rejestr ma ok. 1300
    // pozycji, więc bierzemy całą pulę pasującą do pozostałych filtrów, a frazę (także w opisie),
    // kolejność i porcje robimy u siebie.
    const parametry = {
      status: a.stan ? STAN_PROJEKTU_WEJSCIE[a.stan] : undefined,
      submissionType: a.rodzaj ? odwroc(RODZAJ_PROJEKTU)[a.rodzaj] : undefined,
      publicConsultation: a.konsultacjePubliczne || a.konsultacjeTrwaja ? true : undefined,
      euRelated: a.unijne,
      // API Sejmu wyklucza oba brzegi zakresu (sprawdzone 2026-09-24: od 2026-08-31 do 2026-09-02
      // daje tylko 2026-09-01), więc pytamy o dzień szerzej i przycinamy włącznie u siebie.
      dateOfReceiptFrom: a.od ? przesunDzien(a.od, -1) : undefined,
      dateOfReceiptTo: a.do ? przesunDzien(a.do, 1) : undefined,
      limit: 5000,
      offset: 0,
    };
    const odp = await zrodlo.lista<unknown>(sciezka, { parametry });
    const kod = a.wnioskodawca ? odwroc(WNIOSKODAWCA)[a.wnioskodawca] : null;
    let pasujace = jakoLista<ProjektZRejestru>(odp.dane, 'projekty')
      .filter((p) => !kod || p.applicantType === kod)
      .filter((p) => (!a.od || (p.dateOfReceipt ?? '') >= a.od) && (!a.do || (p.dateOfReceipt ?? '9') <= a.do))
      .filter((p) => !a.konsultacjeTrwaja || ((p.publicConsultationStartDate ?? '9') <= dzis && dzis <= (p.publicConsultationEndDate ?? '')));
    const uwagiFrazy: string[] = [];
    let trafienia = new Map<ProjektZRejestru, Trafienie>();
    if (a.fraza) {
      const wynik = szukajZeSkrotami(pasujace, a.fraza, (p) => p.title ?? '', (p) => p.description ?? '');
      trafienia = wynik.trafienia;
      pasujace = pasujace.filter((p) => trafienia.has(p));
      uwagiFrazy.push(...wynik.uwagi);
    }
    // Trafienia w tytule przed trafieniami w samym opisie; w środku od najnowszych.
    const ranga = (p: ProjektZRejestru) => (trafienia.get(p)?.miejsce === 'opis' ? 1 : 0);
    pasujace.sort((x, y) => ranga(x) - ranga(y) || String(y.dateOfReceipt ?? '').localeCompare(String(x.dateOfReceipt ?? '')));
    const razem = pasujace.length;
    const lista = pasujace.slice(a.przesuniecie, a.przesuniecie + a.limit);
    const zadane = lista;

    // Etap z rejestru procesów: numer procesu to zwykle numer druku. Jedno zapytanie o całą listę
    // procesów, tylko gdy na stronie są projekty z drukiem.
    const sciezkaProcesow = `${T(a.kadencja)}/processes`;
    const parametryProcesow = { limit: 5000, offset: 0 };
    const procesy = new Map<string, ProcesZRejestru>();
    let procesyZrodlo = false;
    let czesciowyProcesow: WynikCzesciowy | undefined;
    if (lista.some((p) => p.print)) {
      try {
        const odpP = await zrodlo.lista<unknown>(sciezkaProcesow, { parametry: parametryProcesow, limitCzasu: 60_000 });
        for (const p of jakoLista<ProcesZRejestru>(odpP.dane, 'procesy')) procesy.set(p.number, p);
        procesyZrodlo = true;
      } catch (e) {
        // Etap jest dodatkiem: bez niego zostaje stan z rejestru projektów i odesłanie do proces, ale mówimy, czego brak.
        czesciowyProcesow = czesciowyZBledu(
          e,
          'informacji, czy projekt uchwalono i gdzie go opublikowano (pola uchwalony, publikacja, eli); lista projektów jest pełna',
          'sprawdzić konkretny projekt narzędziem proces albo zapytać ponownie za kilka minut',
        );
      }
    }
    return wPorcji(zadane, a.przesuniecie, razem, (porcja) => ({
      ...(czesciowyProcesow ? { wynikCzesciowy: czesciowyProcesow } : {}),
      razem,
      projekty: porcja.map((p) => {
        const proc = p.print ? procesy.get(p.print) : undefined;
        const t = trafienia.get(p);
        return {
          numer: p.number,
          tytul: czysty(p.title),
          rodzaj: p.submissionType ? (RODZAJ_PROJEKTU[p.submissionType] ?? p.submissionType) : null,
          wnioskodawca: p.applicantType ? (WNIOSKODAWCA[p.applicantType] ?? p.applicantType) : null,
          stan: p.status ? (STAN_PROJEKTU[p.status] ?? p.status) : null,
          ...(procesyZrodlo ? { uchwalony: proc ? Boolean(proc.passed) : null, publikacja: proc?.displayAddress ?? null, eli: proc?.ELI ?? null } : {}),
          ...(t ? { trafienie: t.miejsce } : {}),
          wplynal: p.dateOfReceipt ?? null,
          druk: p.print ?? null,
          konsultacjePubliczne: p.publicConsultation === true,
          konsultacjeOd: p.publicConsultationStartDate ?? null,
          konsultacjeDo: p.publicConsultationEndDate ?? null,
          opis: czysty(p.description) || null,
          unijny: p.euRelated === true,
        };
      }),
      zrodla: [zrodlo.adres(sciezka, parametry), ...(procesyZrodlo ? [zrodlo.adres(sciezkaProcesow, parametryProcesow)] : [])],
      uwagi: [
        ...uwagiFrazy,
        'Pole stan to status rejestru projektów: „aktywny (nie wycofany)” NIE znaczy „w toku”, część takich projektów jest uchwalona i ogłoszona. ' +
          'Etap podaje uchwalony i publikacja (z rejestru procesów, po numerze druku); pełny przebieg, weto i Trybunał: narzędzie proces z numerem druku. ' +
          'Rejestr nie podaje daty wycofania: wplynal to data wpływu.',
        ...(procesyZrodlo ? ['uchwalony: null znaczy, że rejestr procesów nie ma procesu o numerze tego druku (np. druk rozpatrywany łącznie z innym); sprawdź narzędziem proces.'] : []),
        'konsultacjePubliczne znaczy, że projekt był kiedykolwiek konsultowany; czy konsultacje trwają dziś, mówią konsultacjeOd/Do (albo parametr konsultacjeTrwaja).',
        ...(a.od || a.do
          ? [
              `Filtr po dacie WPŁYWU do Sejmu, oba dni włącznie (${a.od ?? 'początek'} – ${a.do ?? 'dziś'}). ` +
                'Datę doręczenia posłom (druk bywa doręczony tygodnie po wpływie) daje szukaj_drukow z wedlugDaty="doreczenia".',
            ]
          : []),
      ],
    }), 'projekty');
  },
});

// ---------------------------------------------------------------------------
// Druki
// ---------------------------------------------------------------------------

interface DrukZRejestru {
  number: string;
  title: string;
  documentDate?: string;
  deliveryDate?: string;
  changeDate?: string;
  processPrint?: string[];
  attachments?: string[];
  additionalPrints?: DrukZRejestru[];
}

/** Numer druku w frazie („autopoprawka 2865”, „druk 3112-A”); rok z tytułu odpada dopiero wtedy, gdy nie ma takiego druku. */
const NUMER_DRUKU = /^\d{1,5}(?:-[A-Za-z]{1,3})?$/;
/** Słowa, które opisują druk, a nie jego tytuł. */
const SLOWA_O_DRUKU = /^(druk|druku|drukiem|nr|numer|numerze)$/i;

export const szukajDrukow = narzedzie({
  nazwa: 'szukaj_drukow',
  tytul: 'Szukaj druków sejmowych',
  opis:
    'Druki sejmowe kadencji (projekty, sprawozdania komisji, opinie, autopoprawki, informacje) po słowach z tytułu i dacie, od najnowszych. ' +
    'Daty od/do są włącznie i domyślnie dotyczą doręczenia posłom (wedlugDaty="doreczenia"); "dokumentu" filtruje po dacie sporządzenia. ' +
    'Fraza z numerem druku („autopoprawka 2865”) pokazuje druki związane z tym numerem. Druki dodatkowe (np. 2874-001) liczy razemDodatkowych, listę daje dodatkowe=true. ' +
      'Wynik mieści się w ok. 20 tys. znaków; resztę daje przesuniecie=nastepnePrzesuniecie. Szczegóły i pliki jednego druku daje druk, przebieg: proces.',
  wejscie: z.object({
    fraza: z.string().min(2).max(200).optional().describe('Słowa z tytułu (każde musi wystąpić, bez względu na polskie znaki)'),
    od: data.optional().describe('Od dnia (włącznie)'),
    do: data.optional().describe('Do dnia (włącznie)'),
    wedlugDaty: z
      .enum(['doreczenia', 'dokumentu'])
      .default('doreczenia')
      .describe('Po której dacie filtrować od/do: doręczenia posłom (domyślnie; tak liczy się „druki z tygodnia”) albo sporządzenia dokumentu'),
    dodatkowe: z
      .boolean()
      .default(false)
      .describe('true: wymień druki dodatkowe (np. 2874-001, ocena skutków regulacji) zamiast głównych, porcjami; domyślnie przy datach jest tylko ich liczba razemDodatkowych'),
    limit: limit(20, 100),
    przesuniecie,
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    // Rejestr druków nie ma wyszukiwarki ani filtrów (ignoruje też limit i processPrint): bierzemy
    // całą listę (ok. 1,8 MB) i szukamy u siebie, więc daty są włącznie bez żadnych przesunięć.
    const sciezka = `${T(a.kadencja)}/prints`;
    const wszystkie = jakoLista<DrukZRejestru>(await zrodlo.json<unknown>(sciezka, { limitCzasu: 60_000 }), 'druki');
    const dataDruku = (d: DrukZRejestru) => (a.wedlugDaty === 'doreczenia' ? d.deliveryDate : d.documentDate) ?? '';
    const wDatach = (d: DrukZRejestru) => (!a.od || dataDruku(d) >= a.od) && (!a.do || (dataDruku(d) || '9') <= a.do);
    const slowa = a.fraza ? klucz(a.fraza).split(/\s+/).filter(Boolean) : [];
    let pula = wszystkie.filter((d) => wDatach(d) && slowa.every((s) => klucz(d.title).includes(s)));
    const uwagi: string[] = [];
    const skrot = pula.length === 0 ? rozwinSkroty(a.fraza) : null;
    if (skrot) {
      const rozw = klucz(skrot.fraza).split(/\s+/).filter(Boolean);
      pula = wszystkie.filter((d) => wDatach(d) && rozw.every((s) => klucz(d.title).includes(s)));
      uwagi.push(skrot.uwaga);
    }
    if (a.fraza) {
      // Tytuły są w przypadkach zależnych („kryptoaktywów”, „kryptoaktywach”): zawsze dokładamy
      // trafienia po rdzeniach, nie tylko przy zerze (inaczej „kryptoaktywa” gubiło nowszy druk).
      const rdz = rdzenie(skrot?.fraza ?? a.fraza);
      const juz = new Set(pula.map((d) => d.number));
      const zRdzeni = wszystkie.filter((d) => !juz.has(d.number) && wDatach(d) && rdz.length > 0 && maWszystkie(d.title, rdz));
      if (zRdzeni.length) {
        pula = [...pula, ...zRdzeni];
        uwagi.push(`Dołączono ${zRdzeni.length} druków pasujących po rdzeniach słów (${rdz.join(', ')}).`);
      }
    }
    // Numeru druku nie ma w tytule, więc „autopoprawka 2865” dawało zero bez słowa. Przy zerze
    // szukamy druków związanych z numerem: ten sam numer z literą (autopoprawki, sprawozdania
    // dodatkowe) i druki tego samego procesu (processPrint). Rok w tytule („na rok 2024”) nie
    // wchodzi tu, bo przy nim zwykłe wyszukiwanie coś znajduje.
    if (a.fraza && pula.length === 0) {
      const tokeny = a.fraza.split(/\s+/).filter(Boolean);
      const numery = tokeny.filter((t) => NUMER_DRUKU.test(t)).map((t) => t.toUpperCase());
      if (numery.length > 0) {
        const reszta = rdzenie(tokeny.filter((t) => !NUMER_DRUKU.test(t) && !SLOWA_O_DRUKU.test(t)).join(' '));
        const zwiazany = (d: DrukZRejestru) =>
          numery.some((n) => {
            const glowny = n.replace(/-.*$/, '');
            return d.number === n || d.number.startsWith(`${glowny}-`) || d.number === glowny || (d.processPrint ?? []).includes(glowny);
          });
        pula = wszystkie.filter((d) => wDatach(d) && zwiazany(d) && (reszta.length === 0 || maWszystkie(d.title, reszta)));
        uwagi.push(
          pula.length > 0
            ? `Fraza zawiera numer druku (${numery.join(', ')}): pokazuję druki z tym numerem (także z literą, np. autopoprawki) i druki tego samego procesu. Jeden druk: narzędzie druk; przebieg i autopoprawki procesu: narzędzie proces.`
            : `Fraza zawiera numer druku (${numery.join(', ')}), a tytuły druków nie zawierają numerów. Użyj narzędzia druk (jeden druk) albo proces (przebieg z autopoprawkami).`,
        );
      }
    }
    const kolejnosc = (x: DrukZRejestru, y: DrukZRejestru) =>
      dataDruku(y).localeCompare(dataDruku(x)) || Number.parseInt(y.number) - Number.parseInt(x.number) || y.number.localeCompare(x.number);
    const pasujace = pula.sort(kolejnosc);
    const opisDaty = a.wedlugDaty === 'doreczenia' ? 'doręczenia posłom (doreczono)' : 'sporządzenia dokumentu (dataDokumentu)';

    // Druki dodatkowe (2874-001 „ocena skutków regulacji”) nie mają własnej pozycji na liście
    // rejestru, a mają własną datę doręczenia: bez nich „ile druków doręczono w sierpniu” było
    // zaniżone bez słowa. Liczymy je osobno, przy filtrze dat; fraza pasuje do ich tytułu albo
    // do tytułu druku głównego.
    const zDatami = Boolean(a.od || a.do);
    const liczDodatkowe = zDatami || a.dodatkowe;
    const dodatkoweWDatach = liczDodatkowe
      ? wszystkie
          .flatMap((d) => dodatkowe(d).map((x) => ({ ...x, tytulGlownego: d.title })))
          .filter(({ druk: x, tytulGlownego }) => {
            if (!wDatach(x)) return false;
            if (!a.fraza) return true;
            const tekst = `${x.title ?? ''} ${tytulGlownego ?? ''}`;
            const rdz = rdzenie(a.fraza);
            return slowa.every((s) => klucz(tekst).includes(s)) || (rdz.length > 0 && maWszystkie(tekst, rdz));
          })
          .sort((x, y) => kolejnosc(x.druk, y.druk))
      : [];
    const uwagiDruku = [
      ...uwagi,
      ...(zDatami ? [`Filtr dat według daty ${opisDaty}, oba dni włącznie (${a.od ?? 'początek'} – ${a.do ?? 'dziś'}).`] : []),
      ...(a.dodatkowe
        ? [
            `Lista drukiDodatkowe wymienia druki dodatkowe (np. „Do druku nr … - ocena skutków regulacji”, numery z przyrostkiem -001) zamiast druków głównych; ` +
              `razem liczy druki główne (${pasujace.length}), razemDodatkowych dodatkowe (${dodatkoweWDatach.length}). Na pytanie „ile druków doręczono” podaj obie liczby osobno.`,
          ]
        : zDatami
          ? [
              `razem liczy druki główne. Druki dodatkowe (np. „Do druku nr … - ocena skutków regulacji”, numery z przyrostkiem -001) rejestr trzyma przy druku głównym, ` +
                `nie jako osobne pozycje: w tych datach jest ich ${dodatkoweWDatach.length} (razemDodatkowych). Na pytanie „ile druków doręczono” podaj obie liczby osobno; ` +
                'listę druków dodatkowych daje dodatkowe=true.',
            ]
          : ['Druki dodatkowe (np. ocena skutków regulacji, numer z przyrostkiem -001) pokazuje narzędzie druk przy druku głównym albo to narzędzie z dodatkowe=true.']),
      'dataDokumentu to data sporządzenia, doreczono to data doręczenia posłom; kolejność od najnowszych według daty, po której filtrowano.',
    ];
    // Pełna lista druków dodatkowych szła zawsze (93 pozycje, 46 KB, 11-b), także gdy pytanie jej
    // nie dotyczyło: teraz domyślnie sama liczba, lista na żądanie i porcjami.
    if (a.dodatkowe) {
      const zadane = dodatkoweWDatach.slice(a.przesuniecie, a.przesuniecie + a.limit);
      return wPorcji(zadane, a.przesuniecie, dodatkoweWDatach.length, (porcja) => ({
        razem: pasujace.length,
        razemDodatkowych: dodatkoweWDatach.length,
        drukiDodatkowe: porcja.map(({ druk: x, rodzic }) => ({
          numer: x.number,
          doDruku: rodzic,
          tytul: czysty(x.title),
          dataDokumentu: x.documentDate ?? null,
          doreczono: x.deliveryDate ?? null,
          pliki: plikiDruku(zrodlo, a.kadencja, x),
        })),
        zrodla: [zrodlo.adres(sciezka)],
        uwagi: uwagiDruku,
      }), 'druki dodatkowe');
    }
    const zadane = pasujace.slice(a.przesuniecie, a.przesuniecie + a.limit);
    return wPorcji(zadane, a.przesuniecie, pasujace.length, (porcja) => ({
      razem: pasujace.length,
      ...(zDatami ? { razemDodatkowych: dodatkoweWDatach.length } : {}),
      druki: porcja.map((d) => ({
        numer: d.number,
        tytul: czysty(d.title),
        dataDokumentu: d.documentDate ?? null,
        doreczono: d.deliveryDate ?? null,
        procesy: d.processPrint ?? [],
      })),
      zrodla: [zrodlo.adres(sciezka)],
      uwagi: uwagiDruku,
    }), 'druki');
  },
});
