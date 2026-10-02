# Zasady współpracy

Zgłoszenia i pull requesty są mile widziane. Poniższe zasady są po to, żeby nie tracić Twojego
czasu na zmianę, której nie przyjmiemy.

## Zgłoszenia

[Nowe zgłoszenie](https://github.com/leniwyposel/sejm-mcp/issues/new/choose): błąd w odpowiedzi
albo pomysł. Najcenniejsze są konkretne przykłady: jakie pytanie zadałeś, co odpowiedział
asystent i co jest w danych Sejmu (najlepiej z adresem z `api.sejm.gov.pl`).

## Pull requesty

- **Większą zmianę zacznij od zgłoszenia**: nowe narzędzie, nowa albo zmieniona reguła liczenia,
  zmiana kształtu wyniku. Poprawki literówek, opisów i drobnych błędów możesz wysłać od razu.
- **Reguła liczenia potrzebuje testu na prawdziwym rekordzie**: nagraj odpowiedź z
  `api.sejm.gov.pl` do `testy/fikstury/` i sprawdź na niej wynik.
- **Granice, których nie przesuwamy:** serwer tylko czyta, łączy się wyłącznie z
  `api.sejm.gov.pl`, zapisuje na dysku tylko pobrane druki, tekst z nich i wyniki OCR w katalogu podręcznym, nie ma
  telemetrii, nie ocenia posłów i nie układa rankingów. Zmiana, która to narusza, nie zostanie przyjęta.
- **Przed wysłaniem:** `npm run typecheck && npm test` (to samo sprawdza CI).
- Zgłoszenia i PR-y po polsku albo po angielsku.

Wysyłając pull request, zgadzasz się, że Twój wkład jest objęty licencją Apache 2.0
(sekcja 5 [LICENSE](LICENSE)); nie prosimy o osobną umowę (CLA).

Odpowiadamy zwykle w ciągu kilku dni. Rozwija nas mały zespół, więc nie każdy pomysł wejdzie,
nawet dobry; zawsze napiszemy dlaczego.

Problemy z bezpieczeństwem zgłaszaj prywatnie, zgodnie z [SECURITY.md](SECURITY.md).
W innych sprawach (współpraca, media): [leniwyposel.pl/kontakt](https://leniwyposel.pl/kontakt/).

---

**English.** Issues and pull requests are welcome. Please open an issue before a larger change
(new tool, counting rule, result shape). A counting rule needs a test on a real record recorded
from `api.sejm.gov.pl`. The server stays read-only, talks only to `api.sejm.gov.pl`, writes only downloaded prints to the
user cache directory, has no telemetry and does not rank MPs. Run `npm run typecheck && npm test` before sending. Contributions
are accepted under Apache-2.0 (section 5), no CLA.
