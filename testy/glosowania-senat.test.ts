import { describe, expect, it } from 'vitest';
import { glosowanie, glosowaniaPosiedzenia, glosyPoslaWDniu, listaPosiedzen, szukajGlosowan } from '../src/narzedzia/glosowania.js';
import { etykietaGlosu, glosowanieSenackie, wynikGlosowania, type GlosowanieSurowe } from '../src/reguly/glosowania.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;
const g26 = () => JSON.parse(fikstura('glosowania-26.json')) as Array<GlosowanieSurowe & { votingNumber: number; sitting: number }>;

describe('poprawki Senatu: Sejm głosuje wniosek o odrzucenie (26/19, budżet 2025)', () => {
  it('reguła rozpoznaje poprawkę Senatu z tytułu, tematu i większości, a nie myli drugiego czytania', () => {
    const r = JSON.parse(fikstura('glosowanie-26-19-poprawka-senatu.json')) as GlosowanieSurowe;
    expect(glosowanieSenackie(r)).toBe('poprawka-senatu');
    const w = wynikGlosowania(r);
    // 194 za przy progu 216: wniosek o odrzucenie nie przeszedł, więc poprawka PRZYJĘTA.
    expect(w).toMatchObject({ przeszlo: false, senat: 'poprawka-senatu', stanowiskoSenatuPrzyjete: true, prog: 216 });
    expect(w.etykieta).toBe('Poprawka Senatu przyjęta (wniosek o odrzucenie nie uzyskał bezwzględnej większości)');

    const lista = g26();
    // 26/6: całość projektu ustawy; 26/11: „poprawka 1” w drugim czytaniu uchwały (większość zwykła).
    expect(glosowanieSenackie(lista.find((g) => g.votingNumber === 6)!)).toBeNull();
    expect(glosowanieSenackie(lista.find((g) => g.votingNumber === 11)!)).toBeNull();
    // 26/47: „poprawki nr 1-2 i 4”, 404 za przy progu 216: poprawki odrzucone, w liczbie mnogiej.
    expect(wynikGlosowania(lista.find((g) => g.votingNumber === 47)!).etykieta).toBe(
      'Poprawki Senatu odrzucone (wniosek o odrzucenie uzyskał bezwzględną większość)',
    );
    // 27/14: „poprawki” przy zwykłej większości, tytuł wspomina Senat, ale to nie uchwała Senatu.
    expect(glosowanieSenackie({ topic: 'poprawki nr 1 oraz 3-4', title: 'Sprawozdanie … wyborami uzupełniającymi do Senatu', majorityType: 'SIMPLE_MAJORITY' })).toBeNull();
    // Bez majorityType (głosy posła) rozstrzyga tekst.
    expect(glosowanieSenackie({ topic: 'poprawka 21', title: 'Pkt. 13 Sprawozdanie Komisji o uchwale Senatu w sprawie ustawy budżetowej na rok 2025' })).toBe('poprawka-senatu');
  });

  it('uchwała Senatu odrzucająca ustawę (IX kadencja, 76/104): wniosek przeszedł, ustawa zostaje', () => {
    const r = {
      ...JSON.parse(fikstura('glosowanie-26-19-poprawka-senatu.json')),
      topic: 'głosowanie nad wnioskiem o odrzucenie uchwały Senatu odrzucającej ustawę.',
      description: 'wniosek o odrzucenie uchwały Senatu odrzucającej ustawę z dnia 14 kwietnia 2023 r. o Państwowej Komisji …',
      yes: 234,
      no: 219,
      abstain: 1,
      majorityVotes: 228,
    };
    const w = wynikGlosowania(r);
    expect(w.senat).toBe('uchwala-senatu-odrzucajaca-ustawe');
    expect(w.etykieta).toMatch(/^Uchwała Senatu odrzucająca ustawę odrzucona: ustawa zostaje/);
    expect(etykietaGlosu('NO', 'ELECTRONIC', false, w.senat)).toBe('przeciw odrzuceniu uchwały Senatu (za odrzuceniem ustawy)');
  });

  it('glosowanie: wynik, zdanie i głos posła mówią o poprawce, nie gołe „Odrzucono”', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/26/19': 'glosowanie-26-19-poprawka-senatu.json', 'term10/MP': 'mp-lista.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 26, numer: 19, poselId: 400 }), z);
    expect(w).toMatchObject({
      wynik: 'Poprawka Senatu przyjęta (wniosek o odrzucenie nie uzyskał bezwzględnej większości)',
      przedmiotGlosowania: 'wniosek o odrzucenie poprawki Senatu',
      stanowiskoSenatuPrzyjete: true,
      przeszlo: false,
      glosPosla: { id: 400, glos: 'przeciw odrzuceniu poprawki Senatu (za poprawką)' },
    });
    expect(w.odpowiedz).toMatch(/nad poprawką Senatu \(głosowano wniosek o jej odrzucenie/);
    expect(w.odpowiedz).toMatch(/Rozstrzygnięcie: Poprawka Senatu przyjęta/);
    expect(w.odpowiedz).not.toMatch(/Wynik: odrzucono/);
    expect(w.uwagi?.join(' ')).toMatch(/art\. 121 ust\. 3/);
  });

  it('glosowania_posiedzenia: bilans liczy uchwały Senatu osobno, „odrzucono” ich nie obejmuje', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/26': 'glosowania-26.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 26 }), z);
    const b = w.bilans as { wszystkich: number; przyjetych: number; odrzuconych: number; nadUchwalamiSenatu: Record<string, number> };
    expect(b.nadUchwalamiSenatu).toEqual({ glosowan: 32, glosowanNadPoprawkami: 32, glosowanPoprawkaPrzyjeta: 28, glosowanPoprawkaOdrzucona: 4, nadOdrzuceniemUstawy: 0 });
    expect(b.przyjetych + b.odrzuconych).toBe(b.wszystkich - 32);
    expect(w.odpowiedz).toMatch(/nad uchwałami Senatu 32 .*poprawki przyjęte w 28 głosowaniach, odrzucone w 4 głosowaniach \(to liczba głosowań, nie poprawek/);
    const g19 = (w.glosowania as Array<{ numer: number; wynik: string }>).find((g) => g.numer === 19)!;
    expect(g19.wynik).toMatch(/^Poprawka Senatu przyjęta/);
  });

  it('glosy_posla_w_dniu: głos przy poprawce Senatu z rozstrzygnięciem (Tusk, 9 I 2025)', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP/400/votings/26/2025-01-09': 'mp-400-26-dzien.json', 'term10/votings/26': 'glosowania-26.json' });
    const w = await glosyPoslaWDniu.wykonaj(wejscie(glosyPoslaWDniu.wejscie, { id: 400, posiedzenie: 26, data: '2025-01-09' }), z);
    const glosy = w.glosy as Array<{ numer: number; glos: string; rozstrzygniecie?: string }>;
    expect(glosy.find((g) => g.numer === 19)).toMatchObject({
      glos: 'przeciw odrzuceniu poprawki Senatu (za poprawką)',
      rozstrzygniecie: expect.stringMatching(/^Poprawka Senatu przyjęta/),
    });
    expect(glosy.find((g) => g.numer === 39)!.glos).toBe('nieobecność');
    expect(glosy.find((g) => g.numer === 6)!.rozstrzygniecie).toBeUndefined();
    expect(w.apeliOKworum).toBe(0);
    expect(w.uwagi?.join(' ')).toMatch(/WNIOSEK O ODRZUCENIE/);
  });

  it('glosy_posla_w_dniu bez głosowań posiedzenia: etykieta z samego tekstu, bez wyniku', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP/400/votings/26/2025-01-09': 'mp-400-26-dzien.json' });
    const w = await glosyPoslaWDniu.wykonaj(wejscie(glosyPoslaWDniu.wejscie, { id: 400, posiedzenie: 26, data: '2025-01-09' }), z);
    const g19 = (w.glosy as Array<{ numer: number; glos: string; rozstrzygniecie?: string }>).find((g) => g.numer === 19)!;
    expect(g19.glos).toBe('przeciw odrzuceniu poprawki Senatu (za poprawką)');
    expect(g19.rozstrzygniecie).toBeUndefined();
    expect(w.apeliOKworum).toBeNull();
  });
});

describe('glosy_posla_w_dniu: wynik bez powtórzeń (02-b, Petru 3 VII 2026)', () => {
  it('tytuł punktu raz w słowniku, godzina zamiast daty, liczby bez zmian', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP/286/votings/61/2026-07-03': 'mp-286-61-dzien.json', 'term10/votings/61': 'glosowania-61.json' });
    const w = await glosyPoslaWDniu.wykonaj(wejscie(glosyPoslaWDniu.wejscie, { id: 286, posiedzenie: 61, data: '2026-07-03' }), z);
    expect(w).toMatchObject({ glosowan: 68, apeliOKworum: 1, glosowanBezApeli: 67, bezOddanegoGlosu: 6 });
    const glosy = w.glosy as Array<{ numer: number; godzina: string; punkt: string; glos: string; rozstrzygniecie?: string }>;
    const punkty = w.punkty as Record<string, string>;
    const g42 = glosy.find((g) => g.numer === 42)!;
    expect(g42).toMatchObject({ godzina: '10:00:44', punkt: 'Pkt. 16', rozstrzygniecie: 'Poprawka Senatu przyjęta' });
    expect(punkty['Pkt. 16']).toMatch(/^Sprawozdanie Komisji o uchwale Senatu .*narkomanii/);
    expect(glosy.filter((g) => g.glos === 'nieobecność').map((g) => g.numer)).toEqual([4, 5, 6, 7, 8, 11]);
    // Punkt bez numeru („Głosowanie proceduralne…”) zostaje w całości.
    expect(glosy.find((g) => g.numer === 4)!.punkt).toMatch(/^Głosowanie proceduralne/);
    expect(JSON.stringify(w).length).toBeLessThan(16_000);
  });
});

describe('apele o kworum', () => {
  it('wynik mówi, czy kworum było (230 = połowa ustawowej liczby posłów)', () => {
    const r = JSON.parse(fikstura('glosowanie-18-46-kworum.json')) as GlosowanieSurowe;
    expect(wynikGlosowania(r)).toMatchObject({ kworumJest: true, etykieta: 'Kworum stwierdzone: 396 obecnych' });
    expect(wynikGlosowania({ ...r, present: 200 })).toMatchObject({ kworumJest: false, etykieta: 'Brak kworum: 200 obecnych (< 230)' });
  });

  it('glosy_posla_w_dniu i glosowania_posiedzenia podają liczbę bez apeli', async () => {
    // 26/19 podmienione na kształt apelu (0/0/0, 263 obecnych): liczy się kształt wyniku, nie temat.
    const lista = g26().map((g) => (g.votingNumber === 19 ? { ...g, yes: 0, no: 0, abstain: 0, present: 263 } : g));
    const z = new ZrodloZFikstur({ 'term10/MP/400/votings/26/2025-01-09': 'mp-400-26-dzien.json' });
    const json = z.json.bind(z);
    z.json = (async (s: string) => (s === 'term10/votings/26' ? lista : json(s))) as typeof z.json;
    const w = await glosyPoslaWDniu.wykonaj(wejscie(glosyPoslaWDniu.wejscie, { id: 400, posiedzenie: 26, data: '2025-01-09' }), z);
    expect(w).toMatchObject({ glosowan: 49, apeliOKworum: 1, glosowanBezApeli: 48 });
    expect(w.odpowiedz).toMatch(/49 głosowań, w tym 1 apel o kworum \(bez nich 48; statystyka Sejmu apeli z reguły nie liczy\)/);
    const p = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 26 }), z);
    expect(p.odpowiedz).toMatch(/26\/19: obecnych 263, kworum stwierdzone\), więc bez apeli 51 głosowań/);
    expect(p.uwagi?.join(' ')).toMatch(/statystyka Sejmu .* z reguły ich nie liczy/);
  });

  it('lista_posiedzen przy wąskim zakresie liczy apele przy każdym dniu', async () => {
    const lista = g26().map((g) => (g.votingNumber === 3 ? { ...g, yes: 0, no: 0, abstain: 0, present: 263 } : g));
    const z = new ZrodloZFikstur({});
    const odp: Record<string, unknown> = {
      'term10/proceedings': [{ number: 26, title: '26. posiedzenie', dates: ['2025-01-08', '2025-01-09', '2025-01-10'] }],
      'term10/votings': JSON.parse(fikstura('posiedzenia-glosowan.json')),
      'term10/votings/26': lista,
    };
    z.json = (async (s: string) => odp[s] ?? null) as typeof z.json;
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { od: '2025-01-08', do: '2025-01-10' }), z);
    const dni = (w.posiedzenia as Array<{ dni: Array<{ data: string; glosowan: number; apeliOKworum?: number; glosowanBezApeli?: number }> }>)[0].dni;
    expect(dni[0]).toEqual({ data: '2025-01-08', glosowan: 3, apeliOKworum: 1, glosowanBezApeli: 2 });
    expect(w.uwagi?.join(' ')).toMatch(/RAZEM z apelami o kworum/);
  });
});

describe('posiedzenie spoza rejestru', () => {
  it('glosowania_posiedzenia 9999: znaleziono false zamiast „0 głosowań”', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/9999': null, 'term10/proceedings/9999': null });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 9999 }), z);
    expect(w.znaleziono).toBe(false);
    expect(w.odpowiedz).toBeUndefined();
    expect(w.uwagi?.join(' ')).toMatch(/nie zna posiedzenia 9999/);
  });

  it('posiedzenie zaplanowane istnieje, tylko nie ma jeszcze głosowań', async () => {
    const z = new ZrodloZFikstur({});
    z.json = (async (s: string) =>
      s === 'term10/proceedings/66' ? { number: 66, title: '66. Posiedzenie', dates: ['2099-10-06', '2099-10-07'] } : []) as typeof z.json;
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 66 }), z);
    expect(w).toMatchObject({ znaleziono: true, stan: 'zaplanowane' });
    expect(w.odpowiedz).toMatch(/zaplanowane i jeszcze się nie odbyło/);
  });
});

describe('szukaj_glosowan', () => {
  it('rok z frazy: budżet na 2026 nie wyprzedza budżetu na 2025', async () => {
    const baza = g26()[18];
    const tytul = (rok: number) => `Pkt. 13 Sprawozdanie Komisji o uchwale Senatu w sprawie ustawy budżetowej na rok ${rok} (druki)`;
    const rekordy = [
      { ...baza, sitting: 26, votingNumber: 19, date: '2025-01-09T18:16:50', title: tytul(2025) },
      { ...baza, sitting: 49, votingNumber: 40, date: '2026-01-09T12:00:00', title: tytul(2026) },
    ];
    const fraza = 'ustawy budżetowej na rok 2025 poprawkami Senatu';
    const z = new ZrodloZFikstur({});
    z.lista = (async (_s: string, o?: { parametry?: Record<string, unknown> }) => {
      const p = o?.parametry ?? {};
      if (p.title === fraza) return { dane: [], razem: 0 };
      return p.limit === 1 ? { dane: [], razem: rekordy.length } : { dane: rekordy, razem: rekordy.length };
    }) as typeof z.lista;
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza }), z);
    expect((w.glosowania as Array<{ glosowanie: string }>).map((g) => g.glosowanie)).toEqual(['26/19']);
    expect(w.uwagi?.join(' ')).toMatch(/rok 2025: pominięto 1/);
  });

  it('podsumowanie według rodzaju liczone ze wszystkich trafień, nie z porcji (04-b)', async () => {
    const kworum = JSON.parse(fikstura('glosowanie-18-46-kworum.json')) as GlosowanieSurowe & { votingNumber: number; sitting: number };
    const zwykle = g26()[5];
    const rekordy = [
      { ...zwykle, sitting: 1, votingNumber: 125, date: '2023-11-20T10:00:00', title: 'Wniosek o stwierdzenie kworum' },
      { ...kworum, sitting: 18, votingNumber: 46 },
      { ...kworum, sitting: 54, votingNumber: 22, date: '2026-03-27T10:00:00' },
    ];
    const z = new ZrodloZFikstur({});
    z.lista = (async (_s: string, o?: { parametry?: Record<string, unknown> }) => {
      const p = o?.parametry ?? {};
      const off = Number(p.offset ?? 0);
      return { dane: rekordy.slice(off, off + Number(p.limit)), razem: rekordy.length };
    }) as typeof z.lista;
    const w = await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'kworum', limit: 1 }), z);
    expect((w.glosowania as unknown[]).length).toBe(1);
    expect(w.wedlugRodzaju).toEqual({ kworum: 2, 'za-przeciw': 1 });
    expect(w.odpowiedz).toBe('3 trafienia: apele o kworum 2, głosowania za/przeciw 1 (liczone ze wszystkich trafień, nie z tej porcji).');
  });

  it('od i do idą do rejestru bez przesunięcia: votings/search ma brzegi włącznie', async () => {
    // Sprawdzone na żywo 2026-09-24: dateFrom=dateTo=2026-09-18 daje 134 głosowania z 18 IX,
    // a dateTo=2025-06-25 obejmuje głosowanie z 23:13 tego dnia. Przesunięcie o dzień zgubiłoby brzeg.
    const z = new ZrodloZFikstur({ 'term10/votings/search': 'glosowania-szukaj.json' });
    await szukajGlosowan.wykonaj(wejscie(szukajGlosowan.wejscie, { fraza: 'budżet', od: '2026-09-18', do: '2026-09-18', limit: 3 }), z);
    for (const q of z.zapytania) expect(q.parametry).toMatchObject({ dateFrom: '2026-09-18', dateTo: '2026-09-18' });
  });
});
