import { describe, expect, it, vi } from 'vitest';
import { KATALOG, komunikatBledu, rodzajBledu, rodzajZeStatusu, type RodzajBledu } from '../src/bledy.js';
import { BladSejmu, KlientSejmu, type OpcjePobrania } from '../src/klient.js';
import { glosowanie, glosyPoslaWDniu, listaPosiedzen } from '../src/narzedzia/glosowania.js';
import { druk, proces, szukajProcesow, szukajProjektow } from '../src/narzedzia/legislacja.js';
import { kluby } from '../src/narzedzia/poslowie.js';
import { zapytanieSurowe } from '../src/narzedzia/surowe.js';
import { czesciowy, type Wynik } from '../src/narzedzia/wspolne.js';
import { BezPamieci } from '../src/pamiec.js';
import { blad, bladArgumentow, odpowiedz } from '../src/serwer.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;
const bezSpania = async () => {};

/** Źródło z fikstur, w którym wybrane ścieżki kończą się błędem Sejmu (fail-soft ma to zgłosić). */
class ZrodloZAwaria extends ZrodloZFikstur {
  constructor(
    mapa: Record<string, string | null>,
    private readonly awarie: Record<string, unknown>,
    razem: Record<string, number> = {},
  ) {
    super(mapa, razem);
  }
  private sprawdz(sciezka: string) {
    if (sciezka in this.awarie) throw this.awarie[sciezka];
  }
  override async json<T>(sciezka: string, opcje?: OpcjePobrania): Promise<T | null> {
    this.sprawdz(sciezka);
    return super.json<T>(sciezka, opcje);
  }
  override async lista<T>(sciezka: string, opcje?: OpcjePobrania): Promise<{ dane: T[]; razem: number | null }> {
    this.sprawdz(sciezka);
    return super.lista<T>(sciezka, opcje);
  }
  override async tekst(sciezka: string, opcje?: OpcjePobrania): Promise<string | null> {
    this.sprawdz(sciezka);
    return super.tekst(sciezka, opcje);
  }
}

const awaria503 = () => new BladSejmu('Sejm nie odpowiedział po 3 próbach (Sejm odpowiedział 503): https://api.sejm.gov.pl/sejm/x', 503);

/** Pierwsze zdanie tego, co zobaczy model: pole odpowiedz po złożeniu wyniku przez serwer. */
const pierwszeZdanie = (w: Wynik) => String((odpowiedz(w).structuredContent as Record<string, unknown>).odpowiedz ?? '');

describe('katalog błędów', () => {
  const STATUSY = [400, 401, 402, 403, 404, 405, 406, 408, 410, 413, 414, 415, 422, 429, 500, 501, 502, 503, 504];

  it.each(STATUSY)('status %i ma własny wpis z czterema polami po polsku', (s) => {
    const r = rodzajZeStatusu(s);
    expect(r).toBe(String(s));
    const w = KATALOG[r];
    expect(w.kod).toBe(String(s));
    expect(w.coSieStalo.length).toBeGreaterThan(20);
    expect(w.coZrobic.length).toBeGreaterThan(10);
    expect(['pytanie', 'Sejm', 'sieć', 'ten serwer']).toContain(w.czyjaWina);
    expect(typeof w.czyPonowic).toBe('boolean');
    // Bez żargonu: nazwa statusu po angielsku nie trafia do człowieka.
    expect(w.coSieStalo).not.toMatch(/Not Found|Internal Server|Too Many|Payment Required|Gateway/i);
  });

  it('inne statusy wpadają do grup 3xx, 4xx, 5xx', () => {
    expect(rodzajZeStatusu(302)).toBe('3xx');
    expect(rodzajZeStatusu(418)).toBe('4xx');
    expect(rodzajZeStatusu(599)).toBe('5xx');
  });

  it('każdy rodzaj ma wpis, a wpisy dla typowych przypadków mówią to, co trzeba', () => {
    const rodzaje: RodzajBledu[] = ['siec', 'czas-zapytania', 'czas-wywolania', 'kolejka', 'za-duza', 'nie-json', 'zapora', 'ksztalt', 'adres-odrzucony', 'walidacja'];
    for (const r of rodzaje) expect(KATALOG[r].coSieStalo).toBeTruthy();
    expect(KATALOG['404'].coSieStalo).toMatch(/nie ma takiego zasobu.*zły numer/);
    expect(KATALOG['404'].czyjaWina).toBe('pytanie');
    expect(KATALOG['402'].coSieStalo).toMatch(/opłaty.*bezpłatne/);
    expect(KATALOG['402'].czyjaWina).toBe('Sejm');
    expect(KATALOG['429'].coZrobic).toMatch(/minuty/);
    expect(KATALOG['429'].coSieStalo).toMatch(/ponawiał/);
    expect(KATALOG['503'].coZrobic).toMatch(/kilka minut/);
    expect(KATALOG['503'].czyPonowic).toBe(true);
    expect(KATALOG['404'].czyPonowic).toBe(false);
  });

  it('rodzaj rozpoznaje błędy sieci, czasu, zapory i złego argumentu', () => {
    expect(rodzajBledu(new BladSejmu('x', 503))).toBe('503');
    expect(rodzajBledu(new BladSejmu('x', null, 'zapora'))).toBe('zapora');
    expect(rodzajBledu(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe('siec');
    expect(rodzajBledu(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe('czas-zapytania');
    expect(rodzajBledu(new Error('Odwrócony przedział dat'))).toBe('walidacja');
  });
});

describe('blad(): stała forma komunikatu', () => {
  it('503: co się stało, czyja wina, co zrobić, szczegóły techniczne na końcu', () => {
    const w = blad(awaria503());
    expect(w.isError).toBe(true);
    const t = w.content[0].text;
    expect(t).toMatch(/^Nie udało się pobrać danych z Sejmu\. Co się stało: System Sejmu jest chwilowo niedostępny/);
    expect(t).toMatch(/Czyja to wina: po stronie Sejmu, nie pytającego\./);
    expect(t).toMatch(/Co zrobić: Spróbować ponownie za kilka minut/);
    expect(t).toMatch(/\(szczegóły techniczne: HTTP 503; .*api\.sejm\.gov\.pl.*\)\. Przekaż to użytkownikowi prostymi słowami/);
    expect(t.indexOf('szczegóły techniczne')).toBeGreaterThan(t.indexOf('Co zrobić'));
  });

  it('402 i 429 mówią uczciwie, że to nie wina pytającego', () => {
    expect(blad(new BladSejmu('Sejm odpowiedział 402', 402)).content[0].text).toMatch(/żąda opłaty.*nie trzeba nic płacić/);
    expect(blad(new BladSejmu('Sejm odpowiedział 429', 429)).content[0].text).toMatch(/ogranicza liczbę zapytań.*Odczekać około minuty/);
  });

  it('adres odrzucony przez ten serwer: zapytanie nie poszło do Sejmu', () => {
    const t = komunikatBledu(new BladSejmu('Niedozwolona ścieżka: "term10/../x"', null, 'adres-odrzucony'));
    expect(t).toMatch(/^Nie pobrano danych: zapytanie odrzucił ten serwer, nie poszło do Sejmu\./);
    expect(t).toMatch(/Niedozwolona ścieżka/);
  });

  it('zły argument z narzędzia i z naszej walidacji argumentów mają tę samą formę', () => {
    const z1 = komunikatBledu(new Error('Odwrócony przedział dat: do (2025-01-01) jest przed od (2026-05-01). Zamień daty miejscami.'));
    expect(z1).toMatch(/^Narzędzie nie wykonało zapytania, bo argument ma złą wartość\. Co się stało: Odwrócony przedział/);
    const z2 = bladArgumentow('profil_posla', [{ sciezka: 'id', komunikat: 'Liczba musi być co najmniej 1.' }]).content[0].text;
    expect(z2).toMatch(/^Narzędzie profil_posla nie wykonało zapytania, bo argument ma złą wartość\. Co się stało: id: Liczba musi być co najmniej 1\. Czyja to wina:/);
  });

  it('klient zostawia status 503 po ponowieniach, a 402 kończy bez ponawiania', async () => {
    let n = 0;
    const k503 = new KlientSejmu(new BezPamieci(), async () => (n++, new Response('', { status: 503 })), bezSpania);
    const e = await k503.json('term10/MP').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BladSejmu);
    expect((e as BladSejmu).status).toBe(503);
    expect((e as BladSejmu).rodzaj).toBe('503');
    expect(n).toBe(3);

    let m = 0;
    const k402 = new KlientSejmu(new BezPamieci(), async () => (m++, new Response('', { status: 402 })), bezSpania);
    const e2 = (await k402.json('term10/MP').catch((x: unknown) => x)) as BladSejmu;
    expect(e2.rodzaj).toBe('402');
    expect(m).toBe(1);

    const kSiec = new KlientSejmu(
      new BezPamieci(),
      async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      },
      bezSpania,
    );
    expect(((await kSiec.json('term10/MP').catch((x: unknown) => x)) as BladSejmu).rodzaj).toBe('siec');

    const kZapora = new KlientSejmu(new BezPamieci(), async () => new Response('<html>Request Rejected</html>', { status: 200, headers: { 'content-type': 'text/html' } }), bezSpania);
    expect(((await kZapora.json('term10/MP').catch((x: unknown) => x)) as BladSejmu).rodzaj).toBe('zapora');
  });
});

describe('odpowiedz(): wynik częściowy i porcja listy na początku', () => {
  it('wynikCzesciowy daje zdanie „Wynik niepełny:” przed treścią narzędzia', () => {
    const w: Wynik = { odpowiedz: 'Treść.', wynikCzesciowy: czesciowy('zabrakło czasu.', 'etapów 4 ustaw', 'wywołać jeszcze raz'), zrodla: [] };
    const s = odpowiedz(w).structuredContent as Record<string, unknown>;
    expect(s.odpowiedz).toBe('Wynik niepełny: zabrakło czasu. Brakuje: etapów 4 ustaw. Jak uzupełnić: wywołać jeszcze raz. Treść.');
    expect(Object.keys(s).slice(0, 2)).toEqual(['odpowiedz', 'wynikCzesciowy']);
    expect(String(s.odpowiedz)).not.toMatch(/—/);
  });

  it('porcja listy: łagodne zdanie „Pokazano … reszta w kolejnej porcji”, bez wynikCzesciowy', () => {
    const s = odpowiedz({ pokazano: '1–30 z 69', nastepnePrzesuniecie: 30, zrodla: [] }).structuredContent as Record<string, unknown>;
    expect(s.odpowiedz).toBe('Pokazano 1–30 z 69; reszta w kolejnej porcji (to samo wywołanie z przesuniecie=30).');
    expect(s.wynikCzesciowy).toBeUndefined();
  });

  it('pełny wynik zostaje bez zmian', () => {
    const s = odpowiedz({ odpowiedz: 'Pełne.', nastepnePrzesuniecie: null, zrodla: [] }).structuredContent as Record<string, unknown>;
    expect(s.odpowiedz).toBe('Pełne.');
    expect(s.wynikCzesciowy).toBeUndefined();
  });
});

describe('narzędzia zgłaszają wynik częściowy (fail-soft)', () => {
  it('glosowanie: awaria listy posłów zabiera sprawdzenie imienników, głos zostaje', async () => {
    const z = new ZrodloZAwaria({ 'term10/votings/18/46': 'glosowanie-18-46-kworum.json' }, { 'term10/MP': awaria503() });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 18, numer: 46, poselId: 1 }), z);
    expect(w.wynikCzesciowy).toMatchObject({ czegoBrakuje: expect.stringMatching(/imiennicy/) });
    expect(w.wynikCzesciowy?.dlaczego).toMatch(/niedostępny albo przeciążony \(HTTP 503/);
    expect(pierwszeZdanie(w)).toMatch(/^Wynik niepełny: nie udało się pobrać części danych z Sejmu/);
  });

  it('glosy_posla_w_dniu: bez głosowań posiedzenia brak apeli i rozstrzygnięć, głosy zostają', async () => {
    const z = new ZrodloZAwaria({ 'term10/MP/400/votings/26/2025-01-09': 'mp-400-26-dzien.json' }, { 'term10/votings/26': awaria503() });
    const w = await glosyPoslaWDniu.wykonaj(wejscie(glosyPoslaWDniu.wejscie, { id: 400, posiedzenie: 26, data: '2025-01-09' }), z);
    expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/apeli o kworum/);
    expect((w.glosy as unknown[]).length).toBeGreaterThan(0);
    expect(pierwszeZdanie(w)).toMatch(/^Wynik niepełny:.*Poseł 400/);
  });

  it('proces: awaria ELI zabiera datę ogłoszenia', async () => {
    const z = new ZrodloZAwaria({ 'term10/processes/687': 'proces-687.json' }, { 'eli/acts/DU/2025/63': awaria503() });
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '687' }), z);
    expect(w.znaleziono).toBe(true);
    expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/daty ogłoszenia/);
    expect(w.wynikCzesciowy?.jakUzupelnic).toMatch(/narzędziem akt z adresem DU\/2025\/63/);
  });

  it('szukaj_projektow: awaria listy procesów zabiera pola uchwalony i publikacja', async () => {
    const z = new ZrodloZAwaria({ 'term10/bills': 'projekty-opis.json' }, { 'term10/processes': awaria503() });
    const w = await szukajProjektow.wykonaj(wejscie(szukajProjektow.wejscie, {}), z);
    expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/uchwalony, publikacja/);
    expect((w.projekty as unknown[]).length).toBeGreaterThan(0);
  });

  it('druk 404: znaleziono false ze zdaniem z katalogu, a awaria listy druków jest zgłoszona', async () => {
    const z = new ZrodloZAwaria({ 'term10/prints/3500': null }, { 'term10/prints': awaria503() });
    const w = await druk.wykonaj(wejscie(druk.wejscie, { numer: '3500' }), z);
    expect(w.znaleziono).toBe(false);
    expect(w.odpowiedz).toMatch(/Rejestr nie zna druku 3500.*Sejm nie ma takiego zasobu: zwykle zły numer/);
    expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/najwyższego numeru druku/);
  });

  it('kluby: bez listy posłów nowi posłowie nie są odróżnieni od przejść', async () => {
    const z = new ZrodloZAwaria({ 'term10/clubs': 'kluby.json' }, { 'term10/MP': awaria503() });
    const w = await kluby.wykonaj(wejscie(kluby.wejscie, {}), z);
    if ((w.ostatnieZmiany as unknown[] | undefined)?.length) expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/nowych posłów/);
    else expect(w.wynikCzesciowy).toBeUndefined();
  });

  it('lista_posiedzen: awaria głosowań posiedzenia zabiera tylko apele', async () => {
    const z = new ZrodloZAwaria(
      { 'term10/proceedings': 'posiedzenia.json', 'term10/votings': 'posiedzenia-glosowan.json' },
      { 'term10/votings/2': awaria503() },
    );
    const w = await listaPosiedzen.wykonaj(wejscie(listaPosiedzen.wejscie, { od: '2024-01-16', do: '2024-01-17' }), z);
    expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/apeli o kworum.*2\. posiedzenia/);
    expect(pierwszeZdanie(w)).toMatch(/^Wynik niepełny:.*Kadencja 10/);
  });

  it('szukaj_procesow ze stanem: brak czasu daje wynikCzesciowy z dolną granicą i poleceniem ponowienia', async () => {
    const lista = JSON.parse(fikstura('procesy-opis.json')).map((p: Record<string, unknown>) => ({ ...p, changeDate: '2098-01-01T00:00:00' }));
    const procesy = Object.fromEntries(
      ['219', '253', '687', '1929', '2865', '838', '2684', '16825-z'].map((n) => [`term10/processes/${n}`, `proces-${n}.json`]),
    );
    const zr = new ZrodloZFikstur({ 'term10/processes/2108': 'proces-2108-weto.json', ...procesy });
    const json = zr.json.bind(zr);
    zr.lista = (async () => ({ dane: lista, razem: lista.length })) as typeof zr.lista;
    zr.json = (async (s: string, o?: unknown) => {
      vi.setSystemTime(Date.now() + 10_000);
      return json(s, o as never);
    }) as typeof zr.json;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const w = await szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, { stan: 'zawetowana' }), zr);
      expect(w.wynikCzesciowy?.dlaczego).toMatch(/zabrakło czasu/);
      expect(w.wynikCzesciowy?.czegoBrakuje).toMatch(/DOLNA granica/);
      expect(w.wynikCzesciowy?.jakUzupelnic).toMatch(/jeszcze raz z tymi samymi parametrami/);
      expect(pierwszeZdanie(w)).toMatch(/^Wynik niepełny: zabrakło czasu/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('zapytanie_surowe: adres innej strony odrzuca ten serwer, zamiast pytać Sejm', async () => {
    const z = new ZrodloZFikstur({});
    const e = await zapytanieSurowe.wykonaj(wejscie(zapytanieSurowe.wejscie, { sciezka: 'example.com/x' }), z).catch((x: unknown) => x);
    expect((e as BladSejmu).rodzaj).toBe('adres-odrzucony');
    expect(z.zapytania).toHaveLength(0);
    expect(() => zapytanieSurowe.wejscie.parse({ sciezka: 'https://example.com' })).toThrow(/nie pobiera innych stron/);
  });

  it('zwykły pełny wynik nie ma wynikCzesciowy', async () => {
    const z = new ZrodloZFikstur({ 'term10/votings/18/46': 'glosowanie-18-46-kworum.json' });
    const w = await glosowanie.wykonaj(wejscie(glosowanie.wejscie, { posiedzenie: 18, numer: 46 }), z);
    expect(w.wynikCzesciowy).toBeUndefined();
    expect(pierwszeZdanie(w)).not.toMatch(/Wynik niepełny/);
  });
});
