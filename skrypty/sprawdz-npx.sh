#!/bin/sh
# Sprawdza, czy sejm-mcp uruchamia się tak, jak uruchomi go użytkownik: przez npx, w pustym
# katalogu podręcznym npm (nic z tego komputera nie pomaga). Wypisuje wersję serwera i liczbę
# narzędzi; kod wyjścia 0 tylko przy 29 narzędziach i zgodnej wersji.
#
#   sh skrypty/sprawdz-npx.sh                       # sejm-mcp z rejestru npm (najnowszy)
#   sh skrypty/sprawdz-npx.sh sejm-mcp@0.3.0        # konkretna wersja z npm
#   sh skrypty/sprawdz-npx.sh ./sejm-mcp-0.3.0.tgz  # paczka z npm pack, przed publikacją
set -eu
SPEC=${1:-sejm-mcp}
KORZEN=$(cd "$(dirname "$0")/.." && pwd)
OCZEKIWANA=${OCZEKIWANA:-$(node -p "require('$KORZEN/package.json').version")}
PODRECZNY=$(mktemp -d)
trap 'rm -rf "$PODRECZNY"' EXIT
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"sprawdz-npx","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' |
  npm_config_cache="$PODRECZNY" npx -y --package "$SPEC" sejm-mcp |
  OCZEKIWANA="$OCZEKIWANA" node -e '
    let wej = ""; process.stdin.on("data", (d) => (wej += d)).on("end", () => {
      const m = wej.trim().split("\n").map((l) => JSON.parse(l));
      const wersja = m.find((x) => x.id === 1)?.result?.serverInfo?.version;
      const narzedzia = m.find((x) => x.id === 2)?.result?.tools?.length;
      console.log(`sejm-mcp ${wersja}, narzędzi: ${narzedzia}`);
      if (wersja !== process.env.OCZEKIWANA || narzedzia !== 29) {
        console.error(`BŁĄD: oczekiwano wersji ${process.env.OCZEKIWANA} i 29 narzędzi`);
        process.exit(1);
      }
    });'
