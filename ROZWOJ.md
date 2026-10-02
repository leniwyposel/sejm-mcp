# Rozwój sejm-mcp

## Uruchomienie z kodu

```bash
npm install
npm run build
claude mcp add sejm -- node "$(pwd)/dist/index.js"   # albo ten sam wpis w innym kliencie
```

## Testy

```bash
npm test               # na nagranych odpowiedziach Sejmu, bez sieci
npm run test:na-zywo   # każde narzędzie raz na prawdziwym API
npm run typecheck
```

Nagrane odpowiedzi leżą w `testy/fikstury/` i pochodzą wprost z `api.sejm.gov.pl`.

## Wydanie

Wersja siedzi w pięciu miejscach i test `testy/pakiet.test.ts` pilnuje, żeby się zgadzały:
`package.json`, `server.json` (dwa razy), `WERSJA` w `src/klient.ts`,
`plugin/.claude-plugin/plugin.json` i przypięty `sejm-mcp@<wersja>` w `plugin/.mcp.json`.

**Uwaga:** `npm publish` udostępnia kod publicznie. Każdy może pobrać paczkę z npm i przeczytać
skompilowany kod, nawet jeśli repozytorium na GitHubie jest prywatne.

Jednorazowo: konto na npmjs.com z włączonym 2FA, `npm login`, `mcp-publisher` zainstalowany
(`brew install mcp-publisher`) i `mcp-publisher login github` na koncie z rolą właściciela w organizacji `leniwyposel`.

Wydanie, po kolei:

```bash
npm publish                    # prepublishOnly: typecheck, testy, build; potem pakiet w npm
git tag v$(node -p "require('./package.json').version") && git push origin --tags
                               # .github/workflows/wydanie.yml: sejm-mcp.mcpb w wydaniu na GitHubie
mcp-publisher publish          # server.json do registry.modelcontextprotocol.io
```

Kolejność ma znaczenie: rejestr MCP sprawdza, czy pakiet jest w npm i czy jego `mcpName`
zgadza się z `name` w `server.json`, więc `mcp-publisher publish` idzie po `npm publish`.
Przy każdym wydaniu dopisz sekcję do [CHANGELOG.md](CHANGELOG.md).

Sama paczka dla Claude Desktop, bez wydania:

```bash
npm run build && npm run mcpb   # build/sejm-mcp.mcpb
```

## Gdzie co jest

- `src/narzedzia/`: narzędzia, po jednym pliku na obszar (posłowie, głosowania, pisma,
  legislacja, posiedzenia, izba, akty prawne ELI).
- `src/reguly/`: reguły liczenia (werdykt głosowania z progu, apel o kworum, termin
  odpowiedzi na pismo). Każda ma test na prawdziwym rekordzie rejestru.
- `src/klient.ts`: jedyne miejsce, które łączy się z `api.sejm.gov.pl`.
- `src/druki/`: tekst druków (`odczyt.ts`: PDF przez unpdf, DOCX i DOC przez word-extractor,
  spis artykułów), OCR (`silnik-ocr.ts`: lista plików silnika ze skrótami; `ocr.ts`
  i `ocr-watek.ts`: rozpoznawanie w osobnym wątku). Silnik kopiuje do `dist/silnik-ocr`
  `skrypty/kopiuj-silnik-ocr.mjs` przy każdym `npm run build`, z paczek npm w devDependencies.
- `src/schowek.ts`: jedyne miejsce, które zapisuje na dysk (katalog podręczny użytkownika).
- `ewaluacja/`: sprawdzian na prawdziwych modelach (100 trudnych pytań z odpowiedziami
  wzorcowymi); opis w [ewaluacja/README.md](ewaluacja/README.md).

## Zasady

- Liczby i werdykty pochodzą z rejestru Sejmu. Narzędzie nie ocenia posłów i nie układa
  rankingów.
- Nowa reguła liczenia dostaje test na prawdziwym rekordzie z API.
- Serwer łączy się tylko z `api.sejm.gov.pl`. Na dysk zapisuje tylko `src/schowek.ts`.
- Pobranie pliku druku ponad 20 MB (limit liczony w strumieniu, bo Sejm nie podaje rozmiaru)
  i OCR ponad 10 stron wymagają zgody użytkownika (elicitation, a bez niej argument `zgoda` po
  pytaniu zadanym przez model). Nic z tego nie dzieje się po cichu.
- Jedna odpowiedź narzędzia ma najwyżej 28 000 znaków (`src/rozmiar.ts`); narzędzie powinno
  samo oddawać porcje mniejsze, sufit jest siatką bezpieczeństwa.
- Każdy fragment druku w odpowiedzi niesie cytowanie: numer druku, plik, stronę i adres pliku;
  pilnuje tego `testy/druki.test.ts`.
