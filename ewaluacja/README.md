# Ewaluacja na prawdziwym modelu

Testy w `testy/` sprawdzają, czy narzędzia liczą dobrze. Ta ewaluacja sprawdza coś innego:
czy model, który widzi tylko opisy narzędzi, wybierze właściwe i poda poprawną odpowiedź.

Każde pytanie idzie do osobnej sesji `claude -p` z tym jednym serwerem MCP i bez innych
narzędzi (bez powłoki, plików i sieci), więc model dociera do Sejmu wyłącznie przez sejm-mcp.

```bash
npm run build
./ewaluacja/uruchom.sh                          # 25 pytań podstawowych, Haiku
./ewaluacja/uruchom.sh sonnet . trudne          # 100 trudnych pytań, Sonnet
python3 ewaluacja/raport.py [trudne]            # raport z wywołaniami i odpowiedziami
```

Wyniki i raporty trafiają do `wyniki/` i `raport.md`, których nie ma w repozytorium.

## Zestawy

- `pytania.tsv`: 25 pytań podstawowych, odpowiedzi wzorcowe niżej.
- `trudne/pytania.tsv`: 100 pytań zbudowanych tak, żeby łapały typowe błędy (imiennicy,
  weto i próg 3/5, klub z dnia głosowania, termin od doręczenia, tekst jednolity).
  Odpowiedzi wzorcowe są w `trudne/wzorce-sejm.md` i `trudne/wzorce-eli.md`, policzone
  niezależnie od sejm-mcp skryptami z `trudne/wyrocznia/` i `trudne/wyrocznia-eli/`
  (Python, prosto z API).

Liczby rosną z każdym posiedzeniem: wzorce sprawdzono 24 września 2026 r. i po nowych
posiedzeniach trzeba je przeliczyć wyroczniami.

## Wyniki na 100 trudnych pytaniach

Poprawne / częściowe / błędne według niezależnych oceniających z kluczem odpowiedzi.

| Wersja | Haiku 4.5 | Sonnet | Porażki z winy serwera |
|---|---|---|---|
| pierwsza z 28 narzędziami | 80/14/6 | | 18 |
| po dwóch rundach poprawek | 90/9/1 | | 3 |
| z gotowym zdaniem `odpowiedz` i polem `niejednoznaczne` | 92/6/2 | 95/4/1 | 2 (Haiku), 1 (Sonnet) |

Pozostałe błędy to nawyki modelu: dopisywanie liczb i dat spoza wyników, pomijanie drugiego
posła o tym samym nazwisku mimo ostrzeżenia. Osobny skill z regułami odpowiadania nie dał
mierzalnej poprawy (90/8/2 bez niego, 87/10/3 z nim), więc reguły są w opisach narzędzi.

## Odpowiedzi wzorcowe dla 25 pytań podstawowych

| Pytanie | Poprawna odpowiedź |
|---|---|
| q01 | Głosowanie 3/15 z 18.01.2024 (całość projektu), głos **za**; klub w dniu głosowania Polska2050-TD. Nowelizacje budżetu 2024 to inne ustawy. |
| q02 | Statystyka Sejmu: 436 opuszczonych z 4714; 43 dni z nieobecnością, 15 usprawiedliwionych (379 głosowań). |
| q03 | Odrzucono mimo 241 za i 198 przeciw: większość 3/5, próg 266. |
| q04 | Apel o kworum, 396 obecnych; nic nie jest przyjmowane ani odrzucane. |
| q05 | Przyjęto 193/168/13. KO 116 za; PiS 164 przeciw; Lewica 23 za; Polska2050-TD 28 za; PSL-TD 25 za; Konfederacja 1 przeciw, 13 wstrz.; Kukiz15 2 przeciw. |
| q06 | 210 interpelacji, 8 po terminie bez odpowiedzi. |
| q07 | Posiedzenie 65: 147 głosowań, 83 przyjęte, 61 odrzucone, 2 apele o kworum, 1 wybór z listy. |
| q08 | Brak rankingu w narzędziach (wymagałby ok. 460 profili); żadnej „listy najgorszych” z kilku wybranych posłów. |
| q09 | 20 posiedzeń komisji. |
| q10 | Jarosław Sachajko (wypowiedź nr 2). |
| q11 | Głosowanie 9/1/1: za. |
| q12 | Tak, uchwalona (47/99, 5.12.2025) i opublikowana (Dz.U. 2026 poz. 62). |
| q13 | Na czele 18316, 18654, potem 18838 i 18827 (opóźnienie liczone od terminu u ministra zdrowia). |
| q14 | Proces 2108, głosowanie 50/104 nad całością ustawy o zmianie ustawy o KRS. |
| q15 | Głosowanie 3/15: za (klub Lewica). |
| q16 | Tak: Dz.U. 2026 poz. 62, obowiązuje od 20 stycznia 2026 (ogłoszona 20.01.2026; uchwalona 9.01.2026 po stanowisku Senatu, głosowanie Sejmu 47/99 z 5.12.2025). |
| q17 | Rozwiązanie umowy bez wypowiedzenia z winy pracownika: ciężkie naruszenie obowiązków, przestępstwo, utrata uprawnień; miesiąc na decyzję; opinia związku; § 4 uchylony. Najnowszy tekst jednolity (DU/2025/277) jest tylko w PDF, więc poprawna odpowiedź mówi, z którego tekstu cytuje. |
| q18 | Ustawa DU/2011/714: 20 aktów zmieniających; najnowszy tekst jednolity DU/2024/1186. |
| q19 | Nie: proces 2108, uchwalona 23.01.2026 (50/104), zawetowana przez Prezydenta 19.02.2026, Sejm nie głosował jeszcze nad wetem. |
| q20 | Komisja do Spraw Deregulacji (DER): przewodniczący; Komisja Odpowiedzialności Konstytucyjnej (ODK): zastępca przewodniczącego. |
| q21 | Marta Golbik (KO); zastępcy: Marek Hok, Katarzyna Sójka, Wioleta Tomczak, Joanna Wicha, Elżbieta Gelert. |
| q22 | Posiedzenie 66, 6–9 października 2026; porządek z rejestru (m.in. trzecie czytanie projektów o rekompensatach za szkody wyrządzone przez ptaki, ustawa o przywróceniu prawa do niezależnego sądu, druki 2107 i 3019). |
| q23 | Dwa: 18.09.2026 projekt o zmianie ustawy o zapasach ropy naftowej, produktów naftowych i gazu; 8.09.2026 projekt ustawy o rynku kryptoaktywów. |
| q24 | Link do odtwarzacza sejm.gov.pl (transmisje_arch.xsp?unid=70410851619B0614C1258A7C006A2693), posiedzenie 10., 10:00–22:08. |
| q25 | Dwie ustawy: DU/2026/1161 (od 2.10.2026, samorządy zawodowe architektów i inżynierów) i DU/2026/507 (od 14.10.2026, CEIDG). |
