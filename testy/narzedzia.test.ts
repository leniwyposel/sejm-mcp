import { describe, expect, it } from 'vitest';
import { glosowanie, glosowaniaPosiedzenia, glosyPoslaWDniu, listaPosiedzen, szukajGlosowan } from '../src/narzedzia/glosowania.js';

const glosyPoslaWDniuSchemat = glosyPoslaWDniu.wejscie;
import { akt, szukajAktow, trescAktu } from '../src/narzedzia/eli.js';
import { NARZEDZIA } from '../src/narzedzia/index.js';
import { proces } from '../src/narzedzia/legislacja.js';
import { pismo, szukajPism } from '../src/narzedzia/pisma.js';
import { posiedzeniaKomisji, trescWypowiedzi, wypowiedziPosiedzenia } from '../src/narzedzia/posiedzenia.js';
import { profilPosla, znajdzPosla } from '../src/narzedzia/poslowie.js';
import { zapytanieSurowe } from '../src/narzedzia/surowe.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

describe('każde narzędzie', () => {
  it('ma unikalną nazwę z dozwolonych znaków MCP i polski opis', () => {
    const nazwy = NARZEDZIA.map((n) => n.nazwa);
    expect(new Set(nazwy).size).toBe(nazwy.length);
    for (const n of NARZEDZIA) {
      expect(n.nazwa).toMatch(/^[a-z_]{3,64}$/);
      expect(n.opis.length).toBeGreaterThan(40);
    }
  });
});

describe('znajdz_posla', () => {
  const zrodlo = () => new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });

  it('znajduje bez polskich znaków i zwraca źródło', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'adamczyk andrzej' }), zrodlo());
    expect(w.poslowie).toEqual([expect.objectContaining({ id: 1, imieNazwisko: 'Andrzej Adamczyk', klub: 'PiS' })]);
    expect(w.zrodla).toEqual(['https://api.sejm.gov.pl/sejm/term10/MP']);
  });

  it('domyślnie pomija posłów z wygasłym mandatem', async () => {
    const z = zrodlo();
    const aktywni = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, {}), z);
    const wszyscy = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { tylkoAktywni: false }), z);
    expect((wszyscy.razem as number) - (aktywni.razem as number)).toBe(3);
  });
});

describe('profil_posla', () => {
  it('sumuje statystykę Sejmu i oddziela usprawiedliwione', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP/1': 'mp-1.json', 'term10/MP/1/votings/stats': 'mp-1-stats.json' });
    const w = await profilPosla.wykonaj(wejscie(profilPosla.wejscie, { id: 1 }), z);
    const dni = JSON.parse(fikstura('mp-1-stats.json')) as Array<{ numVotings: number; numMissed: number; absenceExcuse: boolean }>;
    const s = w.statystykaSejmu as Record<string, number>;
    expect(s.glosowan).toBe(dni.reduce((a, d) => a + d.numVotings, 0));
    expect(s.opuszczonych).toBe(dni.reduce((a, d) => a + d.numMissed, 0));
    expect(s.opuszczonychUsprawiedliwionych + s.opuszczonychNieusprawiedliwionych).toBe(s.opuszczonych);
    expect(w.zrodla).toHaveLength(2);
  });

  it('nieznany poseł to odpowiedź, nie wyjątek', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP/9999': null, 'term10/MP/9999/votings/stats': null });
    const w = await profilPosla.wykonaj(wejscie(profilPosla.wejscie, { id: 9999 }), z);
    expect(w.znaleziono).toBe(false);
  });
});

describe('głosowania', () => {
  it('lista_posiedzen pomija posiedzenia planowane bez numeru', async () => {
    const z = new ZrodloZFikstur({ 'term10/proceedings': 'posiedzenia.json', 'term10/votings': 'posiedzenia-glosowan.json' });
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, {}), z);
    const lista = w.posiedzenia as Array<{ numer: number | null; dni: Array<{ glosowan: number }> }>;
    expect(lista.every((p) => p.numer !== null)).toBe(true);
    expect(lista[0].dni[0].glosowan).toBe(8);
  });

  it('glosowania_posiedzenia filtruje po dniu', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/10': 'glosowania-10.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 10, data: '2024-04-24' }), z);
    const lista = w.glosowania as Array<{ data: string }>;
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((g) => g.data.startsWith('2024-04-24'))).toBe(true);
  });

  it('glosowanie: kworum, klub z dnia głosowania i głos posła', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/18/46': 'glosowanie-18-46-kworum.json', 'term10/MP': 'mp-lista.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 18, numer: 46, poselId: 1 }), z);
    expect(w).toMatchObject({
      rodzaj: 'kworum',
      wynik: 'apel o kworum: nic nie jest przyjmowane ani odrzucane; kworum stwierdzone: 396 obecnych (≥ 230, połowa ustawowej liczby posłów)',
      kworumJest: true,
      glosPosla: { id: 1, klubWDniuGlosowania: 'PiS', glos: 'obecność na apelu o kworum (to jest udział)' },
    });
    expect(w.listaImienna).toBeUndefined();
    expect(w.uwagi?.join(' ')).toMatch(/apel o kworum/i);
  });

  it('szukaj_glosowan przekazuje frazę do wyszukiwarki rejestru', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/search': 'glosowania-szukaj.json' }, { 'term10/votings/search': 328 });
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'budżet', limit: 3 }), z);
    expect(w.razem).toBe(328);
    // Najpierw liczba trafień, potem ostatnia porcja: rejestr sortuje od najstarszych.
    expect(z.zapytania[0].parametry).toMatchObject({ title: 'budżet', limit: 1, offset: 0 });
    expect(z.zapytania[1].parametry).toMatchObject({ title: 'budżet', limit: 3, offset: 325 });
    expect(w.zrodla[0]).toContain('title=bud%C5%BCet');
  });
});

describe('pisma', () => {
  it('szukaj_pism: stan każdego pisma i parametry autora', async () => {
    const z = new ZrodloZFikstur({ 'term10/interpellations': 'interpelacje-autor.json', 'term10/MP': 'mp-lista.json' }, { 'term10/interpellations': 210 });
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: 277, limit: 2 }), z);
    // Z autorem bierzemy całą pulę jego pism, żeby podsumowanie objęło wszystkie, nie pierwszą porcję.
    expect(z.zapytania.find((q) => q.sciezka === 'term10/interpellations')?.parametry).toMatchObject({ from: 277, limit: 500, offset: 0 });
    expect(w.razem).toBe(2);
    expect(w.podsumowanie).toMatchObject({ razem: 2, jedynyAutor: 2 });
    const pierwsze = (w.pisma as Array<{ stan: string; autorzy?: Array<{ id: number }>; liczbaAutorow: number }>)[0];
    expect(pierwsze.stan).toBe('odpowiedziano');
    // Jedyny autor to szukany poseł: pola autorzy nie ma, liczba zostaje.
    expect(pierwsze.autorzy).toBeUndefined();
    expect(pierwsze.liczbaAutorow).toBe(1);
  });

  it('pismo z treścią: tekst bez HTML i oba źródła', async () => {
    const z = new ZrodloZFikstur({
      'term10/interpellations/1': 'interpelacja-1.json',
      'term10/interpellations/1/body': 'interpelacja-1-tresc.html',
      'term10/MP': 'mp-lista.json',
    });
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 1, tresc: true }), z);
    const tresc = w.tresc as { tekst: string };
    expect(tresc.tekst).toContain('Interpelacja nr 1');
    expect(tresc.tekst).not.toMatch(/<p/);
    expect(w.zrodla).toHaveLength(2);
    expect((w.adresaci as Array<{ termin: string }>)[0].termin).toBe('2023-12-28');
  });

  it('klucz odpowiedzi nie przemyci ścieżki', () => {
    expect(() => pismo.wejscie.parse({ rodzaj: 'interpelacja', numer: 1, odpowiedzKlucz: '../../MP' })).toThrow();
  });
});

describe('legislacja i posiedzenia', () => {
  it('proces: etapy spłaszczone z werdyktem głosowania', async () => {
    const z = new ZrodloZFikstur({ 'term10/processes/1': 'proces-1.json' });
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '1' }), z);
    const etapy = w.etapy as Array<{ poziom: number; glosowanie?: { wynik: string } }>;
    expect(etapy.some((e) => e.poziom === 1)).toBe(true);
    expect(etapy.find((e) => e.glosowanie)?.glosowanie?.wynik).toBe('Przyjęto');
    expect(w.glosowanieKoncowe).toMatchObject({ posiedzenie: 1, numer: 2, wynik: 'Przyjęto' });
  });

  it('posiedzenia_komisji: porządek jako tekst', async () => {
    const z = new ZrodloZFikstur({ 'term10/committees/sittings/2024-04-24': 'komisje-2024-04-24.json' });
    const w = await posiedzeniaKomisji.wykonaj(wejscie(posiedzeniaKomisji.wejscie, { data: '2024-04-24' }), z);
    const p = (w.posiedzenia as Array<{ porzadek: string }>)[0];
    expect(p.porzadek).not.toMatch(/<div/);
  });

  it('wypowiedzi_posiedzenia i tresc_wypowiedzi', async () => {
    const z = new ZrodloZFikstur({
      'term10/proceedings/10/2024-04-24/transcripts': 'stenogram-10-2024-04-24.json',
      'term10/proceedings/10/2024-04-24/transcripts/1': 'wypowiedz-10-2024-04-24-1.html',
    });
    const spis = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, { posiedzenie: 10, data: '2024-04-24', mowca: 'orliński' }), z);
    expect((spis.spis as Array<{ numer: number }>)[0].numer).toBe(1);
    const t = await trescWypowiedzi.wykonaj(wejscie(trescWypowiedzi.wejscie, { posiedzenie: 10, data: '2024-04-24', numer: 1 }), z);
    expect(t.tekst).toContain('Szanowni Państwo');
  });
});

describe('zapytanie_surowe', () => {
  it('schemat odrzuca ścieżki wychodzące poza /sejm/', () => {
    for (const sciezka of ['../eli/acts', 'https://evil.example', 'term10/MP?x=1']) {
      const wynik = zapytanieSurowe.wejscie.safeParse({ sciezka });
      if (wynik.success) {
        // Schemat przepuszcza '..' w środku; zatrzymuje ją dopiero klient. Sprawdzamy oba piętra.
        expect(() => new ZrodloZFikstur({}).adres(sciezka)).toThrow();
      }
    }
  });

  it('zwraca surową odpowiedź w porcji z adresem', async () => {
    const z = new ZrodloZFikstur({ 'term10': 'kadencja.json' });
    const w = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'term10' }), z);
    expect(w.odpowiedz).toMatchObject({ num: 10, current: true });
    expect(w.zrodla).toEqual(['https://api.sejm.gov.pl/sejm/term10']);
  });
});

describe('poprawki po testach agentów', () => {
  it('odpowiedź Sejmu w złym kształcie to błąd, nie wymyślony werdykt', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/10/1': 'kadencja.json' });
    await expect(glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 10, numer: 1 }), z)).rejects.toThrow(/Nieoczekiwany kształt/);
    const z2 = new ZrodloZFikstur({ 'term10/votings/10': 'kadencja.json' });
    await expect(glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 10 }), z2)).rejects.toThrow(/Nieoczekiwany kształt/);
  });

  it('glosowania_posiedzenia: bilans liczy wszystkie, lista idzie porcjami', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/10': 'glosowania-10.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 10, limit: 5 }), z);
    const b = w.bilans as { wszystkich: number; przyjetych: number; odrzuconych: number; apeliOKworum: number; wyborowZListy: number; nadUchwalamiSenatu: { glosowan: number } };
    expect(b.wszystkich).toBe(26);
    expect(b.przyjetych + b.odrzuconych + b.nadUchwalamiSenatu.glosowan + b.apeliOKworum + b.wyborowZListy).toBe(26);
    expect(w.glosowania).toHaveLength(5);
    expect(w.nastepnePrzesuniecie).toBe(5);
  });

  it('tytuł posiedzenia nie udaje punktu porządku obrad', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/10': 'glosowania-10.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 10, limit: 1 }), z);
    expect((w.glosowania as Array<{ punkt: string | null }>)[0].punkt).toBeNull();
  });

  it('w zakończonej kadencji znajdz_posla domyślnie szuka też wśród wygasłych mandatów', async () => {
    const z = new ZrodloZFikstur({ 'term9/MP': 'mp-lista.json' });
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'adamczyk', kadencja: 9 }), z);
    expect(w.razem).toBe(1);
    const nieaktywny = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'nikt-taki' }), new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' }));
    // Zero przy frazie to fakt o rejestrze kadencji (także wśród wygasłych), a nie tylko „sprawdź pisownię”.
    expect(nieaktywny.odpowiedz).toMatch(/Kadencja 10 \(od 2023\).*nikt o tym nazwisku nie był posłem/);
    expect(nieaktywny.uwagi?.join(' ')).toMatch(/z wygasłymi mandatami włącznie/);
    expect(nieaktywny.uwagi?.join(' ')).not.toMatch(/tylkoAktywni=false/);
  });

  it('nieistniejąca data jest odrzucana przed zapytaniem', () => {
    expect(() => glosyPoslaWDniuSchemat.parse({ id: 1, posiedzenie: 1, data: '2024-02-30' })).toThrow();
    expect(() => posiedzeniaKomisji.wejscie.parse({ data: '9999-99-99' })).toThrow();
  });

  it('lista_posiedzen liczy stan z dat i podaje ostatnie zakończone', async () => {
    const z = new ZrodloZFikstur({ 'term10/proceedings': 'posiedzenia.json', 'term10/votings': 'posiedzenia-glosowan.json' });
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, {}), z);
    expect(w.ostatnieZakonczone).toBeGreaterThan(0);
    expect((w.posiedzenia as Array<{ stan: string }>).every((p) => ['zakończone', 'trwa', 'zaplanowane'].includes(p.stan))).toBe(true);
  });
});

describe('poprawki po teście z Haiku', () => {
  it('szukaj_pism z adresatem liczy spóźnienie tylko u tego adresata i sortuje po opóźnieniu', async () => {
    const pisma = [
      { num: 1, title: 'a', to: ['minister zdrowia', 'minister sprawiedliwości'], replies: [], recipientDetails: [
        { name: 'minister zdrowia', sent: '2026-01-01', answerDelayedDays: 0 },
        { name: 'minister sprawiedliwości', sent: '2026-01-01', answerDelayedDays: 200 },
      ] },
      { num: 2, title: 'b', to: ['minister zdrowia'], replies: [], recipientDetails: [{ name: 'minister zdrowia', sent: '2026-06-01', answerDelayedDays: 90 }] },
      { num: 3, title: 'c', to: ['minister zdrowia'], replies: [], recipientDetails: [{ name: 'minister zdrowia', sent: '2026-03-01', answerDelayedDays: 180 }] },
    ];
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });
    z.lista = (async () => ({ dane: pisma, razem: 3 })) as typeof z.lista;
    const zapytanie = { json: z.json.bind(z), lista: z.lista, tekst: z.tekst.bind(z), bajty: z.bajty.bind(z), adres: z.adres.bind(z) };
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', adresat: 'minister zdrowia', tylkoOpoznione: true, sortuj: 'opoznienie' }), zapytanie);
    const lista = w.pisma as Array<{ numer: number; stan: string; poTerminieU: Array<{ adresat: string }> }>;
    // Pismo 1 jest po terminie u ministra zdrowia TEŻ (21 dni od 2026-01-01 dawno minęło), ale
    // w poTerminieU nie ma ministra sprawiedliwości: liczy się tylko wskazany adresat.
    expect(lista.map((p) => p.numer)).toEqual([1, 3, 2]);
    expect(lista.every((p) => p.poTerminieU.every((u) => u.adresat === 'minister zdrowia'))).toBe(true);
  });
});

describe('akty prawne (ELI)', () => {
  it('akt: status, wejście w życie, druki i powiązania', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2026/62': 'eli-du-2026-62.json' });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2026/62' }), z);
    expect(w).toMatchObject({ znaleziono: true, adres: 'DU/2026/62', obowiazuje: 'tak', wejscieWZycie: '2026-01-20', oznaczenie: 'Dz.U. 2026 poz. 62' });
    expect(w.zrodla).toEqual(['https://api.sejm.gov.pl/eli/acts/DU/2026/62']);
    expect(w.uwagi?.join(' ')).toMatch(/tylko w PDF/);
  });

  it('akt: najnowszy tekst jednolity i lista powiązań przycięta do 10', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/1974/141': 'eli-du-1974-141.json', 'eli/acts/DU/2025/277': null });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/1974/141' }), z);
    expect(w.najnowszyTekstJednolity).toMatchObject({ adres: 'DU/2025/277' });
    expect(w.odpowiedz).toMatch(/Akty wykonawcze 1163/);
    const wykonawcze = (w.powiazania as Array<{ rodzaj: string; liczba: number; akty: unknown[] }>).find((p) => p.rodzaj === 'Akty wykonawcze');
    expect(wykonawcze?.liczba).toBeGreaterThan(1000);
    expect(wykonawcze?.akty).toHaveLength(10);
  });

  it('tresc_aktu: jeden artykuł wycięty z tekstu', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2019/914': 'eli-du-2019-914.json', 'eli/acts/DU/2019/914/text.html': 'eli-du-2019-914-tekst.html' });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2019/914', artykul: '2' }), z);
    expect(w.tekst).toMatch(/^Art\. 2\./);
    expect(w.tekst).not.toMatch(/Art\. 3\./);
  });

  it('tresc_aktu: spis jednostek bez punktów i liter', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2019/914': 'eli-du-2019-914.json', 'eli/acts/DU/2019/914/struct': 'eli-du-2019-914-struct.json' });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2019/914', spis: true }), z);
    expect((w.spis as Array<{ id: string }>).map((j) => j.id)).toEqual(['part_1', 'arti_1', 'arti_2', 'arti_3', 'arti_4']);
  });

  it('tresc_aktu: akt tylko w PDF oddaje adres PDF', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/DU/2026/62': 'eli-du-2026-62.json' });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2026/62' }), z);
    expect(w).toMatchObject({ tekstHtml: false, pdf: 'https://api.sejm.gov.pl/eli/acts/DU/2026/62/text.pdf' });
  });

  it('szukaj_aktow: ustawy przed obwieszczeniami', async () => {
    const z = new ZrodloZFikstur({ 'eli/acts/search': 'eli-szukaj-krs.json' });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { fraza: 'Krajowej Radzie Sądownictwa', limit: 5 }), z);
    const lista = w.akty as Array<{ rodzaj: string; adres: string }>;
    expect(lista.every((x) => x.rodzaj === 'Ustawa')).toBe(true);
    expect(lista.map((x) => x.adres)).toContain('DU/2019/914');
  });

  it('adres aktu tylko w postaci DU|MP/rok/pozycja', () => {
    for (const zly of ['DU/2026', '../sejm/term10', 'XX/2026/1', 'DU/2026/62/text.html']) {
      expect(akt.wejscie.safeParse({ adres: zly }).success).toBe(false);
    }
  });
});

describe('weto Prezydenta', () => {
  it('proces 2108: rejestr mówi passed=true, a stan mówi o wecie bez głosowania nad nim', async () => {
    const z = new ZrodloZFikstur({ 'term10/processes/2108': 'proces-2108-weto.json' });
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '2108' }), z);
    expect(w.stan).toMatch(/^zawetowana przez Prezydenta 2026-02-19; Sejm nie głosował jeszcze nad wetem \(.*3\/5.*\)$/);
    expect(w.glosowanieKoncowe).toMatchObject({ posiedzenie: 50, numer: 104 });
  });
});

describe('bilans posiedzenia liczy głosowania nad całością (polskie litery w wyrażeniu)', () => {
  it('„całość projektu ustawy” i „całości projektu uchwały” są policzone', async () => {
    const baza = JSON.parse(fikstura('glosowania-10.json'))[0];
    const lista = [
      { ...baza, votingNumber: 1, description: 'całość projektu ustawy' },
      { ...baza, votingNumber: 2, description: 'całość projektu ustawy' },
      { ...baza, votingNumber: 3, topic: 'głosowanie nad całością projektu uchwały', description: 'całość projektu uchwały' },
      { ...baza, votingNumber: 4, description: 'poprawka 1' },
    ];
    const z = new ZrodloZFikstur({});
    z.json = (async () => lista) as typeof z.json;
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 10 }), z);
    const nc = (w.bilans as { nadCaloscia: { ustaw: { razem: number; glosowania: string[] }; uchwal: { razem: number } } }).nadCaloscia;
    expect(nc.ustaw.razem).toBe(2);
    expect(nc.uchwal.razem).toBe(1);
    expect(nc.ustaw.glosowania).toEqual(['10/1', '10/2']);
  });
});

describe('runda 4: poprawki', () => {
  it('rozwinSkroty: ZUS i KRS na pełne nazwy z tytułów, zwykłe słowa bez zmian', async () => {
    const { rozwinSkroty } = await import('../src/narzedzia/wspolne.js');
    expect(rozwinSkroty('waloryzacja ZUS')?.fraza).toBe('waloryzacja Ubezpieczeń Społecznych');
    expect(rozwinSkroty('ustawa o KRS')?.fraza).toBe('ustawa o Krajowej Radzie Sądownictwa');
    expect(rozwinSkroty('budżet na 2024')).toBeNull();
  });

  it('znajdz_posla: „Adamczyka” znajduje Adamczyka (odmiana) z uwagą', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Adamczyka' }), z);
    expect((w.poslowie as Array<{ id: number }>).map((p) => p.id)).toContain(1);
  });

  it('głosowanie nad wetem: wynik mówi o wecie, nie gołe „Odrzucono”', async () => {
    const baza = JSON.parse(fikstura('glosowanie-10-1.json'));
    const weto = { ...baza, topic: 'głosowanie nad wnioskiem Prezydenta o ponowne rozpatrzenie ustawy', yes: 232, no: 199, abstain: 0, majorityType: 'MAJORITY_THREE_FIFTHS', majorityVotes: 259 };
    const z = new ZrodloZFikstur({});
    z.json = (async () => weto) as typeof z.json;
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 65, numer: 10 }), z);
    expect(w.wynik).toBe('Nie uchwalono ponownie: weto utrzymane');
    expect(w.rozstrzygniecie).toMatch(/weto Prezydenta utrzymane/);
  });

  it('bliźniaki: przepisy wprowadzające za ustawą, w obrębie dnia rosnąco', async () => {
    const baza = JSON.parse(fikstura('glosowania-10.json'))[0];
    const lista = [
      { ...baza, votingNumber: 11, date: '2026-09-17T17:24:00', title: 'Pkt 28 Przepisy wprowadzające ustawę o statusie osoby najbliższej', description: 'całość projektu ustawy' },
      { ...baza, votingNumber: 10, date: '2026-09-17T17:22:00', title: 'Pkt 27 ustawa o statusie osoby najbliższej', description: 'całość projektu ustawy' },
    ];
    const z = new ZrodloZFikstur({});
    z.lista = (async () => ({ dane: lista, razem: 2 })) as typeof z.lista;
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'statusie osoby najbliższej' }), z);
    const g = w.glosowania as Array<{ numer: number; akt: string }>;
    expect(g.map((x) => x.numer)).toEqual([10, 11]);
    expect(g[1].akt).toBe('przepisy wprowadzające');
    expect(w.uwagi?.join(' ')).toMatch(/pole akt/);
  });
});

describe('poprawki po ocenie Haiku i Sonneta', () => {
  it('znajdz_posla: wygasły mandat bez tylkoAktywni i posłowie ślubujący później w okręgu', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-nastepca-i-imiennicy.json' });
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Łukasz Litewka' }), z);
    expect(w.poslowie).toEqual([expect.objectContaining({ id: 215, aktywny: false, dataSlubowania: '2023-11-13', dataWygasniecia: '2026-04-23' })]);
    // Stachowicz ślubowała w 2024, przed wygaśnięciem mandatu Litewki: nie jest kandydatką na następczynię.
    expect(w.slubowaliPozniejWOkregu).toEqual([
      expect.objectContaining({ okreg: 32, poslowie: [expect.objectContaining({ id: 499, imieNazwisko: 'Bożena Borowiec', dataSlubowania: '2026-05-15' })] }),
    ]);
    expect(w.uwagi?.join(' ')).toMatch(/nie zapisuje, kto kogo zastąpił.*wniosek z okręgu i dat/);
  });

  it('glosowanie: kluby o podobnym skrócie mają osobne wyniki, lista imienna tylko dokładnego klubu', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65/12': 'glosowanie-65-12.json', 'term10/MP': 'mp-nastepca-i-imiennicy.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 65, numer: 12, klub: 'Konfederacja' }), z);
    const lista = w.listaImienna as Array<{ klub: string; glos: string }>;
    expect(new Set(lista.map((p) => p.klub))).toEqual(new Set(['Konfederacja']));
    const n = w.niejednoznaczne as { coZrobic: string; wynikiKlubow: Array<{ klub: string; za: number; przeciw: number; wstrzymalo: number }> };
    expect(n.coZrobic).toMatch(/Nie sumuj/);
    expect(n.wynikiKlubow.map((k) => k.klub).sort()).toEqual(['Konfederacja', 'Konfederacja_KP']);
    expect(n.wynikiKlubow.find((k) => k.klub === 'Konfederacja')).toMatchObject({ za: 10, przeciw: 1, wstrzymalo: 1 });
  });

  it('glosowanie: głos imiennika w odpowiedzi, gdy pytano o jednego posła', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65/12': 'glosowanie-65-12.json', 'term10/MP': 'mp-nastepca-i-imiennicy.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 65, numer: 12, poselId: 189 }), z);
    expect(w.odpowiedz).toMatch(/Piotr Król.*za/);
    expect(w.odpowiedz).toMatch(/Imiennicy w tej kadencji: Wojciech Król \(id 190\): nieobecność/);
    expect((w.niejednoznaczne as { powod: string }).powod).toMatch(/Wojciech Król/);
    // Oba id naraz: nie ma już kogo dopowiadać.
    const oba = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 65, numer: 12, poselId: [189, 190] }), z);
    expect(oba.niejednoznaczne).toBeUndefined();
  });

  it('glosowanie: awaria listy posłów nie zabiera wyniku', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65/12': 'glosowanie-65-12.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 65, numer: 12, poselId: 189 }), z);
    expect(w.znaleziono).toBe(true);
    expect(w.niejednoznaczne).toBeUndefined();
  });

  it('akt: wygasły tekst jednolity wskazuje nowszy tekst tej samej ustawy', async () => {
    const z = new ZrodloZFikstur({
      'eli/acts/DU/2023/1465': 'eli-du-2023-1465.json',
      'eli/acts/DU/1974/141': 'eli-du-1974-141.json',
      'eli/acts/DU/2025/277': 'eli-du-2025-277.json',
      'eli/acts/DU/2023/1465/references': null,
    });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2023/1465' }), z);
    expect(w.zastapionyPrzez).toMatchObject({ adres: 'DU/2025/277', oznaczenie: 'Dz.U. 2025 poz. 277' });
    expect(w.najnowszyTekstJednolity).toMatchObject({ adres: 'DU/2025/277' });
    expect(w.odpowiedz).toMatch(/zastąpiony przez nowszy tekst jednolity Dz\.U\. 2025 poz\. 277/);
  });

  it('akt: najnowszy tekst jednolity ma zastapionyPrzez równe null', async () => {
    const z = new ZrodloZFikstur({
      'eli/acts/DU/2025/277': 'eli-du-2025-277.json',
      'eli/acts/DU/1974/141': 'eli-du-1974-141.json',
      'eli/acts/DU/2025/277/references': null,
    });
    const w = await akt.wykonaj(wejscie(akt.wejscie, { adres: 'DU/2025/277' }), z);
    expect(w.zastapionyPrzez).toBeNull();
    expect(w.uwagi?.join(' ')).toMatch(/To najnowszy tekst jednolity tej ustawy/);
  });
});

describe('pisma po teście 07 i 08', () => {
  const zrodlo = (sciezka: string, plik: string) => new ZrodloZFikstur({ [sciezka]: plik, 'term10/MP': 'mp-lista.json' });

  it('pismo 13144 bez recipientDetails: termin od daty wysłania, z adnotacją', async () => {
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: '13144' }), zrodlo('term10/interpellations/13144', 'interpelacja-13144.json'));
    const [ad] = w.adresaci as Array<Record<string, unknown>>;
    expect(ad).toMatchObject({ adresat: 'minister spraw zagranicznych', terminOd: 'wysłanie', termin: '2025-11-20', odpowiedziano: false });
    expect(w.stan).toBe('po-terminie');
    expect((w.uwagi as string[]).some((u) => u.includes('sentDate'))).toBe(true);
  });

  it('pismo 3550: adres PDF odpowiedzi i zdanie, że treść jest tylko w załączniku', async () => {
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'zapytanie', numer: 3550 }), zrodlo('term10/writtenQuestions/3550', 'zapytanie-3550.json'));
    const [odp] = w.odpowiedzi as Array<Record<string, unknown>>;
    expect(odp.pdf).toMatch(/^https:\/\/api\.sejm\.gov\.pl\/.*\.pdf$/);
    expect(odp).toMatchObject({ adresat: 'minister aktywów państwowych', tylkoZalacznik: true });
    expect(String(odp.przypisanie)).toMatch(/^wniosek/);
    expect(w.odpowiedz).toMatch(/w załączniku PDF \(https:.*\): tekst daje pismo z odpowiedzKlucz/);
  });

  it('pismo 4637: dni każdej odpowiedzi względem wspólnego terminu, licznik Sejmu z objaśnieniem', async () => {
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 4637 }), zrodlo('term10/interpellations/4637', 'interpelacja-4637.json'));
    const dni = (w.odpowiedzi as Array<{ dniPoWspolnymTerminie: number }>).map((o) => o.dniPoWspolnymTerminie);
    expect(dni).toEqual([-10, -3, -1, 18, 50]);
    expect((w.wnioski as string[]).join(' ')).toMatch(/wspólny termin 2024-10-04/);
  });

  it('pismo 17177: wniosek „co najmniej jeden adresat nie odpowiedział” w zdaniu odpowiedzi', async () => {
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 17177 }), zrodlo('term10/interpellations/17177', 'interpelacja-17177.json'));
    expect(w.odpowiedz).toMatch(/co najmniej 1 adresat nie odpowiedział, \d+ dni po terminie 2026-06-11/);
    expect(w.stan).toBe('po-terminie');
  });

  it('szukaj_pism: rozbicie po adresatach, licznik Sejmu przy piśmie i opis „nie wiadomo”', async () => {
    const pisma = ['interpelacja-4637.json', 'interpelacja-6746.json', 'interpelacja-13144.json', 'interpelacja-17177.json'].map((f) => JSON.parse(fikstura(f)));
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });
    z.lista = (async () => ({ dane: pisma, razem: 4 })) as typeof z.lista;
    const zapytanie = { json: z.json.bind(z), lista: z.lista, tekst: z.tekst.bind(z), bajty: z.bajty.bind(z), adres: z.adres.bind(z) };
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: '137' }), zapytanie);
    const pod = w.podsumowanie as { wedlugAdresata: Array<{ adresat: string; pism: number }> };
    expect(pod.wedlugAdresata[0]).toMatchObject({ adresat: 'minister spraw zagranicznych', pism: 3 });
    const lista = w.pisma as Array<Record<string, unknown>>;
    const p6746 = lista.find((p) => p.numer === 6746)!;
    expect(p6746).toMatchObject({ stan: 'nie-wiadomo', licznikOpoznieniaSejmu: 0 });
    expect(String(p6746.stanOpis)).toMatch(/prawdopodobnie/);
    expect(lista.find((p) => p.numer === 13144)).toMatchObject({ stan: 'po-terminie', terminOd: 'wysłanie' });
    expect(lista.find((p) => p.numer === 17177)).toMatchObject({ stan: 'po-terminie', licznikSejmuInaczej: true });
  });
});

describe('pisma po teście 07-b (prawdziwa lista interpelacji posła 442)', () => {
  const z = () => new ZrodloZFikstur({ 'term10/interpellations': 'interpelacje-autor-442.json', 'term10/MP': 'mp-lista.json' });

  it('szukaj_pism: 12789 nie jest „nie-wiadomo”, ta sama reguła przypisania co w pismo', async () => {
    // Lista jest przycięta do budżetu znaków: szukamy dalej po nastepnePrzesuniecie.
    let p: { numer: number; stan: string } | undefined;
    let przesuniecie: number | undefined = 0;
    while (!p && przesuniecie !== undefined) {
      const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: 442, limit: 100, przesuniecie }), z());
      expect(JSON.stringify(w).length).toBeLessThan(20_000);
      p = (w.pisma as Array<{ numer: number; stan: string }>).find((x) => x.numer === 12789);
      przesuniecie = w.nastepnePrzesuniecie as number | undefined;
    }
    expect(p?.stan).toBe('odpowiedziano-po-terminie');
  });

  it('szukaj_pism: stara i nowa nazwa resortu osobno, ale z uwagą i sumą', async () => {
    const w = await szukajPism.wykonaj(wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', autorId: 442 }), z());
    const wg = (w.podsumowanie as { wedlugAdresata: Array<{ adresat: string; pism: number }> }).wedlugAdresata;
    const ile = (n: string) => wg.find((x) => x.adresat === n)?.pism ?? 0;
    const suma = ile('minister finansów') + ile('minister finansów i gospodarki');
    expect(ile('minister finansów')).toBeGreaterThan(0);
    expect(ile('minister finansów i gospodarki')).toBeGreaterThan(0);
    expect((w.uwagi as string[]).join(' ')).toContain(`„minister finansów” (${ile('minister finansów')}) i „minister finansów i gospodarki” (${ile('minister finansów i gospodarki')}), razem ${suma}`);
  });
});

describe('posłowie po testach 01, 02, 12 i 19', () => {
  const zDanych = (dane: unknown, plik = 'mp-lista.json') => {
    const z = new ZrodloZFikstur({ 'term10/MP': plik });
    if (dane) z.json = (async () => dane) as typeof z.json;
    return z;
  };

  it('znajdz_posla: nazwisko z łącznikiem, samo i z imieniem', async () => {
    for (const fraza of ['Arciszewska-Mielewczyk', 'Dorota Arciszewska-Mielewczyk', 'arciszewska mielewczyk']) {
      const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza }), zDanych(null));
      expect((w.poslowie as Array<{ id: number }>).map((p) => p.id)).toEqual([5]);
    }
  });

  it('znajdz_posla: filtr okręgu mówi, ilu posłów z wygasłym mandatem pominięto, bez uwagi o płci', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { okreg: '32' }), zDanych(null, 'mp-nastepca-i-imiennicy.json'));
    expect(w.razem).toBe(2);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/Pominięto 2 posłów z wygasłym mandatem/);
    expect(uwagi).not.toMatch(/płci/);
  });

  it('znajdz_posla: posłowie ślubujący później w kolejności ślubowań, klub poprzednika oznaczony', async () => {
    const lista = [
      { id: 413, firstName: 'Maciej', lastName: 'Wąsik', firstLastName: 'Maciej Wąsik', club: 'PiS', districtNum: 16, active: false, mandateExpiryDate: '2023-12-20', oathDate: '2023-11-13' },
      { id: 474, firstName: 'Maria', lastName: 'Koźlakiewicz', firstLastName: 'Maria Koźlakiewicz', club: 'KO', districtNum: 16, active: true, oathDate: '2024-06-26' },
      { id: 476, firstName: 'Mariusz', lastName: 'Kulpa', firstLastName: 'Mariusz Kulpa', club: 'PiS', districtNum: 16, active: true, oathDate: '2024-06-28' },
    ];
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Wąsik' }), zDanych(lista));
    const [n] = w.slubowaliPozniejWOkregu as Array<{ poslowie: Array<{ id: number; tenSamKlub: boolean }> }>;
    expect(n.poslowie.map((q) => [q.id, q.tenSamKlub])).toEqual([[474, false], [476, true]]);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/tej samej listy wyborczej/);
    expect(uwagi).not.toMatch(/na początku listy/);
  });

  it('znajdz_posla: okręg 16 (prawdziwy rejestr), inne wakaty tego czasu i brak rozstrzygnięcia przy dwóch mandatach PiS', async () => {
    const w = await znajdzPosla.wykonaj(wejscie(znajdzPosla.wejscie, { fraza: 'Maciej Wąsik' }), zDanych(null, 'mp-okreg-16.json'));
    const [n] = w.slubowaliPozniejWOkregu as Array<{
      poslowie: Array<{ id: number }>;
      inneWygasnieciaWOkregu: Array<{ id: number; klub: string; dataWygasniecia: string }>;
    }>;
    expect(n.poslowie.map((q) => q.id)).toEqual([474, 476, 492]);
    expect(n.inneWygasnieciaWOkregu.map((q) => [q.id, q.klub, q.dataWygasniecia])).toEqual([
      [160, 'KO', '2024-06-10'],
      [279, 'PiS', '2024-06-10'],
    ]);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/Jacek Ozdoba \(PiS, 2024-06-10/);
    expect(uwagi).toMatch(/Klub PiS stracił tu 2 mandaty, a posłów tego klubu ślubujących później jest 2: API nie rozstrzyga, kto objął który mandat/);
  });

  it('profil_posla: opis wymienia liczbę głosów w wyborach, uwaga o apelach mówi, że Sejm ich nie liczy', async () => {
    expect(profilPosla.opis).toMatch(/liczba głosów zdobytych w wyborach/);
    const z = new ZrodloZFikstur({ 'term10/MP/1': 'mp-1.json', 'term10/MP/1/votings/stats': 'mp-1-stats.json' });
    const w = await profilPosla.wykonaj(wejscie(profilPosla.wejscie, { id: '1' }), z);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/z reguły nie liczy apeli o kworum/);
    expect(uwagi).not.toMatch(/bywa w statystyce Sejmu policzony/);
  });
});

describe('wypowiedzi po teście 13', () => {
  const stenogram = {
    statements: [
      { num: 0, name: 'Marszałek', memberID: 0, startDateTime: '2026-09-17T09:06:00', endDateTime: '2026-09-17T00:48:00' },
      { num: 1, name: 'Maria Koc', function: 'Poseł', memberID: 11, startDateTime: '2026-09-17T09:10:00', endDateTime: '2026-09-17T09:12:00' },
      { num: 2, name: 'Lidia Czechak', function: 'Poseł', memberID: 12, startDateTime: '2026-09-17T09:13:00', endDateTime: '2026-09-17T09:14:00' },
      { num: 3, name: 'Maria Koc', function: 'Poseł', memberID: 11, startDateTime: '2026-09-17T10:00:00', endDateTime: '2026-09-17T10:01:00' },
      { num: 4, name: 'Lidia Czechak', function: 'Poseł', memberID: 12, startDateTime: '2026-09-17T11:00:00', endDateTime: '2026-09-17T11:01:00' },
      { num: 5, name: 'Marcin Józefaciuk', function: 'Poseł', memberID: 13, unspoken: true },
      { num: 6, name: 'Marcin Józefaciuk', function: 'Poseł', memberID: 13, unspoken: true },
      { num: 7, name: 'Marcin Józefaciuk', function: 'Poseł', memberID: 13, unspoken: true },
    ],
  };
  const zrodlo = () => {
    const z = new ZrodloZFikstur({});
    z.json = (async () => stenogram) as typeof z.json;
    z.tekst = (async () =>
      '<h1>65. posiedzenie</h1><h2 class="punkt">25. punkt porządku dziennego:</h2><p class="punkt-tytul">\nSprawozdanie Komisji Kultury (druki nr 2556 i 2758).\n</p><h2 class="mowca">Poseł Maria Koc:</h2><p>Tekst</p>') as typeof z.tekst;
    return z;
  };

  it('zestawienie: mówcy z liczbą wygłoszonych i niewygłoszonych, remis nazwany', async () => {
    const w = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, { posiedzenie: 65, data: '2026-09-17', zestawienie: true }), zrodlo());
    expect(w).toMatchObject({ wypowiedzi: 8, wygloszonych: 5, niewygloszonych: 3 });
    const zest = w.zestawienie as Array<{ mowca: string; wygloszone: number; niewygloszone: number }>;
    expect(zest.slice(0, 2).map((m) => [m.mowca, m.wygloszone])).toEqual([['Lidia Czechak', 2], ['Maria Koc', 2]]);
    expect(w.odpowiedz).toMatch(/Lidia Czechak, Maria Koc \(2, remis\)/);
    expect(w.odpowiedz).toMatch(/niewygłoszone: Marcin Józefaciuk \(3\)/);
    expect(w.spis).toBeUndefined();
  });

  it('spis: wypowiedź po północy oznaczona, przy filtrze mówcy punkt porządku', async () => {
    const w = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, { posiedzenie: 65, data: '2026-09-17' }), zrodlo());
    expect((w.spis as Array<Record<string, unknown>>)[0]).toMatchObject({ numer: 0, poPolnocy: true });
    expect((w.uwagi as string[]).join(' ')).toMatch(/po północy/);
    const m = await wypowiedziPosiedzenia.wykonaj(wejscie(wypowiedziPosiedzenia.wejscie, { posiedzenie: 65, data: '2026-09-17', mowca: 'Koc' }), zrodlo());
    expect((m.spis as Array<Record<string, unknown>>)[0]).toMatchObject({
      punktPorzadku: '25. punkt porządku dziennego',
      tematPunktu: 'Sprawozdanie Komisji Kultury (druki nr 2556 i 2758).',
    });
  });
});

describe('walidacja wejścia po polsku (test 20)', () => {
  it('numery jako napisy przechodzą, złe wartości dają polskie komunikaty', () => {
    expect(profilPosla.wejscie.parse({ id: '12', kadencja: '9' })).toMatchObject({ id: 12, kadencja: 9 });
    const zle = profilPosla.wejscie.safeParse({ id: 'abc' });
    expect(zle.success).toBe(false);
    expect(zle.error?.issues[0].message).toMatch(/^Oczekiwano liczby, podano wartość, która nie jest liczbą/);
    expect(profilPosla.wejscie.safeParse({ id: 1.5 }).error?.issues[0].message).toBe('Oczekiwano liczby całkowitej, podano 1.5.');
    expect(zapytanieSurowe.wejscie.safeParse({ sciezka: 'a b' }).error?.issues[0].message).not.toMatch(/[\^$]/);
  });
});

describe('odpowiedź tylko w PDF (test 08)', () => {
  it('zapytanie 3015: onlyAttachment=false, a treść to „w załączniku”, więc wynik podaje adresy PDF', async () => {
    const z = new ZrodloZFikstur({
      'term10/writtenQuestions/3015': 'zapytanie-3015.json',
      'term10/writtenQuestions/3015/reply/DQYK9U/body': 'zapytanie-3015-odpowiedz.html',
      'term10/MP': 'mp-lista.json',
    });
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'zapytanie', numer: 3015, odpowiedzKlucz: 'DQYK9U' }), z);
    const tresc = w.tresc as { tylkoWZalaczniku: string; zalacznikPdf: string[] };
    expect(tresc.tylkoWZalaczniku).toMatch(/tylko w załączniku PDF/);
    expect(tresc.zalacznikPdf).toHaveLength(2);
    expect(w.odpowiedz).toMatch(/^Zapytanie nr 3015 \(wpłynęło do Sejmu/);
  });
});

describe('pisma po rundzie 20c (testy 07, 08, 17)', () => {
  const doZrodla = (z: ZrodloZFikstur) => ({ json: z.json.bind(z), lista: z.lista, tekst: z.tekst.bind(z), bajty: z.bajty.bind(z), adres: z.adres.bind(z) });

  it('szukaj_pism z tylkoOpoznione i adresatem liczy sam, na całej puli stronami, bez filtra delayed Sejmu', async () => {
    // Pula: 500 pism w terminie na pierwszej stronie i dwa spóźnione z licznikiem Sejmu 0 na drugiej.
    const wTerminie = Array.from({ length: 500 }, (_, i) => ({
      num: 30000 - i, title: 'x', to: ['minister sportu i turystyki'], replies: [{ key: 'A', receiptDate: '2026-01-10' }],
      recipientDetails: [{ name: 'minister sportu i turystyki', sent: '2026-01-01', answerDelayedDays: 0 }],
    }));
    const spoznione = [
      { num: 19371, title: 'raport', to: ['minister sportu i turystyki'], replies: [], recipientDetails: [{ name: 'minister sportu i turystyki', sent: '2026-09-03', answerDelayedDays: 0 }] },
      { num: 2183, title: 'bon', to: ['minister ds. polityki senioralnej', 'minister sportu i turystyki'],
        replies: [{ key: 'D4SHH9', from: 'Minister Marzena Okła-Drewnowicz', receiptDate: '2024-04-26', prolongation: false }],
        recipientDetails: [
          { name: 'minister sportu i turystyki', sent: '2024-03-28', answerDelayedDays: 0 },
          { name: 'minister ds. polityki senioralnej', sent: '2024-04-05', answerDelayedDays: 0 },
        ] },
    ];
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json', 'term10/interpellations/2183/reply/D4SHH9/body': null });
    const parametry: Array<Record<string, unknown>> = [];
    z.lista = (async (_s: string, o?: { parametry?: Record<string, unknown> }) => {
      parametry.push(o?.parametry ?? {});
      return { dane: o?.parametry?.offset ? spoznione : wTerminie, razem: 502 };
    }) as typeof z.lista;
    z.tekst = (async () => '<p class="intAuthor">Odpowiadający: minister ds. polityki senioralnej Marzena Okła-Drewnowicz</p>') as typeof z.tekst;
    const w = await szukajPism.wykonaj(
      wejscie(szukajPism.wejscie, { rodzaj: 'interpelacja', adresat: 'minister sportu i turystyki', tylkoOpoznione: true, sortuj: 'opoznienie' }),
      doZrodla(z),
    );
    expect(parametry.map((p) => p.offset)).toEqual([0, 500]);
    expect(parametry.every((p) => p.delayed === undefined)).toBe(true);
    const lista = w.pisma as Array<{ numer: number; poTerminieU: Array<{ dni: number }>; licznikOpoznieniaSejmu: number }>;
    expect(lista.map((p) => p.numer)).toEqual([2183, 19371]);
    expect(lista[0].licznikOpoznieniaSejmu).toBe(0);
    expect(w.razem).toBe(2);
    expect((w.uwagi as string[]).join(' ')).toMatch(/nie filtrem Sejmu delayed=true/);
    expect((w.uwagi as string[]).join(' ')).toMatch(/linii „Odpowiadający”/);
  });

  it('pismo z kluczem odpowiedzi spoza pisma: błąd z listą kluczy', async () => {
    const z = new ZrodloZFikstur({ 'term10/writtenQuestions/3442': 'zapytanie-3442.json', 'term10/MP': 'mp-lista.json' });
    await expect(pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'zapytanie', numer: 3442, odpowiedzKlucz: 'DQVGVD' }), z)).rejects.toThrow(
      'Zapytanie nr 3442 nie ma odpowiedzi o kluczu DQVGVD; dostępne: DU9G3H, DUJHZQ, DUPHWB.',
    );
  });

  it('pismo 3442: resorty z linii „Odpowiadający”, minister finansów jedyny bez odpowiedzi', async () => {
    const baza = 'term10/writtenQuestions/3442';
    const z = new ZrodloZFikstur({
      [baza]: 'zapytanie-3442.json',
      'term10/MP': 'mp-lista.json',
      ...Object.fromEntries(['DU9G3H', 'DUJHZQ', 'DUPHWB'].map((k) => [`${baza}/reply/${k}/body`, `zapytanie-3442-${k}.html`])),
    });
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'zapytanie', numer: 3442 }), z);
    const adresaci = w.adresaci as Array<{ adresat: string; odpowiedziano: unknown; dniPoTerminie: number | null; przypisanie?: string }>;
    expect(adresaci.map((a) => a.odpowiedziano)).toEqual([false, true, true, true]);
    expect(adresaci[0].adresat).toBe('minister finansów i gospodarki');
    expect(adresaci[0].dniPoTerminie).toBeGreaterThanOrEqual(121);
    expect(adresaci.slice(1).every((a) => /^wniosek z treści/.test(a.przypisanie ?? ''))).toBe(true);
    expect(w.odpowiedz).not.toMatch(/; ;|; \./);
    expect((w.odpowiedzi as Array<{ odpowiadajacy?: string }>)[0].odpowiadajacy).toMatch(/Ministerstwie Spraw Wewnętrznych/);
  });

  it('pismo bez recipientDetails i sentDate: adresaci z pola to, zdanie bez pustej części', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });
    const json = z.json.bind(z);
    z.json = (async (s: string) => (s === 'term10/MP' ? json(s) : { num: 20000, title: 'ETS', receiptDate: '2026-09-23', from: ['1'], to: ['minister klimatu i środowiska'], recipientDetails: [], replies: [] })) as typeof z.json;
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 20000 }), doZrodla(z));
    expect(w.adresaci).toEqual([expect.objectContaining({ adresat: 'minister klimatu i środowiska', doreczono: null, termin: null, stanDoreczenia: 'jeszcze nie wysłano, brak doręczenia' })]);
    expect(w.odpowiedz).toBe(
      'Interpelacja nr 20000 (wpłynęła do Sejmu 2026-09-23), 1 autor; minister klimatu i środowiska: rejestr nie podaje wysłania ani doręczenia (pismo jeszcze niewysłane), więc termin jeszcze nie biegnie.',
    );
  });

  it('pismo doręczone lata po wpływie: adnotacja o anomalii', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP': 'mp-lista.json' });
    const json = z.json.bind(z);
    z.json = (async (s: string) => (s === 'term10/MP' ? json(s) : {
      num: 1279, title: 'kadry', receiptDate: '2024-02-01', sentDate: '2026-08-17', from: ['20'], to: ['minister obrony narodowej'],
      recipientDetails: [{ name: 'minister obrony narodowej', sent: '2026-08-17', answerDelayedDays: 17 }],
      replies: [{ from: 'sekretarz stanu w Ministerstwie Obrony Narodowej - Paweł Bejda', receiptDate: '2026-08-31', prolongation: true }],
    })) as typeof z.json;
    const w = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 1279 }), doZrodla(z));
    expect((w.adresaci as Array<Record<string, unknown>>)[0]).toMatchObject({ doreczonoDniPoWplywie: 928 });
    expect(w.odpowiedz).toMatch(/doręczono 2026-08-17, 928 dni po wpływie do Sejmu/);
    expect((w.uwagi as string[]).join(' ')).toMatch(/Anomalia rejestru/);
  });

  it('pismo z adresatem „nie wiadomo”: dni po terminie jako liczba i zdanie, że nie znaczy to „żaden”', async () => {
    // Treść odpowiedzi nieosiągalna: przypisanie zostaje „nie wiadomo”.
    const z = new ZrodloZFikstur({ 'term10/interpellations/17177': 'interpelacja-17177.json', 'term10/MP': 'mp-lista.json' });
    z.tekst = (async () => null) as typeof z.tekst;
    const w2 = await pismo.wykonaj(wejscie(pismo.wejscie, { rodzaj: 'interpelacja', numer: 17177 }), doZrodla(z));
    const nieznani = (w2.adresaci as Array<{ odpowiedziano: unknown; dniPoTerminieGdyBezOdpowiedzi?: number }>).filter((a) => a.odpowiedziano === 'nie wiadomo');
    expect(nieznani.length).toBeGreaterThan(0);
    expect(nieznani.every((a) => typeof a.dniPoTerminieGdyBezOdpowiedzi === 'number' && a.dniPoTerminieGdyBezOdpowiedzi > 0)).toBe(true);
    expect(w2.odpowiedz).toMatch(/To nie znaczy, że nie odpowiedział żaden/);
    expect(w2.odpowiedz).toMatch(/jeśli nie odpowiedział, to \d+ dni po terminie/);
  });
});
