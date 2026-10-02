/**
 * HTML z rejestru → zwykły tekst dla modelu.
 *
 * Treść pism i stenogramów to tekst z zewnątrz: model dostaje go jako dane, nigdy jako HTML.
 * Wycinamy znaczniki, skrypty i style, dekodujemy encje, usuwamy znaki sterujące i niewidoczne
 * znaki kierunku pisma (można nimi ukryć tekst przed człowiekiem, a pokazać go modelowi).
 */

const ENCJE: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  oacute: 'ó',
  Oacute: 'Ó',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bdquo: '„',
  rdquo: '”',
  ldquo: '“',
  sect: '§',
  deg: '°',
  shy: '',
};

function dekodujEncje(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (calosc, nazwa: string) => {
    if (nazwa.startsWith('#x') || nazwa.startsWith('#X')) return znak(parseInt(nazwa.slice(2), 16), calosc);
    if (nazwa.startsWith('#')) return znak(parseInt(nazwa.slice(1), 10), calosc);
    return ENCJE[nazwa] ?? calosc;
  });
}

function znak(kod: number, zapas: string): string {
  if (!Number.isFinite(kod) || kod < 0 || kod > 0x10ffff) return zapas;
  return String.fromCodePoint(kod);
}

/**
 * Znaki, których człowiek nie widzi, a model czyta: sterujące (poza \n i \t), zerowej
 * szerokości, sterujące kierunkiem pisma, miękki dywiz, łącznik grafemów (U+034F), wypełniacze
 * Hangul, mongolskie selektory wariantu (U+180B–180F), pusty znak Braille'a (U+2800), selektory
 * wariantu i znaki TAG (U+E0000–E007F), którymi da się przemycić ukryty tekst ASCII.
 */
const NIEWIDOCZNE =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** Więcej HTML-a nie czytamy: tyle mieści odpowiedź klienta; kodeks z tekstem jednolitym to ok. 2,3 MB. */
const LIMIT_HTML = 8_000_000;

/**
 * Usuwa bloki `<script>…</script>` i podobne jednym przejściem do przodu: szukanie otwarcia
 * zaczyna się tam, gdzie skończyło się poprzednie, więc każdy znak jest czytany raz.
 */
function usunBloki(html: string): string {
  const otwarcie = /<(script|style|head|noscript|template)(?![a-z0-9-])/gi;
  const male = html.toLowerCase();
  let wynik = '';
  let i = 0;
  for (;;) {
    otwarcie.lastIndex = i;
    const m = otwarcie.exec(html);
    if (!m) return wynik + html.slice(i);
    wynik += html.slice(i, m.index);
    const koniec = male.indexOf(`</${m[1].toLowerCase()}`, m.index);
    if (koniec === -1) return wynik;
    const zamkniecie = male.indexOf('>', koniec);
    if (zamkniecie === -1) return wynik;
    i = zamkniecie + 1;
  }
}

/** Elementy bez treści i bez znacznika zamykającego: nie wchodzą na stos otwartych. */
const PUSTE = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Czy atrybuty chowają element przed człowiekiem: atrybut `hidden` albo styl `display:none`,
 * `visibility:hidden`, `font-size:0`, `opacity:0`. `aria-hidden` NIE ukrywa: chowa tekst przed
 * czytnikiem ekranu, a oko go widzi, więc model ma go dostać tak jak człowiek (test 20-b, N1).
 * Styl czytamy tylko z atrybutu `style` i bez komentarzy CSS: `display:inline; /* display:none *\/`
 * wycinało widoczny tekst. Wyrażenia nie mają zagnieżdżonych kwantyfikatorów, więc są liniowe.
 */
function ukrywa(atrybuty: string): boolean {
  // Wartości w cudzysłowach nie są nazwami atrybutów: title="hidden" niczego nie chowa.
  if (/(?:^|\s)hidden(?:\s|=|\/|$)/i.test(atrybuty.replace(/"[^"]*"|'[^']*'/g, '""'))) return true;
  const m = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(atrybuty);
  if (!m) return false;
  const styl = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$)/g, ' ');
  return (
    /display\s*:\s*none/i.test(styl) ||
    /visibility\s*:\s*hidden/i.test(styl) ||
    /font-size\s*:\s*(?:0+(?:\.0*)?|\.0+)(?:px|pt|em|rem|%)?\s*(?:[;!]|$)/i.test(styl) ||
    /opacity\s*:\s*(?:0+(?:\.0*)?|\.0+)\s*(?:[;!]|$)/i.test(styl)
  );
}

/** Dopisek w tekście, gdy ukryty element nie ma zamknięcia: treść zostaje, model wie dlaczego. */
export const ADNOTACJA_NIEZAMKNIETY = '[serwer: element oznaczony w HTML jako ukryty nie ma zamknięcia; jego treść zostawiono]';
/** Ukryty fragment dłuższy niż tyle znaków HTML wycinamy z dopiskiem, żeby wycięcie nie było ciche. */
const DLUGI_UKRYTY = 500;

interface Znacznik {
  lt: number;
  gt: number;
  zamykajacy: boolean;
  nazwa: string;
  atrybuty: string;
  samozamkniety: boolean;
}

/**
 * Znaczniki HTML po kolei, jedno przejście z `indexOf`: pozycja następnego `>` jest zapamiętana,
 * więc ciąg samych `<` nie każe szukać go od nowa. `tekst(od, do)` dostaje wszystko pomiędzy.
 */
function* znaczniki(html: string, tekst: (od: number, do_: number) => void): Generator<Znacznik> {
  let i = 0;
  let gt = -1;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) return tekst(i, html.length);
    tekst(i, lt);
    if (gt <= lt) gt = html.indexOf('>', lt + 1);
    if (gt < 0) return tekst(lt, html.length);
    const nastepnyLt = html.indexOf('<', lt + 1);
    if (nastepnyLt >= 0 && nastepnyLt < gt) {
      // `<` bez własnego `>`: zwykły znak w tekście.
      tekst(lt, nastepnyLt);
      i = nastepnyLt;
      continue;
    }
    const znacznik = html.slice(lt, gt + 1);
    i = gt + 1;
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9]*)/.exec(znacznik);
    if (!m) {
      tekst(lt, gt + 1);
      continue;
    }
    const nazwa = m[2].toLowerCase();
    const atrybuty = znacznik.slice(m[0].length, -1);
    yield { lt, gt, zamykajacy: !!m[1], nazwa, atrybuty, samozamkniety: !m[1] && (PUSTE.has(nazwa) || atrybuty.trimEnd().endsWith('/')) };
  }
}

/** Stos otwartych elementów z licznikiem nazw: zamknięcie zdejmuje do pasującego w czasie stałym na element. */
class Stos {
  private readonly elementy: Array<{ nazwa: string; lt: number }> = [];
  private readonly licznik = new Map<string, number>();
  get dlugosc() {
    return this.elementy.length;
  }
  wloz(nazwa: string, lt: number) {
    this.elementy.push({ nazwa, lt });
    this.licznik.set(nazwa, (this.licznik.get(nazwa) ?? 0) + 1);
  }
  /** Zdejmuje do elementu o tej nazwie włącznie; false, gdy takiego nie ma na stosie. */
  zamknij(nazwa: string): boolean {
    if ((this.licznik.get(nazwa) ?? 0) === 0) return false;
    for (;;) {
      const e = this.elementy.pop()!;
      this.licznik.set(e.nazwa, this.licznik.get(e.nazwa)! - 1);
      if (e.nazwa === nazwa) return true;
    }
  }
  pozostale() {
    return this.elementy.map((e) => e.lt);
  }
}

/**
 * Wycina elementy ukryte przed człowiekiem (tekst, którego na stronie Sejmu nikt nie zobaczy,
 * a model by przeczytał). Dwa liniowe przejścia: pierwsze ustala, które elementy nie mają
 * zamknięcia, drugie wycina. Niezamknięty ukryty element w przeglądarce chowa resztę strony,
 * ale tu to częściej zepsuty HTML niż zamiar, a cicho zjadał całą widoczną treść (test 20-b, N2):
 * zostawiamy go z dopiskiem. Element zamknięty przez zamknięcie rodzica kończy się tam, a samo
 * zamknięcie rodzica zostaje w tekście (inaczej znikał podział akapitu).
 */
function usunUkryte(html: string): string {
  const pusta = () => {};
  const otwarte = new Stos();
  for (const z of znaczniki(html, pusta)) {
    if (z.zamykajacy) otwarte.zamknij(z.nazwa);
    else if (!z.samozamkniety) otwarte.wloz(z.nazwa, z.lt);
  }
  const niezamkniete = new Set(otwarte.pozostale());

  const stos = new Stos();
  let ukryteOd = -1;
  let ukryteLt = -1;
  let adnotacja = false;
  let wynik = '';
  const tekst = (od: number, do_: number) => {
    if (ukryteOd < 0 && do_ > od) wynik += html.slice(od, do_);
  };
  for (const z of znaczniki(html, tekst)) {
    const znacznik = html.slice(z.lt, z.gt + 1);
    if (z.zamykajacy) {
      if (stos.zamknij(z.nazwa) && ukryteOd >= 0 && stos.dlugosc <= ukryteOd) {
        const zamknietyRodzic = stos.dlugosc < ukryteOd;
        if (z.gt - ukryteLt > DLUGI_UKRYTY) wynik += ` [serwer: pominięto ukryty w HTML fragment, ${z.gt - ukryteLt} znaków] `;
        ukryteOd = -1;
        if (zamknietyRodzic) wynik += znacznik;
        continue;
      }
      if (ukryteOd < 0) wynik += znacznik;
      continue;
    }
    if (ukryteOd < 0 && ukrywa(z.atrybuty)) {
      if (niezamkniete.has(z.lt)) {
        if (!adnotacja) wynik += ` ${ADNOTACJA_NIEZAMKNIETY} `;
        adnotacja = true;
      } else {
        if (!z.samozamkniety) {
          ukryteOd = stos.dlugosc;
          ukryteLt = z.lt;
          stos.wloz(z.nazwa, z.lt);
        }
        continue;
      }
    }
    if (!z.samozamkniety) stos.wloz(z.nazwa, z.lt);
    if (ukryteOd < 0) wynik += znacznik;
  }
  return wynik;
}

/**
 * Po zdekodowaniu encji `&lt;system&gt;` byłoby dosłownym `<system>`, który udaje ogranicznik
 * wiadomości. Nawiasy wokół czegoś, co wygląda na znacznik, zamieniamy na ‹ ›: tekst zostaje,
 * ale nie udaje znacznika. Zwykłe „a < b” zostaje bez zmian.
 */
function bezZnacznikow(tekst: string): string {
  return tekst.replace(/<(\/?[A-Za-z!?][^<>\n]{0,200})>/g, '‹$1›');
}

export function htmlNaTekst(html: string): string {
  // Wyrażenia poniżej są liniowe: żadne nie przeszukuje reszty tekstu od każdego `<` od nowa.
  const przyciety = html.length > LIMIT_HTML ? html.slice(0, LIMIT_HTML) : html;
  // Łamania wierszy ze źródła HTML nic nie znaczą (dzielą zdania w pół); znaczenie mają tylko
  // znaczniki blokowe, które niżej zamieniamy na nowe wiersze.
  const tekst = usunUkryte(usunBloki(przyciety.replace(/<!--(?:[^-]|-(?!->))*(?:-->|$)/g, '').replace(/\s+/g, ' ')))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, '\n')
    .replace(/<li\b[^<>]*>/gi, '- ')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<\/?[A-Za-z!][^<>]*>/g, '');
  return zwyklyTekst(dekodujEncje(tekst));
}

/**
 * Tekst z zewnątrz (po HTML-u albo prosto z PDF) → tekst dla modelu: bez niewidocznych znaków,
 * bez niczego, co udaje znacznik, ze zwykłymi odstępami. Tekst z PDF przechodzi tędy tak samo jak z HTML.
 */
export function zwyklyTekst(tekst: string): string {
  return bezZnacznikow(tekst)
    .replace(NIEWIDOCZNE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Krótki tekst z rejestru (tytuł, temat) bez niewidocznych znaków. */
export function czysty(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  return String(s).replace(NIEWIDOCZNE, '').trim();
}

/** Każdy napis w odpowiedzi, na każdej głębokości, bez niewidocznych znaków. */
export function wyczyscWszystko<T>(wartosc: T): T {
  if (typeof wartosc === 'string') return wartosc.replace(NIEWIDOCZNE, '') as T;
  if (Array.isArray(wartosc)) return wartosc.map(wyczyscWszystko) as T;
  if (wartosc && typeof wartosc === 'object') {
    const wynik: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(wartosc)) if (v !== undefined) wynik[k] = wyczyscWszystko(v);
    return wynik as T;
  }
  return wartosc;
}

/** Link z rejestru przepuszczamy tylko, gdy prowadzi na https do domeny Sejmu albo ELI. */
export function bezpiecznyLink(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    const zaufany = host === 'sejm.gov.pl' || host.endsWith('.sejm.gov.pl') || host === 'eli.gov.pl';
    return u.protocol === 'https:' && zaufany ? u.href : null;
  } catch {
    return null;
  }
}

export interface Fragment {
  tekst: string;
  od: number;
  do: number;
  dlugosc: number;
  /** Gdzie zacząć następną porcję; `null`, gdy to koniec tekstu. */
  nastepnyOd: number | null;
}

/** Porcja długiego tekstu, żeby jedna odpowiedź nie zalała rozmowy. */
export function fragment(tekst: string, od = 0, ile = 12_000): Fragment {
  const start = Math.max(0, Math.min(od, tekst.length));
  let koniec = Math.min(tekst.length, start + ile);
  // Nie tniemy pary surogatów (emoji): połówka znaku to śmieć w odpowiedzi.
  const kod = tekst.charCodeAt(koniec - 1);
  if (koniec < tekst.length && koniec > start + 1 && kod >= 0xd800 && kod <= 0xdbff) koniec--;
  return {
    tekst: tekst.slice(start, koniec),
    od: start,
    do: koniec,
    dlugosc: tekst.length,
    nastepnyOd: koniec < tekst.length ? koniec : null,
  };
}

/** Porównanie bez wielkości liter i bez polskich znaków: „Łośko" = „losko". */
export function klucz(s: string | null | undefined): string {
  return String(s ?? '')
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
