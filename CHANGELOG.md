# Zmiany

Format według [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), numeracja według
[Semantic Versioning](https://semver.org/lang/pl/). Przed wersją 1.0.0 nazwy i kształt narzędzi
mogą się jeszcze zmieniać; każda taka zmiana będzie tu opisana.

## [Nieopublikowane]

### Dodane

- `Dockerfile` i `.dockerignore`: serwer w kontenerze (`docker run -i --rm sejm-mcp`), dwuetapowe
  budowanie na `node:22-slim`, użytkownik bez uprawnień roota, silnik OCR w obrazie. Przygotowanie
  wpisu w katalogu Docker MCP.

## [0.3.0] - 2026-10-02

Pierwsze publiczne wydanie: kod na GitHubie (Apache-2.0), pakiet w npm, paczka `.mcpb`
w wydaniach na GitHubie. Obejmuje też zmiany z 0.2.0, która nie trafiła do npm.

### Dodane

- `tekst_druku`: pełny tekst druku sejmowego strona po stronie, z pliku PDF, DOCX albo DOC,
  bez infrastruktury Leniwego Posła (decyzja z 28.09.2026). Plik przychodzi z `api.sejm.gov.pl`,
  leży w katalogu podręcznym użytkownika pod skrótem sha256 i przy kolejnych pytaniach jest
  czytany z dysku (nowa `changeDate` druku oznacza pobranie od nowa). Spis treści (działy,
  rozdziały, artykuły, uzasadnienie, OSR), porcje stron (`strony="11-20"`) i skok do artykułu
  (`artykul="52"`); druk 948 (2025 stron) czyta się raz ok. 15 s, potem z dysku w ułamku sekundy.
- Cytowanie przy każdej stronie: numer druku, nazwa pliku, numer strony (w Wordzie numer części),
  artykuły na stronie i adres pliku z `#page=N`; w opisie narzędzia i w każdej odpowiedzi
  zasada: podaj plik i stronę, zaproponuj otwarcie oryginału.
- Strony bez warstwy tekstowej są oznaczone „strona bez warstwy tekstowej (skan)”. Odczyt
  maszynowy (`ocr=true`): Tesseract 5 w WebAssembly z danymi języka polskiego tessdata 4.0.0
  best_int i pdf.js z dekoderami skanów, w paczce (`dist/silnik-ocr`, ok. 10 MB, licencje
  i NOTICE obok), bez sieci, w osobnym wątku, ok. 0,9–2,2 s na stronę. Każda taka strona ma
  etykietę „odczyt maszynowy, możliwe błędy” i prośbę o sprawdzenie w oryginale.
- Zgoda użytkownika przez okno pytania klienta MCP (elicitation) przed pobraniem pliku druku
  ponad 20 MB i przed OCR ponad 10 stron (z szacunkiem czasu); zgoda na plik obowiązuje do końca
  sesji serwera. Klient bez elicitation dostaje prośbę do modelu i argument `zgoda`. Plik do 20 MB
  pobiera się bez pytania (decyzja z 2.10.2026): Sejm nie podaje `Content-Length`, więc limit
  pilnuje licznik bajtów w strumieniu, a po przekroczeniu 20 MB pobieranie jest przerywane
  i serwer pyta o zgodę z podanym powodem. Wcześniej pytał o każdy plik bez podanego rozmiaru,
  czyli o każdy druk (2690, 215 KB, też). Klucz zgody `pobranie` działa dalej jak `duzy-plik`.
- Zależność `word-extractor` 1.0.4 (MIT, czysty JavaScript) i silnik OCR w paczce.
- `glosowania_posiedzenia` z `porzadek: true`: porządek obrad posiedzenia (pole `agenda`
  z `/proceedings/{n}`) z głosowaniami pod każdym punktem, każde z werdyktem; punkty bez głosowań
  też, a na końcu „Pozostałe głosowania” (wnioski formalne, apele o kworum, głosowania bez numeru
  punktu). Reguła przypisania jak na stronie posiedzenia w leniwyposel.pl: numer „Pkt. N”
  z początku tytułu, punkt musi istnieć i mieć wspólny druk, a tytuł bez numeru z drukiem trafia
  pod punkt tylko wtedy, gdy ten druk ma dokładnie jeden punkt. Posiedzenie 65: 53 punkty,
  137 ze 147 głosowań pod punktami, 10 pozostałych. Długi porządek idzie porcjami (`odPunktu`).
  Reguła w `src/reguly/porzadek.ts`, testy na rekordach 65. posiedzenia.

### Zmienione

- **Wspólny sufit rozmiaru odpowiedzi: 28 000 znaków** (`src/rozmiar.ts`, wołany w `odpowiedz()`).
  Dłuższy wynik jest przycinany na poziomie obiektu, nigdy w środku napisu JSON: najpierw listy
  od końca (co najmniej jedna pozycja zostaje), potem długie napisy na granicy słowa. Przycięta
  odpowiedź ma `wynikCzesciowy` z polską informacją, co skrócono („lista transmisje: pokazano 83
  z 300 pozycji”) i jak dostać resztę argumentami tego narzędzia (`przesuniecie=N`, mniejszy
  `limit`, krótszy przedział dat), oraz pole `skroconoDoLimitu`. Audyt przed publikacją zmierzył
  do 121 tys. znaków (`transmisje` za miesiąc z `limit: 200`).
- Niższe limity: `transmisje` domyślnie 30, najwyżej 50 (było 100 i 200; miesiąc dawał domyślnie
  61,6 tys. znaków), `znajdz_posla` najwyżej 100 (było 500), `posiedzenia_komisji` najwyżej 40
  (było 100), `szukaj_aktow` najwyżej 50 (było 100), `tekst_druku` `znakow` domyślnie 20 000,
  najwyżej 25 000 (było 30 000 i 60 000).
- `tools/list` krótszy o ok. 30 tys. znaków: wspólny schemat wyniku (`outputSchema`, 29 razy)
  ma tylko pola i jedno zdanie o `wynikCzesciowy`; resztę mówi instrukcja serwera.
- Katalog podręczny ma limit 500 MB: po zapisie pliku druku serwer kasuje najdawniej używane
  pliki, aż zejdzie do 400 MB (skasowany druk pobierze się od nowa).
- pdf.js w silniku OCR: `pdfjs-dist` 6.3.289 zamiast 6.1.200 (GHSA-hq66-cqwq-w95j), nowe
  rozmiary i skróty sha256 w `src/druki/silnik-ocr.ts`. unpdf 1.8.1 ma wbudowany pdf.js 6.1.200
  i nowszej wersji nie ma; podatność wymaga `enableScripting`, którego serwer nie używa
  (SECURITY.md, NOTICE).
- Paczka `.mcpb`: strona domowa `https://leniwyposel.pl/dla-developerow/` (była martwa
  `/mcp/`), wymagany Node.js `>=22.0.0` jak w `engines`, a opisy narzędzi tną się na końcu
  zdania, nie na „np.” czy „tys.” (`skrypty/opis-narzedzia.mjs`).
- README i wtyczka: wersja hostowana (`https://mcp.leniwyposel.pl/mcp`) jako zapas, gdy API Sejmu
  nie odpowiada; zdanie o tym, że liczby o posłach pochodzą ze statystyk Sejmu i mogą różnić się
  od leniwyposel.pl; wtyczka nie twierdzi już, że nic nie zapisuje na dysku, i ma 29 narzędzi
  także po angielsku; pamięć odpowiedzi to 60 s, nie „kilka minut”; SECURITY.md podaje limity
  8 MiB (JSON, HTML) i 24 MiB (PDF). Komunikaty o silniku OCR nie mówią już o pobieraniu go:
  silnik jest w paczce, a przy uszkodzonych plikach trzeba zainstalować sejm-mcp ponownie.
- Serwer zapisuje na dysk: wyłącznie pliki druków, tekst z nich odczytany i wyniki OCR,
  w katalogu podręcznym (`SEJM_MCP_SCHOWEK` wskazuje inny). README, SECURITY.md
  i CONTRIBUTING.md mówią to wprost.
- `console.log` w procesie serwera pisze na stderr: stdout należy wyłącznie do protokołu MCP.
- `lista_posiedzen` bez `od`/`do` zwraca 10 ostatnich posiedzeń i najbliższe (ok. 2,9 tys. znaków
  zamiast ok. 10,8 tys. dla całej kadencji; z `planowane` 3,3 zamiast 14,2 tys.). Sumy w polu
  `sumy` dalej obejmują całą kadencję. Całą listę daje nowy argument `wszystkie: true`.

### Poprawione

- **Apel o kworum w trybie „dowolny przycisk”.** Pięć rekordów X kadencji (1/125, 15/4, 16/4,
  20/4, 33/5) to sprawdzenia kworum, przy których marszałek prosił o naciśnięcie dowolnego
  przycisku; rejestr zapisuje je jak głosowanie (33/5: 145 za, 47 przeciw, 237 wstrzymań), więc
  serwer podawał „Przyjęto”. Teraz rodzaj rozstrzyga kształt wyniku ALBO jawny rejestr tych pięciu
  (kadencja, posiedzenie, numer i dzień, z cytatem ze stenogramu i adresem PDF), tak jak w serwisie
  leniwyposel.pl od 2.10.2026. Werdykt: „Kworum stwierdzone: N obecnych”, gdzie N to wszystkie
  naciśnięcia (33/5: 429, 1/125: 342). Przy pośle naciśnięcie na apelu to obecność, a brak
  naciśnięcia to opuszczony apel, poza liczbą nieobecności (`glosy_posla_w_dniu`: `apeleObecnosc`,
  `apeleOpuszczone`); kluby na apelu mają `obecni` i `opuscili`. Statystyka posła w Sejmie pomija
  wszystkie pięć, więc liczby zgadzają się z nią także w te dni. Błędny komentarz o 33/5 poprawiony.
- Nowy rekord z tematem „stwierdzenie kworum”, który nie jest apelem z kształtu ani z rejestru,
  liczy się jak zwykłe głosowanie, ale dostaje łagodne ostrzeżenie (`doSprawdzenia` i uwaga):
  rozstrzyga stenogram.

## 0.2.0 - nieopublikowana

Przygotowana do premiery 26.09.2026, ale nie trafiła do npm; jej zmiany weszły do 0.3.0.

### Zmienione

- **Licencja: Apache 2.0** zamiast PolyForm Noncommercial 1.0.0. Wolno używać, zmieniać
  i rozpowszechniać sejm-mcp w dowolnym celu, także komercyjnym, z zachowaniem `LICENSE`
  i `NOTICE`. Wersja 0.1.4 była wydana wyłącznie wewnętrznie, na starej licencji.
- README: instalacja w Claude Desktop (`.mcpb`), Claude Code, Cursorze, VS Code i Windsurfie,
  animacja z przykładową rozmową, opis błędów po ludzku.

### Dodane

- `server.json` dla oficjalnego rejestru MCP (`io.github.leniwyposel/sejm-mcp`) i pole `mcpName`
  w `package.json`.
- Paczka `.mcpb` z odnośnikiem do polityki prywatności i ikoną; wydanie tworzy ją samo
  z tagu `v*`.
- Ikona w SVG oraz PNG 512 i 256 px (`.github/assets/`).
- Test pilnujący, żeby wersja i licencja zgadzały się w `package.json`, `server.json`, kodzie,
  wtyczce Claude Code i paczce `.mcpb`.

### Poprawione

- `posiedzenia_komisji` z kodem komisji i datami gubił posiedzenia, więc zaniżał liczbę
  posiedzeń w miesiącu (maj 2026 SPC: 6 zamiast 9, marzec ASW: 6 zamiast 7, czerwiec RRW:
  2 zamiast 3). Czytał spisy dzienne (`committees/sittings/{dzień}`), a te podają posiedzenie
  wspólne tylko pod komisją prowadzącą (RRW 168 z 10.06.2026 stoi tam jako KSP 133
  z `jointWith`) i bywają niepełne (12.03.2026 nie ma w nim ASW 97). Teraz źródłem jest
  rejestr komisji (`committees/{kod}/sittings`), a spis dzienny zostaje zapasem na awarię,
  z `wynikCzesciowy` i z dopasowaniem po `jointWith`. Odpowiedź podaje osobno liczbę posiedzeń
  (`razem`), liczbę dni (`dniPosiedzen`) i numery; opis narzędzia mówi wprost, że dwa
  posiedzenia jednego dnia to dwa posiedzenia.
- `druk` objaśnia daty: `dataDokumentu` to sporządzenie przez autora, nie wpływ do Sejmu,
  a `doreczono` to doręczenie posłom; wpływ jest etapem procesu (`proces`, `wszczeto`). Przy
  różnicy ponad 30 dni wynik ma osobną uwagę (druk 164: 663 dni).

### Bez zmian

- 28 narzędzi tylko do odczytu, te same nazwy i parametry co w 0.1.4. Serwer łączy się
  wyłącznie z `api.sejm.gov.pl`, nie zapisuje niczego na dysku i nie ma telemetrii.

## 0.1.4 - 2026-09-26

Wydanie wewnętrzne (niepubliczne): 28 narzędzi do API Sejmu RP i bazy aktów prawnych ELI,
reguły liczenia (próg przy wecie, apel o kworum, klub z dnia głosowania, termin odpowiedzi
na pismo od doręczenia) z testami na prawdziwych rekordach, wtyczka Claude Code ze skillem.

[0.3.0]: https://github.com/leniwyposel/sejm-mcp/releases/tag/v0.3.0
