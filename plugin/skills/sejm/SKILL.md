---
name: sejm
description: Jak odpowiadać na pytania o polski Sejm i akty prawne z narzędziami sejm-mcp (posłowie, głosowania, weta, frekwencja, interpelacje, procesy legislacyjne, ustawy w Dzienniku Ustaw). Używaj zawsze, gdy odpowiedź opiera się na wynikach narzędzi sejm-mcp.
---

# Odpowiadanie z sejm-mcp

Narzędzia zwracają dokładne dane z rejestru Sejmu i bazy ELI. Błędy w odpowiedziach biorą się
z dopowiadania, liczenia i wybierania na oko, więc trzymaj się trzech nawyków.

## 1. Przepisuj, nie licz

Zacznij od pola `odpowiedz`, gdy narzędzie je zwróciło: to gotowe zdanie z werdyktem, liczbami,
progiem i mianownikiem. Każdą liczbę, datę i nazwisko bierz z konkretnego pola wyniku, a liczby
zbiorcze z pól `bilans`, `podsumowanie` i `statystykaSejmu`, nie z przeliczania list.

Gdy czegoś w wynikach nie ma, napisz, że rejestr tego nie podaje. Dotyczy to zwłaszcza progu
większości przed głosowaniem, pełnego imienia przy inicjale („M. Kuchciński”) i treści przepisu,
gdy narzędzie dało tylko link do PDF. Uzupełnianie z pamięci daje tu błędne imiona, progi
i treść przepisów.

## 2. Wybieraj świadomie

Gdy wynik ma pole `niejednoznaczne` albo kilka pozycji pasuje do pytania, wybierz tę, która zgadza
się z pytaniem: data, tytuł aktu (pole `akt`: ustawa czy przepisy wprowadzające), klub, imię.
Napisz w jednym zdaniu, którą wybrałeś i dlaczego. Jeśli pytanie nie rozstrzyga, odpowiedz
o każdej z pasujących pozycji albo zapytaj użytkownika.

## 3. Jeden werdykt

Nagłówek i treść mówią to samo co pola `wynik`, `rozstrzygniecie` albo `stan`. Przy wecie
Prezydenta: „weto utrzymane” znaczy, że ustawa nie wchodzi w życie; „weto odrzucone” znaczy, że
Sejm ponownie ją uchwalił. Ogłoszenie w Dzienniku Ustaw to nie wejście w życie: datę daje pole
`wejscieWZycie`.

## Druki: plik i strona przy każdym cytacie

Tekst z `tekst_druku` cytuj zawsze z numerem druku, nazwą pliku, numerem strony (w Wordzie
numerem części) i linkiem z `cytowanie.url`, który otwiera PDF na tej stronie; zaproponuj
otwarcie oryginału. Strona z polem `ocr` to odczyt maszynowy skanu, nie tekst Sejmu: powiedz
to i poproś o sprawdzenie w oryginale. O zgodę na pobranie pliku albo OCR wielu stron pytaj
użytkownika, nigdy nie podawaj `zgoda` bez jego odpowiedzi.

## Przed wysłaniem sprawdź

1. Każda liczba, data i nazwisko w odpowiedzi ma pole, z którego pochodzi.
2. Werdykt w nagłówku jest ten sam co w polu wyniku.
3. Nie ma w odpowiedzi niczego spoza wyników narzędzi; jeśli dodajesz wiedzę ogólną, oznacz ją
   wprost.

Pod odpowiedzią podaj adresy z pola `zrodla`.

## Przykłady

**Weto.** Pytanie: „Czy Sejm odrzucił weto do ustawy o statusie osoby najbliższej?” Pole
`odpowiedz`: „Głosowanie 65/10 … za 232 … wymagane co najmniej 259 … weto Prezydenta utrzymane.”
Dobrze: „Nie. Weto utrzymano: 232 głosy za przy wymaganych 259 (3/5), głosowanie 65/10.”
Źle: „Sejm odrzucił weto” w nagłówku i „weto utrzymane” niżej.

**Inicjał.** Kandydat w wyniku: „M. Kuchciński” bez pola `poselId`. Dobrze: „M. Kuchciński
(rejestr podaje tylko inicjał imienia)”. Źle: „Maciej Kuchciński”.

**Liczenie.** Pytanie: „Ile interpelacji złożyła posłanka sama?” Weź `podsumowanie.jedynyAutor`,
nie licz pozycji listy.
