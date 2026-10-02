/**
 * Jeden sufit rozmiaru odpowiedzi dla wszystkich narzędzi.
 *
 * Audyt z 2.10.2026: część narzędzi przy dozwolonych parametrach oddawała 56-121 tys. znaków
 * (transmisje za miesiąc, znajdz_posla z limitem 500). Claude Code zapisuje wynik ponad ok. 25 tys.
 * tokenów do pliku, a model widzi z niego tylko podgląd. Każde narzędzie pilnuje się samo, a ten
 * moduł jest siatką pod spodem: wynik dłuższy niż {@link SUFIT_ZNAKOW} jest przycinany na poziomie
 * obiektu (nigdy w środku napisu JSON), najpierw listy od końca, a dopiero gdy list brakuje, długie
 * napisy na granicy słowa. Przycięcie zawsze idzie z polem wynikCzesciowy, więc model mówi o nim
 * użytkownikowi i wie, którym argumentem dostać resztę.
 */

import { czesciowy, dolaczCzesciowe, type Wynik } from './narzedzia/wspolne.js';

/** Najwięcej znaków tekstu odpowiedzi (JSON w polu content), razem z kalendarzem i zdaniem o skróceniu. */
export const SUFIT_ZNAKOW = 28_000;

/** Pola, których nie przycinamy: zdanie dla modelu, źródła, zastrzeżenia i informacja o częściowości. */
const CHRONIONE = new Set(['odpowiedz', 'najpierw', 'zrodla', 'uwagi', 'wynikCzesciowy', 'kalendarz', 'potrzebnaZgoda', 'pytanieOZgode', 'cytowanie']);

/** Najkrótszy napis, który jeszcze skracamy (krótsze nie zrobią różnicy, a tracą sens). */
const MIN_NAPIS = 1500;
const ZNACZNIK_NAPISU = ' […] (skrócono: limit rozmiaru odpowiedzi)';

export interface Przyciecie {
  /** Ścieżka pola, np. "transmisje" albo "punkty[3].glosowania". */
  pole: string;
  /** Lista: ile pozycji zostało i ile było. Napis: ile znaków zostało i ile było. */
  pokazano: number;
  bylo: number;
  rodzaj: 'lista' | 'tekst';
}

type Rodzic = Record<string, unknown> | unknown[];
interface Kandydat {
  rodzic: Rodzic;
  klucz: string | number;
  sciezka: string;
  rozmiar: number;
}

const dlugosc = (x: unknown) => JSON.stringify(x)?.length ?? 0;

function zbierz(x: unknown, sciezka: string, listy: Kandydat[], napisy: Kandydat[], gora: boolean): void {
  if (Array.isArray(x)) {
    x.forEach((e, i) => {
      const s = `${sciezka}[${i}]`;
      if (Array.isArray(e) && e.length > 1) listy.push({ rodzic: x, klucz: i, sciezka: s, rozmiar: dlugosc(e) });
      if (typeof e === 'string' && e.length > MIN_NAPIS) napisy.push({ rodzic: x, klucz: i, sciezka: s, rozmiar: e.length });
      zbierz(e, s, listy, napisy, false);
    });
    return;
  }
  if (!x || typeof x !== 'object') return;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (gora && CHRONIONE.has(k) && !(k === 'odpowiedz' && v && typeof v === 'object')) continue;
    const s = sciezka ? `${sciezka}.${k}` : k;
    if (Array.isArray(v) && v.length > 1) listy.push({ rodzic: x as Record<string, unknown>, klucz: k, sciezka: s, rozmiar: dlugosc(v) });
    if (typeof v === 'string' && v.length > MIN_NAPIS) napisy.push({ rodzic: x as Record<string, unknown>, klucz: k, sciezka: s, rozmiar: v.length });
    zbierz(v, s, listy, napisy, false);
  }
}

const czytaj = (k: Kandydat) => (k.rodzic as Record<string | number, unknown>)[k.klucz];
const wpisz = (k: Kandydat, v: unknown) => {
  (k.rodzic as Record<string | number, unknown>)[k.klucz] = v;
};

/** Napis skrócony o co najmniej `o` znaków, na granicy słowa, ze znacznikiem skrócenia. */
function skrocNapis(s: string, o: number): string {
  const cel = Math.max(MIN_NAPIS / 2, s.length - o - ZNACZNIK_NAPISU.length);
  const ciecie = s.lastIndexOf(' ', cel);
  return s.slice(0, ciecie > cel * 0.8 ? ciecie : cel).trimEnd() + ZNACZNIK_NAPISU;
}

/**
 * Obiekt przycięty tak, żeby jego JSON miał najwyżej `limit` znaków. Najpierw największa lista
 * (pozycje od końca, co najmniej jedna zostaje), potem najdłuższy napis. Oryginał zostaje bez zmian.
 */
export function przytnij<T>(obiekt: T, limit: number): { wynik: T; przyciecia: Przyciecie[] } {
  const kopia = structuredClone(obiekt);
  const przyciecia = new Map<string, Przyciecie>();
  for (let krok = 0; krok < 500; krok++) {
    const nadmiar = dlugosc(kopia) - limit;
    if (nadmiar <= 0) break;
    const listy: Kandydat[] = [];
    const napisy: Kandydat[] = [];
    zbierz(kopia, '', listy, napisy, true);
    const lista = listy.sort((a, b) => b.rozmiar - a.rozmiar)[0];
    if (lista) {
      const l = czytaj(lista) as unknown[];
      // Od końca, aż zejdziemy o nadmiar; zawsze co najmniej jedna pozycja zostaje.
      let zostaje = l.length;
      let zdjeto = 0;
      while (zostaje > 1 && zdjeto < nadmiar) zdjeto += dlugosc(l[--zostaje]) + 1;
      const p = przyciecia.get(lista.sciezka);
      przyciecia.set(lista.sciezka, { pole: lista.sciezka, pokazano: zostaje, bylo: p?.bylo ?? l.length, rodzaj: 'lista' });
      wpisz(lista, l.slice(0, zostaje));
      continue;
    }
    const napis = napisy.sort((a, b) => b.rozmiar - a.rozmiar)[0];
    if (!napis) break;
    const s = czytaj(napis) as string;
    const krotszy = skrocNapis(s, nadmiar);
    if (krotszy.length >= s.length) break;
    const p = przyciecia.get(napis.sciezka);
    przyciecia.set(napis.sciezka, { pole: napis.sciezka, pokazano: krotszy.length, bylo: p?.bylo ?? s.length, rodzaj: 'tekst' });
    wpisz(napis, krotszy);
  }
  // Listy zagnieżdżone w pozycjach, które potem zdjęto, nie istnieją już w wyniku.
  const zostaly = [...przyciecia.values()].filter((p) => istnieje(kopia, p.pole));
  return { wynik: kopia, przyciecia: zostaly };
}

function istnieje(x: unknown, sciezka: string): boolean {
  let o: unknown = x;
  for (const czesc of sciezka.match(/[^.[\]]+/g) ?? []) {
    if (!o || typeof o !== 'object') return false;
    const k = /^\d+$/.test(czesc) && Array.isArray(o) ? Number(czesc) : czesc;
    if (!(k in (o as object))) return false;
    o = (o as Record<string | number, unknown>)[k];
  }
  return true;
}

/** Jak dostać resztę: argumenty porcji, które to narzędzie naprawdę ma. */
export function jakDostacReszte(argumenty: readonly string[], przesuniecieDalej: number | null): string {
  const a = new Set(argumenty);
  const drogi: string[] = [];
  if (a.has('przesuniecie') && przesuniecieDalej !== null) drogi.push(`z przesuniecie=${przesuniecieDalej} (kolejne pozycje)`);
  else if (a.has('przesuniecie')) drogi.push('z argumentem przesuniecie (kolejna porcja)');
  if (a.has('limit')) drogi.push('z mniejszym limit');
  if (a.has('odPunktu')) drogi.push('z odPunktu (dalsze punkty)');
  if (a.has('powiazaniaLimit')) drogi.push('z mniejszym powiazaniaLimit albo z powiazaniaPrzesuniecie');
  if (a.has('strony')) drogi.push('z węższym zakresem stron (strony="N-M")');
  if (a.has('znakow')) drogi.push('z mniejszym znakow');
  if (a.has('od') && a.has('do')) drogi.push('z krótszym przedziałem dat (od, do)');
  else if (a.has('od')) drogi.push('z argumentem od (dalszy ciąg tekstu)');
  if (drogi.length === 0) drogi.push('z węższym pytaniem (bardziej konkretne argumenty)');
  return `wywołać to samo narzędzie jeszcze raz ${drogi.join(' albo ')}`;
}

const opisPrzyciecia = (p: Przyciecie) =>
  p.rodzaj === 'lista' ? `lista ${p.pole}: pokazano ${p.pokazano} z ${p.bylo} pozycji` : `tekst ${p.pole}: pokazano ${p.pokazano} z ${p.bylo} znaków`;

/**
 * Wynik narzędzia mieszczący się w budżecie znaków. `rozmiar` mierzy gotową odpowiedź (po dodaniu
 * zdania na początek i kalendarza), więc budżet zmniejszamy, aż całość zejdzie pod sufit.
 */
export function wSuficie(
  wynik: Wynik,
  rozmiar: (w: Wynik) => number,
  argumenty: { nazwy: readonly string[]; wartosci?: Record<string, unknown> } = { nazwy: [] },
  sufit = SUFIT_ZNAKOW,
): Wynik {
  if (rozmiar(wynik) <= sufit) return wynik;
  let budzet = sufit - 1500;
  let ostatni = wynik;
  for (let proba = 0; proba < 6 && budzet > 2000; proba++) {
    const { wynik: przyciety, przyciecia } = przytnij(wynik, budzet);
    // Lista na najwyższym poziomie przy narzędziu ze stronicowaniem: następne przesunięcie wprost.
    const glowna = przyciecia.find((p) => p.rodzaj === 'lista' && !/[.[]/.test(p.pole));
    const przes = typeof argumenty.wartosci?.przesuniecie === 'number' ? argumenty.wartosci.przesuniecie : 0;
    const dalej = glowna && argumenty.nazwy.includes('przesuniecie') ? przes + glowna.pokazano : null;
    const w: Wynik = { ...przyciety };
    if (dalej !== null) {
      // Zdanie o porcji (serwer.ts) czyta te pola: po przycięciu wskazywałyby pozycje, których model nie widział.
      w.nastepnePrzesuniecie = dalej;
      delete w.pokazano;
    }
    const opis = przyciecia.length ? przyciecia.map(opisPrzyciecia).join('; ') : 'część pól';
    ostatni = dolaczCzesciowe(w, [
      czesciowy(
        `odpowiedź przekroczyła ${sufit.toLocaleString('pl-PL')} znaków, więcej niż serwer oddaje naraz, żeby nie zapchać rozmowy, więc ją skrócił`,
        `${opis}; nie traktuj skróconej listy jako pełnej i nie licz z niej sum`,
        jakDostacReszte(argumenty.nazwy, dalej),
      ),
    ]);
    ostatni.skroconoDoLimitu = { limitZnakow: sufit, pola: przyciecia };
    if (rozmiar(ostatni) <= sufit) return ostatni;
    budzet = Math.floor(budzet * 0.8);
  }
  return ostatni;
}
