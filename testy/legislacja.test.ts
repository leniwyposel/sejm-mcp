import { describe, expect, it, vi } from 'vitest';
import { druk, proces, szukajDrukow, szukajProcesow, szukajProjektow } from '../src/narzedzia/legislacja.js';
import { fikstura, ZrodloZFikstur } from './pomoc.js';

const wejscie = <S extends { parse: (x: unknown) => unknown }>(s: S, x: unknown) => s.parse(x) as never;

const procesy = {
  'term10/processes/219': 'proces-219.json',
  'term10/processes/253': 'proces-253.json',
  'term10/processes/687': 'proces-687.json',
  'term10/processes/1929': 'proces-1929.json',
  'term10/processes/2108': 'proces-2108-weto.json',
  'term10/processes/2865': 'proces-2865.json',
  'term10/processes/838': 'proces-838.json',
  'term10/processes/2684': 'proces-2684.json',
  'term10/processes/16825-z': 'proces-16825-z.json',
  'eli/acts/DU/2025/63': 'eli-du-2025-63.json',
};

const stan = async (numer: string) => (await proces.wykonaj(wejscie(proces.wejscie, { numer }), new ZrodloZFikstur(procesy))).stan as string;

describe('proces: stan z ostatniego etapu, z datą', () => {
  it('polecenie „nie zgaduj” stoi w uwagach, nie w stanie ani w odpowiedzi (09-b)', async () => {
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '219' }), new ZrodloZFikstur(procesy));
    expect(`${w.stan} ${w.odpowiedz}`).not.toMatch(/zgaduj|nie podawaj/i);
    expect((w.uwagi as string[]).join(' ')).toMatch(/Nie zgaduj, co się stało/);
    const weto = await proces.wykonaj(wejscie(proces.wejscie, { numer: '2108' }), new ZrodloZFikstur(procesy));
    expect(`${weto.stan} ${weto.odpowiedz}`).not.toMatch(/nie podawaj/i);
    expect((weto.uwagi as string[]).join(' ')).toMatch(/nie podawaj go/);
  });

  it('trzy ustawy „uchwalone, nieopublikowane” mają trzy różne stany', async () => {
    expect(await stan('2108')).toMatch(/^zawetowana przez Prezydenta 2026-02-19; Sejm nie głosował jeszcze nad wetem/);
    expect(await stan('1929')).toBe('uchwalona przez Sejm 2026-09-18; rejestr nie ma jeszcze stanowiska Senatu (Senat ma na nie 30 dni)');
    // 219 leży u Prezydenta od 2024-07-15 bez dalszego etapu: stan mówi to wprost, same fakty.
    expect(await stan('219')).toMatch(/^u Prezydenta: przekazana do podpisu 2024-07-15; rejestr Sejmu nie ma dalszego etapu.*po \d+ dniach od przekazania.*nieopublikowana$/);
    expect(await stan('253')).toMatch(/^skierowana przez Prezydenta do Trybunału Konstytucyjnego 2024-10-07/);
  });

  it('w toku: ostatni etap z datą i wnioskiem komisji', async () => {
    expect(await stan('2865')).toBe(
      'w toku: ostatni etap „Praca w komisjach po I czytaniu” 2026-09-17; sprawozdanie komisji 2026-09-17 (druk 3119, wniosek: „załączony projekt ustawy”)',
    );
  });

  it('opublikowana: podpis, data ogłoszenia z ELI i adres ELI', async () => {
    const z = new ZrodloZFikstur(procesy);
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '687' }), z);
    expect(w.stan).toBe('podpisana przez Prezydenta 2025-01-17, opublikowana (Dz.U. 2025 poz. 63)');
    expect(w).toMatchObject({
      eli: 'DU/2025/63',
      adresEli: 'https://api.sejm.gov.pl/eli/acts/DU/2025/63',
      dataOgloszenia: '2025-01-20',
      podpisPrezydenta: '2025-01-17',
      stanowiskoSenatu: { data: '2024-12-19', stanowisko: 'wniósł poprawki', druk: '919' },
      weto: null,
    });
    expect(w.odpowiedz).toMatch(/Senat 2024-12-19: wniósł poprawki\. Ogłoszona 2025-01-20/);
    expect(w.zrodla).toContain('https://api.sejm.gov.pl/eli/acts/DU/2025/63');
  });
});

describe('proces: pola etapów, których wcześniej nie było', () => {
  it('stanowisko Senatu, wniosek komisji i wnioski mniejszości', async () => {
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '687' }), new ZrodloZFikstur(procesy));
    const etapy = w.etapy as Array<Record<string, unknown>>;
    expect(etapy.find((e) => e.etap === 'Stanowisko Senatu')).toMatchObject({ stanowiskoSenatu: 'wniósł poprawki', druk: '919' });
    expect(etapy.find((e) => e.druk === '940')).toMatchObject({ wniosekKomisji: 'przyjąć poprawki', wnioskiMniejszosci: 0 });
    expect(etapy.find((e) => e.druk === '857')).toMatchObject({ wniosekKomisji: 'załączony projekt ustawy', wnioskiMniejszosci: 110 });
  });

  it('autopoprawki z otherDocuments (2865-A)', async () => {
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '2865' }), new ZrodloZFikstur(procesy));
    expect(w.autopoprawki).toEqual(['2865-A']);
    expect((w.inneDokumenty as Array<{ druk: string; dataDokumentu: string }>)[0]).toMatchObject({ druk: '2865-A', dataDokumentu: '2026-09-02' });
    const start = (w.etapy as Array<Record<string, unknown>>).find((e) => e.etap === 'Projekt wpłynął do Sejmu');
    expect(start?.inneDokumenty).toHaveLength(1);
  });
});

describe('szukaj_procesow: weto widać na liście', () => {
  it('dociąga etapy dla uchwalonych, nieopublikowanych wyników', async () => {
    const z = new ZrodloZFikstur({ 'term10/processes': 'procesy-krs.json', ...procesy });
    const w = await szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, { fraza: 'Krajowej Radzie Sądownictwa' }), z);
    const lista = w.procesy as Array<{ numer: string; stan: string; ostatniEtap: { data: string } }>;
    expect(lista.find((p) => p.numer === '2108')?.stan).toMatch(/^zawetowana przez Prezydenta 2026-02-19/);
    expect(lista.find((p) => p.numer === '219')?.stan).toMatch(/^u Prezydenta: przekazana do podpisu 2024-07-15/);
    expect(lista.find((p) => p.numer === '2108')?.ostatniEtap.data).toBe('2026-02-19');
    expect(w.zrodla).toContain('https://api.sejm.gov.pl/sejm/term10/processes/2108');
  });
});

describe('szukaj_projektow: od i do są włącznie', () => {
  it('pyta API o dzień szerzej i przycina u siebie (projekt z 2026-09-01, druk 3028)', async () => {
    const z = new ZrodloZFikstur({ 'term10/bills': 'projekty-2026-09-01.json' });
    const w = await szukajProjektow.wykonaj(wejscie(szukajProjektow.wejscie, { od: '2026-09-01', do: '2026-09-01' }), z);
    expect(z.zapytania[0].parametry).toMatchObject({ dateOfReceiptFrom: '2026-08-31', dateOfReceiptTo: '2026-09-02' });
    const lista = w.projekty as Array<{ numer: string; wplynal: string; druk: string | null }>;
    expect(lista.every((p) => p.wplynal === '2026-09-01')).toBe(true);
    expect(lista.find((p) => p.numer === 'RPW/29343/2026')?.druk).toBe('3028');
    expect(w.razem).toBe(2);
  });
});

describe('szukaj_drukow: data doręczenia i numer w frazie', () => {
  const z = () => new ZrodloZFikstur({ 'term10/prints': 'druki-wrzesien-2026.json' });

  it('domyślnie filtruje po doręczeniu, oba dni włącznie (57 druków 14-18 IX 2026)', async () => {
    const w = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { od: '2026-09-14', do: '2026-09-18' }), z());
    expect(w.razem).toBe(57);
    const numery = (w.druki as Array<{ numer: string }>).map((d) => d.numer);
    const wszystkie = (await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { od: '2026-09-14', do: '2026-09-18', limit: 100 }), z())).druki as Array<{ numer: string }>;
    expect(wszystkie.map((d) => d.numer)).toEqual(expect.arrayContaining(['3085', '3086', '3087', '3088']));
    expect(numery).toHaveLength(20);
    expect((w.uwagi as string[]).join(' ')).toMatch(/doręczenia posłom.*włącznie/);
  });

  it('po dacie dokumentu, gdy o to poproszono', async () => {
    const w = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { od: '2026-09-14', do: '2026-09-18', wedlugDaty: 'dokumentu' }), z());
    expect(w.razem).toBe(43);
    expect((w.uwagi as string[]).join(' ')).toMatch(/sporządzenia dokumentu/);
  });

  it('„autopoprawka 2865” znajduje 2865-A i podpowiada druk/proces', async () => {
    const w = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { fraza: 'autopoprawka 2865' }), z());
    expect((w.druki as Array<{ numer: string }>).map((d) => d.numer)).toEqual(['2865-A']);
    expect((w.uwagi as string[]).join(' ')).toMatch(/numer druku \(2865\).*narzędzie proces/);
  });

  it('sam numer daje druki procesu', async () => {
    const w = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { fraza: 'druk 2865' }), z());
    expect((w.druki as Array<{ numer: string }>).map((d) => d.numer).sort()).toEqual(['2865', '2865-A', '3119']);
  });
});

describe('szukaj_procesow: fraza w opisie, stan i daty (09, 18, 05)', () => {
  const z = () => new ZrodloZFikstur({ 'term10/processes': 'procesy-opis.json', ...procesy });
  const szukaj = (x: unknown) => szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, x), z());
  type Pozycja = { numer: string; trafienie?: string; opis: string | null; stan: string; dataStanu?: string };

  it('„składka zdrowotna przedsiębiorca” znajduje 838 po opisie, z opisem przy wyniku', async () => {
    const w = await szukaj({ fraza: 'składka zdrowotna przedsiębiorca' });
    const lista = w.procesy as Pozycja[];
    const p838 = lista.find((p) => p.numer === '838');
    expect(p838).toMatchObject({ trafienie: 'opis' });
    expect(p838?.opis).toMatch(/składki zdrowotnej dla przedsiębiorców/);
    expect(p838?.stan).toMatch(/^zawetowana przez Prezydenta 2025-05-07/);
    expect(lista.map((p) => p.numer)).not.toContain('1609');
    expect((w.uwagi as string[]).join(' ')).toMatch(/w opisie/);
  });

  it('„depenalizacja aborcji” bez polskich znaków: 176 z opisu, nie 830 o tym samym tytule', async () => {
    const w = await szukaj({ fraza: 'depenalizacja aborcji' });
    const lista = w.procesy as Pozycja[];
    // Opis 176 mówi o „depenalizacji” i „terminacji ciąży”, nie o „aborcji”: trafienie bez jednego słowa, z uwagą.
    expect(lista.map((p) => p.numer)).toEqual(['176']);
    expect((w.uwagi as string[]).join(' ')).toMatch(/wszystkimi poza jednym/);
    const w2 = await szukaj({ fraza: 'depenalizacji' });
    expect((w2.procesy as Pozycja[]).map((p) => p.numer)).toEqual(['176']);
    expect((w2.procesy as Pozycja[])[0].trafienie).toBe('opis');
  });

  it('stan „skierowana do TK” liczy z etapów tylko uchwalone, nieopublikowane ustawy', async () => {
    const w = await szukaj({ stan: 'skierowana do TK' });
    expect(w.razem).toBe(2);
    expect((w.procesy as Pozycja[]).map((p) => p.numer).sort()).toEqual(['253', '2684']);
    expect((w.procesy as Pozycja[]).find((p) => p.numer === '253')?.dataStanu).toBe('2024-10-07');
    expect(w.odpowiedz).toMatch(/^Rejestr procesów kadencji 10: 2 w stanie „skierowana do TK”: 253 \(2024-10-07\), 2684/);
    expect((w.uwagi as string[]).join(' ')).toMatch(/sprawdzono etapy \d+ z \d+ uchwalonych, nieopublikowanych ustaw/);
  });

  it('stan z etapów po budżecie czasu: wynik częściowy z poleceniem ponowienia, nie przekroczenie limitu (09-b)', async () => {
    // Inna data zmiany niż w pozostałych testach, żeby pamięć procesów nie podała etapów od razu.
    const lista = JSON.parse(fikstura('procesy-opis.json')).map((p: Record<string, unknown>) => ({ ...p, changeDate: '2099-01-01T00:00:00' }));
    const zr = z();
    const json = zr.json.bind(zr);
    zr.lista = (async () => ({ dane: lista, razem: lista.length })) as typeof zr.lista;
    // Każde zapytanie o szczegóły „trwa” 10 s zegara: budżet (18 s) starcza na dwa.
    zr.json = (async (s: string, o?: unknown) => {
      vi.setSystemTime(Date.now() + 10_000);
      return json(s, o as never);
    }) as typeof zr.json;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const w = await szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, { stan: 'zawetowana' }), zr);
      expect(w.odpowiedz).toMatch(/wynik częściowy: sprawdzono 2 z 6 ustaw, więc to DOLNA granica/);
      expect((w.uwagi as string[])[0]).toMatch(/^WYNIK CZĘŚCIOWY: nie sprawdzono 4 z 6 ustaw \(4 z braku czasu.*jeszcze raz/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stany z etapów: zawetowana, u Prezydenta, w Senacie; z listy: opublikowana, w toku', async () => {
    const numery = async (stan: string) => ((await szukaj({ stan })).procesy as Pozycja[]).map((p) => p.numer).sort();
    expect(await numery('zawetowana')).toEqual(['2108', '838']);
    expect(await numery('u Prezydenta')).toEqual(['219']);
    expect(await numery('w Senacie')).toEqual(['1929']);
    expect(await numery('opublikowana')).toEqual(['1609', '687']);
    expect(await numery('zakończona bez uchwalenia')).toEqual(['176', '324', '830']);
  });

  it('od/do z wedlugDaty="wszczecia" działają (włącznie) i są opisane w uwagach i odpowiedzi', async () => {
    const w = await szukaj({ od: '2024-11-19', do: '2024-11-19', wedlugDaty: 'wszczecia' });
    expect((w.procesy as Pozycja[]).map((p) => p.numer)).toEqual(['838']);
    expect((w.uwagi as string[]).join(' ')).toMatch(/daty wszczęcia procesu, oba dni włącznie/);
    expect(w.odpowiedz).toMatch(/według daty wszczęcia procesu/);
    await expect(szukaj({ od: '2025-01-02', do: '2025-01-01' })).rejects.toThrow(/Odwrócony przedział/);
  });

  it('domyślnie od/do łapie którąkolwiek datę: 838 wszczęty 2024, zamknięty w Sejmie 2025 (05-b)', async () => {
    const w = await szukaj({ fraza: 'składka zdrowotna', od: '2025-01-01', do: '2025-12-31' });
    const lista = w.procesy as Array<Pozycja & { dataWZakresie?: string }>;
    expect(lista.map((p) => p.numer)).toContain('838');
    expect(lista.find((p) => p.numer === '838')?.dataWZakresie).toMatch(/zamknięcia w Sejmie 2025-04-04/);
    expect(w.odpowiedz).toMatch(/według którejkolwiek z dat: wszczęcia, zamknięcia w Sejmie albo ostatniej zmiany/);
  });

  it('„składka zdrowotna” nie trafia procesu o KRS, w którego opisie „składania” i „zdrowotnej” stoją daleko (05-b, 1311)', async () => {
    const zk = new ZrodloZFikstur({ 'term10/processes': 'procesy-opis-krs.json', ...procesy });
    const w = await szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, { fraza: 'składka zdrowotna', od: '2025-01-01', do: '2025-12-31' }), zk);
    const numery = (w.procesy as Pozycja[]).map((p) => p.numer);
    expect(numery).toContain('838');
    expect(numery).not.toContain('1311');
    // Samo pospolite słowo („zdrowotna”) przy częściowym dopasowaniu też nie wystarcza.
    const w2 = await szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, { fraza: 'zdrowotna reforma' }), zk);
    expect((w2.procesy as Pozycja[]).map((p) => p.numer)).not.toContain('1311');
  });

  it('częściowe dopasowanie mówi o tym w odpowiedzi', async () => {
    const w = await szukaj({ fraza: 'depenalizacja aborcji' });
    expect(w.odpowiedz).toMatch(/żaden nie ma wszystkich słów frazy/);
    expect((w.procesy as Array<{ dopasowanie?: string }>)[0].dopasowanie).toBe('bez jednego słowa frazy');
  });

  it('bez parametru stan ostrzega, że lista nie odpowiada na pytania zbiorcze', async () => {
    const w = await szukaj({ fraza: 'Kodeks karny' });
    expect((w.uwagi as string[]).join(' ')).toMatch(/pytanie zbiorcze.*NIE odpowiada/);
  });
});

describe('proces: uwaga Sejmu (comments) i odmiana druków dodatkowych (19-b, 11-b)', () => {
  it('16825-z: oświadczenie posła o formalnej poprawności trafia do uwagaSejmu i odpowiedzi', async () => {
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '16825-z' }), new ZrodloZFikstur(procesy));
    expect(w.uwagaSejmu).toMatch(/oświadczenie Posła Łukasza Mejzy spełnia warunki formalnej poprawności/);
    expect(w.odpowiedz).toMatch(/Uwaga Sejmu w rejestrze: „W opinii nr 27/);
  });

  it('druk 2874: „1 druk dodatkowy”', async () => {
    const w = await druk.wykonaj(wejscie(druk.wejscie, { numer: '2874' }), new ZrodloZFikstur({ 'term10/prints/2874': 'druk-2874.json' }));
    expect((w.uwagi as string[]).join(' ')).toMatch(/Druk ma 1 druk dodatkowy \(/);
  });
});

describe('szukaj_procesow i szukaj_drukow: wynik w 20 tys. znaków', () => {
  it('przycięta porcja mówi, od czego zacząć następną', async () => {
    // 300 procesów z długim opisem: przy limit 100 wynik byłby ok. 100 tys. znaków.
    const lista = Array.from({ length: 300 }, (_, i) => ({
      number: String(i + 1),
      title: `Poselski projekt ustawy o zmianie ustawy o sprawie ${i + 1}`,
      description: 'projekt dotyczy '.padEnd(400, 'x'),
      documentType: 'projekt ustawy',
      processStartDate: '2025-02-01',
    }));
    const z = new ZrodloZFikstur({});
    z.lista = (async () => ({ dane: lista, razem: lista.length })) as typeof z.lista;
    const w = await szukajProcesow.wykonaj(wejscie(szukajProcesow.wejscie, { od: '2025-01-01', limit: 100 }), z);
    expect(JSON.stringify(w).length).toBeLessThanOrEqual(20_000);
    const n = (w.procesy as unknown[]).length;
    expect(n).toBeLessThan(100);
    expect(w.nastepnePrzesuniecie).toBe(n);
    expect(w.pokazano).toBe(`procesy 1–${n} z 300`);
    expect((w.uwagi as string[])[0]).toMatch(new RegExp(`Porcję skrócono ze? 100 do ${n}.*przesuniecie=${n}.*DOKŁADNIE`));
  });
});

describe('proces: opis projektu', () => {
  it('838 ma opis o składce zdrowotnej', async () => {
    const w = await proces.wykonaj(wejscie(proces.wejscie, { numer: '838' }), new ZrodloZFikstur(procesy));
    expect(w.opis).toMatch(/obniżenia wysokości składki zdrowotnej/);
  });
});

describe('szukaj_projektow: opis, stan rejestru i etap z procesów (10, 18)', () => {
  const z = () => new ZrodloZFikstur({ 'term10/bills': 'projekty-opis.json', 'term10/processes': 'procesy-opis.json' });
  type Projekt = { druk: string; stan: string; uchwalony: boolean | null; publikacja: string | null; trafienie?: string };

  it('fraza z opisu („składka zdrowotna przedsiębiorca”) trafia 838, nie idzie do API jako title', async () => {
    const zr = z();
    const w = await szukajProjektow.wykonaj(wejscie(szukajProjektow.wejscie, { fraza: 'składka zdrowotna przedsiębiorca' }), zr);
    expect((w.projekty as Projekt[]).map((p) => p.druk)).toEqual(['838']);
    expect((w.projekty as Projekt[])[0].trafienie).toBe('opis');
    expect(zr.zapytania[0].parametry?.title).toBeUndefined();
  });

  it('ACTIVE to „aktywny (nie wycofany)”, a uchwalony i publikacja przychodzą z procesów', async () => {
    const w = await szukajProjektow.wykonaj(wejscie(szukajProjektow.wejscie, {}), z());
    const lista = w.projekty as Projekt[];
    expect(lista.find((p) => p.druk === '838')).toMatchObject({ stan: 'aktywny (nie wycofany)', uchwalony: true, publikacja: null });
    expect(lista.find((p) => p.druk === '1609')).toMatchObject({ uchwalony: true, publikacja: 'Dz.U. 2025 poz. 1537' });
    expect(lista.find((p) => p.druk === '176')?.uchwalony).toBe(false);
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/NIE znaczy „w toku”/);
    expect(uwagi).not.toMatch(/„przyjęty”/);
  });

  it('filtr dat odsyła po datę doręczenia do szukaj_drukow', async () => {
    const w = await szukajProjektow.wykonaj(wejscie(szukajProjektow.wejscie, { od: '2024-01-01', do: '2024-12-31' }), z());
    expect((w.uwagi as string[]).join(' ')).toMatch(/data WPŁYWU|dacie WPŁYWU/);
    expect((w.uwagi as string[]).join(' ')).toMatch(/szukaj_drukow z wedlugDaty="doreczenia"/);
  });
});

describe('druk: data dokumentu to nie data wpływu (benchmark B047)', () => {
  it('druk 164: sporządzony 2022-03-24, doręczony 2024-01-16; uwaga mówi, która data jest która', async () => {
    const w = await druk.wykonaj(wejscie(druk.wejscie, { numer: '164' }), new ZrodloZFikstur({ 'term10/prints/164': 'druk-164.json' }));
    expect(w).toMatchObject({ dataDokumentu: '2022-03-24', doreczono: '2024-01-16' });
    const uwagi = (w.uwagi as string[]).join(' ');
    expect(uwagi).toMatch(/dataDokumentu to data sporządzenia dokumentu przez autora, nie data wpływu do Sejmu/);
    expect(uwagi).toMatch(/sporządzono 2022-03-24, a posłom doręczono go dopiero 2024-01-16 \(663 dni później\)/);
    expect(druk.opis).toMatch(/kiedy wpłynął do Sejmu” nie podawaj dataDokumentu/);
  });
});

describe('druki dodatkowe (11)', () => {
  it('druk 2874 zwraca 2874-001 (ocena skutków regulacji) z datą doręczenia i plikiem', async () => {
    const w = await druk.wykonaj(wejscie(druk.wejscie, { numer: '2874' }), new ZrodloZFikstur({ 'term10/prints/2874': 'druk-2874.json' }));
    expect(w.drukiDodatkowe).toEqual([
      {
        numer: '2874-001',
        tytul: 'Do druku nr 2874 - ocena skutków regulacji',
        dataDokumentu: '2026-08-19',
        doreczono: '2026-08-20',
        pliki: ['https://api.sejm.gov.pl/sejm/term10/prints/2874-001/2874-001.pdf'],
      },
    ]);
  });

  it('wpis o numerze druku głównego to wersja, nie druk dodatkowy; jego dzieci zostają (599)', async () => {
    const z = new ZrodloZFikstur({});
    z.json = (async () => ({
      number: '599',
      title: 't',
      additionalPrints: [{ number: '599', title: 't', deliveryDate: '2024-12-09', additionalPrints: [{ number: '599-001', title: 'Do druku nr 599 - opinia KNF', deliveryDate: '2024-09-05' }] }],
    })) as never;
    const w = await druk.wykonaj(wejscie(druk.wejscie, { numer: '599' }), z);
    expect((w.drukiDodatkowe as Array<{ numer: string }>).map((d) => d.numer)).toEqual(['599-001']);
  });

  it('nieistniejący druk: najwyższy znany numer', async () => {
    const z = new ZrodloZFikstur({ 'term10/prints/3500': null, 'term10/prints': 'druki-sierpien-2026.json' });
    const w = await druk.wykonaj(wejscie(druk.wejscie, { numer: '3500' }), z);
    expect(w).toMatchObject({ znaleziono: false, najwyzszyNumer: 3013 });
    expect((w.uwagi as string[]).join(' ')).toMatch(/Najwyższy numer druku w rejestrze kadencji 10: 3013/);
  });

  it('szukaj_drukow z datami liczy druki dodatkowe osobno (2874-001 doręczony 2026-08-20)', async () => {
    const z = new ZrodloZFikstur({ 'term10/prints': 'druki-sierpien-2026.json' });
    const w = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { od: '2026-08-20', do: '2026-08-20' }), z);
    expect(w.razem).toBe(7);
    expect(w.razemDodatkowych).toBe(1);
    // Domyślnie sama liczba: lista szła zawsze i dawała 46 KB (11-b).
    expect(w.drukiDodatkowe).toBeUndefined();
    expect((w.uwagi as string[]).join(' ')).toMatch(/podaj obie liczby osobno.*dodatkowe=true/);
    const w2 = await szukajDrukow.wykonaj(wejscie(szukajDrukow.wejscie, { od: '2026-08-20', do: '2026-08-20', dodatkowe: true }), z);
    expect(w2.drukiDodatkowe).toMatchObject([{ numer: '2874-001', doDruku: '2874', doreczono: '2026-08-20' }]);
    expect(w2.druki).toBeUndefined();
    expect(w2.razem).toBe(7);
  });
});
