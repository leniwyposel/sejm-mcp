# Sejm RP (wtyczka Claude Code)

Wtyczka łączy Claude Code z serwerem [sejm-mcp](https://github.com/leniwyposel/sejm-mcp): 29 narzędzi
tylko do odczytu do publicznych API Sejmu RP (`api.sejm.gov.pl`) i bazy aktów prawnych ELI.
Dokłada skill `sejm` z instrukcją, jak odpowiadać na podstawie wyników: przepisywać liczby
z pól narzędzi zamiast je liczyć, podawać próg przy wecie, klub z dnia głosowania i link do źródła.

## Instalacja

```text
/plugin marketplace add leniwyposel/sejm-mcp
/plugin install sejm@sejm-mcp
```

Wtyczka uruchamia `npx -y sejm-mcp@<wersja>`, więc potrzebny jest Node.js 22 lub nowszy.

Gdy API Sejmu nie odpowiada, ten serwer też nie odpowie. Wtedy możesz użyć wersji hostowanej,
która odpowiada z nocnej kopii bazy: <https://mcp.leniwyposel.pl/mcp>

## Co jest w środku

- `.mcp.json`: serwer `sejm` przez `npx`, przypięty do dokładnej wersji pakietu.
- `skills/sejm/SKILL.md`: jak odpowiadać z wyników narzędzi.

## Prywatność

Serwer działa lokalnie i łączy się wyłącznie z `api.sejm.gov.pl`. Na dysku zapisuje tylko pobrane
druki, tekst z nich odczytany i wyniki odczytu maszynowego (OCR), w katalogu podręcznym
użytkownika (`~/Library/Caches/sejm-mcp`, `~/.cache/sejm-mcp` albo `%LOCALAPPDATA%\sejm-mcp\Cache`,
najwyżej ok. 500 MB; można go w każdej chwili skasować). Druk do 20 MB pobiera bez pytania,
większy dopiero za zgodą. Nie ma kont, kluczy ani telemetrii; pytania nie trafiają do autorów. Polityka prywatności:
<https://leniwyposel.pl/polityka-prywatnosci/>. Szczegóły techniczne: [SECURITY.md](https://github.com/leniwyposel/sejm-mcp/blob/main/SECURITY.md).

---

**English.** Claude Code plugin for the Polish Parliament (Sejm) and Polish law: the local,
read-only [sejm-mcp](https://github.com/leniwyposel/sejm-mcp) server (29 tools over
`api.sejm.gov.pl` and the ELI legal database) plus a skill that tells Claude to quote numbers
from tool results, apply the correct majority threshold and cite the source URL. No account,
no API key, no telemetry; the server talks only to `api.sejm.gov.pl`. It caches downloaded
prints, their extracted text and OCR results in your user cache folder (at most about 500 MB);
prints over 20 MB are downloaded only after you agree. When the Sejm API is down, this server is
down too; the hosted version answers from a nightly copy: <https://mcp.leniwyposel.pl/mcp>.
Licence: Apache-2.0.
