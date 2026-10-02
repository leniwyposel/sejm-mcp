// Pierwsze zdanie opisu narzędzia do manifestu .mcpb (Claude Desktop pokazuje je przy rozszerzeniu).
// Tnie wyłącznie na końcu zdania: kropka, po niej odstęp i wielka litera (albo cudzysłów, nawias),
// a słowo przed kropką nie jest skrótem („np.”, „tys.”, „m.in.”) ani liczbą. Gdy takiego miejsca
// nie ma, zwraca cały opis: lepiej dłużej niż urwane w pół zdania.

const SKROTY = new Set(['np', 'tys', 'mln', 'mld', 'in', 'tzw', 'ok', 'art', 'ust', 'pkt', 'poz', 'nr', 'r', 'godz', 'str', 'zm', 'wg', 'tj', 'ds', 'pt', 'św', 'dr', 'prof', 'im', 'al', 'ul', 'pl', 'zob', 'por', 'itp', 'itd', 'cd', 'tzn', 'jw', 'U', 'Dz']);

export function pierwszeZdanie(opis) {
  const s = opis.trim();
  const wzor = /\.(?=\s+[A-ZĄĆĘŁŃÓŚŹŻ„"(])/g;
  for (let m; (m = wzor.exec(s)); ) {
    const poczatek = s.slice(0, m.index);
    // Nawias albo cudzysłów przed kropką zamyka zdanie: „(klub, koło, niezrzeszeni). Z parametrem…”.
    if (/[)”"]$/.test(poczatek)) return s.slice(0, m.index + 1);
    const przed = /([\p{L}\d]+)$/u.exec(poczatek)?.[1] ?? '';
    if (!przed || /^\d+$/.test(przed) || SKROTY.has(przed) || SKROTY.has(przed.toLowerCase())) continue;
    return s.slice(0, m.index + 1);
  }
  return s;
}
