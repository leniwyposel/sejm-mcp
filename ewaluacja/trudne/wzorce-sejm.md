# Wzorce odpowiedzi: trudne pytania o Sejm (t001-t060)

Stan danych: 2026-09-24 (kadencja 10 od 2023-11-13; ostatnie zamknięte posiedzenie 65, 15-18 IX 2026;
posiedzenie 66 zaplanowane na 6-9 X 2026). Każda liczba wyliczona niezależnie z surowego API
skryptem `wyrocznia/wyrocznia.py` (`python3 wyrocznia.py t017` odtwarza jedną odpowiedź; `SEJM_NOCACHE=1`
pobiera dane od nowa). Baza URL: `https://api.sejm.gov.pl/sejm/`, poniżej skracana do `…/`.

Słownik głosu w API: `YES`, `NO`, `ABSTAIN`, `ABSENT` (nie głosował), `PRESENT` (obecny w głosowaniu
kworum), `VOTE_VALID` + `listVotes` (głosowanie na liście). API NIE ma pola „wynik”: rozstrzygnięcie
liczy się z `majorityType`/`majorityVotes` (zwykła: yes > no; pozostałe: yes >= majorityVotes;
kworum: yes = no = abstain = 0 i present > 0, czyli brak rozstrzygnięcia).

Zasada oceny ogólna: liczby mają się zgadzać co do sztuki, chyba że w tolerancji napisano inaczej.
Odpowiedź, która podaje prawidłowe liczby, ale błędne rozstrzygnięcie (np. „przyjęto” przy kworum albo
przy 3/5 nieosiągniętym), jest błędna.

---

## A. Wieloetapowe (15)

### t001 · wieloetapowe
**Odpowiedź:** Mateusz Morawiecki (klub RozwojPlus) **nie głosował** (ABSENT). Głosowanie 65/10
(17 IX 2026, ponowne uchwalenie ustawy o statusie osoby najbliższej, druki 2863 i 3110): 232 za,
199 przeciw, 0 wstrzymujących, 29 nie głosowało; wymagana większość 3/5 = 259. **Weto nie zostało
odrzucone** (ustawa nie uchwalona ponownie).
**Tolerancja:** brak. Odpowiedź „głosował przeciw/za” = błąd.
**URL:** `…/term10/votings/65`, `…/term10/votings/65/10`, `…/term10/MP`

### t002 · wieloetapowe
**Odpowiedź:** najwięcej niegłosujących miał **PiS: 15** (131 przeciw). Dalej KO 6, Lewica 5,
Polska2050 3, RozwojPlus 2, Demokracja 1, PSL-TD 1. Wynik 65/99 (18 IX 2026, druki 671, 2881, 2881-A):
223 za, 197 przeciw, 7 wstrz., 33 nie głosowało; **ustawa uchwalona**.
**Tolerancja:** brak.
**URL:** `…/term10/votings/65`, `…/term10/votings/65/99`

### t003 · wieloetapowe
**Odpowiedź:** **Wiesław Różyński** (PSL-TD), sprawozdawca Komisji Edukacji i Nauki (wystąpienie nr 45,
18 IX 2026). Nad całością (65/99) głosował **za**. Wynik: 223/197/7, przyjęto.
**Tolerancja:** wystarczy nazwisko, klub i głos.
**URL:** `…/term10/proceedings/65/2026-09-18/transcripts` (pole `rapporteur: true`),
`…/term10/proceedings/65/2026-09-18/transcripts/45`, `…/term10/votings/65/99`

### t004 · wieloetapowe
**Odpowiedź:** Horała (wystąpienie nr 5, 16 IX 2026) mówił w pierwszym czytaniu **rządowego projektu
ustawy o podatku od nadzwyczajnych zysków osiągniętych w okresie od marca do grudnia 2026 r. ze zbycia
paliw ciekłych (druk 3100)**. W głosowaniu nad całością 65/115 (18 IX 2026) głosował **przeciw**
(klub RozwojPlus). Sejm projekt **przyjął**: 237 za, 202 przeciw, 1 wstrz.
**Tolerancja:** skrót „podatek od nadzwyczajnych zysków paliwowych / windfall tax od paliw” akceptowalny.
**URL:** `…/term10/proceedings/65/2026-09-16/transcripts`, `…/term10/proceedings/65/2026-09-16/transcripts/5`,
`…/term10/votings/65/115`, `…/term10/prints/3100`

### t005 · wieloetapowe
**Odpowiedź:** druk 2110 wpłynął 30 XII 2025. I czytanie 13 II 2026: wniosek o odrzucenie (51/72)
**199 za, 233 przeciw, 3 wstrz.** (odrzucony). III czytanie **29 V 2026**: uchwalona (58/62)
**230 za, 198 przeciw, 1 wstrz.** Stanowisko Senatu 25 VI, do prezydenta 26 VI 2026. **Weto
17 VII 2026** (druk 2863). Głosowanie nad wetem **17 IX 2026** (65/10): **232 za, 199 przeciw,
0 wstrz.**, wymagane 3/5 = 259 → **nie uchwalona ponownie** (proces zakończony, `passed: false`).
**Tolerancja:** można pominąć datę Senatu; kluczowe: 230/198/1, weto 17 VII, 232 < 259, weto utrzymane.
**URL:** `…/term10/processes/2110`, `…/term10/votings/51/72`, `…/term10/votings/58/62`, `…/term10/votings/65/10`

### t006 · wieloetapowe (ON_LIST)
**Odpowiedź:** wybrany **Marcin Horała** – 254 głosy; Marcin Ociepa 167; 7 głosów przeciw wszystkim;
wymagana bezwzględna większość 215 (głosowało 428). Horała zagłosował **na siebie** (Horała YES,
Ociepa NO). Głosowanie 65/22, 18 IX 2026.
**Tolerancja:** brak.
**URL:** `…/term10/votings/65/22`

### t007 · wieloetapowe
**Odpowiedź:** **Katarzyna Kierzek-Koperska** (KO), sprawozdawczyni Komisji do Spraw Deregulacji oraz
Komisji Polityki Społecznej i Rodziny (wystąpienie nr 44, 18 IX 2026). Głosowała **za**. Klub KO:
146 za, 4 przeciw, 6 nie głosowało. Całość (65/82): 252 za, 148 przeciw, 40 wstrz. – **przyjęto**.
(Pytanie używa skrótu ZUS, tytuł brzmi „…należności dochodzonych przez Zakład Ubezpieczeń Społecznych
powstałych przed dniem 1 stycznia 1999 r.”, druki 3010, 3055, 3055-A.)
**Tolerancja:** brak. (Sprawozdawczyni zabrała głos także 15 IX i 17 IX – to też ona.)
**URL:** `…/term10/proceedings/65/2026-09-18/transcripts`, `…/transcripts/44`, `…/term10/votings/65/82`

### t008 · wieloetapowe (były poseł)
**Odpowiedź:** Łukasz Litewka (Lewica, okręg 32 Katowice) – mandat wygasł **23 IV 2026** (zgon). Jedyną
osobą, która złożyła ślubowanie w okręgu 32 po tej dacie, jest **Bożena Borowiec** (Lewica,
ślubowanie **15 V 2026**). 17 IX 2026 (65/10) głosowała **za** ponownym uchwaleniem.
**Tolerancja:** API nie zapisuje wprost „kto kogo zastąpił”; odpowiedź powinna przyznać, że to wniosek
z okręgu i dat (albo ze źródeł pozasejmowych). Kluczowe: Borowiec, 15 V 2026, za.
**URL:** `…/term10/MP/215`, `…/term10/MP`, `…/term10/MP/499`, `…/term10/votings/65/10`

### t009 · wieloetapowe
**Odpowiedź:** Konfederacja (16 posłów): **10 za, 1 przeciw (Przemysław Wipler), 1 wstrz. (Michał
Połuboczek), 4 nie głosowało (Konrad Berkowicz, Karina Bosak, Sławomir Mentzen, Krzysztof Mulawa)**.
Wynik 65/12: 422 za, 3 przeciw, 5 wstrz.; wymagana bezwzględna większość ustawowej liczby posłów (231) →
**zgoda wyrażona**.
**Tolerancja:** nazwiska nieobecnych mogą zostać pominięte, jeśli liczby są dobre; Wipler i Połuboczek wymagani.
**URL:** `…/term10/votings/65/12`

### t010 · wieloetapowe (ON_LIST)
**Odpowiedź:** wybrany **Maciej Berek** – 226 głosów (próg 219, bezwzględna większość przy 437 głosujących);
Artur Kotowski 184; 27 przeciw wszystkim. Szymon Hołownia głosował **na Berka** (przeciw Kotowskiemu).
Głosowanie 64/14, 4 IX 2026.
**Tolerancja:** brak.
**URL:** `…/term10/votings/64`, `…/term10/votings/64/14`

### t011 · wieloetapowe
**Odpowiedź:** interpelacja **nr 5561** (wpłynęła 17 X 2024), adresat: **minister infrastruktury**,
przesłana 21 X 2024 → termin 11 XI 2024. Odpowiedź: **sekretarz stanu Stanisław Bukowiec**, data
wpływu **3 VIII 2025** → **265 dni po terminie** (286 dni od przesłania).
**Tolerancja:** ±1 dzień w liczeniu opóźnienia (konwencja liczenia dnia granicznego). Uwaga: pole
Sejmu `answerDelayedDays` pokazuje 0 (licznik zeruje się po odpowiedzi) – odpowiedź „0 dni opóźnienia”
jest błędna.
**URL:** `…/term10/interpellations?from=286&limit=500`, `…/term10/interpellations/5561`

### t012 · wieloetapowe (zmiana klubu)
**Odpowiedź:** **Maja Ewa Nowak** (wystąpienie nr 35, 18 IX 2026, Komisja Polityki Społecznej i Rodziny).
W listopadzie 2023 (np. głosowanie 1/27, 28 XI 2023) klub **Polska2050-TD**; teraz **Polska2050**
(koło/klub Polska 2050). Całość (65/68): **443 za, 0 przeciw, 0 wstrz.** – przyjęto jednogłośnie; ona za.
**Tolerancja:** „Trzecia Droga / Polska 2050” dla 2023 akceptowalne.
**URL:** `…/term10/proceedings/65/2026-09-18/transcripts`, `…/transcripts/35`, `…/term10/votings/1/27`,
`…/term10/votings/65/68`, `…/term10/MP`

### t013 · wieloetapowe
**Odpowiedź:** Bożenna Hołownia (Polska2050) mówiła 16 IX 2026 (wystąpienie nr 90) o rządowym projekcie
**ustawy o szczególnych rozwiązaniach związanych z organizacją XXVI Światowego Jamboree Skautowego
w Polsce w 2027 r.** (druki 2846 i 3024). Nad całością (65/86, 18 IX) głosowała **za**; wynik
411 za, 23 przeciw, 0 wstrz. – przyjęto.
**Tolerancja:** nie wolno pomylić z Szymonem Hołownią (on tego dnia nie przemawiał).
**URL:** `…/term10/proceedings/65/2026-09-16/transcripts`, `…/transcripts/90`, `…/term10/votings/65/86`

### t014 · wieloetapowe
**Odpowiedź:** **dwa razy**: (1) **15 IX 2026** ok. 11:29 (wyst. nr 14) – żądanie zwołania posiedzenia
w trybie niejawnym w sprawie zagrożeń bezpieczeństwa (informacje premiera od szefa CIA; ochrona portów,
lotnisk, gotowość wojska); (2) **18 IX 2026** ok. 09:13 (wyst. nr 2) – apel o poszerzenie Prezydium
o dwa miejsca wicemarszałków dla dwóch dodatkowych klubów przed wyborem wicemarszałka. 16 i 17 IX nie
przemawiał.
**Tolerancja:** streszczenia swobodne; liczba (2) i daty obowiązkowe.
**URL:** `…/term10/proceedings/65/{2026-09-15,16,17,18}/transcripts`, `…/2026-09-15/transcripts/14`,
`…/2026-09-18/transcripts/2`

### t015 · wieloetapowe
**Odpowiedź:** **RozwojPlus**: 39 wstrzymało się, 2 nie głosowało, 0 za, 0 przeciw. Mateusz Morawiecki
**wstrzymał się** (ABSTAIN). (Dla porównania PiS 140 przeciw, 6 nieobecnych.) Wynik 65/82: 252/148/40, przyjęto.
**Tolerancja:** brak.
**URL:** `…/term10/votings/65/82`

---

## B. Pułapki reguł (12)

### t016 · pułapka: kworum
**Odpowiedź:** głosowanie 65/3 (15 IX 2026, 11:22) to **głosowanie kworum**: 0 za, 0 przeciw,
0 wstrz., **402 obecnych**, 58 nie głosowało. **Nie było wniosku do przyjęcia ani odrzucenia** –
sprawdzano obecność; kworum (230) stwierdzone.
**Tolerancja:** „przyjęto”/„odrzucono” = błąd.
**URL:** `…/term10/votings/65/3`

### t017 · pułapka: kworum
**Odpowiedź:** 54/22 (27 III 2026) to **głosowanie kworum**: **0 za**, 0 przeciw, 0 wstrz.,
**263 obecnych**, 197 nie wzięło udziału. Sejm niczego nie przyjął; kworum (230) było.
**Tolerancja:** brak.
**URL:** `…/term10/votings/54`, `…/term10/votings/54/22`

### t018 · pułapka: 3/5
**Odpowiedź:** **Nie.** 65/11: 232 za, 200 przeciw, 0 wstrz. (432 głosujących); wymagana większość
3/5 = **260**. Weto utrzymane, ustawa nie uchwalona ponownie.
**URL:** `…/term10/votings/65/11`

### t019 · pułapka: bezwzględna większość ustawowa
**Odpowiedź:** **Nie.** 59/51 (11 VI 2026): 227 za, 210 przeciw, 2 wstrz.; wymagane **231** głosów
(bezwzględna większość ustawowej liczby posłów). Wniosek Komendanta Głównego Policji (druk 2615)
nie uzyskał zgody, mimo że „za” było więcej niż „przeciw”.
**URL:** `…/term10/votings/59`, `…/term10/votings/59/51`

### t020 · pułapka: 3/5
**Odpowiedź:** W głosowaniu 1/27 **nie**: 246 za, 202 przeciw, 0 wstrz., wymagana większość 3/5 = **269**.
Ale to samo powołanie głosowano zaraz potem ponownie (1/29, większość zwykła, próg 203): 246/202/0, **przyjęto**.
(Poprawka wzorca 2026-09-24 po ocenie runda 2: pierwotny wzorzec pomijał 1/29.)
**Tolerancja:** „nie” bez wzmianki o 1/29 = odpowiedź częściowa; „tak” przez 1/29 z progiem 203 = poprawne,
jeśli wspomina, że pierwsze głosowanie (3/5) nie przeszło.
**URL:** `…/term10/votings/1/27`, `…/term10/votings/1/29`

### t021 · pułapka: 3/5 (weto)
**Odpowiedź:** **Nie.** 46/75 (5 XII 2025; ustawa z 7 XI 2025 o rynku kryptoaktywów, druki 2048 i 2059):
243 za, 192 przeciw, 0 wstrz.; wymagane 3/5 = **261**. Weto utrzymane.
**Tolerancja:** dopuszczalna wzmianka o drugim wecie (ustawa z 15 V 2026, głosowanie 64/15 4 IX 2026,
241 < 266) – ale pytanie dotyczy grudnia 2025.
**URL:** `…/term10/votings/46`, `…/term10/votings/46/75`

### t022 · pułapka: ON_LIST
**Odpowiedź:** próg 229 (bezwzględna większość, 457 głosujących). **Wybrani (4): Kamila Gasiuk-Pihowicz
246, Tomasz Zimoch 246, Anna Maria Żukowska 245, Robert Kropiwnicki 243.** Niewybrani: Marek Ast 193,
Arkadiusz Mularczyk 192, Kazimierz Smoliński 192, Bartosz Kownacki 191. 18 głosów przeciw wszystkim.
Głosowanie 1/13.
**Tolerancja:** brak.
**URL:** `…/term10/votings/1/13`

### t023 · pułapka: zmiana klubu
**Odpowiedź:** w dniu głosowania 65/10 Skwarek był w klubie **RozwojPlus** i głosował **przeciw**.
Według aktualnej listy posłów należy do **PiS**.
**Tolerancja:** jeśli odpowiedź podaje tylko dzisiejszy klub jako klub z dnia głosowania = błąd.
Stan „dziś” z `…/term10/MP` na 2026-09-24; gdyby się zmienił, liczy się klub z listy w chwili oceny.
**URL:** `…/term10/votings/65/10`, `…/term10/MP`, `…/term10/MP/343`

### t024 · pułapka: zmiana klubu
**Odpowiedź:** 28 XI 2023 (1/27) Petru był w klubie **Polska2050-TD** i głosował **za**; obecnie klub
**Centrum**.
**Tolerancja:** głosowanie 1/29 (to samo powołanie, większość zwykła) jest równie poprawne jak 1/27.
**URL:** `…/term10/votings/1/27`, `…/term10/MP`

### t025 · pułapka: były poseł
**Odpowiedź:** **Nie głosował – nie był już posłem.** Mandat Borysa Budki wygasł **10 VI 2024**
(wybór do Parlamentu Europejskiego); nie ma go na liście głosujących 16/12. (Wynik: 242 za, 202 przeciw,
0 wstrz. – przyjęto.)
**Tolerancja:** „nieobecny/ABSENT” bez wyjaśnienia o wygaśnięciu mandatu = odpowiedź częściowo błędna.
**URL:** `…/term10/MP/38`, `…/term10/votings/16/12`

### t026 · pułapka: prolongata to nie odpowiedź
**Odpowiedź:** **Nie – brak odpowiedzi merytorycznej.** Interpelacja 18544 (Jarosław Sachajko) do
ministra rodziny, pracy i polityki społecznej, przesłana **16 VII 2026**, termin 6 VIII 2026. Są
**trzy informacje o przedłużeniu terminu** (3 VIII 2026 – Katarzyna Nowakowska; 31 VIII i 22 IX 2026 –
Monika Sikora), żadnej odpowiedzi. Na 24 IX 2026: **49 dni po terminie** (licznik Sejmu też 49).
**Tolerancja:** liczba dni rośnie o 1 dziennie (±1 za konwencję); jeśli po 24 IX wpłynie odpowiedź,
wzorzec do aktualizacji. Stwierdzenie „odpowiedziano 3 VIII” = błąd.
**URL:** `…/term10/interpellations?limit=500&offset=1000&sort_by=-num`, `…/term10/interpellations/18544`

### t027 · pułapka: wielu adresatów
**Odpowiedź:** **Nie.** Adresaci: minister finansów i gospodarki oraz minister rodziny, pracy i polityki
społecznej (obu przesłano 12 IX 2025). Jedyna odpowiedź merytoryczna: **15 I 2026, podsekretarz stanu
Katarzyna Nowakowska (MRPiPS)**, poprzedzona **czterema** prolongatami MRPiPS (14 X, 3 XI, 21 XI 2025,
9 I 2026). **Od ministra finansów i gospodarki brak odpowiedzi** w API.
**Tolerancja:** odpowiedź musi rozróżnić adresatów; „odpowiedziano” bez tego = błąd.
**URL:** `…/term10/interpellations?from=445&limit=500`, `…/term10/interpellations/12176`

---

## C. Agregacje (10)

### t028 · agregacja
**Odpowiedź:** 65. posiedzenie: **147 głosowań**. Głosowań nad całością projektu: **29** – **18 ustaw**
(nr 68, 82-88, 99, 108, 109, 115, 125, 132, 140-143) i **11 uchwał / innych** (nr 13, 20, 133-139, 145, 147).
Przyjęto **wszystkie 29**.
**Tolerancja:** ±0 dla 147 i 29; podział ustawy/uchwały ±1 (głosowanie 132 i 145 bywają różnie klasyfikowane).
**URL:** `…/term10/votings/65`

### t029 · agregacja
**Odpowiedź:** Polska2050 (15): **12 za, 2 przeciw (Szymon Hołownia, Paweł Śliz), 1 nie głosował
(Agnieszka Buczyńska)**. Wynik ogółem: 422/3/5, zgoda wyrażona.
**URL:** `…/term10/votings/65/12`

### t030 · agregacja (interpelacje, termin)
**Odpowiedź:** **10 interpelacji** (8 jako jedyny autor, 2 współautorskie: 5955, 5971). Po terminie
(21 dni od `recipientDetails[].sent`): **3** – **5561** (265 dni), **5971** (11 dni; prolongata
29 XI 2024 nie jest odpowiedzią, odpowiedź 9 XII 2024), **9733** (6 dni). Bez odpowiedzi: 0.
**Tolerancja:** ±1 dzień na każdym opóźnieniu. Pisemnych zapytań Petru nie ma (0), nie mylić.
Liczby mogą wzrosnąć, jeśli poseł złoży nowe interpelacje.
**URL:** `…/term10/interpellations?from=286&limit=500`, `…/term10/writtenQuestions?from=286&limit=500`

### t031 · agregacja (statystyki Sejmu)
**Odpowiedź:** Jarosław Kaczyński: **1065 opuszczonych głosowań** (suma `numMissed`, z 4714 w 163 dniach
posiedzeń do 18 IX 2026); dni z co najmniej jednym opuszczonym głosowaniem: **81**; dni oznaczonych
`absenceExcuse = true`: **42** (39 dni z opuszczeniami bez usprawiedliwienia).
**Tolerancja:** zmienia się dopiero po 66. posiedzeniu lub przy wstecznym usprawiedliwieniu.
**URL:** `…/term10/MP/148/votings/stats`

### t032 · agregacja (statystyki Sejmu)
**Odpowiedź:** Sławomir Skwarek: **146 opuszczonych głosowań**, 31 dni z opuszczeniami,
**5 dni usprawiedliwionych** (26 nieusprawiedliwionych).
**Tolerancja:** jak t031.
**URL:** `…/term10/MP/343/votings/stats`

### t033 · agregacja
**Odpowiedź:** 64. posiedzenie (2-4 IX 2026): **65 głosowań**; większości 3/5 wymagało **1**: nr 15
(wniosek prezydenta o ponowne rozpatrzenie ustawy o rynku kryptoaktywów) – 241 za, 198 przeciw,
3 wstrz., próg 266 → **weto nieodrzucone**. (Pozostałe: 44 zwykła, 20 bezwzględna.)
**URL:** `…/term10/votings/64`

### t034 · agregacja (kworum)
**Odpowiedź:** **2** głosowania kworum: nr **3** (15 IX 2026) – **402** obecnych; nr **16** (18 IX 2026) –
**441** obecnych.
**URL:** `…/term10/votings/65`

### t035 · agregacja
**Odpowiedź:** koło **Razem – 4 posłów**: Maciej Konieczny, Adrian Zandberg, Marcelina Zawisza,
Marta Stożek.
**Tolerancja:** stan na 2026-09-24.
**URL:** `…/term10/clubs`, `…/term10/MP` (ew. `…/term10/clubs/Razem`)

### t036 · agregacja
**Odpowiedź:** **167** interpelacji z Zawiszą w polu `from`; jako jedyna autorka **101**; do więcej niż
jednego adresata **14** (4060, 4637, 4638, 6746, 12168, 12169, 12174, 12175, 12176, 12369, 12789, 12829,
14192, 15559).
**Tolerancja:** liczby mogą wzrosnąć przy nowych interpelacjach (±2).
**URL:** `…/term10/interpellations?from=445&limit=500`

### t037 · agregacja (podział klubów, 3/5)
**Odpowiedź:** 64/15 (4 IX 2026): 241 za, 198 przeciw, 3 wstrz., 18 nie głosowało; próg 3/5 = 266 →
**weto nie zostało odrzucone**. Kluby: KO 156 za; PSL-TD 31 za (1 nieob.); Lewica 21 za; Polska2050
14 za (1 nieob.); Centrum 13 za (2 nieob.); Razem 3 za (1 nieob.); PiS 141 przeciw (5 nieob.);
RozwojPlus 38 przeciw (3 nieob.); Konfederacja 15 przeciw (1 nieob.); Demokracja 3 przeciw (1 nieob.);
Konfederacja_KP 2 wstrz. (1 nieob.); niezrzeszeni 3 za, 1 przeciw, 1 wstrz., 2 nieob.
**Tolerancja:** brak dla wyniku; drobne pominięcie małych kół dopuszczalne.
**URL:** `…/term10/votings/64/15`

---

## D. Starsze kadencje (8)

### t038 · kadencja 8
**Odpowiedź:** **Marek Kuchciński** – 409 głosów; Kornel Morawiecki 42; 7 przeciw wszystkim
(12 XI 2015, głosowanie 1/1, próg 230).
**URL:** `…/term8/votings/1`, `…/term8/votings/1/1`

### t039 · kadencja 8
**Odpowiedź:** 22 XII 2015 (głosowanie 6/68): **235 za, 181 przeciw, 4 wstrz.** – uchwalono.
Paweł Kukiz **przeciw**. Kukiz'15: 34 przeciw, 2 za, 2 wstrz., 2 nie głosowało.
**URL:** `…/term8/proceedings`, `…/term8/votings/6`, `…/term8/votings/6/68`

### t040 · kadencja 9
**Odpowiedź:** 11 VIII 2021 (głosowanie 36/121): **228 za, 216 przeciw, 10 wstrz.** – uchwalono.
Jarosław Gowin (klub PiS) **przeciw**; Paweł Kukiz (Kukiz15) **za**.
**URL:** `…/term9/proceedings`, `…/term9/votings/36`, `…/term9/votings/36/121`

### t041 · kadencja 7
**Odpowiedź:** **Ewa Kopacz** – 300 głosów; Marek Kuchciński 150; 3 przeciw wszystkim (8 XI 2011,
głosowanie 1/2, próg 227). Donald Tusk głosował **na Ewę Kopacz**.
**URL:** `…/term7/votings/1`, `…/term7/votings/1/2`

### t042 · kadencja 9
**Odpowiedź:** 12 XI 2019 (głosowanie 1/1): **314 za, 11 przeciw, 134 wstrz.** (próg 230).
**URL:** `…/term9/votings/1/1`

### t043 · kadencja 9
**Odpowiedź:** 20 XII 2019 (głosowanie 2/151): **233 za, 205 przeciw, 10 wstrz.** – uchwalono.
Jarosław Gowin **za**.
**URL:** `…/term9/votings/2`, `…/term9/votings/2/151`

### t044 · kadencja 7
**Odpowiedź:** według `…/term7/clubs`: **PO 196**, **PiS 134** (stan końcowy kadencji w API;
na początku kadencji było inaczej – odpowiedź może to zaznaczyć).
**Tolerancja:** podanie wyników wyborczych 2011 (PO 207, PiS 157) bez zastrzeżenia = błąd.
**URL:** `…/term7/clubs`

### t045 · kadencja 8
**Odpowiedź:** **Joachim Brudziński** – 330 za, 75 przeciw, 40 wstrz. (12 XI 2015, głosowanie 1/4,
próg 223).
**URL:** `…/term8/votings/1`

---

## E. Dwuznaczne sformułowania (8)

### t046 · dwuznaczne (dwoje Hołowniów)
**Odpowiedź:** w Sejmie jest dwoje posłów o tym nazwisku (oboje Polska2050) i głosowali **różnie**:
**Szymon Hołownia – przeciw**, **Bożenna Hołownia – za** (65/12; wynik 422/3/5, zgoda wyrażona).
**Tolerancja:** odpowiedź o jednej osobie bez zaznaczenia drugiej = błąd.
**URL:** `…/term10/MP`, `…/term10/votings/65/12`

### t047 · dwuznaczne (dwóch Królów)
**Odpowiedź:** dwóch posłów: **Piotr Król (PiS) – za**; **Wojciech Król (KO, którego wniosek dotyczył) –
nie głosował**. Wynik 422/3/5, zgoda wyrażona.
**URL:** `…/term10/MP`, `…/term10/votings/65/12`

### t048 · dwuznaczne (data względna, „wczoraj” = 23 IX 2026)
**Odpowiedź:** **żadnych** – 23 IX 2026 nie było posiedzenia Sejmu. Ostatnie posiedzenie (65.) trwało
15-18 IX 2026 (147 głosowań); następne (66.) zaplanowano na 6-9 X 2026.
**Tolerancja:** podanie wyników z 18 IX jako „wczorajszych” = błąd.
**URL:** `…/term10/proceedings`

### t049 · dwuznaczne („ostatnie posiedzenie”)
**Odpowiedź:** ostatnie odbyte to **65. posiedzenie, 15, 16, 17 i 18 IX 2026**: **147 głosowań**
(15 IX: 4, 16 IX: 2, 17 IX: 7, **18 IX: 134**). Posiedzenie 66 (6-9 X) jest oznaczone w API jako
`current`, ale jeszcze się nie odbyło.
**Tolerancja:** wskazanie 66. posiedzenia = błąd.
**URL:** `…/term10/proceedings`, `…/term10/votings/65`

### t050 · dwuznaczne (skrót KRS)
**Odpowiedź:** 23 I 2026, rządowy projekt ustawy o zmianie ustawy o Krajowej Radzie Sądownictwa oraz
ustawy – Kodeks wyborczy (druki 2108, 2177), głosowanie 50/104: **232 za, 183 przeciw, 12 wstrz.** –
uchwalono. Konfederacja: **8 przeciw, 5 wstrz., 3 nie głosowało**.
**Tolerancja:** wzmianka o innej noweli KRS (12 IV 2024, 244/199/0) mile widziana, ale nie zamiast tej.
**URL:** `…/term10/votings/50`, `…/term10/votings/50/104`

### t051 · dwuznaczne (skrót TK)
**Odpowiedź:** 24 VII 2024, poselski projekt ustawy o Trybunale Konstytucyjnym (druki 253, 543, 543-A),
głosowanie 16/12: **242 za, 202 przeciw, 0 wstrz.** – uchwalono. PiS: **180 przeciw, 10 nie głosowało**.
(Tego samego dnia 16/15 – Przepisy wprowadzające ustawę o TK – 242/200/0.)
**URL:** `…/term10/votings/16`, `…/term10/votings/16/12`

### t052 · dwuznaczne (bez polskich znaków)
**Odpowiedź:** Paulina **Hennig-Kloska** – **za** (65/10); klub **Centrum** (także w dniu głosowania;
w 2023 była w Polska2050-TD). Wynik 232/199/0 < 259 – weto utrzymane.
**URL:** `…/term10/MP`, `…/term10/votings/65/10`

### t053 · dwuznaczne (dwóch Kaczyńskich, bez znaków)
**Odpowiedź:** dwóch posłów PiS: **Filip Kaczyński** głosował na **Adama Borowskiego** (przeciw
Gregorczyk-Abram); **Jarosław Kaczyński nie głosował**. RPO została **Sylwia Gregorczyk-Abram**:
233 głosy (próg 217), Adam Borowski 177, 23 przeciw wszystkim (62/110, 17 VII 2026).
**URL:** `…/term10/MP`, `…/term10/votings/62/110`

---

## F. Odmowa lub kwalifikacja (7)

### t054 · odmowa/kwalifikacja
**Wzorzec:** API nie ma endpointu rankingowego; ranking wymaga ok. 460 wywołań
`…/term10/MP/{id}/votings/stats` (po jednym na posła). Poprawna odpowiedź: mówi to wprost, **nie
wymyśla** kolejności ani liczb, proponuje alternatywę (sprawdzenie konkretnych posłów, jednego
klubu, jednego głosowania lub posiedzenia). Podanie „rankingu” z kilku posłów jako pełnego = błąd.
**URL:** `…/term10/MP`, `…/term10/MP/{id}/votings/stats`

### t055 · odmowa/kwalifikacja
**Wzorzec:** API nie ma pola płci (pola MP: imiona, nazwisko, klub, okręg, daty, wykształcenie itd.).
Poprawna odpowiedź: mówi, że dokładnej liczby z API nie da się podać; ewentualne szacunki po imionach
lub po formie `accusativeName`/`genitiveName` musi oznaczyć jako przybliżenie z heurystyki. Twarda
liczba podana jako fakt z API = błąd.
**URL:** `…/term10/MP`

### t056 · odmowa/kwalifikacja
**Wzorzec:** odmowa oceny („leniwy” to opinia, nie fakt z API). Dopuszczalne i pożądane: fakty ze
statystyk Sejmu – 1065 opuszczonych głosowań z 4714, 81 dni z opuszczeniami, 42 dni usprawiedliwione
(jak t031) – bez wartościującego werdyktu.
**URL:** `…/term10/MP/148/votings/stats`

### t057 · nie istnieje
**Wzorzec:** **takie głosowanie nie istnieje** – na 1. posiedzeniu 10. kadencji odbyło się 147 głosowań
(`…/term10/votings/1/999` zwraca 404). Żadnych wymyślonych wyników.
**URL:** `…/term10/votings/1`, `…/term10/votings/1/999`

### t058 · przyszłość
**Wzorzec:** 66. posiedzenie jest zaplanowane na **6-9 X 2026** i jeszcze się nie odbyło; nie ma
głosowań (`…/term10/votings/66` = pusta lista), więc nie ma wyników. Można podać porządek dzienny
jako plan. Podanie „uchwalonych ustaw” = błąd.
**URL:** `…/term10/proceedings`, `…/term10/votings/66`

### t059 · nie istnieje
**Wzorzec:** Jarosław Kaczyński **nie zabierał głosu** 17 IX 2026 – ani w żadnym innym dniu
65. posiedzenia (15-18 IX): brak jego wypowiedzi w stenogramach. Żadnego wymyślonego cytatu.
**URL:** `…/term10/proceedings/65/2026-09-17/transcripts` (oraz 15, 16, 18 IX)

### t060 · nie istnieje
**Wzorzec:** interpelacja nr 99999 **nie istnieje** (404); najwyższy numer w 10. kadencji na
24 IX 2026 to ok. 20020. Żadnych wymyślonych treści.
**Tolerancja:** najwyższy numer rośnie codziennie – podanie go nie jest wymagane.
**URL:** `…/term10/interpellations/99999`, `…/term10/interpellations?limit=500&sort_by=-num`
