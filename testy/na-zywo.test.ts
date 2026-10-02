/**
 * Test na prawdziwym API Sejmu. Nie chodzi w CI: uruchamia się tylko przez `npm run test:na-zywo`
 * (ustawia SEJM_MCP_NA_ZYWO=1). Każde narzędzie raz, z pamięcią wyłączoną.
 */
import { describe, expect, it } from 'vitest';
import { KlientSejmu } from '../src/klient.js';
import { NARZEDZIA } from '../src/narzedzia/index.js';
import { BezPamieci } from '../src/pamiec.js';

const PRZYPADKI: Record<string, unknown> = {
  znajdz_posla: { fraza: 'petru' },
  profil_posla: { id: 286 },
  kluby: {},
  lista_posiedzen: {},
  glosowania_posiedzenia: { posiedzenie: 10, data: '2024-04-24' },
  szukaj_glosowan: { fraza: 'budżet', limit: 3 },
  glosowanie: { posiedzenie: 10, numer: 1, poselId: 286 },
  glosy_posla_w_dniu: { id: 1, posiedzenie: 10, data: '2024-04-24' },
  szukaj_pism: { rodzaj: 'interpelacja', adresat: 'minister zdrowia', limit: 3 },
  pismo: { rodzaj: 'zapytanie', numer: 1, tresc: true },
  szukaj_procesow: { fraza: 'budżet', limit: 3 },
  proces: { numer: '1' },
  druk: { numer: '1' },
  tekst_druku: { numer: '2690' },
  posiedzenia_komisji: { komisja: 'ZDR', limit: 2 },
  wypowiedzi_posiedzenia: { posiedzenie: 10, data: '2024-04-24' },
  tresc_wypowiedzi: { posiedzenie: 10, data: '2024-04-24', numer: 1 },
  szukaj_aktow: { fraza: 'Krajowej Radzie Sądownictwa', limit: 3 },
  akt: { adres: 'DU/2026/62' },
  tresc_aktu: { adres: 'DU/2019/914', artykul: '1' },
  kadencje: {},
  komisje: { kod: 'ZDR' },
  porzadek_posiedzenia: {},
  szukaj_projektow: { wnioskodawca: 'Prezydent', limit: 3 },
  szukaj_drukow: { fraza: 'budżetowej', limit: 3 },
  transmisje: { data: '2024-04-24', limit: 3 },
  grupy_bilateralne: { fraza: 'Ukraińska' },
  slownik_eli: { slownik: 'rodzaje' },
  zapytanie_surowe: { sciezka: 'term10' },
};

describe.skipIf(process.env.SEJM_MCP_NA_ZYWO !== '1')('na żywo: api.sejm.gov.pl', () => {
  const zrodlo = new KlientSejmu(new BezPamieci());

  it('każde narzędzie ma przypadek', () => {
    expect(NARZEDZIA.map((n) => n.nazwa).sort()).toEqual(Object.keys(PRZYPADKI).sort());
  });

  for (const n of NARZEDZIA) {
    it(n.nazwa, async () => {
      const w = await n.wykonaj(n.wejscie.parse(PRZYPADKI[n.nazwa]), zrodlo);
      expect(w.zrodla.length).toBeGreaterThan(0);
      expect(w.znaleziono).not.toBe(false);
      console.log(n.nazwa, JSON.stringify(w).slice(0, 300));
    }, 90_000);
  }

  it('szukaj_glosowan: weto z frazą bez trafień w tytule trafia głosowanie nad wetem (t021)', async () => {
    const n = NARZEDZIA.find((x) => x.nazwa === 'szukaj_glosowan')!;
    const w = await n.wykonaj(n.wejscie.parse({ fraza: 'weta Prezydenta Rzeczypospolitej Polskiej do ustawy o kryptoaktywach', od: '2025-11-01' }), zrodlo);
    const pierwsze = (w.glosowania as Array<{ glosowanie: string }>).slice(0, 5).map((g) => g.glosowanie);
    expect(pierwsze).toContain('46/75');
  }, 90_000);
});
