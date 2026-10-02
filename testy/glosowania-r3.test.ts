import { describe, expect, it } from 'vitest';
import { drukZTekstu, glosowanie, glosowaniaPosiedzenia, listaPosiedzen, szukajGlosowan } from '../src/narzedzia/glosowania.js';
import { rozkladKlubow, type GlosowanieSurowe } from '../src/reguly/glosowania.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;
type Rekord = GlosowanieSurowe & { sitting: number; votingNumber: number; sittingDay: number };
const baza = () => JSON.parse(fikstura('glosowania-26.json'))[5] as Rekord;

/** Wyszukiwarka rejestru na niby: tytuł zawiera frazę (bez wielkości liter), porcje po offset/limit. */
function wyszukiwarka(rekordy: Rekord[]) {
  const z = new ZrodloZFikstur({});
  z.lista = (async (_s: string, o?: { parametry?: Record<string, unknown> }) => {
    const p = o?.parametry ?? {};
    z.zapytania.push({ sciezka: _s, parametry: o?.parametry as never });
    const fraza = String(p.title ?? '').toLowerCase();
    const pasuje = rekordy.filter((g) => `${g.title} ${g.topic} ${g.description ?? ''}`.toLowerCase().includes(fraza));
    const off = Number(p.offset ?? 0);
    return { dane: pasuje.slice(off, off + Number(p.limit ?? 100)), razem: pasuje.length };
  }) as typeof z.lista;
  return z;
}

describe('szukaj_glosowan: kilka rdzeni (19-5, 05-k3)', () => {
  it('„Mejza immunitet”: nazwisko nie ginie pod najrzadszym rdzeniem, a uwagi mówią, jak szukano', async () => {
    const b = baza();
    const mejza = Array.from({ length: 7 }, (_, i) => ({
      ...b,
      sitting: 31,
      votingNumber: 62 + i,
      date: `2025-03-20T1${i}:00:00`,
      title: 'Pkt. 5 Sprawozdanie Komisji w sprawie wniosku oskarżyciela prywatnego Łukasza Mejzy o wyrażenie zgody na pociągnięcie posłanki do odpowiedzialności',
      topic: 'wniosek',
      description: null,
    }));
    const immunitet = [
      { ...b, sitting: 23, votingNumber: 3, date: '2024-12-01T10:00:00', title: 'Pkt. 2 Sprawozdanie o umowie Intersputnik o immunitetach', topic: 'całość', description: null },
      { ...b, sitting: 1, votingNumber: 53, date: '2023-11-28T10:00:00', title: 'Pkt. 9 Wybór składu Komisji Regulaminowej, Spraw Poselskich i Immunitetowych', topic: 'wybór', description: null },
      { ...b, sitting: 1, votingNumber: 10, date: '2023-11-14T10:00:00', title: 'Pkt. 4 Komisja immunitetowa', topic: 'wybór', description: null },
    ];
    const z = wyszukiwarka([...immunitet, ...mejza]);
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'Mejza immunitet' }), z);
    const g = w.glosowania as Array<{ glosowanie: string }>;
    expect(g).toHaveLength(10);
    expect(g.slice(0, 7).every((x) => x.glosowanie.startsWith('31/'))).toBe(true);
    const u = w.uwagi!.join(' ');
    expect(u).toMatch(/„Mej” 7 \(nazwa własna\), „immuni” 3/);
    expect(u).toMatch(/pobrano tytuły z rdzeniem „Mej” i „immuni”/);
    expect(u).toMatch(/Najpierw 7 tytułów z nazwą własną/);
  });

  it('pełne trafienie na pierwszym rdzeniu kończy szukanie (bez drugiej serii zapytań)', async () => {
    const b = baza();
    const rekordy = [
      { ...b, sitting: 46, votingNumber: 75, date: '2025-12-05T10:00:00', title: 'Pkt. 1 Wniosek Prezydenta o ponowne rozpatrzenie ustawy o kryptoaktywach', topic: 'głosowanie', description: null },
      { ...b, sitting: 40, votingNumber: 1, date: '2025-09-01T10:00:00', title: 'Pkt. 3 Sprawozdanie o projekcie ustawy o kryptoaktywach', topic: 'całość', description: null },
    ];
    const z = wyszukiwarka(rekordy);
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'kryptoaktywach rozpatrzenie' }), z);
    expect((w.glosowania as Array<{ glosowanie: string }>).map((x) => x.glosowanie)).toEqual(['46/75']);
    const tytuly = z.zapytania.filter((q) => q.parametry?.limit === 100).map((q) => q.parametry?.title);
    expect(new Set(tytuly).size).toBe(1);
  });

  it('całości ustaw o tym samym tytule z różnych dni: niejednoznaczne z drukiem przy każdej', async () => {
    const b = baza();
    const tytul = (druk: string, pkt: number) =>
      `Pkt. ${pkt} Sprawozdanie Komisji o rządowym projekcie ustawy o zmianie ustawy o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych oraz niektórych innych ustaw (druki nr ${druk})`;
    const rekordy = [
      { ...b, sitting: 32, votingNumber: 17, date: '2025-04-04T09:48:12', title: tytul('838, 1103 i 1103-A', 19), topic: 'głosowanie nad całością projektu.', description: 'całość projektu ustawy' },
      { ...b, sitting: 41, votingNumber: 35, date: '2025-09-26T12:52:13', title: tytul('1609, 1670 i 1670-A', 4), topic: 'głosowanie nad całością projektu.', description: 'całość projektu ustawy' },
    ];
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'świadczeniach opieki zdrowotnej' }), wyszukiwarka(rekordy));
    const n = w.niejednoznaczne as { powod: string; glosowania: Array<{ glosowanie: string; druk: string }> };
    expect(n.powod).toMatch(/RÓŻNE akty: 41\/35 \(2025-09-26, druk 1609\), 32\/17 \(2025-04-04, druk 838\)/);
    expect(n.glosowania.map((x) => x.druk).sort()).toEqual(['1609', '838']);
    expect((w.glosowania as Array<{ druk: string }>).map((g) => g.druk)).toEqual(['1609', '838']);
  });

  it('drukZTekstu: druk projektu z tytułu, tematu albo opisu', () => {
    expect(drukZTekstu('Pkt. 19 Sprawozdanie … (druki nr 838, 1103 i 1103-A) - trzecie czytanie')).toBe('838');
    expect(drukZTekstu(null, 'Druk nr 930 - wniosek o skrócenie terminu')).toBe('930');
    expect(drukZTekstu('Głosowanie proceduralne dotyczące druku 929')).toBe('929');
    expect(drukZTekstu('Wybór Marszałka Sejmu')).toBeNull();
  });

  it('daty z IX kadencji bez parametru kadencja: szuka w kadencji 9 i mówi o tym', async () => {
    const z = new ZrodloZFikstur({ 'term9/votings/search': 'glosowania-szukaj.json' });
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'budżet', od: '2022-11-01', do: '2022-11-30', limit: 3 }), z);
    expect(z.zapytania.every((q) => q.sciezka === 'term9/votings/search')).toBe(true);
    expect(w.uwagi![0]).toMatch(/należą do kadencji 9, nie 10: użyto kadencji 9/);
  });
});

describe('glosowania_posiedzenia: kadencja z daty i rozmiar (17-3, 20-5)', () => {
  it('posiedzenie 66 z datą 2022-11-16 bez kadencji czyta IX kadencję', async () => {
    const lista = JSON.parse(fikstura('glosowania-26.json')).map((g: Rekord) => ({ ...g, sitting: 66, date: '2022-11-16T10:00:00' }));
    const z = new ZrodloZFikstur({});
    const pytane: string[] = [];
    z.json = (async (s: string) => {
      pytane.push(s);
      return s === 'term9/votings/66' ? lista : null;
    }) as typeof z.json;
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 66, data: '2022-11-16', limit: 3 }), z);
    expect(pytane).toEqual(['term9/votings/66']);
    expect(w.odpowiedz).toMatch(/^Posiedzenie 66, dzień 2022-11-16 \(kadencja 9\)/);
    expect(w.uwagi![0]).toMatch(/należy do kadencji 9/);
  });

  it('pełne posiedzenie mieści się w 20 tys. znaków i mówi, skąd wziąć resztę', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/26': 'glosowania-26.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 26, limit: 30 }), z);
    expect(JSON.stringify(w).length).toBeLessThanOrEqual(20_000);
    const pokazane = (w.glosowania as unknown[]).length;
    expect(w.nastepnePrzesuniecie).toBe(pokazane);
    expect(w.uwagi!.join(' ')).toMatch(new RegExp(`przesuniecie=${pokazane}`));
    // Zakres i następna porcja stoją w odpowiedzi i w pokazano, nie tylko w uwagach (20-b).
    expect(w.pokazano).toMatch(new RegExp(`^głosowania 1–${pokazane} z \\d+; następna porcja: przesuniecie=${pokazane}$`));
    expect(w.odpowiedz).toMatch(new RegExp(`Lista niżej: głosowania 1–${pokazane} z`));
    // Druga porcja przypomina, od którego głosowania się zaczyna.
    const w2 = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 26, przesuniecie: pokazane }), z);
    expect(w2.uwagi!.join(' ')).toMatch(new RegExp(`zaczyna się od głosowania ${pokazane + 1}`));
    expect(() => glosowaniaPosiedzenia.wejscie.parse({ posiedzenie: 26, limit: 60 })).toThrow();
    // Tytuł punktu raz w słowniku, przy głosowaniu sam numer.
    expect((w.glosowania as Array<{ punkt: string | null }>).some((g) => g.punkt === 'Pkt. 13')).toBe(true);
    expect((w.punkty as Record<string, string>)['Pkt. 13']).toMatch(/ustawy budżetowej na rok 2025/);
    expect(() => glosowaniaPosiedzenia.wejscie.parse({ posiedzenie: 26, limit: 100 })).toThrow();
  });
});

describe('lista_posiedzen: sumy, sąsiedzi, kolejność (06, 19-4)', () => {
  const posiedzenia = [
    { number: 46, title: '46.', dates: ['2025-12-02', '2025-12-03', '2025-12-05'] },
    { number: 47, title: '47.', dates: ['2025-12-05', '2025-12-09'] },
    { number: 48, title: '48.', dates: ['2025-12-17', '2025-12-18'] },
    { number: 0, title: 'planowane', dates: ['2099-01-27', '2099-01-28'] },
    { number: 0, title: 'planowane', dates: ['2099-01-13', '2099-01-14'] },
  ];
  const zrodlo = () => {
    const z = new ZrodloZFikstur({});
    z.json = (async (s: string) => (s === 'term10/proceedings' ? posiedzenia : s === 'term10/votings' ? [] : null)) as typeof z.json;
    return z;
  };

  it('dniObrad i unikalneDni: 5 XII 2025 należy do 46. i 47.', async () => {
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { od: '2025-12-01', do: '2025-12-31' }), zrodlo());
    expect(w.sumy).toMatchObject({ posiedzen: 3, dniObrad: 7, unikalneDni: 6, dniDwochPosiedzen: ['2025-12-05'] });
    expect(w.odpowiedz).toMatch(/3 posiedzenia z numerem \(od 46\. do 48\.\); dni obrad, które już minęły: 7 \(różnych dat 6; 2025-12-05 to dzień dwóch posiedzeń\)/);
  });

  it('pusty zakres: posiedzenie tuż przed i tuż po pytanej dacie', async () => {
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { od: '2025-12-10', do: '2025-12-10' }), zrodlo());
    expect(w.sasiedzi).toMatchObject({ przedZakresem: { numer: 47 }, poZakresie: { numer: 48 } });
    expect(w.odpowiedz).toMatch(/brak posiedzeń Sejmu; najbliższe wcześniej: 47\. \(2025-12-05, 2025-12-09\); najbliższe później: 48\./);
  });

  it('zaplanowane bez numeru idą po dacie, nie w kolejności rejestru', async () => {
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { planowane: true }), zrodlo());
    const dni = (w.posiedzenia as Array<{ dni: Array<{ data: string }> }>).map((p) => p.dni[0].data);
    expect(dni).toEqual([...dni].sort());
  });
});

describe('glosowanie: wybór z listy i lista imienna (03-2, 20)', () => {
  const zListy = () => {
    const g = JSON.parse(fikstura('glosowanie-10-1.json'));
    return {
      ...g,
      kind: 'ON_LIST',
      yes: 0,
      no: 0,
      abstain: 0,
      votingOptions: [{ option: 'HOŁOWNIA SZYMON', votes: 450, optionIndex: 1 }],
      votes: g.votes.slice(0, 4).map((v: { vote: string }, i: number) => ({ ...v, club: 'PiS', vote: i === 3 ? 'ABSENT' : 'VOTE_VALID', listVotes: i === 3 ? undefined : { 1: 'YES' } })),
    };
  };

  it('kluby[] mają nieobecni zamiast bezKarty, a zdanie podaje karty i nieobecnych', async () => {
    const z = new ZrodloZFikstur({});
    z.json = (async () => zListy()) as typeof z.json;
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 1, numer: 1 }), z);
    expect(w.kluby).toEqual([{ klub: 'PiS', kartOddanych: 3, nieobecni: 1 }]);
    expect(w.odpowiedz).toMatch(/karty oddało 3 posłów, nieobecnych 1\./);
  });

  it('rozkladKlubow: VOTE_VALID bez wyborów to karta oddana, ABSENT to nieobecność', () => {
    const k = rozkladKlubow(
      [
        { MP: 1, club: 'A', vote: 'VOTE_VALID', listVotes: {} },
        { MP: 2, club: 'A', vote: 'ABSENT' },
        { MP: 3, club: 'A', vote: 'VOTE_INVALID' },
      ],
      'ON_LIST',
    );
    expect(k[0]).toMatchObject({ zListy: 1, nieobecny: 1, niewazne: 1 });
  });

  it('lista imienna całej izby zgrupowana i poniżej 20 tys. znaków', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/10/1': 'glosowanie-10-1.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 10, numer: 1, listaImienna: true }), z);
    expect(JSON.stringify(w).length).toBeLessThanOrEqual(20_000);
    const l = w.listaImienna as Record<string, Record<string, string[]>>;
    const razem = Object.values(l).flatMap((k) => Object.values(k)).flat().length;
    expect(razem).toBe(457);
    expect(Object.keys(l)).toEqual(expect.arrayContaining(['za', 'przeciw', 'nieobecność']));
  });
});
