import { z } from 'zod';
import { odmiana } from '../reguly/daty.js';
import { czysty, klucz } from '../tekst.js';
import { brak404, czesciowyZBledu, BIEZACA_KADENCJA, data, jakoLista, jakoRekord, kadencja, limit, narzedzie, opisKadencji, przesuniecie, sprawdzPrzedzial, T } from './wspolne.js';

interface PoselZRejestru {
  id: number;
  firstName: string;
  secondName?: string;
  lastName: string;
  firstLastName: string;
  club?: string;
  districtNum?: number;
  districtName?: string;
  voivodeship?: string;
  active: boolean;
  inactiveCause?: string;
  waiverDesc?: string;
  mandateExpiryDate?: string;
  birthDate?: string;
  birthLocation?: string;
  profession?: string;
  educationLevel?: string;
  numberOfVotes?: number;
  email?: string;
  oathDate?: string;
  genitiveName?: string;
}

interface DzienStatystyki {
  sitting: number;
  date: string;
  numVotings: number;
  numVoted: number;
  numMissed: number;
  absenceExcuse: boolean | null;
}

interface KlubZRejestru {
  id: string;
  name: string;
  membersCount: number;
  members?: Array<{ id: number; firstName?: string; lastName?: string; function?: string; joinDate?: string }>;
  email?: string;
  phone?: string;
}

function skrotPosla(p: PoselZRejestru) {
  return {
    id: p.id,
    imieNazwisko: czysty(p.firstLastName),
    klub: p.club ?? null,
    okreg: p.districtNum ?? null,
    okregNazwa: p.districtName ?? null,
    wojewodztwo: p.voivodeship ?? null,
    aktywny: p.active,
    dataSlubowania: p.oathDate ?? null,
    powodWygasniecia: p.inactiveCause ?? null,
    // Na liście, nie tylko w profilu: ranking głosów w okręgu ma być jednym wywołaniem, a nie 20.
    glosowWWyborach: p.numberOfVotes ?? null,
    ...(p.active ? {} : { dataWygasniecia: p.mandateExpiryDate ?? null, opisWygasniecia: czysty(p.waiverDesc) || null }),
  };
}

export const znajdzPosla = narzedzie({
  nazwa: 'znajdz_posla',
  tytul: 'Znajdź posła',
  opis:
    'Szuka posłów danej kadencji po imieniu lub nazwisku (bez względu na polskie znaki), klubie lub numerze okręgu. ' +
    'Zwraca numer posła (id), którego wymagają inne narzędzia. Klub to przynależność DZIŚ, nie w dniu dawnego głosowania. ' +
    'Przy pośle, którego mandat wygasł, wynik podaje posłów jego okręgu ślubujących później (pole slubowaliPozniejWOkregu), a przy pośle, ' +
    'który ślubował w trakcie kadencji, mandaty wygasłe wcześniej w jego okręgu (wygasliWczesniejWOkregu). Każdy poseł ma glosowWWyborach; ' +
    'sortuj="glosy" układa listę od największej liczby głosów (np. okreg + sortuj="glosy" to ranking okręgu). tylkoWygasle=true: tylko posłowie z wygasłym mandatem, z liczbą według powodu.',
  wejscie: z.object({
    fraza: z.string().max(100).optional().describe('Imię i/lub nazwisko, np. "Petru" albo "ryszard petru"'),
    klub: z.string().max(50).optional().describe('Skrót klubu z rejestru, np. "KO", "PiS", "PSL-TD", "Polska2050"; jednoznaczny początek skrótu ("PSL") też wystarczy'),
    okreg: z.coerce.number().int().min(1).max(41).optional().describe('Numer okręgu wyborczego (1-41)'),
    tylkoAktywni: z
      .boolean()
      .optional()
      .describe('Pomiń posłów, których mandat wygasł. Domyślnie tak w bieżącej kadencji, a nie w zakończonych (tam mandat wygasł wszystkim)'),
    tylkoWygasle: z.boolean().optional().describe('Tylko posłowie, których mandat wygasł przed końcem kadencji (z liczbą według powodu wygaśnięcia)'),
    sortuj: z.enum(['rejestr', 'glosy']).optional().describe('Kolejność: "rejestr" (domyślnie, alfabetycznie) albo "glosy" (od największej liczby głosów w wyborach)'),
    limit: limit(100, 100),
    przesuniecie,
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const sciezka = `${T(a.kadencja)}/MP`;
    const wszyscy = jakoLista<PoselZRejestru>(await zrodlo.json<unknown>(sciezka), 'lista posłów');
    // Wygasły przed końcem kadencji: w zakończonej kadencji rejestr ma active=false u wszystkich,
    // więc tam rozstrzyga data wygaśnięcia.
    const wygasl = (p: PoselZRejestru) => !p.active && (a.kadencja === BIEZACA_KADENCJA || !!p.mandateExpiryDate);
    const tylkoAktywni = a.tylkoWygasle ? false : (a.tylkoAktywni ?? a.kadencja === BIEZACA_KADENCJA);
    // Dzielimy też po łączniku: „Kluzik-Rostkowska” to dwa człony nazwiska, a słowa posła niżej
    // są dzielone tak samo; bez tego fraza z łącznikiem nie pasowała do niczego.
    const slowa = klucz(a.fraza).split(/[\s-]+/).filter(Boolean);
    const uwagiOdmiany: string[] = [];
    // Skrót klubu: „PSL” dawał zero, bo w rejestrze klub nazywa się „PSL-TD”. Jednoznaczny początek
    // skrótu dopasowujemy i mówimy o tym; niejednoznaczny albo nieznany zostaje zerem z przyczyną.
    let klub: string | null = null;
    if (a.klub) {
      const skroty = [...new Set(wszyscy.map((p) => p.club).filter((c): c is string => !!c))].sort();
      const szukany = klucz(a.klub);
      const dokladny = skroty.find((c) => klucz(c) === szukany);
      const poPoczatku = skroty.filter((c) => klucz(c).startsWith(szukany));
      if (dokladny) klub = klucz(dokladny);
      else if (poPoczatku.length === 1) {
        klub = klucz(poPoczatku[0]);
        uwagiOdmiany.push(`W rejestrze klub „${a.klub}” nazywa się ${poPoczatku[0]}; pokazano posłów klubu ${poPoczatku[0]}.`);
      } else {
        klub = '\u0000';
        uwagiOdmiany.push(
          poPoczatku.length > 1
            ? `„${a.klub}” pasuje do kilku klubów: ${poPoczatku.join(', ')}. Powtórz z jednym skrótem.`
            : `W rejestrze kadencji ${a.kadencja} nie ma klubu „${a.klub}”. Skróty z rejestru: ${skroty.join(', ')}.`,
        );
      }
    }
    const pasujeNazwa = (p: PoselZRejestru, slowaFrazy: string[]) => {
      if (!slowaFrazy.length) return true;
      // Każde słowo frazy musi być początkiem któregoś słowa imienia lub nazwiska (także członu po dywizie).
      const czesci = klucz(`${p.firstName} ${p.secondName ?? ''} ${p.lastName}`).split(/[\s-]+/).filter(Boolean);
      return slowaFrazy.every((s) => czesci.some((c) => c.startsWith(s)));
    };
    const pasuje = (p: PoselZRejestru, slowaFrazy: string[]) => {
      if (tylkoAktywni && !p.active) return false;
      if (a.tylkoWygasle && !wygasl(p)) return false;
      if (klub && klucz(p.club) !== klub) return false;
      if (a.okreg && p.districtNum !== a.okreg) return false;
      return pasujeNazwa(p, slowaFrazy);
    };
    let trafienia = wszyscy.filter((p) => pasuje(p, slowa));
    // Pytanie o posła po nazwisku, którego mandat wygasł: domyślny filtr aktywnych zwracał zero
    // i model musiał zgadnąć, że trzeba zapytać drugi raz. Szukamy od razu wśród wszystkich.
    if (trafienia.length === 0 && slowa.length && tylkoAktywni && a.tylkoAktywni === undefined) {
      const wygasli = wszyscy.filter((p) => !p.active && pasuje({ ...p, active: true }, slowa));
      if (wygasli.length) {
        trafienia = wygasli;
        uwagiOdmiany.push('Wśród posłów z trwającym mandatem nikogo nie ma; pokazano posłów, których mandat wygasł.');
      }
    }
    // Nazwisko w przypadku zależnym („Króla”, „Hołowni”): szukamy też formy bez końcówki i łączymy
    // wyniki. Zawsze, nie tylko przy zerze trafień: „Króla” trafia „Królak”, a gubi obu posłów Król.
    const rdzen = (s: string) => (s.length >= 4 ? s.replace(/(owi|emu|ego|iej|ej|em|ie|a|u|y|i|e)$/, '') : s);
    const slowaR = slowa.map(rdzen);
    if (slowaR.some((s, i) => s !== slowa[i])) {
      const juz = new Set(trafienia.map((p) => p.id));
      const dodatkowi = wszyscy.filter((p) => !juz.has(p.id) && pasuje(p, slowaR));
      if (dodatkowi.length) {
        trafienia = [...trafienia, ...dodatkowi];
        uwagiOdmiany.push(
          `Fraza mogła być odmieniona; dołączono posłów dla formy „${slowaR.join(' ')}”: ${dodatkowi.map((p) => p.firstLastName).join(', ')}. Nazwiska podawaj w mianowniku.`,
        );
      }
    }
    const uwagi: string[] = [...uwagiOdmiany];
    if (wszyscy.length === 0) uwagi.push(`Rejestr nie ma posłów kadencji ${a.kadencja}.`);
    // Przy filtrze okręgu uwaga o płci to szum; przy liście całej izby albo klubu pytanie o kobiety jest typowe.
    if (!slowa.length && !a.okreg) {
      uwagi.push('Rejestr Sejmu nie ma pola płci: liczby kobiet i mężczyzn nie da się podać jako faktu z API; szacunek po imionach oznacz jako przybliżenie.');
    }
    // Ostatnia próba: fraza sklejona bez spacji i dywizów jako kawałek sklejonego imienia i nazwiska.
    // Tekst z PDF-u ma dywizy z łamania wiersza w środku nazwiska („Dziemiano-wicz”).
    if (trafienia.length === 0 && slowa.length) {
      const sklejona = slowa.join('');
      const sklejeni = sklejona.length >= 5
        ? wszyscy.filter((p) => pasuje(p, []) && klucz(`${p.firstName}${p.secondName ?? ''}${p.lastName}`).replace(/[\s-]+/g, '').includes(sklejona))
        : [];
      if (sklejeni.length) {
        trafienia = sklejeni;
        uwagi.push(`Fraza „${a.fraza}” pasuje dopiero po sklejeniu bez spacji i dywizów: ${sklejeni.map((p) => p.firstLastName).join(', ')}. Sprawdź, czy to ta osoba.`);
      }
    }
    let odpowiedz: string | undefined;
    if (trafienia.length === 0 && slowa.length && wszyscy.length) {
      // Zero przy frazie: najpierw sprawdzamy, czy nazwisko w ogóle jest w rejestrze kadencji.
      // Samo „sprawdź pisownię” model czytał jako niepewność, a to fakt: takiego posła nie było.
      const poNazwisku = wszyscy.filter((p) => pasujeNazwa(p, slowa) || pasujeNazwa(p, slowaR));
      if (poNazwisku.length === 0) {
        odpowiedz =
          `${opisKadencji(a.kadencja)}: w rejestrze Sejmu nie ma posła pasującego do „${a.fraza}”, także wśród posłów, których mandat wygasł. ` +
          'W tej kadencji nikt o tym nazwisku nie był posłem.';
        uwagi.push(
          `Szukano wśród wszystkich ${wszyscy.length} posłów kadencji ${a.kadencja}, z wygasłymi mandatami włącznie. Każde słowo frazy musi być początkiem imienia albo członu nazwiska ` +
            '(np. „Kluzik”, „Rostkowska”, „Kluzik-Rostkowska”). Osoba mogła być posłem w innej kadencji (parametr kadencja) albo pełnić funkcję bez mandatu posła (np. minister spoza Sejmu).',
        );
      } else {
        uwagi.push(
          `„${a.fraza}” pasuje do ${poNazwisku.map((p) => `${p.firstLastName} (id ${p.id}, ${p.club ?? 'bez klubu'}, okręg ${p.districtNum ?? '?'}${p.active ? '' : ', mandat wygasł'})`).join(', ')}, ` +
            'ale nie spełnia pozostałych filtrów (klub, okreg, tylkoAktywni, tylkoWygasle).',
        );
      }
    }
    // Filtr okręgu lub klubu z domyślnym pominięciem wygasłych mandatów: mówimy, ilu pominięto,
    // żeby „kto był wybrany z okręgu” nie dostało odpowiedzi bez tych posłów.
    if (tylkoAktywni && !slowa.length && (a.okreg || klub)) {
      const pominieci = wszyscy.filter((p) => !p.active && pasuje({ ...p, active: true }, slowa));
      if (pominieci.length) {
        uwagi.push(
          `Pominięto ${pominieci.length} ${pominieci.length === 1 ? 'posła' : 'posłów'} z wygasłym mandatem (${pominieci.map((p) => p.firstLastName).join(', ')}); ` +
            'pokazuje ich tylkoAktywni=false. Klub przy nich to klub z chwili wygaśnięcia.',
        );
      }
    }
    const nazwiska = new Map<string, string[]>();
    for (const p of trafienia) nazwiska.set(klucz(p.lastName), [...(nazwiska.get(klucz(p.lastName)) ?? []), p.firstLastName]);
    const imiennicy = [...nazwiska.values()].filter((osoby) => osoby.length > 1 && slowa.length === 1);
    const niejednoznaczne = imiennicy.length
      ? {
          powod: `To nazwisko nosi kilku posłów: ${imiennicy.map((o) => o.join(', ')).join('; ')}.`,
          coZrobic: 'Jeśli pytanie nie wskazuje imienia, odpowiedz o każdym z nich albo zapytaj użytkownika, o którego chodzi.',
        }
      : undefined;
    // Rejestr nie zapisuje, kto kogo zastąpił. Mamy okręg, datę wygaśnięcia i daty ślubowania,
    // więc podajemy posłów tego okręgu, którzy ślubowali później, jako wniosek, nie fakt.
    const wygasli = a.tylkoWygasle && !slowa.length ? [] : trafienia.filter((p) => !p.active && p.districtNum && p.mandateExpiryDate).slice(0, 3);
    const dzien = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    const nastepcy = wygasli.map((p) => {
      // Kolejność tylko po dacie ślubowania: sortowanie „najpierw ten sam klub” model czytał jako
      // wskazanie następcy (Wąsik → „logicznie Kulpa, bo pierwsza na liście”).
      const poslowie = wszyscy
        .filter((q) => q.id !== p.id && q.districtNum === p.districtNum && q.oathDate && q.oathDate >= p.mandateExpiryDate!)
        .sort((x, y) => x.oathDate!.localeCompare(y.oathDate!))
        .map((q) => ({
          id: q.id,
          imieNazwisko: czysty(q.firstLastName),
          klub: q.club ?? null,
          tenSamKlub: !!p.club && q.club === p.club,
          dataSlubowania: q.oathDate,
          aktywny: q.active,
        }));
      // Inne mandaty wygasłe w tym okręgu w podobnym czasie: ci sami posłowie mogli objąć któryś
      // z nich (okręg 16: Wąsik XII 2023, Ozdoba i Kierwiński VI 2024, trzech nowych posłów).
      const ostatnieSlubowanie = poslowie.at(-1)?.dataSlubowania;
      const inneWygasniecia = wszyscy
        .filter(
          (q) =>
            q.id !== p.id &&
            !q.active &&
            q.districtNum === p.districtNum &&
            q.mandateExpiryDate &&
            dzien(q.mandateExpiryDate) >= dzien(p.mandateExpiryDate!) - 365 &&
            (ostatnieSlubowanie ? q.mandateExpiryDate <= ostatnieSlubowanie : dzien(q.mandateExpiryDate) <= dzien(p.mandateExpiryDate!) + 365),
        )
        .sort((x, y) => x.mandateExpiryDate!.localeCompare(y.mandateExpiryDate!))
        .map((q) => ({
          id: q.id,
          imieNazwisko: czysty(q.firstLastName),
          klub: q.club ?? null,
          dataWygasniecia: q.mandateExpiryDate,
          opisWygasniecia: czysty(q.waiverDesc) || null,
        }));
      return {
        po: { id: p.id, imieNazwisko: czysty(p.firstLastName), dataWygasniecia: p.mandateExpiryDate },
        okreg: p.districtNum,
        klub: p.club ?? null,
        poslowie,
        ...(inneWygasniecia.length ? { inneWygasnieciaWOkregu: inneWygasniecia } : {}),
      };
    });
    for (const n of nastepcy) {
      const inne = n.inneWygasnieciaWOkregu ?? [];
      const wakatyKlubu = n.klub ? 1 + inne.filter((q) => q.klub === n.klub).length : 1;
      const zKlubu = n.poslowie.filter((q) => q.tenSamKlub);
      uwagi.push(
        `Rejestr Sejmu nie zapisuje, kto kogo zastąpił. W okręgu ${n.okreg} po wygaśnięciu mandatu ${n.po.imieNazwisko} (${n.po.dataWygasniecia}) ` +
          (n.poslowie.length
            ? `ślubowali: ${n.poslowie.map((q) => `${q.imieNazwisko} (${q.klub ?? 'bez klubu'}, ${q.dataSlubowania}, id ${q.id})`).join(', ')}. ` +
              'Następstwo to wniosek z okręgu i dat, nie fakt z rejestru; tak je podaj. Mandat obejmuje kandydat z tej samej listy wyborczej, ' +
              'więc następcą jest raczej poseł tego samego klubu (tenSamKlub=true), a poseł innego klubu raczej nie. ' +
              'Kolejność listy to kolejność ślubowań, nie wskazanie następcy. ' +
              'Klub to stan dziś, nie komitet wyborczy: komitet mógł się od tego czasu rozejść na kilka klubów.'
            : 'nikt jeszcze nie złożył ślubowania.'),
      );
      if (inne.length) {
        uwagi.push(
          `W tym okręgu w podobnym czasie wygasły też mandaty: ${inne.map((q) => `${q.imieNazwisko} (${q.klub ?? 'bez klubu'}, ${q.dataWygasniecia}${q.opisWygasniecia ? `, ${q.opisWygasniecia}` : ''})`).join(', ')} ` +
            '(pole inneWygasnieciaWOkregu). Posłowie ślubujący później mogli objąć którykolwiek z tych mandatów.' +
            (wakatyKlubu > 1
              ? ` Klub ${n.klub} stracił tu ${odmiana(wakatyKlubu, ['mandat', 'mandaty', 'mandatów'])}, a posłów tego klubu ślubujących później jest ${zKlubu.length}: ` +
                'API nie rozstrzyga, kto objął który mandat. Nie wskazuj jednego następcy; podaj ich razem jako następców tych mandatów.'
              : ''),
        );
      }
    }
    // Ślubował w trakcie kadencji: symetrycznie do slubowaliPozniejWOkregu podajemy mandaty wygasłe
    // wcześniej w jego okręgu. Tylko przy frazie: przy liście okręgu byłby to szum przy każdym pośle.
    const poczatek = wszyscy.map((q) => q.oathDate).filter((d): d is string => !!d).sort()[0];
    const pozniejsi = slowa.length
      ? trafienia.filter((p) => p.districtNum && p.oathDate && poczatek && dzien(p.oathDate) > dzien(poczatek) + 30).slice(0, 3)
      : [];
    const poprzednicy = pozniejsi
      .map((p) => ({
        posel: { id: p.id, imieNazwisko: czysty(p.firstLastName), dataSlubowania: p.oathDate },
        okreg: p.districtNum,
        klub: p.club ?? null,
        poslowie: wszyscy
          .filter(
            (q) =>
              q.id !== p.id &&
              q.districtNum === p.districtNum &&
              q.mandateExpiryDate &&
              q.mandateExpiryDate <= p.oathDate! &&
              dzien(q.mandateExpiryDate) >= dzien(p.oathDate!) - 365,
          )
          .sort((x, y) => x.mandateExpiryDate!.localeCompare(y.mandateExpiryDate!))
          .map((q) => ({
            id: q.id,
            imieNazwisko: czysty(q.firstLastName),
            klub: q.club ?? null,
            tenSamKlub: !!p.club && q.club === p.club,
            dataWygasniecia: q.mandateExpiryDate,
            opisWygasniecia: czysty(q.waiverDesc) || null,
          })),
      }))
      .filter((x) => x.poslowie.length > 0);
    for (const n of poprzednicy) {
      const zKlubu = n.poslowie.filter((q) => q.tenSamKlub);
      uwagi.push(
        `Rejestr Sejmu nie zapisuje, kogo poseł zastąpił. ${n.posel.imieNazwisko} ślubował(a) w trakcie kadencji (${n.posel.dataSlubowania}); wcześniej w okręgu ${n.okreg} wygasły mandaty: ` +
          `${n.poslowie.map((q) => `${q.imieNazwisko} (${q.klub ?? 'bez klubu'}, ${q.dataWygasniecia}, id ${q.id})`).join(', ')}. ` +
          'Poprzednik to wniosek z okręgu i dat, nie fakt z rejestru; tak go podaj. Mandat obejmuje kandydat z tej samej listy, więc poprzednikiem jest raczej poseł tego samego klubu (tenSamKlub=true). ' +
          (zKlubu.length > 1 || n.poslowie.length > 1
            ? 'Wakatów jest tu kilka: API nie rozstrzyga, który z nich objął; nie wskazuj jednego poprzednika.'
            : 'Klub to stan dziś, nie komitet wyborczy.'),
      );
    }
    // Lista wygasłych mandatów: liczba według powodu z rejestru, żeby „ilu posłów odeszło i dlaczego” nie wymagało liczenia.
    let wedlugPowodu: Record<string, number> | undefined;
    if (a.tylkoWygasle) {
      wedlugPowodu = {};
      for (const p of trafienia) {
        // Bez inactiveCause (np. utrata prawa wybieralności) rejestr ma sam opis wygaśnięcia.
        const powod = czysty(p.inactiveCause) || czysty(p.waiverDesc) || 'powód niepodany w rejestrze';
        wedlugPowodu[powod] = (wedlugPowodu[powod] ?? 0) + 1;
      }
      const opis = Object.entries(wedlugPowodu)
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      odpowiedz ??= `${opisKadencji(a.kadencja)}: mandat wygasł przed końcem kadencji ${odmiana(trafienia.length, ['posłowi', 'posłom', 'posłom'])}${trafienia.length ? ` (${opis})` : ''}.`;
      uwagi.push('powodWygasniecia i opisWygasniecia to słowa rejestru (np. zrzeczenie, wybór do Parlamentu Europejskiego, śmierć); nie dopisuj przyczyn spoza nich.');
    }
    if (a.sortuj === 'glosy') {
      // Stabilne sortowanie: przy remisie zostaje kolejność rejestru. Brak liczby na końcu.
      trafienia = [...trafienia].sort((x, y) => (y.numberOfVotes ?? -1) - (x.numberOfVotes ?? -1));
      uwagi.push(
        'Lista od największej liczby głosów w wyborach do Sejmu (glosowWWyborach, dane rejestru Sejmu). ' +
          (tylkoAktywni ? 'Posłowie z wygasłym mandatem są pominięci; ranking z nimi daje tylkoAktywni=false. ' : '') +
          'To głosy oddane na kandydata, nie na listę.',
      );
    }
    const koniec = a.przesuniecie + a.limit;
    if (koniec < trafienia.length) uwagi.push(`Pokazano ${a.przesuniecie + 1}–${koniec} z ${trafienia.length}; dalej: przesuniecie=${koniec}.`);
    return {
      ...(koniec < trafienia.length ? { pokazano: `posłów ${a.przesuniecie + 1}–${koniec} z ${trafienia.length}`, nastepnePrzesuniecie: koniec } : {}),
      ...(odpowiedz ? { odpowiedz } : {}),
      ...(niejednoznaczne ? { niejednoznaczne } : {}),
      razem: trafienia.length,
      ...(wedlugPowodu ? { wedlugPowodu } : {}),
      poslowie: trafienia.slice(a.przesuniecie, koniec).map(skrotPosla),
      ...(nastepcy.length ? { slubowaliPozniejWOkregu: nastepcy } : {}),
      ...(poprzednicy.length ? { wygasliWczesniejWOkregu: poprzednicy } : {}),
      zrodla: [zrodlo.adres(sciezka)],
      uwagi,
    };
  },
});

/** Suma dni statystyki Sejmu; jedno miejsce, żeby kadencja, okres i posiedzenie liczyły się tak samo. */
function zliczDni(dni: readonly DzienStatystyki[]) {
  const suma = (f: (d: DzienStatystyki) => number) => dni.reduce((s, d) => s + (f(d) || 0), 0);
  const opuszczonych = suma((d) => d.numMissed);
  const usprawiedliwionych = suma((d) => (d.absenceExcuse === true ? d.numMissed : 0));
  const zNieobecnoscia = dni.filter((d) => d.numMissed > 0);
  return {
    dniPosiedzen: dni.length,
    glosowan: suma((d) => d.numVotings),
    oddanych: suma((d) => d.numVoted),
    opuszczonych,
    opuszczonychUsprawiedliwionych: usprawiedliwionych,
    opuszczonychNieusprawiedliwionych: opuszczonych - usprawiedliwionych,
    dniZNieobecnoscia: zNieobecnoscia.length,
    dniUsprawiedliwione: zNieobecnoscia.filter((d) => d.absenceExcuse === true).length,
    dniNieusprawiedliwione: zNieobecnoscia.filter((d) => d.absenceExcuse === false).length,
    dniBezDecyzji: zNieobecnoscia.filter((d) => d.absenceExcuse !== true && d.absenceExcuse !== false).length,
  };
}

/** Suma na posiedzenie: zamiast 160 wierszy dni do dodawania przez model. */
function sumyPosiedzen(dni: readonly DzienStatystyki[]) {
  const grupy = new Map<number, DzienStatystyki[]>();
  for (const d of dni) grupy.set(d.sitting, [...(grupy.get(d.sitting) ?? []), d]);
  return [...grupy.entries()]
    .map(([posiedzenie, lista]) => {
      const daty = lista.map((d) => d.date).sort();
      return { posiedzenie, od: daty[0], do: daty[daty.length - 1], ...zliczDni(lista) };
    })
    .sort((x, y) => y.od.localeCompare(x.od) || y.posiedzenie - x.posiedzenie);
}

export const profilPosla = narzedzie({
  nazwa: 'profil_posla',
  tytul: 'Profil posła',
  opis:
    'Dane posła z rejestru: klub, okręg wyborczy, liczba głosów zdobytych w wyborach do Sejmu (glosowWWyborach), data i miejsce urodzenia, ' +
    'wykształcenie, zawód, data ślubowania, a przy wygasłym mandacie data i powód wygaśnięcia. Do tego statystyka głosowań według Sejmu (/MP/{id}/votings/stats): ile głosowań było, ' +
    'w ilu wziął udział, ile opuścił i ile z opuszczonych dni Sejm uznał za usprawiedliwione. ' +
    'To liczby Sejmu, nie nasze wyliczenie. Z parametrem dni=true dochodzi rozbicie na dni posiedzeń, z posiedzenia=true suma na każde posiedzenie, ' +
    'a z od/do (daty włącznie) suma statystyki za ten okres (pole zakres), np. rok 2025: od=2025-01-01, do=2025-12-31. Klub to przynależność DZIŚ; ' +
    'klub z konkretnego dnia daje glosowanie z poselId (pole klubWDniuGlosowania). Numer posła obowiązuje w jednej kadencji: ' +
    'w innej kadencji ten sam numer to inna osoba, więc szukaj posła w tej kadencji przez znajdz_posla.',
  wejscie: z.object({
    id: z.coerce.number().int().min(1).describe('Numer posła z znajdz_posla'),
    dni: z.boolean().default(false).describe('Dołącz statystykę dzień po dniu (najnowsze najpierw); z od/do tylko dni z zakresu'),
    posiedzenia: z.boolean().default(false).describe('Dołącz sumę na każde posiedzenie (najnowsze najpierw); z od/do tylko dni z zakresu'),
    od: data.optional().describe('Początek okresu (włącznie) dla sumy w polu zakres'),
    do: data.optional().describe('Koniec okresu (włącznie) dla sumy w polu zakres'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    sprawdzPrzedzial(a.od, a.do);
    const sciezkaPosla = `${T(a.kadencja)}/MP/${a.id}`;
    const sciezkaStat = `${T(a.kadencja)}/MP/${a.id}/votings/stats`;
    const [p, stat] = await Promise.all([
      zrodlo.json<unknown>(sciezkaPosla).then((x) => jakoRekord<PoselZRejestru>(x, 'poseł', ['id'], ['lastName'])),
      zrodlo.json<unknown>(sciezkaStat).then((x) => jakoLista<DzienStatystyki>(x, 'statystyka posła')),
    ]);
    if (!p) return { ...brak404(`Rejestr nie zna posła ${a.id} w kadencji ${a.kadencja}.`), zrodla: [zrodlo.adres(sciezkaPosla)] };

    const dni = stat;
    const calosc = zliczDni(dni);
    const zakresowy = !!(a.od || a.do);
    const wZakresie = zakresowy ? dni.filter((d) => (!a.od || d.date >= a.od) && (!a.do || d.date <= a.do)) : dni;
    const zakres = zakresowy ? { od: a.od ?? null, do: a.do ?? null, ...zliczDni(wZakresie) } : undefined;

    // Zakończona kadencja: rejestr ma active=false u wszystkich, więc „klub dziś, mandat wygasł”
    // było nieprawdą o pośle, który zasiadał do końca kadencji.
    const zakonczona = a.kadencja !== BIEZACA_KADENCJA;
    const stanPosla = zakonczona
      ? p.mandateExpiryDate
        ? `klub w chwili wygaśnięcia mandatu: ${p.club ?? 'bez klubu'}; mandat wygasł ${p.mandateExpiryDate}, przed końcem kadencji ${a.kadencja}`
        : `klub na koniec kadencji ${a.kadencja}: ${p.club ?? 'bez klubu'}; mandat do końca kadencji`
      : `klub dziś: ${p.club ?? 'bez klubu'}${p.active ? '' : `, mandat wygasł${p.mandateExpiryDate ? ` ${p.mandateExpiryDate}` : ''}`}`;
    const zdanie = (z: ReturnType<typeof zliczDni>) =>
      `opuszczone ${z.opuszczonych} z ${z.glosowan} głosowań; dni z nieobecnością ${z.dniZNieobecnoscia}, w tym usprawiedliwione ` +
      `${z.dniUsprawiedliwione}, nieusprawiedliwione ${z.dniNieusprawiedliwione}${z.dniBezDecyzji ? `, bez decyzji Sejmu ${z.dniBezDecyzji}` : ''}`;
    const okres = zakres ? `od ${a.od ?? 'początku kadencji'} do ${a.do ?? 'dziś'}` : '';
    const posiedzenia = a.posiedzenia ? sumyPosiedzen(wZakresie) : undefined;
    return {
      znaleziono: true,
      odpowiedz:
        `${zakonczona ? `${opisKadencji(a.kadencja)}. ` : ''}${p.firstLastName} (${stanPosla}), wg statystyki Sejmu` +
        (zakres ? ` ${okres}: ${zdanie(zakres)}. W całej kadencji: ${zdanie(calosc)}.` : `: ${zdanie(calosc)}.`),
      posel: {
        ...skrotPosla(p),
        drugieImie: p.secondName ?? null,
        dataUrodzenia: p.birthDate ?? null,
        miejsceUrodzenia: p.birthLocation ?? null,
        zawod: p.profession ?? null,
        wyksztalcenie: p.educationLevel ?? null,
        glosowWWyborach: p.numberOfVotes ?? null,
        dataSlubowania: p.oathDate ?? null,
        email: p.email ?? null,
        zdjecie: zrodlo.adres(`${T(a.kadencja)}/MP/${a.id}/photo`),
      },
      statystykaSejmu: calosc,
      ...(zakres ? { zakres } : {}),
      ...(posiedzenia ? { posiedzenia } : {}),
      dni: a.dni
        ? [...wZakresie]
            .sort((x, y) => y.date.localeCompare(x.date))
            .map((d) => ({
              posiedzenie: d.sitting,
              data: d.date,
              glosowan: d.numVotings,
              oddanych: d.numVoted,
              opuszczonych: d.numMissed,
              usprawiedliwione: d.numMissed > 0 ? d.absenceExcuse === true : null,
            }))
        : undefined,
      zrodla: [zrodlo.adres(sciezkaPosla), zrodlo.adres(sciezkaStat)],
      uwagi: [
        'statystykaSejmu to liczby samego Sejmu. Usprawiedliwienie jest decyzją Sejmu i dotyczy całego dnia posiedzenia.',
        ...(zakres
          ? [
              `zakres to suma dni posiedzeń z datą od ${a.od ?? 'początku'} do ${a.do ?? 'końca'} włącznie (${odmiana(zakres.dniPosiedzen, ['dzień', 'dni', 'dni'])}); ` +
                'podawaj ją jako liczbę za ten okres, a statystykaSejmu jako liczbę za całą kadencję.',
            ]
          : []),
        ...(posiedzenia
          ? ['posiedzenia to suma dni każdego posiedzenia (dniNieusprawiedliwione liczy dni, opuszczonych liczy głosowania). Posiedzenie bywa podzielone na kilka tygodni.']
          : []),
        // Sprawdzone 24 IX 2026 na X kadencji: 4775 głosowań w rejestrze, 52 apele, statystyka 4714; apel wyłączony
        // w 49 z 52 dni, policzony w 2, a na 9 dniach pominięte też pojedyncze inne głosowania. Liczb nie ma w uwadze, bo się zestarzeją.
        'Statystyka Sejmu z reguły nie liczy apeli o kworum i bywa, że pomija pojedyncze inne głosowania, więc jej liczba głosowań bywa mniejsza ' +
          'niż liczba głosowań z list posiedzeń (lista_posiedzen i glosy_posla_w_dniu podają apele osobno); przy cytowaniu mów, że to liczba Sejmu.',
        'Podawaj liczby z mianownikiem (ile głosowań było) i z podziałem na usprawiedliwione, prosto z pól (nie odejmuj sam); nie wyciągaj z nich ocen osoby.',
        (zakonczona ? `klub to przynależność na koniec kadencji ${a.kadencja}. ` : 'klub to przynależność DZIŚ. ') + 'Klub w dniu dawnego głosowania podaje glosowanie z poselId (glosPosla.klubWDniuGlosowania); nie zakładaj, że klub się nie zmieniał.',
        ...(a.kadencja !== BIEZACA_KADENCJA
          ? [`To poseł nr ${a.id} w kadencji ${a.kadencja}: ${p.firstLastName}. Numery nie przenoszą się między kadencjami; tę samą osobę w innej kadencji znajdź przez znajdz_posla.`]
          : []),
      ],
    };
  },
});

/**
 * Klub czy koło, z nazwy. Słowo może stać w środku („Koalicyjny Klub Parlamentarny Lewicy”),
 * więc szukamy go gdziekolwiek; sprawdzanie początku nazwy gubiło Lewicę.
 */
export function rodzajKlubu(skrot: string, nazwa: string | null | undefined): 'klub' | 'koło' | 'niezrzeszeni' | null {
  if (skrot === 'niez.') return 'niezrzeszeni';
  const slowa = klucz(nazwa).split(/[^a-z0-9]+/);
  if (slowa.includes('kolo')) return 'koło';
  if (slowa.includes('klub')) return 'klub';
  return null;
}

const UWAGA_OD =
  'od to data wejścia posła do TEGO klubu, nie data powstania klubu ani początek mandatu. W jakim klubie poseł był wcześniej, ' +
  'pokazuje lista imienna głosowania sprzed tej daty (glosowanie z poselId albo z listaImienna: pole klub to klub w dniu głosowania).';

export const kluby = narzedzie({
  nazwa: 'kluby',
  tytul: 'Kluby i koła poselskie',
  opis:
    'Bez parametru: kluby i koła w Sejmie danej kadencji z liczbą członków (stan na dziś) i rodzajem (klub, koło, niezrzeszeni). ' +
    'Z parametrem klub: jeden klub z pełną nazwą, kontaktem, logo i dzisiejszym składem z funkcjami (przewodniczący, wiceprzewodniczący, sekretarz…) ' +
    'i datą wejścia każdego posła do klubu. Skrót potoczny („PSL”) albo część nazwy dopasowuje do skrótu z rejestru („PSL-TD”), gdy jest jednoznaczny. ' +
    'Bez parametru klub także ostatnie wejścia posłów do klubów (pole ostatnieZmiany: kto, do którego klubu, od kiedy), czyli „kto ostatnio zmienił klub”.',
  wejscie: z.object({
    klub: z.string().min(1).max(80).optional().describe('Skrót klubu z listy, np. "KO", "PiS", "Konfederacja_KP"; można też początek skrótu albo część nazwy'),
    kadencja,
  }),
  async wykonaj(a, zrodlo) {
    const sLista = `${T(a.kadencja)}/clubs`;
    if (a.klub) {
      // Skrót idzie do ścieżki tylko, gdy ma bezpieczne znaki; inaczej (spacje, polskie litery)
      // od razu dopasowujemy go do listy klubów.
      const bezpieczny = /^[A-Za-z0-9][A-Za-z0-9_\-.]{0,39}$/.test(a.klub) && !a.klub.includes('..');
      const pobierz = async (skrot: string) =>
        jakoRekord<KlubZRejestru & { members?: Array<{ id: number; firstName?: string; lastName?: string; function?: string; joinDate?: string }> }>(
          await zrodlo.json<unknown>(`${T(a.kadencja)}/clubs/${skrot}`),
          'klub',
          [],
          ['id'],
        );
      let k = bezpieczny ? await pobierz(a.klub) : null;
      const uwagi: string[] = [];
      const zrodla: string[] = [];
      if (bezpieczny) zrodla.push(zrodlo.adres(`${T(a.kadencja)}/clubs/${a.klub}`));
      if (!k) {
        const lista = jakoLista<KlubZRejestru>(await zrodlo.json<unknown>(sLista), 'kluby');
        zrodla.push(zrodlo.adres(sLista));
        const szukany = klucz(a.klub);
        const poSkrocie = lista.filter((x) => klucz(x.id).startsWith(szukany));
        const kandydaci = poSkrocie.length ? poSkrocie : lista.filter((x) => klucz(x.name).includes(szukany));
        if (kandydaci.length !== 1) {
          return {
            znaleziono: false,
            ...(kandydaci.length > 1 ? { pasujace: kandydaci.map((x) => ({ skrot: x.id, nazwa: czysty(x.name) })) } : {}),
            zrodla,
            uwagi: [
              kandydaci.length > 1
                ? `„${a.klub}” pasuje do kilku klubów: ${kandydaci.map((x) => x.id).join(', ')}. Powtórz z jednym skrótem.`
                : `Nie ma klubu „${a.klub}”. Skróty z rejestru: ${lista.map((x) => x.id).join(', ')}.`,
            ],
          };
        }
        k = await pobierz(kandydaci[0].id);
        zrodla.push(zrodlo.adres(`${T(a.kadencja)}/clubs/${kandydaci[0].id}`));
        if (!k) return { znaleziono: false, zrodla, uwagi: [`Rejestr nie oddał klubu ${kandydaci[0].id}.`] };
        uwagi.push(`„${a.klub}” to w rejestrze klub ${k.id} (${czysty(k.name)}); dalej używaj skrótu ${k.id}.`);
      }
      uwagi.push(UWAGA_OD);
      return {
        znaleziono: true,
        skrot: k.id,
        nazwa: czysty(k.name),
        rodzaj: rodzajKlubu(k.id, k.name),
        czlonkow: k.membersCount,
        email: czysty(k.email) || null,
        telefon: czysty(k.phone) || null,
        logo: zrodlo.adres(`${T(a.kadencja)}/clubs/${k.id}/logo`),
        sklad: (k.members ?? []).map((m) => ({
          id: m.id,
          imieNazwisko: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(),
          funkcja: czysty(m.function) || 'członek',
          od: m.joinDate ?? null,
        })),
        zrodla,
        uwagi,
      };
    }
    // Lista posłów tylko po daty ślubowania: wejście do klubu w dniu ślubowania to nowy mandat, nie
    // zmiana klubu (03-b: Bożena Borowiec, Lewica, 2026-05-15). Bez niej zostaje sama lista klubów.
    const sPoslowie = `${T(a.kadencja)}/MP`;
    let bladPoslow: unknown = null;
    const [surowe, surowiPoslowie] = await Promise.all([
      zrodlo.json<unknown>(sLista),
      zrodlo.json<unknown>(sPoslowie).catch((e: unknown) => {
        bladPoslow = e;
        return null;
      }),
    ]);
    const lista = jakoLista<KlubZRejestru>(surowe, 'kluby');
    const slubowanie = new Map<number, string>();
    for (const p of Array.isArray(surowiPoslowie) ? (surowiPoslowie as Array<{ id?: number; oathDate?: string }>) : []) {
      if (typeof p?.id === 'number' && typeof p.oathDate === 'string') slubowanie.set(p.id, p.oathDate.slice(0, 10));
    }
    // Pierwszy dzień kadencji: najwcześniejsze ślubowanie. Wejście tego dnia to początek kadencji, nie nowy poseł.
    const pierwszyDzien = [...slubowanie.values()].sort()[0] ?? null;
    const nowyPosel = (id: number, od: string) => {
      const s = slubowanie.get(id);
      return !!s && !!pierwszyDzien && s > pierwszyDzien && od.slice(0, 10) === s;
    };
    const wpisy = lista.map((k) => ({
      skrot: k.id,
      nazwa: czysty(k.name),
      // Regulamin Sejmu: klub to co najmniej 15 posłów, koło co najmniej 3.
      rodzaj: rodzajKlubu(k.id, k.name),
      czlonkow: k.membersCount,
    }));
    const ile = (r: string) => wpisy.filter((w) => w.rodzaj === r).length;
    const zrodla = [zrodlo.adres(sLista), ...(slubowanie.size ? [zrodlo.adres(sPoslowie)] : [])];
    const uwagi = ['„niez.” to posłowie niezrzeszeni, nie klub ani koło. Ich nazwiska daje znajdz_posla {klub:"niez."}.'];
    // Rejestr nie ma dziennika zmian klubów; jedyny ślad to data wejścia (joinDate) w dzisiejszym
    // składzie. Lista /clubs niesie już składy, więc to nie kosztuje ani jednego zapytania więcej.
    const grupy = new Map<string, { od: string; klub: string; nowy: boolean; poslowie: Array<{ id: number; imieNazwisko: string }> }>();
    for (const k of lista) {
      for (const m of k.members ?? []) {
        if (!m.joinDate) continue;
        const nowy = nowyPosel(m.id, m.joinDate);
        const kl = `${m.joinDate}|${k.id}|${nowy}`;
        const g = grupy.get(kl) ?? { od: m.joinDate, klub: k.id, nowy, poslowie: [] };
        g.poslowie.push({ id: m.id, imieNazwisko: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() });
        grupy.set(kl, g);
      }
    }
    // Powstanie klubu to kilkadziesiąt osób z jedną datą: pięć nazwisk i liczba wystarczą.
    // 8 najnowszych przejść; wejścia nowych posłów z tego okresu zostają na liście, oznaczone, ale ich nie liczymy.
    const posortowane = [...grupy.values()].sort((x, y) => y.od.localeCompare(x.od) || x.klub.localeCompare(y.klub));
    const przejscia = posortowane.filter((g) => !g.nowy).slice(0, 8);
    const najstarsze = przejscia.at(-1)?.od ?? '';
    const ostatnieZmiany = posortowane
      .filter((g) => (g.nowy ? g.od >= najstarsze : przejscia.includes(g)))
      .map((g) => ({ od: g.od, klub: g.klub, liczba: g.poslowie.length, ...(g.nowy ? { nowyPosel: true } : {}), poslowie: g.poslowie.slice(0, 5) }));
    const ostatnie = przejscia[0];
    if (ostatnieZmiany.length) {
      uwagi.push(
        'ostatnieZmiany to najpóźniejsze daty wejścia posłów do dzisiejszych klubów (8 najnowszych par data i klub). Wiele osób z jedną datą (liczba) to zwykle powstanie klubu albo koła, nie pojedyncze przejście; nazwisk jest wtedy najwyżej pięć, pełny skład daje kluby z parametrem klub. ' +
          'Z jakiego klubu poseł przyszedł, rejestr tu nie mówi: pokazuje to lista imienna głosowania sprzed tej daty (glosowanie z poselId, pole klubWDniuGlosowania). ' +
          'Posłów, którzy odeszli z Sejmu, nie ma w dzisiejszych składach. ' +
          (slubowanie.size
            ? 'nowyPosel=true to wejście do klubu w dniu ślubowania, czyli nowy mandat, a nie zmiana klubu: nie podawaj go jako „ostatniej zmiany klubu”.'
            : 'Listy posłów z datami ślubowania nie udało się pobrać, więc wejść nowych posłów (data wejścia = data ślubowania) nie odróżniono od przejść.'),
      );
    }
    return {
      ...(bladPoslow && ostatnieZmiany.length
        ? {
            wynikCzesciowy: czesciowyZBledu(
              bladPoslow,
              'odróżnienia nowych posłów (wejście do klubu w dniu ślubowania) od prawdziwych zmian klubu w ostatnieZmiany; liczby klubów i kół są pełne',
            ),
          }
        : {}),
      odpowiedz:
        `${opisKadencji(a.kadencja)}: ${odmiana(ile('klub'), ['klub', 'kluby', 'klubów'])}, ${odmiana(ile('koło'), ['koło', 'koła', 'kół'])}${ile('niezrzeszeni') ? `, niezrzeszonych posłów ${wpisy.find((w) => w.rodzaj === 'niezrzeszeni')?.czlonkow ?? 0}` : ''}.` +
        (ostatnie
          ? ` Najpóźniejsze wejście do klubu${slubowanie.size ? ' (bez nowych posłów)' : ''}: ${ostatnie.od}, ${ostatnie.klub}, ` +
            `${ostatnie.poslowie.length === 1 ? ostatnie.poslowie[0].imieNazwisko : `${ostatnie.poslowie.length} posłów`}.`
          : ''),
      liczbaKlubow: ile('klub'),
      liczbaKol: ile('koło'),
      kluby: wpisy,
      ...(ostatnieZmiany.length ? { ostatnieZmiany } : {}),
      zrodla,
      // Model znał liczbę niezrzeszonych, ale szukał nazwisk w surowym JSON-ie; wskazujemy wywołanie.
      uwagi,
    };
  },
});
