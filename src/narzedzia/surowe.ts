import { z } from 'zod';
import { BladSejmu } from '../klient.js';
import { fragment } from '../tekst.js';
import { brak404, narzedzie, UWAGA_TEKST_Z_ZEWNATRZ } from './wspolne.js';

/**
 * Furtka na wszystko, czego nie ma w gotowych narzędziach. Tylko GET, tylko JSON, tylko pod
 * https://api.sejm.gov.pl/sejm/ (pilnuje tego `zlozAdres` w kliencie), odpowiedź w porcjach.
 */
const SCIEZKI =
  'Istniejące zasoby API Sejmu (po "termN/"): MP, MP/{id}, MP/{id}/votings/stats, clubs, clubs/{id} (członkowie z joinDate, datą wejścia do klubu), ' +
  'committees, committees/{kod} (także podkomisja, np. committees/INF01N: skład, appointmentDate, dismissalDate), committees/{kod}/members, ' +
  'committees/{kod}/sittings, proceedings, proceedings/{nr}, proceedings/{nr}/{RRRR-MM-DD}/transcripts (lista wypowiedzi dnia), ' +
  'votings, votings/{pos}, votings/{pos}/{nr}, votings/search, interpellations, writtenQuestions, prints, prints/{nr}, processes, processes/{nr}, ' +
  'bills, videos, videos/{RRRR-MM-DD}, bilateralGroups. ELI: eli/acts/search, eli/acts/{DU|MP}/{rok}/{poz}, …/references, …/struct, ' +
  'eli/changes/acts, eli/types, eli/keywords, eli/references. Nie ma zasobów z płcią posłów ani z demografią, ani z listą prezydium Sejmu (kto jest marszałkiem, pokazuje głosowanie nad wyborem: szukaj_glosowan z frazą „Wybór Marszałka Sejmu”).';

/**
 * Zasoby, które nie są JSON-em (API odpowiada 406 na Accept: application/json): mówimy, które
 * narzędzie je czyta, zamiast gołego „Sejm odpowiedział 406”, po którym model zgadywał dalej.
 */
function podpowiedzDlaNieJson(sciezka: string): string {
  if (/^eli\/acts\/.+\/text\.(html|pdf)$/.test(sciezka)) return 'Tekst aktu prawnego czytaj narzędziem tresc_aktu (adres, artykul albo spis); tekst z PDF też czyta tresc_aktu.';
  if (/\/transcripts\/\d+$|\/transcripts\/pdf$/.test(sciezka)) return 'Treść wypowiedzi ze stenogramu daje narzędzie tresc_wypowiedzi, a listę wypowiedzi dnia wypowiedzi_posiedzenia.';
  if (/(interpellations|writtenQuestions)\/.+\/(body|reply|replies)/.test(sciezka)) return 'Treść interpelacji, zapytania i odpowiedzi daje narzędzie pismo z tresc:true.';
  if (/\/(photo|photo-mini)$/.test(sciezka)) return 'To zdjęcie posła, nie JSON; dane posła daje narzędzie profil_posla.';
  if (/\/pdf$|\.pdf$/.test(sciezka)) return 'To plik PDF; zapytanie_surowe go nie czyta. Odpowiedź na pismo z PDF czyta narzędzie pismo (odpowiedzKlucz), a tekst aktu tresc_aktu; w innym razie podaj czytelnikowi adres.';
  return 'Ten zasób nie jest JSON-em (HTML albo PDF); tym narzędziem pobierzesz tylko JSON.';
}

/** Podpowiedź przy 404, dopasowana do tego, czego szukano. */
function podpowiedzDla404(sciezka: string): string {
  if (/marsha|marszal|presidium|prezydium|speaker|chairman/i.test(sciezka)) {
    return 'API Sejmu nie ma zasobu z marszałkiem ani prezydium Sejmu. Kto został wybrany, pokazuje głosowanie: szukaj_glosowan z frazą „Wybór Marszałka Sejmu” albo „Wybór Wicemarszałka”; najnowszy wybór jest aktualny. W stenogramach marszałek występuje jako „Marszałek” bez nazwiska. ';
  }
  if (/committee|komisj|subcommittee|podkomisj/i.test(sciezka)) {
    return 'Podkomisja nie leży pod komisją: ma własny adres committees/{kodPodkomisji}, np. term10/committees/INF01N (nazwa, rodzaj, appointmentDate, dismissalDate, members). ' +
      'Kody podkomisji są w polu subCommittees zasobu committees/{kodKomisji}; skład z datami: committees/{kod}/members. Zasobu committees/{kod}/subcommittees nie ma. ';
  }
  if (/club|klub/i.test(sciezka)) {
    return 'Klub to clubs/{id}, np. term10/clubs/KO: pole members ma każdego członka z joinDate (data wejścia do klubu) i funkcją; listę id klubów daje term10/clubs. ' +
      'Historii przynależności (z jakiego klubu ktoś przyszedł) API nie ma osobno: widać ją w polu club list imiennych głosowań sprzed joinDate. ';
  }
  if (/speech|wypowiedz|stenogram|transcript/i.test(sciezka)) {
    return 'Wypowiedzi są pod proceedings/{nr}/{RRRR-MM-DD}/transcripts (narzędzia wypowiedzi_posiedzenia i tresc_wypowiedzi). ';
  }
  return '';
}

export const zapytanieSurowe = narzedzie({
  nazwa: 'zapytanie_surowe',
  tytul: 'Surowe zapytanie do API Sejmu',
  opis:
    'Pobiera dowolny zasób JSON spod https://api.sejm.gov.pl/sejm/ (np. "term10/committees", "term10/bills", "term10/videos/2024-04-24") ' +
    'albo spod /eli/ (ścieżka zaczyna się od "eli/", np. "eli/acts/DU/2026/62/references"). ' +
    'Używaj tylko wtedy, gdy żadne inne narzędzie nie pasuje. Odpowiedź jest surowa: bez werdyktów i bez reguł liczenia, ' +
    'więc nie licz z niej frekwencji ani wyników głosowań samodzielnie. ' + SCIEZKI,
  wejscie: z.object({
    sciezka: z
      .string()
      .min(1)
      .max(200)
      .regex(
        /^[A-Za-z0-9_\-./]+$/,
        'Niedozwolone znaki: dozwolona jest tylko ścieżka w API Sejmu (litery, cyfry, / _ - .), np. "term10/MP", bez „https://” i adresu strony: ten serwer nie pobiera innych stron niż api.sejm.gov.pl',
      )
      .describe('Ścieżka względem /sejm/, np. "term10/clubs/KO", albo od "eli/", np. "eli/acts/DU/2026/62"'),
    parametry: z
      .record(z.string().regex(/^[A-Za-z_]{1,30}$/), z.union([z.string().max(200), z.number(), z.boolean()]))
      .refine((p) => Object.keys(p).length <= 12, 'Najwyżej 12 parametrów')
      .optional()
      .describe('Parametry zapytania, np. {"limit": 10, "title": "szpital"}'),
    od: z.number().int().min(0).default(0).describe('Od którego znaku odpowiedzi zacząć'),
  }),
  async wykonaj(a, zrodlo) {
    // „example.com/x” przechodzi przez wzorzec znaków, a Sejm odpowiedziałby 404 („nie ma zasobu”),
    // co wprowadza w błąd: to adres innej strony, którego ten serwer z zasady nie pobiera.
    const pierwszy = a.sciezka.replace(/^\/+/, '').split('/')[0];
    if (/^(www\.|[a-z0-9-]+\.(com|pl|org|net|eu|gov|io|info|dev)$)/i.test(pierwszy) || /^https?$/i.test(pierwszy)) {
      throw new BladSejmu(`Adres innej strony niż api.sejm.gov.pl: ${JSON.stringify(a.sciezka)}`, null, 'adres-odrzucony');
    }
    const adres = zrodlo.adres(a.sciezka, a.parametry);
    const sciezka = a.sciezka.replace(/^\/+/, '');
    let surowa: unknown;
    try {
      surowa = await zrodlo.json<unknown>(a.sciezka, { parametry: a.parametry });
    } catch (e) {
      if (e instanceof BladSejmu && e.status === 406) {
        return { znaleziono: false, odpowiedz: podpowiedzDlaNieJson(sciezka), zrodla: [adres], uwagi: [`Sejm odpowiedział 406: ten adres nie oddaje JSON-a. ${podpowiedzDlaNieJson(sciezka)}`] };
      }
      throw e;
    }
    if (surowa === null) {
      return { ...brak404('Sejm odpowiedział 404: pod tą ścieżką nie ma zasobu'), zrodla: [adres], uwagi: [`${podpowiedzDla404(sciezka)}${SCIEZKI}`] };
    }
    const tekst = JSON.stringify(surowa);
    if (a.od > 0 && a.od >= tekst.length) {
      return {
        znaleziono: true,
        dlugosc: tekst.length,
        zrodla: [adres],
        uwagi: [`Parametr od (${a.od}) wykracza poza odpowiedź: ma ona ${tekst.length} znaków. Zacznij od 0 albo od wartości nastepnyOd z poprzedniej porcji.`],
      };
    }
    // Mała odpowiedź idzie jako JSON (bez podwójnego escapowania), duża jako tekst w porcjach.
    const maly = tekst.length <= 20_000 && a.od === 0;
    return {
      znaleziono: true,
      odpowiedz: maly ? surowa : undefined,
      porcja: maly ? undefined : fragment(tekst, a.od, 20_000),
      zrodla: [adres],
      uwagi: [
        'Surowa odpowiedź rejestru, bez reguł liczenia tego serwera.',
        ...(maly
          ? []
          : [`Pokazano znaki ${a.od}–${Math.min(tekst.length, a.od + 20_000)} z ${tekst.length} (odpowiedź ma ${tekst.length} znaków): to porcja surowego JSON-a w kolejności rejestru. Nie licz ani nie filtruj z porcji; użyj właściwego narzędzia.`]),
        UWAGA_TEKST_Z_ZEWNATRZ,
      ],
    };
  },
});
