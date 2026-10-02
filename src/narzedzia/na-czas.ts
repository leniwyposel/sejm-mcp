/**
 * Wiele wolnych zapytań-dodatków (treści odpowiedzi, nagłówki wypowiedzi) w jednym wywołaniu,
 * z terminem. Klient MCP przerywa po ok. 60 s, a Sejm oddaje jedną treść po 4 do 30 s, więc
 * czytamy tyle, ile zdążymy, i mówimy, czego nie zdążyliśmy.
 */

/** Tyle zapytań naraz puszcza klient (src/klient.ts); więcej w kolejce tylko czekałoby na termin. */
const NARAZ = 4;

/** Nie zaczynamy zapytania, gdy do terminu zostało mniej niż tyle. */
const ZAPAS_MS = 1500;

const MINELO = Symbol('minęło');

/**
 * Wykonuje `f` dla każdego zadania, najwyżej NARAZ naraz, i wraca najpóźniej chwilę po terminie.
 * Zadanie, którego nie zaczęto albo nie skończono przed terminem, ma w wyniku `undefined`. Własna
 * kolejka, a nie kolejka klienta: zadania czekające w kolejce klienta ruszały po terminie i
 * wydłużały wywołanie o kilka sekund (pomiar: 28 s przy terminie 22 s).
 */
export async function naCzas<T, W>(
  zadania: readonly T[],
  termin: number,
  f: (t: T) => Promise<W>,
  /** Tu trafiają błędy zadań (Sejm odpowiedział błędem), żeby narzędzie odróżniło awarię od braku czasu. */
  bledy?: unknown[],
): Promise<Array<W | undefined>> {
  const wyniki: Array<W | undefined> = new Array(zadania.length).fill(undefined);
  let nastepne = 0;
  let zegar: ReturnType<typeof setTimeout> | undefined;
  const koniec = new Promise<typeof MINELO>((r) => {
    zegar = setTimeout(() => r(MINELO), Math.max(0, termin - Date.now()));
  });
  const robotnik = async () => {
    while (nastepne < zadania.length) {
      if (termin - Date.now() < ZAPAS_MS) return;
      const j = nastepne++;
      const w = await Promise.race([f(zadania[j]).catch((e: unknown) => {
          bledy?.push(e);
          return undefined;
        }), koniec]);
      if (w === MINELO) return;
      wyniki[j] = w;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(NARAZ, zadania.length) }, robotnik));
  } finally {
    clearTimeout(zegar);
  }
  return wyniki;
}
