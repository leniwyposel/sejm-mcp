# Bezpieczeństwo

## Co robi serwer

- Łączy się wyłącznie z `https://api.sejm.gov.pl/sejm/` i `https://api.sejm.gov.pl/eli/`.
  Adres jest sprawdzany po złożeniu, przekierowania są odrzucane. Nazwa pliku druku z rejestru
  jest kodowana i nie może wyjść poza katalog swojego druku.
- Silnik OCR (Tesseract 5 w WebAssembly, dane języka polskiego tessdata best_int, pdf.js
  z dekoderami obrazów skanów) jest częścią paczki (`dist/silnik-ocr`), razem ok. 10 MB, z
  licencjami i NOTICE składników (Apache-2.0). Budowanie kopiuje go z dokładnie przypiętych paczek
  npm i sprawdza rozmiary i skróty sha256 zapisane w `src/druki/silnik-ocr.ts`; wątek OCR sprawdza
  skróty jeszcze raz przed uruchomieniem. OCR działa w osobnym wątku, bez sieci, i czyta tylko
  obrazy stron. W plikach silnika nie ma `eval` ani `new Function`.
- Wysyła tylko zapytania GET. Nie czyta Twoich plików, nie uruchamia poleceń systemowych.
- Zapisuje na dysku wyłącznie w katalogu podręcznym użytkownika (`~/Library/Caches/sejm-mcp`,
  `~/.cache/sejm-mcp`, `%LOCALAPPDATA%\sejm-mcp\Cache` albo `SEJM_MCP_SCHOWEK`): pobrane pliki
  druków pod skrótem sha256, tekst z nich odczytany i wyniki OCR. Nazwy plików składa
  serwer z numeru druku i skrótów, nigdy z danych z sieci; zapis jest atomowy. Katalog ma limit
  500 MB: po zapisie pliku druku serwer kasuje najdawniej używane pliki, aż zejdzie do 400 MB.
- Odpowiedź z Sejmu (JSON, HTML) ma limit 8 MiB, PDF odpowiedzi na pismo albo tekstu aktu
  24 MiB, a jedno pobranie razem z ponowieniami trwa najwyżej 55 s. Plik druku ma osobny limit:
  bez pytania serwer pobiera najwyżej 20 MiB, licząc bajty w strumieniu (Sejm zwykle nie podaje
  `Content-Length`); po przekroczeniu przerywa pobieranie i pyta użytkownika o zgodę. Za zgodą
  najwyżej 200 MiB. Duży plik pobiera się w tle, narzędzie czeka najwyżej 45 s.
- Jedna odpowiedź narzędzia ma najwyżej 28 000 znaków; dłuższą serwer skraca (listy od końca,
  bez psucia JSON-a) i oznacza jako wynik niepełny.
  Wobec Sejmu: najwyżej 4 zapytania naraz i hamowanie przy błędach 429 i 5xx.
- Tekst z rejestru (pisma, stenogramy) trafia do modelu jako zwykły tekst, bez HTML-a,
  znaków sterujących i niewidocznych znaków, z adnotacją, że to dane, a nie polecenia.
- PDF-y (odpowiedzi na pisma, teksty aktów) pobiera tylko z `api.sejm.gov.pl/sejm/` i `/eli/`
  tym samym klientem i czyta je w procesie serwera biblioteką pdf.js (unpdf) bez wykonywania
  kodu z PDF, bez eval, bez workera, bez pobierania czcionek z sieci i bez zapisu na dysk,
  z limitem stron i 20 s na plik; tekst przechodzi to samo czyszczenie co tekst z HTML.
- pdf.js: silnik OCR ma pdfjs-dist 6.3.289, z poprawką GHSA-hq66-cqwq-w95j (wykonanie
  JavaScriptu z PDF przy `enableScripting: true`). Biblioteka unpdf 1.8.1, którą serwer czyta
  warstwę tekstową PDF, ma wbudowany pdf.js 6.1.200, a nowszej wersji unpdf jeszcze nie ma.
  Ta podatność tu nie działa: serwer nie włącza `enableScripting`, nie ładuje warstwy
  przeglądarkowej ani piaskownicy skryptów pdf.js i używa wyłącznie `getDocument`,
  `getTextContent` i `getOperatorList`. Skaner zależności może ją mimo to zgłosić; unpdf
  zaktualizujemy, gdy wyjdzie wersja z nowszym pdf.js.
- Odpowiedzi API pamięta najwyżej przez minutę i tylko w pamięci procesu. Zostają wyłącznie
  pliki druków w katalogu podręcznym (patrz wyżej); nowa wersja druku w rejestrze (`changeDate`)
  oznacza pobranie pliku od nowa.

## Zgłaszanie problemu

Problem z bezpieczeństwem zgłoś prywatnie przez
[GitHub Security Advisories](https://github.com/leniwyposel/sejm-mcp/security/advisories/new),
nie w publicznym zgłoszeniu.

**English.** Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/leniwyposel/sejm-mcp/security/advisories/new),
not in a public issue. We aim to acknowledge within a few days. Supported version: the latest
release on npm.
