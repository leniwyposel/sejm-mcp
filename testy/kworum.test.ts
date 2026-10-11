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

// Rekord pobrany z api.sejm.gov.pl 2026-10-11. Marszałek po tym głosowaniu (stenogram 18. posiedzenia,
// 1.10.2024, s. 534–535): „Głosowało 227 posłów. 221 – za, 5 – przeciw, 1 się wstrzymał. Ale mamy brak
// kworum.” i „stwierdzam, że Sejm nie podjął uchwały”. Z samych liczb wychodziło „przyjęto”.
describe('mniej niż 230 głosujących: serwer nie wylicza wyniku, odsyła do stenogramu', () => {
  it('18/127: 221/5/1 przy 227 głosujących to nie „przyjęto”', () => {
    const g = rekord('glosowanie-18-127.json');
    expect([g.yes, g.no, g.abstain, g.totalVoted]).toEqual([221, 5, 1, 227]);
    const w = wynikGlosowania(g);
    expect(w).toMatchObject({ rodzaj: 'zwykle', przeszlo: null, ponizejPolowy: true });
    expect(w.etykieta).toMatch(/^Głosowało 227, mniej niż połowa ustawowej liczby posłów \(230, art\. 120 Konstytucji\)/);
    expect(w.etykieta).toMatch(/zapisuje stenogram/);
    expect(w.etykieta).not.toMatch(/przyjęto|odrzucono/i);
  });

  it('33/6: zwykłe głosowanie z co najmniej 230 głosującymi dalej ma wyliczony wynik', () => {
    const w = wynikGlosowania(rekord('glosowanie-33-6.json'));
    expect(w.ponizejPolowy).toBeUndefined();
    expect(typeof w.przeszlo).toBe('boolean');
  });
});

describe('fragment stenogramu po głosowaniu: zwykłe wyszukanie zdania z liczbami rekordu', () => {
  // Tekst jak w stenogramie 18. posiedzenia (1.10.2024, wypowiedź Marszałka), skrócony.
  const tekst =
    'Kto z pań i panów posłów jest za przyjęciem wniosku w brzmieniu z druku nr 689, zechce podnieść rękę i nacisnąć przycisk. ' +
    'Kto jest przeciw? Kto się wstrzymał? Głosowało 227 posłów. 221 - za, 5 - przeciw, 1 się wstrzymał. Wyniki głosowania ' +
    'Ale mamy brak kworum. (Gwar na sali, oklaski) Dziękuję państwu bardzo za entuzjazm i stwierdzam, że Sejm nie podjął uchwały ' +
    'w sprawie zmian w składach osobowych komisji sejmowych.';
  it('znajduje akapit 18/127 po liczbach z rekordu i oddaje go dosłownie', async () => {
    const { fragmentPoGlosowaniu } = await import('../src/narzedzia/glosowania.js');
    const f = fragmentPoGlosowaniu(tekst, { yes: 221, no: 5, abstain: 1 });
    expect(f).toMatch(/^Głosowało 227 posłów\. 221 - za, 5 - przeciw/);
    expect(f).toMatch(/Ale mamy brak kworum\./);
    expect(f).toMatch(/Sejm nie podjął uchwały/);
  });
  it('inne liczby: nie zgaduje, zwraca null', async () => {
    const { fragmentPoGlosowaniu } = await import('../src/narzedzia/glosowania.js');
    expect(fragmentPoGlosowaniu(tekst, { yes: 220, no: 5, abstain: 1 })).toBeNull();
  });
});

describe('szukanie frazy w długim tekście', () => {
  it('oddaje trafienia z kontekstem, bez wielkości liter, i liczy wszystkie', async () => {
    const { szukajFrazy } = await import('../src/tekst.js');
    const t = 'Początek dnia. Stwierdzam kworum. Dalej obrady. ' + 'x'.repeat(2000) + ' Ale mamy brak kworum. Koniec.';
    const w = szukajFrazy(t, 'KWORUM', 20);
    expect(w.trafien).toBe(2);
    expect(w.fragmenty).toHaveLength(2);
    expect(w.fragmenty[1].tekst).toMatch(/Ale mamy brak kworum/);
    expect(t.slice(w.fragmenty[1].od)).toMatch(/brak kworum/);
  });
  it('dwa głosowania tego dnia z tymi samymi liczbami: fragment po głosowaniu nie zgaduje', async () => {
    const { fragmentPoGlosowaniu } = await import('../src/narzedzia/glosowania.js');
    const zdanie = 'Głosowało 440 posłów. 230 - za, 210 - przeciw, nikt się nie wstrzymał. ';
    expect(fragmentPoGlosowaniu(zdanie + 'Sejm przyjął. ' + zdanie + 'Sejm przyjął.', { yes: 230, no: 210, abstain: 0 })).toBeNull();
    expect(fragmentPoGlosowaniu(zdanie + 'Sejm przyjął.', { yes: 230, no: 210, abstain: 0 })).toMatch(/^Głosowało 440 posłów/);
  });
});

describe('fragment po głosowaniu: warianty odczytu wyniku przez Marszałka (stenogramy X kadencji)', () => {
  it('większość kwalifikowana (64/15, 4.09.2026) i „przeciw nie był nikt” (19/8, 10.10.2024)', async () => {
    const { fragmentPoGlosowaniu } = await import('../src/narzedzia/glosowania.js');
    const weto =
      'Kto się wstrzymał? Głosowało 442 posłów. Większość 3/5 - 266. 241 - za, 198 - przeciw, 3 się wstrzymało. ' +
      'Wobec nieuzyskania wymaganej większości głosów Sejm nie uchwalił ponownie ustawy z dnia 15 maja 2026 r. o rynku kryptoaktywów.';
    expect(fragmentPoGlosowaniu(weto, { yes: 241, no: 198, abstain: 3 })).toMatch(/Sejm nie uchwalił ponownie ustawy/);
    const powrot = 'Głosowało 233 posłów. Za - 231, przeciw nie był nikt, wstrzymało się 2. Wyniki głosowania Stwierdzam, że Sejm podjął uchwałę.';
    expect(fragmentPoGlosowaniu(powrot, { yes: 231, no: 0, abstain: 2 })).toMatch(/Sejm podjął uchwałę/);
  });
});

describe('fragment po głosowaniu kończy się przed następnym głosowaniem', () => {
  it('19/8: bez odczytu kolejnego głosowania (druk 708)', async () => {
    const { fragmentPoGlosowaniu } = await import('../src/narzedzia/glosowania.js');
    const t =
      'Głosowało 233 posłów. Za - 231, przeciw nie był nikt, wstrzymało się 2. Wyniki głosowania Stwierdzam, że Sejm podjął uchwałę w sprawie zmian w składach osobowych komisji sejmowych. (Oklaski) ' +
      'Przystępujemy do rozpatrzenia punktu 7. porządku dziennego (druk nr 708). Kto z pań i panów posłów jest za, zechce podnieść rękę. Głosowało 349 posłów. Za - 263, przeciw - 71, wstrzymało się 15.';
    const f = fragmentPoGlosowaniu(t, { yes: 231, no: 0, abstain: 2 });
    expect(f).toMatch(/Sejm podjął uchwałę/);
    expect(f).not.toMatch(/349|708|Kto z pań|Przystępujemy/);
  });
});

describe('poprawki z 11.10.2026', () => {
  it('cytat po głosowaniu bez etykiety „Wyniki głosowania” z HTML stenogramu', async () => {
    const { fragmentPoGlosowaniu } = await import('../src/narzedzia/glosowania.js');
    const f = fragmentPoGlosowaniu('Głosowało 233 posłów. Za - 231, przeciw nie był nikt, wstrzymało się 2. Wyniki głosowania Stwierdzam, że Sejm podjął uchwałę.', { yes: 231, no: 0, abstain: 2 });
    expect(f).toBe('Głosowało 233 posłów. Za - 231, przeciw nie był nikt, wstrzymało się 2. Stwierdzam, że Sejm podjął uchwałę.');
  });
  it('fraza: mówi, ile pokazano, i daje nastepneOd do dalszych trafień', async () => {
    const { szukajFrazy } = await import('../src/tekst.js');
    const t = Array.from({ length: 25 }, (_, i) => `Akapit ${i} o kworum.` + ' x'.repeat(500)).join(' ');
    const a = szukajFrazy(t, 'kworum', 50, 10);
    expect(a.trafien).toBe(25);
    expect(a.fragmenty).toHaveLength(10);
    expect(a.pokazano).toBe(10);
    expect(a.nastepneOd).not.toBeNull();
    const b = szukajFrazy(t, 'kworum', 50, 10, a.nastepneOd!);
    expect(b.fragmenty[0].tekst).toMatch(/Akapit 10 o kworum/);
    const c = szukajFrazy(t, 'kworum', 50, 10, b.nastepneOd!);
    expect(c.nastepneOd).toBeNull();
    expect(c.fragmenty).toHaveLength(5);
  });
});
