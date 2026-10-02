import { describe, expect, it } from 'vitest';
import { glosowanie, glosowaniaPosiedzenia, glosyPoslaWDniu } from '../src/narzedzia/glosowania.js';
import {
  APELE_DOWOLNY_PRZYCISK,
  apelDoPrzegladu,
  czyApelDowolnyPrzycisk,
  etykietaGlosu,
  poselNaApelu,
  rodzajGlosowania,
  wynikGlosowania,
  type GlosowanieSurowe,
} from '../src/reguly/glosowania.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;
type Rekord = GlosowanieSurowe & { sitting: number; votingNumber: number; votes: Array<{ MP: number; vote: string; club: string }> };
const rekord = (nazwa: string) => JSON.parse(fikstura(nazwa)) as Rekord;

// Rekordy pobrane z api.sejm.gov.pl 2026-10-02: 33/5 i 1/125 (apele w trybie „dowolny przycisk”),
// 18/46 (apel w trybie „obecny”, ten sam temat), 33/6 (zwykłe głosowanie tuż po 33/5).
describe('apele o kworum: kształt ALBO rejestr (reguła serwisu z 2.10.2026)', () => {
  it('33/5: temat „wniosek o stwierdzenie kworum”, 145/47/237, a to apel w trybie „dowolny przycisk”', () => {
    const g = rekord('glosowanie-33-5.json');
    expect([g.yes, g.no, g.abstain, g.present]).toEqual([145, 47, 237, 0]);
    const w = wynikGlosowania(g);
    expect(w).toMatchObject({
      rodzaj: 'kworum',
      przeszlo: null,
      obecnych: 429,
      kworumJest: true,
      trybApelu: 'dowolny-przycisk',
      etykieta: 'Kworum stwierdzone: 429 obecnych',
    });
    expect(w.apel?.cytat).toMatch(/Jakiegokolwiek przycisku\. \(\.\.\.\) Stwierdzam kworum\./);
    expect(w.apel?.stenogram).toBe('https://api.sejm.gov.pl/sejm/term10/proceedings/33/2025-04-23/transcripts/pdf');
    expect(apelDoPrzegladu(g)).toBeNull();
  });

  it('1/125: obecnych to suma naciśnięć (121 + 58 + 163 = 342), tyle ile marszałek odczytał w stenogramie', () => {
    const w = wynikGlosowania(rekord('glosowanie-1-125.json'));
    expect(w).toMatchObject({ rodzaj: 'kworum', obecnych: 342, etykieta: 'Kworum stwierdzone: 342 obecnych', trybApelu: 'dowolny-przycisk' });
    expect(w.apel?.cytat).toMatch(/jest nas 342/);
  });

  it('18/46: ten sam temat, kształt 0/0/0 przy 396 obecnych: apel w trybie „obecny”', () => {
    const g = rekord('glosowanie-18-46-kworum.json');
    expect(wynikGlosowania(g)).toMatchObject({ rodzaj: 'kworum', obecnych: 396, trybApelu: 'obecny', etykieta: 'Kworum stwierdzone: 396 obecnych' });
    expect(wynikGlosowania(g).apel).toBeUndefined();
    expect(apelDoPrzegladu(g)).toBeNull();
  });

  it('33/6: zwykłe głosowanie tuż po apelu zostaje zwykłe', () => {
    const w = wynikGlosowania(rekord('glosowanie-33-6.json'));
    expect(w).toMatchObject({ rodzaj: 'zwykle', przeszlo: true, etykieta: 'Przyjęto' });
  });

  it('rejestr dopasowuje po posiedzeniu, numerze i dniu; pięć wpisów, każdy z cytatem i stenogramem', () => {
    expect(APELE_DOWOLNY_PRZYCISK.map((a) => `${a.posiedzenie}/${a.numer}`)).toEqual(['1/125', '15/4', '16/4', '20/4', '33/5']);
    for (const a of APELE_DOWOLNY_PRZYCISK) {
      expect(a.kadencja).toBe(10);
      expect(a.cytat.length).toBeGreaterThan(50);
      expect(a.stenogram).toContain(`/proceedings/${a.posiedzenie}/${a.dzien}/transcripts/pdf`);
    }
    expect(czyApelDowolnyPrzycisk(33, 5, '2025-04-23T21:39:27')).not.toBeNull();
    // Ten sam numer w innej kadencji (inny dzień) nie jest apelem z rejestru.
    expect(czyApelDowolnyPrzycisk(33, 5, '2017-01-11T10:00:00')).toBeNull();
    const g = rekord('glosowanie-33-5.json');
    expect(rodzajGlosowania({ ...g, date: '2017-01-11T10:00:00' })).toBe('zwykle');
  });

  it('łagodne ostrzeżenie: nowy rekord z tematem „stwierdzenie kworum”, który nie jest apelem z kształtu ani z rejestru', () => {
    const g = rekord('glosowanie-33-5.json');
    const nowy = { ...g, sitting: 70, votingNumber: 3, date: '2026-11-05T10:00:00' };
    expect(rodzajGlosowania(nowy)).toBe('zwykle');
    expect(apelDoPrzegladu(nowy)).toMatch(/^70\/3 ma temat „wniosek o stwierdzenie kworum”.*rozstrzyga stenogram/);
    // Zwykły temat nie budzi ostrzeżenia.
    expect(apelDoPrzegladu(rekord('glosowanie-33-6.json'))).toBeNull();
  });
});

describe('poseł na apelu o kworum: każde naciśnięcie to obecność, brak naciśnięcia to opuszczony apel', () => {
  it('etykieta głosu na apelu nie udaje głosu za ani przeciw', () => {
    expect(poselNaApelu('YES')).toBe('obecny');
    expect(poselNaApelu('ABSTAIN')).toBe('obecny');
    expect(poselNaApelu('PRESENT')).toBe('obecny');
    expect(poselNaApelu('ABSENT')).toBe('opuszczony');
    expect(etykietaGlosu('NO', 'ELECTRONIC', true)).toBe('obecność na apelu o kworum (naciśnięty przycisk „przeciw”; to potwierdzenie obecności, nie głos)');
    expect(etykietaGlosu('ABSENT', 'ELECTRONIC', true)).toBe('opuszczony apel o kworum (nie wlicza się do nieobecności w głosowaniach)');
    expect(etykietaGlosu('NO', 'ELECTRONIC', false)).toBe('przeciw');
  });

  it('glosowanie 33/5: kluby mają obecnych i tych, którzy apel opuścili (429 + 31 = 460)', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/33/5': 'glosowanie-33-5.json', 'term10/MP': 'mp-lista.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 33, numer: 5, poselId: 1 }), z);
    expect(w).toMatchObject({ rodzaj: 'kworum', trybApelu: 'dowolny-przycisk', obecnych: 429, przeszlo: null });
    expect(w).not.toHaveProperty('za');
    expect(w.nacisniecia).toEqual({ za: 145, przeciw: 47, wstrzymanie: 237, obecny: 0 });
    const kluby = w.kluby as Array<{ obecni: number; opuscili: number }>;
    expect(kluby.reduce((s, k) => s + k.obecni, 0)).toBe(429);
    expect(kluby.reduce((s, k) => s + k.opuscili, 0)).toBe(31);
    expect(w.odpowiedz).toMatch(/^Głosowanie 33\/5 \(2025-04-23\) to apel o kworum w trybie „dowolny przycisk”.*kworum stwierdzone: 429 obecnych/);
    expect((w.glosPosla as { glos: string }).glos).toMatch(/^obecność na apelu o kworum \(naciśnięty przycisk „wstrzymuję się”/);
    expect(w.uwagi?.join(' ')).toMatch(/dowolny przycisk/);
  });

  it('glosy_posla_w_dniu 23.04.2025: 6 pozycji, apel 33/5 osobno, więc 5 głosowań jak w statystyce Sejmu', async () => {
    const z = new ZrodloZFikstur({ 'term10/MP/1/votings/33/2025-04-23': 'mp-1-33-2025-04-23.json', 'term10/votings/33': 'glosowania-33.json' });
    const w = await glosyPoslaWDniu.wykonaj(wejscie(glosyPoslaWDniu.wejscie, { id: 1, posiedzenie: 33, data: '2025-04-23' }), z);
    expect(w).toMatchObject({ glosowan: 6, apeliOKworum: 1, glosowanBezApeli: 5, bezOddanegoGlosu: 0, apeleObecnosc: 1, apeleOpuszczone: 0 });
    const apel = (w.glosy as Array<{ numer: number; glos: string; apelOKworum?: boolean }>).find((g) => g.numer === 5)!;
    expect(apel.apelOKworum).toBe(true);
    expect(apel.glos).toMatch(/^obecność na apelu o kworum/);
  });

  it('glosowania_posiedzenia 33: bilans liczy 33/5 jako apel, nie jako przyjęty wniosek', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/33': 'glosowania-33.json' });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 33, data: '2025-04-23' }), z);
    const b = w.bilans as { wszystkich: number; apeliOKworum: number; kworum: Array<{ glosowanie: string; obecnych: number }> };
    expect(b.apeliOKworum).toBe(1);
    expect(b.kworum).toEqual([{ glosowanie: '33/5', obecnych: 429, kworumJest: true }]);
  });
});
