import { describe, expect, it } from 'vitest';
import { glosowaniaPosiedzenia, listaPosiedzen, MAKS_ZNAKOW, OSTATNICH_POSIEDZEN } from '../src/narzedzia/glosowania.js';
import {
  drukiTytulu,
  krotkaNazwaPunktu,
  liniaGlosowania,
  punktyPorzadku,
  punktyZTytulu,
  rozlozNaPunkty,
} from '../src/reguly/porzadek.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;
// 65. posiedzenie (15–18 IX 2026), pobrane z api.sejm.gov.pl 2026-10-02: /proceedings/65 i /votings/65.
const agenda65 = () => (JSON.parse(fikstura('posiedzenie-65.json')) as { agenda: string }).agenda;
const glosowania65 = () => JSON.parse(fikstura('glosowania-65.json')) as Array<{ votingNumber: number; title: string; topic: string }>;

describe('porządek obrad: punkty z pola agenda', () => {
  it('65. posiedzenie: 53 punkty, numeracja przez dwie listy (punkt 41 niezrealizowany, druga lista od 42)', () => {
    const punkty = punktyPorzadku(agenda65());
    expect(punkty).toHaveLength(53);
    expect(punkty[0].poz).toBe(1);
    expect(punkty.map((p) => p.poz)).not.toContain(41);
    expect(punkty.at(-1)!.poz).toBe(54);
    expect(punkty[1].druki).toEqual(['3010', '3055', '3055-A']);
    expect(krotkaNazwaPunktu(punkty[1].tekst)).toMatch(/^Ustawa o umorzeniu należności/);
  });

  it('pusty albo brakujący porządek to pusta lista, nie wyjątek', () => {
    expect(punktyPorzadku(null)).toEqual([]);
    expect(punktyPorzadku('')).toEqual([]);
  });
});

describe('głosowanie → punkt porządku (reguła serwisu z 2.10.2026)', () => {
  it('65. posiedzenie: 137 ze 147 głosowań pod punktami, 10 w „Pozostałe głosowania”', () => {
    const r = rozlozNaPunkty(punktyPorzadku(agenda65()), glosowania65());
    expect(r.punkty).toHaveLength(53);
    expect(r.punkty.reduce((s, p) => s + p.glosowania.length, 0)).toBe(137);
    expect(r.poza.map((g) => g.votingNumber)).toEqual([2, 3, 4, 5, 6, 15, 16, 17, 72, 73]);
    // 65/5 i 65/6: druki 3100 i 3099 mają po dwa punkty, więc zostają poza punktami.
    expect(liniaGlosowania(r.poza[3].title, r.poza[3].topic, false)).toBe('Wniosek o skrócenie terminu (druk 3100)');
  });

  it('numer punktu tylko z początku tytułu; wspólne rozpatrywanie daje kilka numerów', () => {
    expect(punktyZTytulu('Pkt. 44 Sprawozdanie Komisji')).toEqual([44]);
    expect(punktyZTytulu('Pkt. 10., 11., 12. i 13 Pierwsze czytanie')).toEqual([10, 11, 12, 13]);
    expect(punktyZTytulu('Rozstrzygnięcie proceduralne dotyczące pkt 14')).toEqual([]);
    expect(drukiTytulu('Głosowanie proceduralne dotyczące druku nr 3100')).toEqual(['3100']);
    expect(drukiTytulu('Wybór (druki nr 2875 i 3077)')).toEqual(['2875', '3077']);
  });

  it('linia głosowania: pod punktem temat z rejestru, poza punktem czytelna nazwa zamiast nazwy posiedzenia', () => {
    expect(liniaGlosowania('Pkt. 2 Sprawozdanie Komisji o projekcie ustawy (druki nr 3010, 3055)', 'poprawka 1', true)).toBe('poprawka 1');
    expect(liniaGlosowania('65. posiedzenie Sejmu Rzeczypospolitej Polskiej w dniach 15, 16, 17 i 18 września 2026 r.', 'Wniosek o przerwę', false)).toBe('Wniosek o przerwę');
    expect(liniaGlosowania('Głosowanie proceduralne dotyczące druku 2821', 'wniosek o skrócenie terminu w sprawie druku nr 2821', false)).toBe('Wniosek o skrócenie terminu (druk 2821)');
  });
});

describe('glosowania_posiedzenia z porzadek=true', () => {
  const zrodlo = () => new ZrodloZFikstur({ 'term10/votings/65': 'glosowania-65.json', 'term10/proceedings/65': 'posiedzenie-65.json' });
  type Porzadek = {
    punktow: number;
    glosowanPodPunktami: number;
    pozostalychGlosowan: number;
    punkty: Array<{ punkt: number; glosowania?: Array<{ glosowanie: string; wynik: string }>; glosowan?: number }>;
    pozostaleGlosowania: { nazwa: string; glosowania: Array<{ glosowanie: string; wynik: string }> };
  };

  it('każde głosowanie stoi raz, porcje mieszczą się w limicie znaków, odPunktu daje resztę', async () => {
    const widziane: string[] = [];
    let odPunktu: number | undefined;
    for (let i = 0; i < 5; i++) {
      const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 65, porzadek: true, ...(odPunktu ? { odPunktu } : {}) }), zrodlo());
      expect(JSON.stringify(w).length).toBeLessThanOrEqual(MAKS_ZNAKOW);
      const p = w.porzadek as Porzadek;
      expect(p).toMatchObject({ punktow: 53, glosowanPodPunktami: 137, pozostalychGlosowan: 10 });
      expect(p.punkty).toHaveLength(53);
      for (const pk of p.punkty) widziane.push(...(pk.glosowania ?? []).map((g) => g.glosowanie));
      if (i === 0) {
        expect(w.odpowiedz).toMatch(/Porządek obrad: 53 punkty; pod punktami 137 głosowań, w grupie „Pozostałe głosowania” 10\./);
        widziane.push(...p.pozostaleGlosowania.glosowania.map((g) => g.glosowanie));
        const apel = p.pozostaleGlosowania.glosowania.find((g) => g.glosowanie === '65/3')!;
        expect(apel.wynik).toBe('Kworum stwierdzone: 402 obecnych');
      }
      odPunktu = (w as { nastepnyPunkt?: number | null }).nastepnyPunkt ?? undefined;
      if (!odPunktu) break;
    }
    expect(widziane).toHaveLength(147);
    expect(new Set(widziane).size).toBe(147);
  });

  it('bez porządku w rejestrze: lista po kolei z uwagą, nie błąd', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/65': 'glosowania-65.json', 'term10/proceedings/65': null });
    const w = await glosowaniaPosiedzenia.wykonaj(wejscie(glosowaniaPosiedzenia.wejscie, { posiedzenie: 65, porzadek: true }), z);
    expect(w).not.toHaveProperty('porzadek');
    expect((w.glosowania as unknown[]).length).toBeGreaterThan(0);
    expect(w.uwagi?.join(' ')).toMatch(/Porządku obrad tego posiedzenia nie ma w rejestrze/);
  });
});

describe('lista_posiedzen: przegląd zamiast całej kadencji', () => {
  // Rejestr X kadencji z 2026-10-02 (pole agenda usunięte, żeby fikstura była mała).
  const zrodlo = () => new ZrodloZFikstur({ 'term10/proceedings': 'posiedzenia-10-bez-porzadku.json', 'term10/votings': 'dni-glosowan-10.json' });

  it(`domyślnie ${OSTATNICH_POSIEDZEN} ostatnich i najbliższe, sumy z całej kadencji; wszystkie=true daje 66`, async () => {
    const krotka = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, {}), zrodlo());
    const p = krotka.posiedzenia as Array<{ numer: number | null }>;
    expect(p.length).toBeGreaterThanOrEqual(OSTATNICH_POSIEDZEN);
    expect(p.length).toBeLessThanOrEqual(OSTATNICH_POSIEDZEN + 1);
    expect(p.some((x) => x.numer === 65)).toBe(true);
    expect(p.some((x) => x.numer === 1)).toBe(false);
    expect(krotka.liczba).toBe(66);
    expect((krotka.sumy as { posiedzen: number }).posiedzen).toBe(66);
    expect(krotka.uwagi?.join(' ')).toMatch(/Lista posiedzeń jest skrócona/);
    expect(JSON.stringify(krotka).length).toBeLessThan(4000);

    const pelna = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { wszystkie: true }), zrodlo());
    expect((pelna.posiedzenia as unknown[]).length).toBe(66);
    expect(pelna).not.toHaveProperty('pokazano');
  });

  it('z od/do zakres decyduje sam, bez skracania', async () => {
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { od: '2024-01-01', do: '2024-12-31' }), zrodlo());
    expect((w.posiedzenia as unknown[]).length).toBeGreaterThan(OSTATNICH_POSIEDZEN);
    expect(w).not.toHaveProperty('pokazano');
  });
});
