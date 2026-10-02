import { describe, expect, it } from 'vitest';
import { BladSejmu, KlientSejmu, zlozAdres } from '../src/klient.js';
import { BezPamieci, PamiecKrotka } from '../src/pamiec.js';

describe('zlozAdres: nic poza api.sejm.gov.pl/sejm/', () => {
  it('składa zwykłą ścieżkę z parametrami i koduje polskie znaki', () => {
    const u = zlozAdres('term10/votings/search', { title: 'budżet', limit: 3, puste: undefined });
    expect(u.href).toBe('https://api.sejm.gov.pl/sejm/term10/votings/search?title=bud%C5%BCet&limit=3');
  });

  it.each([
    '../eli/acts',
    'term10/../../eli',
    'term10//MP',
    'https://evil.example/x',
    'term10/MP?x=1',
    'term10/MP#x',
    'term10/%2e%2e/eli',
    'term10/MP@evil.example',
    'term10/MP\\..\\x',
    'term10/ MP',
  ])('odrzuca %j', (sciezka) => {
    expect(() => zlozAdres(sciezka)).toThrow(BladSejmu);
  });

  it('ścieżka od eli/ idzie do API aktów prawnych i nie wychodzi poza /eli/', () => {
    expect(zlozAdres('eli/acts/DU/2026/62').href).toBe('https://api.sejm.gov.pl/eli/acts/DU/2026/62');
    expect(() => zlozAdres('eli/../sejm/term10')).toThrow(BladSejmu);
    expect(zlozAdres('term10/eli/acts').href).toBe('https://api.sejm.gov.pl/sejm/term10/eli/acts');
  });

  it('wiodące ukośniki nie wyprowadzają poza /sejm/', () => {
    expect(zlozAdres('/term10/MP').href).toBe('https://api.sejm.gov.pl/sejm/term10/MP');
    expect(zlozAdres('//evil.example/x').href).toBe('https://api.sejm.gov.pl/sejm/evil.example/x');
  });

  it('za długi adres odpada przed siecią, a błąd nie cytuje go w całości', () => {
    const parametry = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, 'x'.repeat(200)]));
    expect(() => zlozAdres('term10/MP', parametry)).toThrow(/za długi/);
  });

  it('parametr nie może przemycić innego hosta', () => {
    const u = zlozAdres('term10/MP', { x: 'https://evil.example/&y=1' });
    expect(u.host).toBe('api.sejm.gov.pl');
    expect(u.searchParams.get('x')).toBe('https://evil.example/&y=1');
  });
});

function odpowiedzJson(tresc: unknown, status = 200, naglowki: Record<string, string> = {}) {
  return new Response(JSON.stringify(tresc), { status, headers: { 'content-type': 'application/json', ...naglowki } });
}

const bezSpania = async () => {};

describe('KlientSejmu', () => {
  it('wysyła User-Agent sejm-mcp, nie podąża za przekierowaniem, ma limit czasu', async () => {
    let init: RequestInit | undefined;
    const k = new KlientSejmu(new BezPamieci(), async (_u, i) => {
      init = i;
      return odpowiedzJson([]);
    }, bezSpania);
    await k.json('term10/MP');
    expect(new Headers(init!.headers).get('user-agent')).toMatch(/^sejm-mcp\/\d/);
    expect(init!.redirect).toBe('manual');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('404 to null, nie wyjątek', async () => {
    const k = new KlientSejmu(new BezPamieci(), async () => new Response('', { status: 404 }), bezSpania);
    expect(await k.json('term10/MP/99999')).toBeNull();
  });

  it('ponawia po 503 i zwraca odpowiedź', async () => {
    let n = 0;
    const k = new KlientSejmu(new BezPamieci(), async () => (++n < 3 ? new Response('', { status: 503 }) : odpowiedzJson({ ok: 1 })), bezSpania);
    expect(await k.json('term10')).toEqual({ ok: 1 });
    expect(n).toBe(3);
  });

  it('poddaje się po trzech 5xx z czytelnym błędem', async () => {
    const k = new KlientSejmu(new BezPamieci(), async () => new Response('', { status: 502 }), bezSpania);
    await expect(k.json('term10')).rejects.toThrow(/nie odpowiedział po 3 próbach/);
  });

  it('przekierowanie to błąd stały: jedna próba i komunikat po polsku', async () => {
    let n = 0;
    const k = new KlientSejmu(new BezPamieci(), async () => (n++, new Response('', { status: 301, headers: { location: 'https://example.com/' } })), bezSpania);
    await expect(k.json('term10')).rejects.toThrow(/API odpowiedziało przekierowaniem \(301\); serwer nie podąża za przekierowaniami/);
    expect(n).toBe(1);
    let m = 0;
    const k2 = new KlientSejmu(new BezPamieci(), async () => {
      m++;
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    }, bezSpania);
    await expect(k2.json('term10')).rejects.toThrow(/przekierowaniem/);
    expect(m).toBe(1);
  });

  it('przekroczony czas opisany po polsku, nie „The operation was aborted”', async () => {
    const k = new KlientSejmu(new BezPamieci(), async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }, bezSpania);
    const blad = await k.json('term10').catch((e: Error) => e);
    expect(String(blad)).toMatch(/nie odpowiedział po 3 próbach \(przekroczono limit czasu odpowiedzi\)/);
    expect(String(blad)).not.toMatch(/aborted/);
  });

  it('termin wywołania narzędzia: po nim zapytanie nie wychodzi', async () => {
    let n = 0;
    const k = new KlientSejmu(new BezPamieci(), async () => (n++, odpowiedzJson([])), bezSpania);
    await expect(k.json('term10', { termin: Date.now() + 200 })).rejects.toThrow(/Zabrakło czasu/);
    expect(n).toBe(0);
  });

  it('400 nie jest ponawiane', async () => {
    let n = 0;
    const k = new KlientSejmu(new BezPamieci(), async () => (n++, new Response('', { status: 400 })), bezSpania);
    await expect(k.json('term10')).rejects.toThrow(/400/);
    expect(n).toBe(1);
  });

  it('strona HTML zapory zamiast JSON-a to błąd, nie dane', async () => {
    const k = new KlientSejmu(
      new BezPamieci(),
      async () => new Response('<html>Request Rejected</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      bezSpania,
    );
    await expect(k.json('term10/MP')).rejects.toThrow(/Zapora/);
  });

  it('odrzuca odpowiedź ponad limit rozmiaru', async () => {
    const duza = new Uint8Array(9 * 1024 * 1024);
    const k = new KlientSejmu(new BezPamieci(), async () => new Response(duza, { status: 200, headers: { 'content-type': 'application/json' } }), bezSpania);
    await expect(k.json('term10/prints')).rejects.toThrow(/za duża/);
  });

  it('lista niesie X-Total-Count', async () => {
    const k = new KlientSejmu(new BezPamieci(), async () => odpowiedzJson([{ num: 1 }], 200, { 'x-total-count': '19940' }), bezSpania);
    expect(await k.lista('term10/interpellations')).toEqual({ dane: [{ num: 1 }], razem: 19940 });
  });

  it('powtórka w ciągu minuty idzie z pamięci procesu, po minucie znowu z Sejmu', async () => {
    let n = 0;
    let zegar = 0;
    const k = new KlientSejmu(new PamiecKrotka(() => zegar), async () => (n++, odpowiedzJson({ a: 1 })), bezSpania);
    await k.json('term10');
    zegar = 59_000;
    await k.json('term10');
    expect(n).toBe(1);
    zegar = 61_000;
    await k.json('term10');
    expect(n).toBe(2);
  });

  it('nie więcej niż 4 zapytania naraz', async () => {
    let teraz = 0;
    let max = 0;
    const k = new KlientSejmu(new BezPamieci(), async () => {
      max = Math.max(max, ++teraz);
      await new Promise((r) => setTimeout(r, 5));
      teraz--;
      return odpowiedzJson([]);
    }, bezSpania);
    await Promise.all(Array.from({ length: 12 }, (_, i) => k.json(`term10/MP/${i + 1}`)));
    expect(max).toBeLessThanOrEqual(4);
  });
});

describe('PamiecKrotka', () => {
  it('nie trzyma więcej, niż pozwala limit, i wyrzuca najstarsze', () => {
    let zegar = 0;
    const p = new PamiecKrotka(() => zegar);
    p.zapisz('a', 'x'.repeat(20_000_000));
    zegar = 1;
    p.zapisz('b', 'y'.repeat(20_000_000));
    expect(p.czytaj('a')).toBeNull();
    expect(p.czytaj('b')).not.toBeNull();
  });
});
