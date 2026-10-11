import { z } from 'zod';

/**
 * Gotowe pytania (MCP prompts): kilka typowych pytań, które pokazują nowej osobie, co serwer
 * umie. Klient pokazuje je jako polecenia (np. „/mcp__sejm__posel” w Claude Code); wybrane
 * pytanie trafia do rozmowy jako wiadomość użytkownika.
 *
 * Każdy tekst mówi asystentowi, których narzędzi użyć i że ma podać adres źródła, tak samo jak
 * instrukcje serwera (`INSTRUKCJE` w serwer.ts). W tekstach nie ma nazwisk posłów: przykład
 * z nazwiskiem czytałby się jak wskazanie konkretnej osoby.
 *
 * Argumenty pytań to zawsze napisy (tak mówi protokół). Walidacja: niepusty tekst o rozsądnej
 * długości, a numery posiedzenia i głosowania to same cyfry. Zły argument kończy się błędem
 * protokołu (-32602), zanim powstanie tekst.
 */

const tekst = (opis: string, max = 200) =>
  z
    .string()
    .trim()
    .min(2, 'Za krótko: podaj co najmniej dwa znaki.')
    .max(max, `Za długo: najwyżej ${max} znaków.`)
    .describe(opis);

const numer = (opis: string) => z.string().trim().regex(/^\d{1,4}$/, 'Podaj sam numer, np. 66.').describe(opis);

/** Zdanie o źródłach, wspólne dla wszystkich pytań. */
const ZRODLA =
  'Przy każdej liczbie i fakcie podaj adres z pola zrodla wyniku, żeby dało się to sprawdzić u źródła. ' +
  'Nie dopisuj niczego z pamięci: jeśli narzędzie czegoś nie podało, powiedz, że rejestr tego nie podaje.';

export interface GotowePytanie<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  nazwa: string;
  tytul: string;
  opis: string;
  argumenty?: S;
  /** Narzędzia, które tekst wymienia (test sprawdza, że istnieją). */
  narzedzia: string[];
  tresc: (a: z.infer<S>) => string;
}

function pytanie<S extends z.ZodObject<z.ZodRawShape>>(p: GotowePytanie<S>): GotowePytanie<S> {
  return p;
}

export const glosowaniaDzis = pytanie({
  nazwa: 'glosowania_dzis',
  tytul: 'Nad czym dziś głosuje Sejm?',
  opis: 'Dzisiejsze głosowania z wynikami. Gdy dziś nie ma posiedzenia: kiedy jest najbliższe i czym Sejm się na nim zajmie.',
  narzedzia: ['lista_posiedzen', 'glosowania_posiedzenia', 'porzadek_posiedzenia'],
  tresc: () =>
    'Nad czym dziś głosuje Sejm?\n\n' +
    'Sprawdź to tak: dzisiejszą datę weź z pola kalendarz w wyniku narzędzia, nie z pamięci. ' +
    'lista_posiedzen z planowane=true powie, czy dziś jest posiedzenie. ' +
    'Jeśli jest, wywołaj glosowania_posiedzenia z numerem posiedzenia, dzisiejszą datą w parametrze data. ' +
    'Przy każdym głosowaniu napisz krótko, czego dotyczyło, czy przeszło i ile było głosów za, przeciw i wstrzymujących się. ' +
    'Jeśli w rejestrze nie ma jeszcze głosowań z dziś, powiedz to i pokaż porządek obrad z porzadek_posiedzenia. ' +
    'Jeśli dziś posiedzenia nie ma, podaj, kiedy jest najbliższe i co jest w jego porządku. ' +
    'Apel o kworum to sprawdzenie obecności: niczego się w nim nie przyjmuje. ' +
    ZRODLA,
});

export const posel = pytanie({
  nazwa: 'posel',
  tytul: 'Kim jest ten poseł?',
  opis: 'Klub, okręg, wynik wyborczy, komisje i obecność na głosowaniach jednego posła albo posłanki, z liczbami z rejestru Sejmu.',
  argumenty: z.object({ posel: tekst('Imię i nazwisko posła albo posłanki', 100) }),
  narzedzia: ['znajdz_posla', 'profil_posla', 'komisje'],
  tresc: (a) =>
    `Kim jest ${a.posel}? Co o tej osobie mówi rejestr Sejmu?\n\n` +
    'Sprawdź to tak: znajdz_posla z imieniem i nazwiskiem, potem profil_posla z numerem posła, a funkcje w komisjach z narzędzia komisje (poselId). ' +
    'Jeśli znajdz_posla zwróci kilka osób (pole niejednoznaczne), napisz o każdej osobno albo zapytaj, o kogo chodzi. ' +
    'Podaj klub, okręg, liczbę głosów w wyborach i komisje. Opuszczone głosowania podawaj razem z liczbą wszystkich głosowań, ' +
    'a dni nieobecności z podziałem na usprawiedliwione i nieusprawiedliwione. Nie oceniaj posła i nie porównuj go z innymi. ' +
    ZRODLA,
});

export const glosPosla = pytanie({
  nazwa: 'glos_posla',
  tytul: 'Jak głosował poseł?',
  opis: 'Jak poseł albo posłanka zagłosowali nad konkretną ustawą: głos w głosowaniu nad całością i klub z dnia głosowania.',
  argumenty: z.object({
    posel: tekst('Imię i nazwisko posła albo posłanki', 100),
    ustawa: tekst('O jaką ustawę chodzi: słowa z tytułu albo numer druku'),
  }),
  narzedzia: ['znajdz_posla', 'szukaj_procesow', 'proces', 'druk', 'glosowanie'],
  tresc: (a) =>
    `Jak ${a.posel} głosował(a) nad ustawą: ${a.ustawa}?\n\n` +
    'Sprawdź to tak: znajdz_posla da numer posła. Ustawę znajdź przez szukaj_procesow (słowa z tytułu) albo druk (numer druku), ' +
    'a w procesie weź głosowanie końcowe (glosowanieKoncowe). Potem glosowanie z tym posiedzeniem, numerem i poselId. ' +
    'Jeśli pasuje kilka ustaw albo kilka osób o tym nazwisku, powiedz to i zapytaj, o którą chodzi. ' +
    'Podaj głos, wynik całego głosowania i klub posła z dnia głosowania. Jeśli posła nie ma na liście głosujących, ' +
    'sprawdź, czy miał wtedy mandat, zanim napiszesz o nieobecności. ' +
    ZRODLA,
});

export const etapUstawy = pytanie({
  nazwa: 'etap_ustawy',
  tytul: 'Na jakim etapie jest ustawa?',
  opis: 'Gdzie jest teraz ustawa: czytania w Sejmie, głosowanie, Senat, podpis albo weto Prezydenta, ogłoszenie w Dzienniku Ustaw.',
  argumenty: z.object({ ustawa: tekst('Słowa z tytułu ustawy albo numer druku, np. 3162') }),
  narzedzia: ['szukaj_procesow', 'proces', 'druk', 'akt'],
  tresc: (a) =>
    `Na jakim etapie jest ustawa: ${a.ustawa}?\n\n` +
    'Sprawdź to tak: przy numerze druku narzędzie druk wskaże proces legislacyjny, a przy słowach z tytułu szukaj_procesow. ' +
    'Jeśli pasuje kilka procesów, wymień je krótko i zapytaj, o który chodzi. Potem proces z numerem procesu. ' +
    'Napisz, na jakim etapie jest ustawa i od kiedy, jak skończyło się głosowanie końcowe w Sejmie (glosowanieKoncowe), ' +
    'co zrobił Senat i czy Prezydent ją podpisał albo zawetował. Jeśli ustawa jest już ogłoszona (pole eli), ' +
    'sprawdź narzędziem akt, kiedy wchodzi w życie. Uchwalenie, ogłoszenie i wejście w życie to trzy różne daty: przy każdej napisz, która to. ' +
    ZRODLA,
});

export const klubyWGlosowaniu = pytanie({
  nazwa: 'kluby_w_glosowaniu',
  tytul: 'Jak głosowały kluby?',
  opis: 'Wynik jednego głosowania w Sejmie i to, jak głosował każdy klub: za, przeciw, wstrzymało się, nie głosowało.',
  argumenty: z.object({
    posiedzenie: numer('Numer posiedzenia Sejmu, np. 66'),
    numer: numer('Numer głosowania na tym posiedzeniu, np. 3'),
  }),
  narzedzia: ['glosowanie', 'glosowania_posiedzenia'],
  tresc: (a) =>
    `Jak głosowały kluby w głosowaniu nr ${a.numer} na ${a.posiedzenie}. posiedzeniu Sejmu?\n\n` +
    `Sprawdź to tak: glosowanie z posiedzenie=${a.posiedzenie} i numer=${a.numer}. Napisz, nad czym głosowano (temat i punkt porządku), ` +
    'czy przeszło i jaka większość była potrzebna (przy większości kwalifikowanej podaj próg z pola progZa). ' +
    'Potem kluby z pola kluby: ilu posłów było za, przeciw, wstrzymało się i nie głosowało. ' +
    'Klub to przynależność z dnia głosowania, nie dzisiejsza. Apel o kworum niczego nie przyjmuje: jeśli to on, powiedz to. ' +
    'Gdy takiego głosowania nie ma, glosowania_posiedzenia z porzadek=true pokaże głosowania pod punktami porządku. ' +
    'Dodaj adres protokołu PDF (drugi adres w polu zrodla). ' +
    ZRODLA,
});

export const czyObowiazuje = pytanie({
  nazwa: 'czy_obowiazuje',
  tytul: 'Czy ta ustawa już obowiązuje?',
  opis: 'Czy akt prawny obowiązuje dziś, od kiedy, gdzie go ogłoszono i jaki jest jego najnowszy tekst jednolity (baza ELI).',
  argumenty: z.object({ akt: tekst('Nazwa aktu, np. „Kodeks pracy”, albo jego adres, np. DU/1974/141') }),
  narzedzia: ['szukaj_aktow', 'akt', 'szukaj_procesow', 'proces'],
  tresc: (a) =>
    `Czy ${a.akt} już obowiązuje?\n\n` +
    'Sprawdź to tak: przy adresie (np. DU/1974/141) od razu akt, a przy nazwie najpierw szukaj_aktow, potem akt z adresem z wyniku. ' +
    'Napisz, czy akt obowiązuje dziś (pole obowiazuje), kiedy go ogłoszono, od kiedy obowiązuje (wejscieWZycie) ' +
    'i jaki jest najnowszy tekst jednolity, jeśli jest. Jeśli w bazie ELI aktu nie ma, sprawdź szukaj_procesow i proces: ' +
    'ustawa może być jeszcze w Sejmie, w Senacie albo czekać na podpis Prezydenta. Ogłoszenie i wejście w życie to różne daty. ' +
    ZRODLA,
});

export const GOTOWE_PYTANIA: GotowePytanie<any>[] = [glosowaniaDzis, posel, glosPosla, etapUstawy, klubyWGlosowaniu, czyObowiazuje];
