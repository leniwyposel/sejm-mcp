/**
 * Najmniejszy PDF do testów, składany w pamięci: strony z napisami w zadanym miejscu i rozmiarze
 * (Helvetica, WinAnsi). Pozwala sprawdzić indeks górny, nagłówki dziennika i limity stron bez
 * trzymania w repozytorium kodeksu na 2 MB.
 */

export interface Napis {
  tekst: string;
  x: number;
  y: number;
  rozmiar?: number;
}

/**
 * Polskie litery spoza WinAnsi dostają wolne kody 0x80–0x90 przez /Differences (nazwy glifów
 * Adobe), a pdf.js oddaje je jako Unicode: tak jak w prawdziwych PDF-ach z Word-a.
 */
const POLSKIE: Array<[string, number, string]> = [
  ['ł', 0x80, 'lslash'], ['Ł', 0x81, 'Lslash'], ['ą', 0x82, 'aogonek'], ['Ą', 0x83, 'Aogonek'], ['ę', 0x85, 'eogonek'], ['Ę', 0x86, 'Eogonek'],
  ['ś', 0x87, 'sacute'], ['Ś', 0x88, 'Sacute'], ['ć', 0x89, 'cacute'], ['Ć', 0x8a, 'Cacute'], ['ń', 0x8b, 'nacute'], ['Ń', 0x8c, 'Nacute'],
  ['ź', 0x8d, 'zacute'], ['Ź', 0x8e, 'Zacute'], ['ż', 0x8f, 'zdotaccent'], ['Ż', 0x90, 'Zdotaccent'],
];
const ROZNICE = `[${POLSKIE.map(([, kod, glif]) => `${kod} /${glif}`).join(' ')}]`;

/** Znak → bajt WinAnsi (albo kod z /Differences); spoza obu zostaje „?”. */
function winAnsi(s: string): string {
  const mapa: Record<string, number> = { '–': 0x96, '—': 0x97, '„': 0x84, '”': 0x94, ...Object.fromEntries(POLSKIE.map(([z, kod]) => [z, kod])) };
  let wynik = '';
  for (const c of s) {
    const kod = mapa[c] ?? c.codePointAt(0)!;
    const bajt = kod < 256 ? kod : 0x3f;
    const znak = String.fromCharCode(bajt);
    wynik += znak === '(' || znak === ')' || znak === '\\' ? `\\${znak}` : bajt < 32 || bajt > 126 ? `\\${bajt.toString(8).padStart(3, '0')}` : znak;
  }
  return wynik;
}

export function zbudujPdf(strony: Napis[][]): Uint8Array {
  const obiekty: string[] = [];
  const dodaj = (tresc: string) => obiekty.push(tresc) + 0;
  dodaj('<< /Type /Catalog /Pages 2 0 R >>');
  dodaj('PAGES');
  dodaj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${ROZNICE} >> >>`);
  const strony_ids: number[] = [];
  for (const napisy of strony) {
    const strumien = napisy.map((n) => `BT /F1 ${n.rozmiar ?? 10} Tf ${n.x} ${n.y} Td (${winAnsi(n.tekst)}) Tj ET`).join('\n');
    const idTresci = dodaj(`<< /Length ${strumien.length} >>\nstream\n${strumien}\nendstream`);
    const idStrony = dodaj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idTresci} 0 R >>`);
    strony_ids.push(idStrony);
  }
  obiekty[1] = `<< /Type /Pages /Kids [${strony_ids.map((i) => `${i} 0 R`).join(' ')}] /Count ${strony_ids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const przesuniecia: number[] = [];
  obiekty.forEach((o, i) => {
    przesuniecia.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${obiekty.length + 1}\n0000000000 65535 f \n`;
  for (const p of przesuniecia) pdf += `${String(p).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${obiekty.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Wiersze tekstu jeden pod drugim, od góry strony. */
export function wiersze(linie: string[], odY = 780): Napis[] {
  return linie.map((tekst, i) => ({ tekst, x: 72, y: odY - i * 14 }));
}
