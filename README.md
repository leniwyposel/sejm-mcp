<h1 align="center">
  <img src="https://raw.githubusercontent.com/leniwyposel/sejm-mcp/main/.github/assets/baner.jpg" width="800" alt="sejm-mcp od Leniwego Posła: Sejm i prawo w Twoim asystencie AI. W tle kopuła sali posiedzeń Sejmu.">
</h1>

<p align="center">
  Zapytaj asystenta AI o posłów, głosowania, interpelacje i obowiązujące prawo.<br>
  Odpowiedź przychodzi z oficjalnych danych Sejmu RP, z linkiem do źródła.
</p>

<p align="center">
  <a href="https://github.com/leniwyposel/sejm-mcp/releases/latest/download/sejm-mcp.mcpb"><img src="https://img.shields.io/badge/Claude_Desktop-Pobierz-D97757?style=for-the-badge&logo=claude&logoColor=white" alt="Pobierz dla Claude Desktop"></a>
  <a href="https://cursor.com/en/install-mcp?name=sejm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNlam0tbWNwIl19"><img src="https://img.shields.io/badge/Cursor-Zainstaluj-000000?style=for-the-badge&logo=cursor&logoColor=white" alt="Zainstaluj w Cursorze"></a>
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=sejm&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22sejm-mcp%22%5D%7D"><img src="https://img.shields.io/badge/VS_Code-Zainstaluj-0098FF?style=for-the-badge" alt="Zainstaluj w VS Code"></a>
</p>

<p align="center">
  <a href="#co-możesz-zapytać">Przykłady</a> •
  <a href="#instalacja">Instalacja</a> •
  <a href="#jak-czytać-odpowiedzi">Jak czytać odpowiedzi</a> •
  <a href="#czego-nie-umie">Czego nie umie</a> •
  <a href="#prywatność">Prywatność</a> •
  <a href="#hackathon-quickstart">Hackathon</a> •
  <a href="#kontakt">Kontakt</a> •
  <a href="#english">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/leniwyposel/sejm-mcp/main/.github/assets/demo.gif" width="800" alt="Animacja: pytanie po polsku, czy Sejm odrzucił weto prezydenta do ustawy o rynku kryptoaktywów. Asystent wywołuje narzędzia sejm-mcp szukaj_glosowan i glosowanie, odpowiada: nie, weto zostało utrzymane, 241 za przy wymaganych 266 (3/5), i podaje źródło api.sejm.gov.pl/sejm/term10/votings/64/15.">
</p>

## Co możesz zapytać

Pytaj zwyczajnie, po polsku. Asystent sam sprawdzi dane w Sejmie.

- „Jak głosował mój poseł nad ustawą budżetową na 2024 rok?”
- „Czy Sejm odrzucił weto prezydenta do ustawy o rynku kryptoaktywów?”
- „Ile głosowań opuściła posłanka X i ile z tych dni Sejm uznał za usprawiedliwione?”
- „Na które interpelacje do ministra zdrowia odpowiedź się spóźnia?”
- „Na jakim etapie jest projekt ustawy o …?”
- „Czym Sejm zajmie się na najbliższym posiedzeniu?”
- „Czy ustawa budżetowa na 2026 rok już obowiązuje i od kiedy?”
- „Co mówi art. 52 Kodeksu pracy?”
- „Co zmienia art. 1 projektu z druku 2457? Pokaż stronę w pliku.”

Działa z posłami, klubami, komisjami, głosowaniami, interpelacjami i zapytaniami, projektami
ustaw, posiedzeniami, stenogramami i transmisjami, a także z aktami prawnymi z Dziennika Ustaw
i Monitora Polskiego.

## Instalacja

Serwer działa na Twoim komputerze. Poza Claude Desktop potrzebny jest
[Node.js](https://nodejs.org) w wersji 22 lub nowszej; polecenie `npx -y sejm-mcp` samo pobierze
i uruchomi najnowszą wersję.

```bash
npx -y sejm-mcp     # serwer MCP na stdio; zwykle uruchamia go Twój klient, nie Ty
```

Gdy API Sejmu nie odpowiada, ten serwer też nie odpowie. Wtedy możesz użyć wersji hostowanej,
która odpowiada z nocnej kopii bazy: <https://mcp.leniwyposel.pl/mcp>

Liczby o posłach (np. nieobecności) pochodzą wprost ze statystyk Sejmu i mogą różnić się od liczb
na leniwyposel.pl, które stosuje własne reguły opisane na <https://leniwyposel.pl/faq/#inne-niz-w-sejmie> (apele
o kworum, okna mandatów).

### Claude Desktop

1. [Pobierz plik `sejm-mcp.mcpb`](https://github.com/leniwyposel/sejm-mcp/releases/latest/download/sejm-mcp.mcpb).
2. Kliknij go dwa razy albo przeciągnij do okna Claude Desktop.
3. Kliknij **Zainstaluj**.

Nic więcej nie trzeba instalować: Claude Desktop ma własny Node.js. W nowej rozmowie zapytaj
o cokolwiek z listy powyżej.

### Claude Code

```bash
claude mcp add sejm -- npx -y sejm-mcp
```

Z opcją `--scope user` serwer będzie dostępny we wszystkich Twoich projektach.

### Cursor

Kliknij przycisk **Cursor** u góry strony albo dopisz wpis do `~/.cursor/mcp.json`
(dla jednego projektu: `.cursor/mcp.json` w jego katalogu):

```json
{
  "mcpServers": {
    "sejm": {
      "command": "npx",
      "args": ["-y", "sejm-mcp"]
    }
  }
}
```

### VS Code

Kliknij przycisk **VS Code** u góry strony albo wpisz w terminalu:

```bash
code --add-mcp '{"name":"sejm","command":"npx","args":["-y","sejm-mcp"]}'
```

Dla jednego projektu wystarczy plik `.vscode/mcp.json`:

```json
{
  "servers": {
    "sejm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "sejm-mcp"]
    }
  }
}
```

### Windsurf

Dopisz wpis do `~/.codeium/windsurf/mcp_config.json` (albo w Windsurfie: Settings → Cascade →
MCP Servers → View raw config) i odśwież listę serwerów:

```json
{
  "mcpServers": {
    "sejm": {
      "command": "npx",
      "args": ["-y", "sejm-mcp"]
    }
  }
}
```

<details>
<summary><b>Inne programy i ręczna konfiguracja</b></summary>

<br>

Każdy program, który uruchamia lokalne serwery MCP (Zed, LM Studio, Goose i inne), przyjmie
ten sam wpis co Cursor i Windsurf.

Claude Desktop bez pliku `.mcpb`: Ustawienia → Developer → Edit Config. Plik leży w
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) albo
`%APPDATA%\Claude\claude_desktop_config.json` (Windows). Po zapisaniu uruchom program ponownie.

Na Windowsie, jeśli serwer się nie uruchamia, zamień polecenie na
`"command": "cmd", "args": ["/c", "npx", "-y", "sejm-mcp"]`.

W Claude Code działa też wtyczka z krótką instrukcją, jak odpowiadać na podstawie wyników:
`/plugin marketplace add leniwyposel/sejm-mcp`, potem `/plugin install sejm@sejm-mcp`.

</details>

### Telefon i przeglądarka

Na razie nie. sejm-mcp działa na komputerze, a aplikacje mobilne i przeglądarkowe wersje
asystentów łączą się tylko z serwerami w internecie.

## Jak czytać odpowiedzi

- **Każda odpowiedź ma źródło.** Asystent dostaje adresy danych Sejmu, z których powstała
  odpowiedź. Przy ważnych sprawach kliknij i sprawdź.
- **Klub z dnia głosowania.** Liczy się klub, w którym poseł był tego dnia, a nie dzisiejszy.
- **Frekwencja według Sejmu.** Opuszczone głosowania i usprawiedliwienia to statystyka samego
  Sejmu, bez przeliczeń.
- **Apel o kworum to nie głosowanie.** Sejm sprawdza kworum na dwa sposoby: przyciskiem
  „obecny” albo prośbą o naciśnięcie dowolnego przycisku. Ten drugi rejestr zapisuje jak
  głosowanie (np. 23.04.2025, 33/5: 145 za, 47 przeciw, 237 wstrzymań), choć stenogram mówi
  „Stwierdzam kworum”. Serwer zna pięć takich przypadków z cytatem ze stenogramu i podaje je jako
  „kworum stwierdzone: N obecnych”. Naciśnięcie na apelu to obecność, a brak naciśnięcia nie
  wlicza się do nieobecności w głosowaniach (tak samo liczy statystyka Sejmu).
- **Wynik z progu.** Przy wecie prezydenta i innych głosowaniach wymagających szczególnej
  większości werdykt wynika z progu (np. 3/5), a nie z tego, czy „za” było więcej niż „przeciw”.
- **Termin odpowiedzi na interpelację** liczy się od doręczenia ministrowi, osobno dla każdego
  adresata. Prolongata to nie odpowiedź.
- **Dane są świeże.** Każde pytanie idzie prosto do Sejmu.
- **Druk cytuje plik i stronę.** Tekst druku przychodzi strona po stronie; przy każdej stronie
  asystent dostaje numer druku, nazwę pliku (np. `2457.pdf`), numer strony i link, który otwiera
  PDF na tej stronie. Poproś o link, jeśli go nie podał.
- **Odczyt maszynowy to nie tekst Sejmu.** Część druków to skany bez warstwy tekstowej. Serwer
  może je odczytać maszynowo (OCR, na Twoim komputerze; przy ponad 10 stronach naraz najpierw
  zapyta, bo to potrwa) i zawsze oznacza taki tekst „odczyt maszynowy, możliwe błędy”. Liczby
  i nazwiska z takiej strony sprawdź w oryginale.

## Gdy coś pójdzie nie tak

Asystent ma obowiązek powiedzieć Ci to na początku odpowiedzi, prostymi słowami. Co to znaczy:

- **„Wynik niepełny”.** Część danych nie dotarła: zabrakło czasu (niektóre pytania wymagają
  dziesiątek zapytań do Sejmu), Sejm nie oddał jakiegoś kawałka albo plik PDF był za długi.
  Liczba jest wtedy dolną granicą („co najmniej”). Zadaj to samo pytanie jeszcze raz: to, co już
  pobrano, serwer pamięta przez 60 sekund, więc szybkie drugie podejście zwykle dokończy resztę.
  To samo zdanie pojawia się, gdy odpowiedź przekroczyła 28 tys. znaków: serwer skraca wtedy listę
  i podaje, jak dostać resztę (kolejna porcja, mniejszy limit, krótszy przedział dat).
- **„Pokazano 30 z 69”.** Nic nie zginęło, to tylko pierwsza porcja długiej listy. Poproś o dalszą
  część.
- **Sejm nie odpowiada albo ma awarię** (błędy 500, 502, 503, 504, brak połączenia). To nie Twoja
  wina: dane w Sejmie są, tylko teraz nie da się ich pobrać. Spróbuj za kilka minut albo użyj
  wersji hostowanej (<https://mcp.leniwyposel.pl/mcp>), która odpowiada z nocnej kopii bazy.
- **„Sejm nie ma takiego zasobu”** (błąd 404). Najczęściej zły numer posiedzenia, pisma albo druku,
  zła kadencja (bieżąca to X, od 2023 r.) albo rzecz, której jeszcze nie ma. Sprawdź numer albo
  poproś asystenta, żeby go najpierw wyszukał.
- **Za dużo zapytań** (błąd 429). Sejm chwilowo ogranicza liczbę pytań. Serwer już ponawiał;
  odczekaj minutę.
- **Adres odrzucony.** Serwer pobiera wyłącznie dane z api.sejm.gov.pl. Innych stron nie otworzy.

## Czego nie umie

- Zna tylko to, co publikuje Sejm. Czego nie ma w rejestrze (np. kto kogo zastąpił w ławach
  poselskich, jak głosował senator), tego nie poda jako faktu.
- PDF czyta w trzech miejscach: odpowiedzi ministrów na interpelacje i zapytania, teksty aktów
  prawnych i druki sejmowe (także DOCX i DOC). Tabele przychodzą spłaszczone do zwykłego tekstu.
  Skan w odpowiedzi ministra albo w akcie zostaje linkiem; skan w druku serwer odczyta maszynowo
  na prośbę. Zapisy posiedzeń komisji zostają linkiem do PDF.
- Plik druku do 20 MB pobiera bez pytania. Sejm zwykle nie podaje rozmiaru z góry, więc serwer
  liczy bajty w trakcie pobierania: gdy plik przekroczy 20 MB, przerywa i pyta, czy pobrać całość
  (z podanym powodem). Na ten sam plik pyta raz na uruchomienie. Pliku ponad 200 MB nie pobierze
  wcale.
- Nie ocenia posłów i nie układa rankingów. Podaje fakty, wnioski należą do Ciebie.
- Asystent AI wciąż może się pomylić przy przepisywaniu liczb. Źródło jest po to, żeby to
  sprawdzić.

## Prywatność

- Działa na Twoim komputerze i łączy się wyłącznie z `api.sejm.gov.pl`. Twoje pytania nie
  trafiają ani do nas, ani do serwisu leniwyposel.pl.
- Tylko czyta dane Sejmu. Nie czyta Twoich plików i nie uruchamia programów.
- Na dysku zapisuje wyłącznie pobrane druki, tekst z nich odczytany i wyniki odczytu maszynowego
  (OCR), żeby nie robić tego drugi raz. Leżą w katalogu podręcznym: `~/Library/Caches/sejm-mcp`
  (macOS), `~/.cache/sejm-mcp` (Linux), `%LOCALAPPDATA%\sejm-mcp\Cache` (Windows); inny wskażesz
  zmienną `SEJM_MCP_SCHOWEK`. Katalog zajmuje najwyżej ok. 500 MB: ponad to serwer kasuje
  najdawniej używane pliki. Można go w każdej chwili skasować.
- Odczyt maszynowy skanów (Tesseract z danymi języka polskiego) jest w paczce i działa bez sieci:
  plik druku nie wychodzi z Twojego komputera.
- Bez kont, kluczy, reklam i telemetrii.

Szczegóły techniczne i zgłaszanie problemów: [SECURITY.md](https://github.com/leniwyposel/sejm-mcp/blob/main/SECURITY.md).

## Narzędzia

Asystent sam wybiera narzędzie do pytania. Lista dla ciekawych:

<details>
<summary><b>29 narzędzi</b></summary>

<br>

| Narzędzie | Co robi |
|---|---|
| `znajdz_posla` | Szuka posła po nazwisku, klubie, okręgu |
| `profil_posla` | Dane posła i statystyka głosowań według Sejmu |
| `kluby` | Kluby i koła, ich skład |
| `komisje` | Komisje sejmowe, skład, komisje posła |
| `grupy_bilateralne` | Polsko-zagraniczne grupy parlamentarne |
| `kadencje` | Kadencje Sejmu od 1991 roku |
| `lista_posiedzen` | Posiedzenia Sejmu z datami: domyślnie 10 ostatnich i najbliższe, `wszystkie: true` cała kadencja, `od`/`do` okres |
| `porzadek_posiedzenia` | Porządek obrad posiedzenia |
| `glosowania_posiedzenia` | Głosowania posiedzenia z wynikami; `porzadek: true` układa je pod punktami porządku obrad (`odPunktu` dla dalszej części) |
| `szukaj_glosowan` | Głosowania po temacie i dacie |
| `glosowanie` | Wynik, próg, kluby, głos posła |
| `glosy_posla_w_dniu` | Głosy posła w jednym dniu |
| `szukaj_pism` | Interpelacje i zapytania z terminem odpowiedzi |
| `pismo` | Jedno pismo: terminy, odpowiedzi, treść |
| `szukaj_procesow` | Projekty ustaw i uchwał po tytule |
| `proces` | Etapy prac nad projektem |
| `szukaj_projektow` | Projekty wniesione do Sejmu |
| `druk` | Druk sejmowy z plikami |
| `tekst_druku` | Pełny tekst druku strona po stronie, spis artykułów, skany i OCR za zgodą |
| `szukaj_drukow` | Druki po tytule i dacie |
| `posiedzenia_komisji` | Posiedzenia komisji |
| `wypowiedzi_posiedzenia` | Kto zabierał głos danego dnia |
| `tresc_wypowiedzi` | Treść wystąpienia ze stenogramu |
| `transmisje` | Nagrania posiedzeń |
| `szukaj_aktow` | Akty prawne po tytule i roku |
| `akt` | Czy akt obowiązuje, od kiedy, co go zmieniło |
| `tresc_aktu` | Tekst aktu albo artykułu w aktualnym brzmieniu |
| `slownik_eli` | Słowniki bazy aktów prawnych |
| `zapytanie_surowe` | Inne dane z API Sejmu |

</details>

## Licencja

[Apache 2.0](https://github.com/leniwyposel/sejm-mcp/blob/main/LICENSE): możesz używać, zmieniać i rozpowszechniać sejm-mcp w dowolnym celu,
także komercyjnym, pod warunkiem zachowania informacji o licencji i o autorach (plik
[NOTICE](https://github.com/leniwyposel/sejm-mcp/blob/main/NOTICE)). Licencja obejmuje też udzielenie praw patentowych. Tworzy zespół
[Leniwego Posła](https://leniwyposel.pl).

### Dane

Dane pochodzą z publicznych API Kancelarii Sejmu RP ([api.sejm.gov.pl](https://api.sejm.gov.pl),
także baza aktów prawnych ELI); projekt nie jest związany z Kancelarią Sejmu. Publikując coś
na ich podstawie, podaj źródło, np. „Źródło: Kancelaria Sejmu RP, api.sejm.gov.pl”, najlepiej
z adresem rekordu, który asystent dostaje przy każdej odpowiedzi.

sejm-mcp łączy się tylko z api.sejm.gov.pl. Wersja hostowana z
[leniwyposel.pl/dla-developerow](https://leniwyposel.pl/dla-developerow/) może dodawać zestawienia
Leniwego Posła; te udostępniamy na licencji
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.pl), z podaniem źródła
„Leniwy Poseł, leniwyposel.pl”.

## Hackathon quickstart

Masz weekend i pomysł na civic tech? Trzy minuty do pierwszej odpowiedzi:

```bash
claude mcp add sejm -- npx -y sejm-mcp                   # Claude Code
npx -y @modelcontextprotocol/inspector npx -y sejm-mcp   # podgląd narzędzi w przeglądarce
```

Trzy pomysły na start (wklej jako prompt):

1. **Tracker ustawy.** „Znajdź projekt ustawy o … , pokaż etapy prac w Sejmie i streść, co
   zmienia art. 1. Przy każdym zdaniu podaj druk, plik i stronę.” (`szukaj_procesow`, `proces`,
   `tekst_druku`)
2. **Głosowania posiedzenia w jednej tabeli.** „Wypisz głosowania ostatniego posiedzenia Sejmu:
   temat, wynik, wymagana większość i jak głosowały kluby. Zwróć JSON do wykresu.”
   (`lista_posiedzen`, `glosowania_posiedzenia`, `glosowanie`)
3. **Spóźnione odpowiedzi ministrów.** „Które interpelacje do ministra … czekają na odpowiedź
   dłużej niż 21 dni od doręczenia? Podaj numery i linki.” (`szukaj_pism`, `pismo`)

Każda odpowiedź niesie adres rekordu w api.sejm.gov.pl, więc Twoja aplikacja może linkować
do źródła. Pamiętaj o granicach z [CONTRIBUTING.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CONTRIBUTING.md): fakty z rejestru, bez
rankingów i ocen posłów.

## Kontakt

- **Błąd w odpowiedzi albo pomysł:** [zgłoszenie na GitHubie](https://github.com/leniwyposel/sejm-mcp/issues/new/choose).
- **Poprawka w kodzie:** pull request, najpierw [CONTRIBUTING.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CONTRIBUTING.md).
- **Współpraca i media:** [leniwyposel.pl/kontakt](https://leniwyposel.pl/kontakt/).

Zgłoszenia i pull requesty są mile widziane; zasady w [CONTRIBUTING.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CONTRIBUTING.md).

Zdjęcie w nagłówku: Piotr VaGla Waglowski,
[domena publiczna](https://commons.wikimedia.org/wiki/File:200701_sejm_chmury_nad_sala_posiedzen.jpg).

---

## English

**sejm-mcp** is a Model Context Protocol (MCP) server for the public APIs of the Polish
parliament (Sejm) and the Polish legal acts database (ELI): MPs, clubs, committees, votes,
interpellations and written questions, legislative processes, prints (full text page by page,
with optional local OCR of scans), sittings, transcripts and laws in force. It runs on your
machine, only reads, and talks to nothing but `api.sejm.gov.pl`. No accounts, keys or telemetry.
Tool names and answers are in Polish; ask in any language.

### Install

Requires [Node.js](https://nodejs.org) 22+ (except Claude Desktop, which ships its own).

- **Run it:** `npx -y sejm-mcp` (stdio; normally your MCP client starts it for you).
- **Claude Desktop:** download [`sejm-mcp.mcpb`](https://github.com/leniwyposel/sejm-mcp/releases/latest/download/sejm-mcp.mcpb)
  and double-click it, or add this to `claude_desktop_config.json`:

  ```json
  { "mcpServers": { "sejm": { "command": "npx", "args": ["-y", "sejm-mcp"] } } }
  ```

- **Claude Code:** `claude mcp add sejm -- npx -y sejm-mcp` (add `--scope user` for all projects).
- **Cursor, VS Code, Windsurf and others:** the same `command`/`args` entry (see the Polish
  sections above for exact file paths).

When the Sejm API is down, this server is down too. You can then use the hosted version, which
answers from a nightly copy of the database: <https://mcp.leniwyposel.pl/mcp>

Figures about MPs (e.g. absences) come straight from the Sejm's own statistics and may differ
from the figures on leniwyposel.pl, which applies its own rules described at
<https://leniwyposel.pl/faq/#inne-niz-w-sejmie> (quorum calls, mandate windows).

Disk and consent: prints up to 20 MB are downloaded without asking. The Sejm usually does not
announce the size, so the server counts bytes while downloading; past 20 MB it stops and asks
you first, saying why. Downloaded prints, their extracted text and OCR results are cached in your
user cache folder (`~/Library/Caches/sejm-mcp`, `~/.cache/sejm-mcp`, `%LOCALAPPDATA%\sejm-mcp\Cache`
or `SEJM_MCP_SCHOWEK`), at most about 500 MB, least recently used files removed first. OCR of more
than 10 pages at once also asks first. A single answer is capped at 28,000 characters; a longer
one is shortened and says how to get the rest.

### Hackathon quickstart

```bash
claude mcp add sejm -- npx -y sejm-mcp
npx -y @modelcontextprotocol/inspector npx -y sejm-mcp   # browse the tools in your browser
```

Three starter prompts:

1. *Bill tracker:* "Find the bill on …, list its stages in the Sejm and summarise what Article 1
   changes, citing print number, file and page for every claim."
2. *Sitting at a glance:* "List the votes of the latest Sejm sitting with topic, result, required
   majority and how each club voted; return JSON for a chart."
3. *Late ministerial answers:* "Which interpellations to the Minister of … have waited more than
   21 days since delivery? Give numbers and links."

### Tools

The 29 tool names are Polish (table above). Two of them take options worth knowing:
`lista_posiedzen` (sittings) returns the 10 latest sittings plus the next one by default;
`wszystkie: true` returns the whole term and `od`/`do` a date range. `glosowania_posiedzenia`
(votes of a sitting) with `porzadek: true` groups the votes under the points of the sitting's
agenda, with the rest under „Pozostałe głosowania” (procedural motions, quorum checks); long
agendas continue with `odPunktu`. A quorum check where the Speaker asked MPs to press *any*
button is recorded by the Sejm like a vote (e.g. sitting 33, vote 5); the server knows the five
such cases, with transcript quotes, and reports them as quorum checks, not as passed motions.

### Data and licence

Data comes from the public APIs of the Chancellery of the Sejm
([api.sejm.gov.pl](https://api.sejm.gov.pl)); this project is not affiliated with or endorsed by
the Chancellery. Please credit it as "Source: Chancellery of the Sejm, api.sejm.gov.pl". Derived
figures served by the hosted version from Leniwy Poseł are
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credit "Leniwy Poseł, leniwyposel.pl".

Code: [Apache 2.0](https://github.com/leniwyposel/sejm-mcp/blob/main/LICENSE); bundled third-party components (Tesseract OCR, tessdata, pdf.js)
are listed in [NOTICE](https://github.com/leniwyposel/sejm-mcp/blob/main/NOTICE). Security issues: report privately via
[SECURITY.md](https://github.com/leniwyposel/sejm-mcp/blob/main/SECURITY.md). Contributions: [CONTRIBUTING.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CODE_OF_CONDUCT.md). Issues and PRs in Polish or English are welcome.
