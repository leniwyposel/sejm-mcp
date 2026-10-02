/**
 * Daty i odmiana liczebników.
 *
 * Czas w rejestrze Sejmu to czas warszawski zapisany bez strefy.
 */

const ZONELESS = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Dzień w strefie Europe/Warsaw.
 *
 * Bezstrefowe 'YYYY-MM-DDTHH:MM:SS' z API Sejmu JEST już czasem warszawskim i nie wolno go
 * przesuwać: parsowane jako UTC głosowanie z 2025-06-25T22:00:31 wychodziło 26 czerwca.
 * Napis z „Z" albo z przesunięciem przeliczamy normalnie.
 */
export function dataWarszawa(zonelessOrIso: string | null | undefined): string {
  if (!zonelessOrIso) return '';
  const wartosc = String(zonelessOrIso).trim();
  const m = ZONELESS.exec(wartosc);
  if (m) return m[1];
  const d = new Date(wartosc);
  if (Number.isNaN(d.getTime())) return wartosc;
  return czesciWarszawa(d).data;
}

function czesciWarszawa(d: Date): { data: string; czas: string } {
  const czesci = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => czesci.find((p) => p.type === t)?.value ?? '';
  const godzina = get('hour') === '24' ? '00' : get('hour');
  return { data: `${get('year')}-${get('month')}-${get('day')}`, czas: `${godzina}:${get('minute')}` };
}

/** Dzisiejsza data w Warszawie. */
export function dzisWarszawa(now: Date = new Date()): string {
  return czesciWarszawa(now).data;
}

/** Data przesunięta o `dni` dni, na kalendarzu, bez stref. */
export function dodajDni(data: string, dni: number): string {
  const dzien = dataWarszawa(data);
  const t = Date.parse(`${dzien}T00:00:00Z`);
  if (Number.isNaN(t)) return dzien;
  return new Date(t + dni * 86400000).toISOString().slice(0, 10);
}

/** Ile dni upłynęło od `od` do `do_`; ujemnie, gdy `do_` jest wcześniej. */
export function roznicaDni(od: string, do_: string): number {
  const a = Date.parse(`${dataWarszawa(od)}T00:00:00Z`);
  const b = Date.parse(`${dataWarszawa(do_)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Sama forma rzeczownika: [jeden, dwa do czterech, pięć i więcej], z wyjątkiem 12-14. */
export function formaOdmiany(n: number, formy: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return formy[0];
  const jednosci = abs % 10;
  const dziesiatki = abs % 100;
  if (jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14)) return formy[1];
  return formy[2];
}

/** Liczba z rzeczownikiem w dobrej formie: „1 poseł", „3 posłów"... */
export function odmiana(n: number, formy: [string, string, string]): string {
  return `${n} ${formaOdmiany(n, formy)}`;
}

const DNI_TYGODNIA = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/** Dzień tygodnia daty RRRR-MM-DD, po polsku. */
export function dzienTygodnia(data: string): string {
  return DNI_TYGODNIA[new Date(`${data}T00:00:00Z`).getUTCDay()];
}

/** „2026-09-25 (piątek)”. */
function zDniem(data: string): string {
  return `${data} (${dzienTygodnia(data)})`;
}

export interface Przedzial {
  od: string;
  do: string;
}

export interface Kalendarz {
  dzis: string;
  wczoraj: string;
  tenTydzien: Przedzial;
  zeszlyTydzien: Przedzial;
  tenMiesiac: Przedzial;
  zeszlyMiesiac: Przedzial;
}

/** Ostatni dzień miesiąca `rok-miesiac` (miesiąc 1–12). */
function koniecMiesiaca(rok: number, miesiac: number): string {
  return new Date(Date.UTC(rok, miesiac, 0)).toISOString().slice(0, 10);
}

/**
 * Daty względne policzone przez serwer w Warszawie w chwili wywołania. Model (Haiku) brał „zeszły
 * tydzień” za ostatnie 7 dni i mylił „wczoraj”, choć instrukcja mówiła, jak liczyć: gotowe
 * przedziały w każdym wyniku usuwają liczenie po jego stronie. Tydzień od poniedziałku do niedzieli.
 */
export function kalendarz(now: Date = new Date()): Kalendarz {
  const dzis = dzisWarszawa(now);
  const dzienTyg = new Date(`${dzis}T00:00:00Z`).getUTCDay();
  const poniedzialek = dodajDni(dzis, -((dzienTyg + 6) % 7));
  const [rok, miesiac] = dzis.split('-').map(Number);
  const [rokZ, miesiacZ] = miesiac === 1 ? [rok - 1, 12] : [rok, miesiac - 1];
  const mm = (m: number) => String(m).padStart(2, '0');
  return {
    dzis: zDniem(dzis),
    wczoraj: zDniem(dodajDni(dzis, -1)),
    tenTydzien: { od: poniedzialek, do: dodajDni(poniedzialek, 6) },
    zeszlyTydzien: { od: dodajDni(poniedzialek, -7), do: dodajDni(poniedzialek, -1) },
    tenMiesiac: { od: `${rok}-${mm(miesiac)}-01`, do: koniecMiesiaca(rok, miesiac) },
    zeszlyMiesiac: { od: `${rokZ}-${mm(miesiacZ)}-01`, do: koniecMiesiaca(rokZ, miesiacZ) },
  };
}
