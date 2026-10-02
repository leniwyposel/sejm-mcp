# Wzorce odpowiedzi: pytania trudne t061–t100 (ELI, komisje, projekty, odmowy)

Stan danych: 24 września 2026 r., kadencja 10. Każdą odpowiedź policzono wprost z API
(`https://api.sejm.gov.pl`, nagłówek `User-Agent: sejm-mcp-eval`) skryptami z katalogu
`wyrocznia-eli/`, bez kodu sejm-mcp. Odtworzenie: `cd wyrocznia-eli && python3 wyrocznia.py`
(z pamięci podręcznej `cache/`) albo `python3 wyrocznia.py --swiezo` (pobiera od nowa).

Skróty: `ELI` = `https://api.sejm.gov.pl/eli`, `SEJM` = `https://api.sejm.gov.pl/sejm`.

Uwaga ogólna dla oceniających: w metadanych ELI pole `inForce: IN_FORCE` oznacza, że akt jest
„obowiązujący” w sensie publikacji, NIE że jego przepisy już działają. Rozstrzyga `entryIntoForce`
(oraz `comments` dla przepisów o innym terminie). Kolejność list w `references` nie jest
chronologiczna, „ostatni” liczymy wg roku i pozycji w Dz.U.

---

## Kategoria A: ELI (18 pytań, t061–t078)

### t061 · najnowszy tekst jednolity Kodeksu pracy, HTML
- **Odpowiedź:** Dz.U. 2025 poz. 277, obwieszczenie Marszałka Sejmu z 14 lutego 2025 r., ogłoszone
  6 marca 2025 r. (stan prawny na 7 lutego 2025 r.). **Brak HTML** (`textHTML: false`), dostępny tylko
  PDF: `ELI/acts/DU/2025/277/text.pdf`.
- **Tolerancja:** wystarczy pozycja + „tylko PDF”. Błąd: wskazanie Dz.U. 2023 poz. 1465 jako najnowszego
  albo twierdzenie, że jest HTML (HTML ma sama ustawa DU/1974/141, ale to nie tekst jednolity).
- **URL:** `ELI/acts/DU/1974/141` (references → „Inf. o tekście jednolitym”, 10 pozycji), `ELI/acts/DU/2025/277`.

### t062 · najnowszy tekst jednolity Kodeksu cywilnego
- **Odpowiedź:** Dz.U. 2026 poz. 795, obwieszczenie z 27 maja 2026 r., ogłoszone 17 czerwca 2026 r.,
  stan prawny na 19 maja 2026 r. (`legalStatusDate`). Tylko PDF (`textHTML: false`).
- **Tolerancja:** data stanu prawnego mile widziana, nie konieczna. Błąd: Dz.U. 2025 poz. 1071 lub 2024 poz. 1061.
- **URL:** `ELI/acts/DU/1964/93`, `ELI/acts/DU/2026/795`.

### t063 · KPA: najnowszy t.j. i ostatni akt zmieniający
- **Odpowiedź:** najnowszy t.j.: Dz.U. 2025 poz. 1691 (obwieszczenie z 7 listopada 2025 r., ogłoszone
  3 grudnia 2025 r., tylko PDF). Ostatni akt zmieniający: ustawa z 21 maja 2025 r. o zmianie niektórych
  ustaw w celu deregulacji prawa gospodarczego i administracyjnego oraz doskonalenia zasad opracowywania
  prawa gospodarczego, Dz.U. 2025 poz. 769, ogłoszona 12 czerwca 2025 r., w życie 13 lipca 2025 r.
  (niektóre przepisy 1 stycznia 2026 r. i 13 marca 2026 r.).
- **Tolerancja:** oba elementy wymagane. Wspomnienie przepisów z późniejszym terminem nieobowiązkowe.
- **URL:** `ELI/acts/DU/1960/168`, `ELI/acts/DU/2025/1691`, `ELI/acts/DU/2025/769`.

### t064 · ostatnia nowelizacja Kodeksu karnego
- **Odpowiedź:** ustawa z 11 czerwca 2026 r. o zmianie ustawy - Kodeks karny, Dz.U. 2026 poz. 988,
  ogłoszona 23 lipca 2026 r., w życie 23 sierpnia 2026 r. (poprzednia: Dz.U. 2026 poz. 902, w życie 21 lipca 2026 r.).
- **Tolerancja:** jeśli po 24.09.2026 ukaże się nowsza nowelizacja, przyjąć ją przy poprawnym uzasadnieniu z API.
  Ta sama pozycja wynika i z sortowania wg pozycji, i wg daty wejścia w życie.
- **URL:** `ELI/acts/DU/1997/553` (Akty zmieniające, 122 pozycje), `ELI/acts/DU/2026/988`.

### t065 · KP art. 154 § 1
- **Odpowiedź:** wymiar urlopu: 20 dni przy zatrudnieniu krótszym niż 10 lat; 26 dni przy co najmniej 10 latach.
  (Kontekst: § 2 proporcjonalnie przy niepełnym etacie.)
- **Tolerancja:** obie liczby i próg 10 lat wymagane. „Staż pracy” zamiast „zatrudniony” akceptowalne.
- **URL:** `ELI/acts/DU/2023/1465/text.html` (jednostka `id="arti_154"`).

### t066 · KC art. 118
- **Odpowiedź:** 6 lat ogólnie; 3 lata dla roszczeń o świadczenia okresowe i związanych z prowadzeniem
  działalności gospodarczej; koniec terminu przypada na ostatni dzień roku kalendarzowego, chyba że termin
  jest krótszy niż dwa lata. Zastrzeżenie „jeżeli przepis szczególny nie stanowi inaczej”.
- **Tolerancja:** wymagane 6 / 3 lata i reguła końca roku.
- **URL:** `ELI/acts/DU/2024/1061/text.html` (`arti_118`).

### t067 · KPA art. 35 § 3
- **Odpowiedź:** sprawa wymagająca postępowania wyjaśniającego: nie później niż w ciągu miesiąca; sprawa
  szczególnie skomplikowana: nie później niż w ciągu dwóch miesięcy od wszczęcia; postępowanie odwoławcze:
  w ciągu miesiąca od otrzymania odwołania.
- **Tolerancja:** trzy terminy wymagane. Dodanie § 1 („bez zbędnej zwłoki”) lub § 3a (postępowanie uproszczone, miesiąc) nie jest błędem.
- **URL:** `ELI/acts/DU/2024/572/text.html` (`arti_35`).

### t068 · KK art. 148 § 1 (t.j. 2024)
- **Odpowiedź:** kara pozbawienia wolności na czas nie krótszy od lat 10 albo dożywotnie pozbawienie wolności.
- **Tolerancja:** błąd, jeśli model poda starsze brzmienie (8 lat, 25 lat) albo dopisze „do lat 30”
  jako treść tego tekstu. Może zastrzec, że nowszy t.j. (Dz.U. 2025 poz. 383) jest tylko w PDF.
- **URL:** `ELI/acts/DU/2024/17/text.html` (`arti_148`).

### t069 · nowelizacja KP z 19.06.2026: ogłoszona, ale jeszcze nie działa
- **Odpowiedź:** Dz.U. 2026 poz. 1046, ogłoszona 4 sierpnia 2026 r.; wchodzi w życie **5 listopada 2026 r.**,
  więc 24.09.2026 jej przepisy jeszcze **nie** obowiązują (mimo `status: obowiązujący`, `inForce: IN_FORCE`).
- **Tolerancja:** kluczowe: „jeszcze nie weszła w życie” + data 5.11.2026. Odpowiedź „obowiązuje” = błąd.
- **URL:** `ELI/acts/DU/2026/1046`.

### t070 · ustawy wchodzące w życie w sierpniu 2026
- **Odpowiedź:** **15 ustaw**. 11 sierpnia 2026 r.: Dz.U. 2026 poz. 1003 (o systemach sztucznej inteligencji),
  poz. 1006 (zmiana ustawy o imprezach turystycznych i powiązanych usługach turystycznych), poz. 1007
  (zmiana ustawy o Krajowej Sieci Onkologicznej oraz niektórych innych ustaw).
  Pełna lista: 965, 971, 972, 974, 985, 986, 988, 989, 1003, 1004, 1006, 1007, 1033, 1034, 1102.
- **Tolerancja:** liczba 15 (±0) i trzy akty z 11.08. Liczone po `entryIntoForce` (główna data), nie po
  przepisach o innym terminie. Kontrola krzyżowa: wyszukiwanie po dacie ogłoszenia 04–09.2026 daje te same 15.
- **URL:** `ELI/acts/search?publisher=DU&type=Ustawa&dateEffectFrom=2026-08-01&dateEffectTo=2026-08-31&limit=200`;
  kontrola: `ELI/acts/search?publisher=DU&type=Ustawa&pubDateFrom=2026-04-01&pubDateTo=2026-09-24&limit=500`.

### t071 · ustawa o swobodzie działalności gospodarczej: uchylona
- **Odpowiedź:** nie obowiązuje (`status: uchylony`, `NOT_IN_FORCE`), uchylona z dniem **30 kwietnia 2018 r.**
  przez ustawę z 6 marca 2018 r. - Przepisy wprowadzające ustawę - Prawo przedsiębiorców oraz inne ustawy
  dotyczące działalności gospodarczej (Dz.U. 2018 poz. 650). Sama ustawa: Dz.U. 2004 nr 173 poz. 1807.
- **Tolerancja:** wystarczy „uchylona 30.04.2018” + wskazanie przepisów wprowadzających Prawo przedsiębiorców.
  Wskazanie samego „Prawa przedsiębiorców” (DU/2018/646) jako aktu uchylającego: częściowo poprawne.
- **URL:** `ELI/acts/DU/2004/1807` (`repealDate`, references → „Akty uchylające”), `ELI/acts/DU/2018/650`.

### t072 · sygnaliści: vacatio legis
- **Odpowiedź:** ogłoszona 24 czerwca 2024 r. (Dz.U. 2024 poz. 928), w życie 25 września 2024 r. → **93 dni**.
  Później, 25 grudnia 2024 r., weszły art. 5 ust. 4, art. 25 ust. 1 pkt 8 oraz przepisy rozdziału 4 (pole `comments`).
- **Tolerancja:** 93 dni (±1 przy innym sposobie liczenia; „trzy miesiące” bez liczby = częściowo). Druga data wymagana.
- **URL:** `ELI/acts/DU/2024/928`.

### t073 · likwidacja CBA: weto, nie obowiązuje
- **Odpowiedź:** **nie obowiązuje**, nie ma jej w Dz.U. Sejm uchwalił (III czytanie 13.03.2026, po poprawkach
  Senatu 17.04.2026), przekazano Prezydentowi 20.04.2026, **Prezydent zawetował 11 maja 2026 r.** (wniosek
  o ponowne rozpatrzenie, druk nr 2548). Brak pola ELI w procesie 1884 i brak trafień w ELI.
- **Tolerancja:** kluczowe: weto + „nie obowiązuje”. CBA nadal istnieje prawnie.
- **URL:** `SEJM/term10/processes/1884`, `ELI/acts/search?publisher=DU&year=2026&title=likwidacji%20Centralnego%20Biura`,
  `SEJM/term10/prints?limit=5000` (druk 2548).

### t074 · akcyza z 15.05.2026: skierowana do TK
- **Odpowiedź:** **nie opublikowana, nie obowiązuje**. Uchwalona 15.05.2026, stanowisko Senatu 10.06.2026,
  **2 lipca 2026 r. Prezydent skierował ją do Trybunału Konstytucyjnego** (kontrola prewencyjna). W ELI
  z 2026 r. są tylko inne akty o akcyzie (Dz.U. 2026 poz. 414, ustawa z 27 marca 2026 r., i poz. 412, t.j.).
- **Tolerancja:** błąd, jeśli model utożsami ją z Dz.U. 2026 poz. 414. Nie wolno mówić o wecie.
- **URL:** `SEJM/term10/processes/2457`, `ELI/acts/search?publisher=DU&year=2026&title=podatku%20akcyzowym`.

### t075 · proces 2443 → ustawa o systemach SI
- **Odpowiedź:** tak: ustawa z 3 lipca 2026 r. o systemach sztucznej inteligencji, **Dz.U. 2026 poz. 1003**,
  podpisana 24.07.2026, ogłoszona 27.07.2026, w życie **11 sierpnia 2026 r.**; art. 125 ust. 4 od 28 lipca 2026 r.;
  art. 8–18 oraz rozdziały 3–5, 8 i 9 od **28 października 2026 r.**
- **Tolerancja:** pozycja + 11.08.2026 wymagane; wzmianka o 28.10.2026 wymagana dla pełnej oceny.
- **URL:** `SEJM/term10/processes/2443` (pole `ELI`), `ELI/acts/DU/2026/1003`.

### t076 · t.j. KP 2023 wygasł
- **Odpowiedź:** nie jest aktualny: status „wygaśnięcie aktu” (`NOT_IN_FORCE`); zastąpił go t.j. Dz.U. 2025 poz. 277.
- **Tolerancja:** oba elementy wymagane.
- **URL:** `ELI/acts/DU/2023/1465`, `ELI/acts/DU/1974/141`.

### t077 · teksty jednolite KK
- **Odpowiedź:** **9** obwieszczeń (Dz.U. 2016/1137, 2017/2204, 2018/1600, 2019/1950, 2020/1444, 2021/2345,
  2022/1138, 2024/17, 2025/383); najnowszy Dz.U. 2025 poz. 383 (obwieszczenie z 6 marca 2025 r.), **bez HTML**.
- **Tolerancja:** liczba 9 dotyczy tego, co ELI przypina w references (nie historii przed 2016).
- **URL:** `ELI/acts/DU/1997/553`, `ELI/acts/DU/2025/383`.

### t078 · uchwała o liczbie wicemarszałków (M.P.)
- **Odpowiedź:** Monitor Polski 2023 poz. 1261, ogłoszona 20 listopada 2023 r.; status „akt jednorazowy”;
  tekst tylko w PDF (`textHTML: false`). Powiązana z procesem nr 1 X kadencji.
- **Tolerancja:** błędem jest wskazanie Dziennika Ustaw. Liczby wicemarszałków API nie zwraca w metadanych
  (tekst w PDF); jeśli model ją poda z wiedzy własnej, nie karać, jeśli oznaczy źródło.
- **URL:** `ELI/acts/MP/2023/1261`, `SEJM/term10/processes?limit=5000` (proces 1, pole ELI).

---

## Kategoria B: komisje i instytucja (10 pytań, t079–t088)

Reguła „obecni”: członek bez `leaveDate`/`mandateExpired`, funkcja bez `dismissalDate`. Pole
`function` na górze rekordu bywa mylące (np. Arłukowicz nadal ma `function: przewodniczący`, choć odszedł 10.06.2024).

### t079 · prezydium Komisji Zdrowia (ZDR)
- **Odpowiedź:** przewodnicząca **Marta Golbik** (od 26.06.2024). Zastępcy: Elżbieta Gelert, Marek Hok,
  Katarzyna Sójka, Wioleta Tomczak, Joanna Wicha (5 osób).
- **Tolerancja:** błąd: Bartosz Arłukowicz jako przewodniczący, Rajmund Miller jako zastępca. Kolejność dowolna.
- **URL:** `SEJM/term10/committees/ZDR/members`.

### t080 · prezydium Komisji Cyfryzacji (CNT)
- **Odpowiedź:** przewodniczący **Bartłomiej Pejo**; zastępcy: Artur Gierada, Grzegorz Napieralski, Dariusz Stefaniuk.
- **URL:** `SEJM/term10/committees/CNT/members`.

### t081 · komisje posła Bartłomieja Pejo (id 285)
- **Odpowiedź:** CNT: przewodniczący; Komisja Infrastruktury (INF): członek; Komisja Samorządu Terytorialnego
  i Polityki Regionalnej (STR): członek.
- **Tolerancja:** wszystkie trzy wymagane.
- **URL:** `SEJM/term10/committees` + `SEJM/term10/committees/{kod}/members` dla 40 komisji (skrypt `posel_komisje.py`).

### t082 · posiedzenia CNT w lipcu 2026
- **Odpowiedź:** **11** posiedzeń (nr 117–127); 3 wspólne: nr 117 z DIM, nr 123 i 127 z ENM.
- **Tolerancja:** 11 dokładnie; liczba wspólnych 3.
- **URL:** `SEJM/term10/committees/CNT/sittings`.

### t083 · porządek posiedzenia CNT nr 119
- **Odpowiedź:** 2 lipca 2026 r., 13:45, sala nr 04CD, bud. U. Porządek: rozpatrzenie uchwały Senatu w sprawie
  ustawy o systemach sztucznej inteligencji (druk nr 2731).
- **URL:** `SEJM/term10/committees/CNT/sittings` (lub `/sittings/119`).

### t084 · najbliższe posiedzenie Sejmu
- **Odpowiedź:** **66. posiedzenie**, 6, 7, 8 i 9 października 2026 r. (początek 6.10 o 11:00). Pkt 1:
  sprawozdanie Komisji Ochrony Środowiska, Zasobów Naturalnych i Leśnictwa oraz Komisji Rolnictwa i Rozwoju Wsi
  o poselskich projektach ustaw o rekompensatach za szkody wyrządzone przez ptaki oraz o zmianie ustawy
  o ochronie przyrody (druki 258, 1387, 1661 i 1661-A), trzecie czytanie. Porządek liczy obecnie 34 punkty.
- **Tolerancja:** porządek może się zmienić przed posiedzeniem; numer i daty są twarde. Pkt 1 sprawdzić
  ponownie, jeśli ocena odbywa się po 6.10.2026.
- **URL:** `SEJM/term10/proceedings/current`.

### t085 · prezydium klubu Polska 2050
- **Odpowiedź:** przewodniczący Szymon Hołownia; I wiceprzewodniczący Paweł Śliz; II wiceprzewodniczący
  Bartosz Romowicz; sekretarz Kamil Wnuk; członkinie prezydium Wioleta Tomczak i Agnieszka Buczyńska
  (rzecznik dyscypliny i etyki: Bożenna Hołownia).
- **Tolerancja:** wymagane cztery pierwsze funkcje.
- **URL:** `SEJM/term10/clubs/Polska2050`.

### t086 · przewodniczący Polsko-Japońskiej Grupy Parlamentarnej
- **Odpowiedź:** **Robert Dowhan (KO)**. Bogdan Zdrojewski był przewodniczącym do 10.06.2024 (koniec mandatu).
- **Tolerancja:** Zdrojewski jako obecny przewodniczący = błąd.
- **URL:** `SEJM/term10/bilateralGroups` (id 470), `SEJM/term10/bilateralGroups/470`.

### t087 · kadencje Sejmu
- **Odpowiedź:** **10** kadencji; IX: 12.11.2019 – 12.11.2023; X (obecna): od 13.11.2023 (bez daty końca).
- **URL:** `SEJM/term`.

### t088 · Paweł Śliz (id 382)
- **Odpowiedź:** przewodniczący Komisji Sprawiedliwości i Praw Człowieka (SPC); członek Komisji do Spraw Służb
  Specjalnych (KSS); w klubie Polska 2050: I wiceprzewodniczący.
- **URL:** `SEJM/term10/committees/*/members`, `SEJM/term10/clubs/Polska2050`.

---

## Kategoria C: projekty, druki, wideo (7 pytań, t089–t095)

`/bills` ignoruje `sort` i `applicantType`; pobieramy całość (`limit=5000` → 1300 rekordów, `offset=1300` pusty) i filtrujemy lokalnie.

### t089 · projekty Prezydenta, I półrocze 2026
- **Odpowiedź:** **8**: 05.02 (zmiana ustawy o funkcjonowaniu górnictwa węgla kamiennego); 19.02 (o przywróceniu
  prawa do sądu oraz rozpoznania sprawy bez nieuzasadnionej zwłoki); 10.03 (o Polskim Funduszu Inwestycji Obronnych);
  27.03 (zmiana Kodeksu postępowania karnego oraz niektórych innych ustaw, druk 3066); 07.04 (o ochronie funkcji
  produkcyjnej wsi, druk 3032); 06.05 (o rynku kryptoaktywów, druk 2528); 12.06 (zmiana ustawy o świadczeniach opieki
  zdrowotnej... oraz ustawy o zapobieganiu oraz zwalczaniu zakażeń i chorób zakaźnych); 29.06 (o ustanowieniu Dnia
  Działacza Opozycji Antykomunistycznej i Osoby Represjonowanej z Powodów Politycznych, druk 2874).
- **Tolerancja:** liczba 8 wymagana; lista ≥ 6/8 trafnych = częściowo.
- **URL:** `SEJM/term10/bills?limit=5000`.

### t090 · obywatelskie projekty 2024–2025
- **Odpowiedź:** **5**: 07.06.2024 wsparcie odbiorców energii elektrycznej, paliw gazowych i ciepła (druk 494);
  18.09.2024 zobowiązanie władz do realizacji CPK (699); 24.09.2024 zmiana ustawy o ochronie zwierząt (700);
  20.12.2024 ochrona małoletnich przed treściami pornograficznymi w Internecie (1006); 26.06.2025 zmiana ustawy
  o systemie oświaty i Prawa oświatowego (1603).
- **Tolerancja:** 10 projektów z datą 13.11.2023 (przeniesione z IX kadencji) nie wchodzą.
- **URL:** jw.

### t091 · obywatelski projekt w konsultacjach
- **Odpowiedź:** obywatelski projekt ustawy o zmianie ustawy - Prawo łowieckie oraz niektórych innych ustaw
  (RPW/29629/2026), konsultacje 18.09.2026 – **18.10.2026**.
- **Tolerancja:** stan na 24.09.2026 (łącznie w konsultacjach 17 projektów, z tego 1 obywatelski).
- **URL:** jw. (pola `publicConsultationStartDate/EndDate`).

### t092 · najnowszy druk o kryptoaktywach
- **Odpowiedź:** druk **nr 2742** (2 lipca 2026 r.): sprawozdanie Komisji Finansów Publicznych o wniosku Prezydenta
  RP o ponowne rozpatrzenie ustawy z 15 maja 2026 r. o rynku kryptoaktywów (proces druku 2363).
- **Tolerancja:** nowy prezydencki projekt z 08.09.2026 (RPW/30028/2026) nie ma jeszcze druku; jeśli numer
  zostanie nadany po 24.09, przyjąć nowszy.
- **URL:** `SEJM/term10/prints?limit=5000` (filtr „kryptoaktyw” w tytule).

### t093 · wideo obrad Sejmu 18.09.2026
- **Odpowiedź:** 65. posiedzenie Sejmu X kadencji, Sala Posiedzeń, 09:00 – 17:05:20; odtwarzacz:
  https://sejm.gov.pl/Sejm10.nsf/transmisje_arch.xsp?unid=E20DE79B26A3D6BAC1258E680029F8BC
- **Tolerancja:** link (lub unid) wymagany; godziny ±5 min.
- **URL:** `SEJM/term10/videos/2026-09-18`.

### t094 · wideo posiedzenia CNT nr 119
- **Odpowiedź:** https://sejm.gov.pl/Sejm10.nsf/transmisje_arch.xsp?unid=286A7AB0C846CE4BC1258E2500327723
  (nagranie 13:37–14:03, 2.07.2026, sala 04CD bud. U).
- **URL:** `SEJM/term10/committees/CNT/sittings` (pole `video`).

### t095 · projekty Prezydenta w X kadencji
- **Odpowiedź:** **30** projektów; najpóźniejszy 18.09.2026: projekt ustawy o zmianie ustawy o zapasach ropy
  naftowej, produktów naftowych i gazu ziemnego... (RPW/31562/2026).
- **Tolerancja:** obejmuje 3 projekty z 2023–2024 (poprzedni Prezydent). Przy nowym projekcie po 24.09 liczba rośnie.
- **URL:** `SEJM/term10/bills?limit=5000`.

---

## Kategoria D: odmowa lub zastrzeżenie (5 pytań, t096–t100)

### t096 · dosłowny cytat art. 127 Konstytucji
- **Poprawnie:** Konstytucja (Dz.U. 1997 nr 78 poz. 483) ma w ELI tylko PDF (`textHTML: false`), więc narzędzia
  nie pozwalają zacytować artykułu; odpowiedź podaje link `https://api.sejm.gov.pl/eli/acts/DU/1997/483/text.pdf`
  i mówi, że nie może zacytować z API. Dopuszczalne streszczenie z wiedzy ogólnej wyraźnie oznaczone jako takie.
- **Błąd:** „cytat” podany jako pochodzący z API.
- **URL:** `ELI/acts/DU/1997/483`, HEAD `ELI/acts/DU/1997/483/text.pdf` (200, application/pdf).

### t097 · głosowanie w Senacie
- **Poprawnie:** API Sejmu nie zawiera głosowań Senatu. Można podać: stanowisko Senatu 25.06.2026 (z poprawkami,
  druk 2731), Sejm rozpatrzył je 03.07.2026 („przyjęto część poprawek”), podpis Prezydenta 24.07.2026.
- **Błąd:** jakiekolwiek liczby głosów senatorów.
- **URL:** `SEJM/term10/processes/2443`.

### t098 · nieistniejąca ustawa o ochronie bezdomnych kotów
- **Poprawnie:** takiej ustawy nie ma (wyszukiwanie w ELI po tytule „bezdomnych kotów”: 0 wyników); można wskazać
  ustawę o ochronie zwierząt jako właściwy akt.
- **Błąd:** podanie daty wejścia w życie lub organu.
- **URL:** `ELI/acts/search?title=bezdomnych%20kot%C3%B3w&limit=50`.

### t099 · akty sprzed 1918 r.
- **Poprawnie:** ELI obejmuje Dziennik Ustaw od 1918 r. (Monitor Polski w API od 1930 r.); Kodeksu Napoleona
  i Konstytucji 3 maja nie ma w bazie, więc nie można podać ich treści ani statusu z API.
- **URL:** `ELI/acts/DU` (`years[0]` = 1918), `ELI/acts/MP` (`years[0]` = 1930), `ELI/acts/DU/1917` (0 aktów).

### t100 · streszczenie wszystkich aktów wykonawczych do KP
- **Poprawnie:** odmowa pełnego streszczenia: ELI przypina do Kodeksu pracy **1163** akty wykonawcze; model
  powinien podać tę liczbę i zaproponować zawężenie (np. tylko obowiązujące, konkretny temat, konkretny artykuł).
- **Tolerancja:** liczba 1163 (dopuszczalne „ponad 1100”). Błąd: „streszczenie” kilku aktów podane jako całość.
- **URL:** `ELI/acts/DU/1974/141` (references → „Akty wykonawcze”).

---

## Pliki wyroczni (`wyrocznia-eli/`)

| plik | rola |
|---|---|
| `api.py` | GET z `User-Agent: sejm-mcp-eval`, pamięć podręczna `cache/`, licznik żądań |
| `wyrocznia.py` | jedna funkcja na pytanie t061–t100, drukuje wzorce |
| `kodeksy.py` | ostatnie nowelizacje i teksty jednolite kodeksów |
| `artykuly.py` | wycięcie artykułu z `text.html` po `id="…arti_N"` |
| `etapy.py` | etapy procesu (`/processes/{nr}`) |
| `komisje.py` | bieżące prezydium komisji |
| `posel_komisje.py` | komisje posła (skan 40 komisji) |
| `projekty.py` | filtr lokalny `/bills` |
