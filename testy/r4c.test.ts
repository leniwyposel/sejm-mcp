import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zlozAdres, type OpcjePobrania, type Parametry, type ZrodloSejmu } from '../src/klient.js';
import { szukajAktow, trescAktu } from '../src/narzedzia/eli.js';
import { szukajProjektow } from '../src/narzedzia/legislacja.js';
import { dopasujWyliczenia, wejscieCzyszczone } from '../src/narzedzia/wspolne.js';
import { opisOdczytuPdf, UWAGA_PDF } from '../src/pdf.js';
import { kalendarz } from '../src/reguly/daty.js';
import { odpowiedz } from '../src/serwer.js';
import { wiersze, zbudujPdf } from './pdf-wzor.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

class ZrodloZMapy implements ZrodloSejmu {
  constructor(private readonly mapa: Record<string, unknown>) {}
  private wez(sciezka: string): unknown {
    if (!(sciezka in this.mapa)) throw new Error(`Brak danych dla ${sciezka}`);
    return this.mapa[sciezka];
  }
  async json<T>(s: string) {
    return this.wez(s) as T | null;
  }
  async lista<T>(s: string) {
    const d = (this.wez(s) as T[] | null) ?? [];
    return { dane: d, razem: d.length };
  }
  async tekst(s: string) {
    return this.wez(s) as string | null;
  }
  async bajty(s: string, _o?: OpcjePobrania) {
    return this.wez(s) as Uint8Array | null;
  }
  adres(s: string, p?: Parametry) {
    return zlozAdres(s, p).href;
  }
}

describe('kalendarz: daty względne liczone przez serwer', () => {
  it('piątek 25.09.2026: zeszły tydzień to 14–20.09, nie ostatnie 7 dni', () => {
    expect(kalendarz(new Date('2026-09-25T10:00:00Z'))).toEqual({
      dzis: '2026-09-25 (piątek)',
      wczoraj: '2026-09-24 (czwartek)',
      tenTydzien: { od: '2026-09-21', do: '2026-09-27' },
      zeszlyTydzien: { od: '2026-09-14', do: '2026-09-20' },
      tenMiesiac: { od: '2026-09-01', do: '2026-09-30' },
      zeszlyMiesiac: { od: '2026-08-01', do: '2026-08-31' },
    });
  });

  it('strefa Warszawy: 23:30 UTC w niedzielę to już poniedziałek; styczeń sięga do grudnia', () => {
    const k = kalendarz(new Date('2027-01-03T23:30:00Z'));
    expect(k.dzis).toBe('2027-01-04 (poniedziałek)');
    expect(k.tenTydzien).toEqual({ od: '2027-01-04', do: '2027-01-10' });
    expect(k.zeszlyTydzien).toEqual({ od: '2026-12-28', do: '2027-01-03' });
    expect(k.zeszlyMiesiac).toEqual({ od: '2026-12-01', do: '2026-12-31' });
    expect(kalendarz(new Date('2028-03-10T12:00:00Z')).zeszlyMiesiac).toEqual({ od: '2028-02-01', do: '2028-02-29' });
  });

  it('odpowiedz dokleja kalendarz do każdego wyniku', () => {
    const o = odpowiedz({ zrodla: ['https://api.sejm.gov.pl/sejm/term10/MP'] }, new Date('2026-09-25T10:00:00Z'));
    expect(o.structuredContent.kalendarz).toMatchObject({ zeszlyTydzien: { od: '2026-09-14', do: '2026-09-20' } });
    expect(JSON.parse(o.content[0].text).kalendarz.wczoraj).toBe('2026-09-24 (czwartek)');
  });
});

describe('wartości wyliczeniowe wybaczają spację i niewidoczny znak w środku słowa', () => {
  const schemat = z.object({ rodzaj: z.enum(['projekt ustawy', 'projekt uchwały']).optional(), lista: z.array(z.enum(['DU', 'MP'])).default([]) });

  it('„projekt uchwa ły”, „PROJEKT UCHWALY”, „du” trafiają w jedną wartość', () => {
    expect(dopasujWyliczenia(schemat, { rodzaj: 'projekt uchwa ły' })).toEqual({ rodzaj: 'projekt uchwały' });
    expect(dopasujWyliczenia(schemat, { rodzaj: 'PROJEKT UCHWALY', lista: ['du', 'M P'] })).toEqual({ rodzaj: 'projekt uchwały', lista: ['DU', 'MP'] });
  });

  it('niepasujące zostaje, walidacja podaje listę dozwolonych', () => {
    expect(dopasujWyliczenia(schemat, { rodzaj: 'uchwała' })).toEqual({ rodzaj: 'uchwała' });
    const w = wejscieCzyszczone(schemat).safeParse({ rodzaj: 'uchwała' });
    expect(w.success).toBe(false);
  });

  it('prawdziwe narzędzie: szukaj_projektow przyjmuje „pos­łowie” i „projekt uchwa ły”', () => {
    const w = wejscieCzyszczone(szukajProjektow.wejscie).safeParse({ wnioskodawca: 'pos­łowie', rodzaj: 'projekt uchwa ły' });
    expect(w.success).toBe(true);
    expect(w.data).toMatchObject({ wnioskodawca: 'posłowie', rodzaj: 'projekt uchwały' });
    const p = wejscieCzyszczone(szukajProjektow.wejscie).safeParse({ wnioskodawca: 'prezydium  sejmu' });
    expect(p.data).toMatchObject({ wnioskodawca: 'Prezydium Sejmu' });
  });
});

describe('szukaj_aktow: pytanie o nowelizacje', () => {
  it('fraza z „zmianie” dostaje uwagę, że liczbę nowelizacji daje akt z Aktami zmieniającymi', async () => {
    const z_ = new ZrodloZMapy({ 'eli/acts/search': { count: 0, items: [] } });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { fraza: 'o zmianie ustawy o podatku dochodowym', rok: 2025 }), z_);
    expect(w.uwagi![0]).toMatch(/gubi nowelizacje/);
    expect(w.uwagi![0]).toMatch(/powiazania="Akty zmieniające"/);
    expect(szukajAktow.opis).toMatch(/Liczbę i listę nowelizacji/);
  });

  it('zwykła fraza bez tej uwagi', async () => {
    const z_ = new ZrodloZMapy({ 'eli/acts/search': { count: 0, items: [] } });
    const w = await szukajAktow.wykonaj(wejscie(szukajAktow.wejscie, { fraza: 'o ochronie zwierząt' }), z_);
    expect(w.uwagi!.join(' ')).not.toMatch(/gubi nowelizacje/);
  });
});

describe('PDF: liczba stron zawsze, także przy odczycie w całości', () => {
  it('opis odczytu z odmianą', () => {
    expect(opisOdczytuPdf({ stron: 3, przeczytanoStron: 3, uciety: false })).toBe('przeczytano 3 z 3 stron (cały plik)');
    expect(opisOdczytuPdf({ stron: 1, przeczytanoStron: 1, uciety: false })).toBe('przeczytano 1 z 1 strony (cały plik)');
    expect(opisOdczytuPdf({ stron: 700, przeczytanoStron: 600, uciety: true })).toMatch(/^przeczytano 600 z 700 stron \(limit/);
    expect(UWAGA_PDF).toMatch(/czego tu nie ma, nie ma też w tym PDF/);
  });

  it('tresc_aktu: uwaga o stronach bez ucięcia i o znaczniku przypisu', async () => {
    const pdf = zbudujPdf([
      wiersze(['Art. 1. Pierwszy artykuł ustawy o czymś ważnym.']),
      [
        { tekst: 'Art. 2.', x: 72, y: 780 },
        { tekst: '6)', x: 98.7, y: 783.5, rozmiar: 6.5 },
        { tekst: ' Drugi artykuł ustawy o czymś innym.', x: 104.5, y: 780 },
      ],
    ]);
    const z_ = new ZrodloZMapy({
      'eli/acts/DU/2020/1': { publisher: 'DU', year: 2020, pos: 1, type: 'Ustawa', title: 'Ustawa o czymś', textHTML: false, textPDF: true },
      'eli/acts/DU/2020/1/text.pdf': pdf,
    });
    const w = await trescAktu.wykonaj(wejscie(trescAktu.wejscie, { adres: 'DU/2020/1' }), z_);
    const uwagi = w.uwagi!.join(" ");
    expect(uwagi).toMatch(/przeczytano 2 z 2 stron \(cały plik\)/);
    expect(uwagi).toMatch(/odsyłacz do przypisu/);
  });
});
