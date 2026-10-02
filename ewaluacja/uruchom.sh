#!/bin/zsh
# Ewaluacja na prawdziwym modelu: każde pytanie z pytania.tsv w osobnej sesji Claude Code
# (headless), z WYŁĄCZNIE tym serwerem MCP i bez żadnych innych narzędzi.
#
#   npm run build && ./ewaluacja/uruchom.sh [model] [filtr] [zestaw]
#   model: domyślnie haiku; filtr: wyrażenie na id, np. "q0[1-3]"; zestaw: podkatalog ewaluacja/ z pytania.tsv (domyślnie główny)
#   python3 ewaluacja/raport.py                           # raport.md z wywołaniami i odpowiedziami
#
# Wyniki porównuj z ewaluacja/README.md. Koszt z Haiku: ok. 1 USD za 30 sesji.
set -e
KAT=${0:A:h}; REPO=${KAT:h}; WARIANT=${WARIANT:-serwer}; MODEL=${1:-haiku}; FILTR=${2:-.}; ZESTAW=${3:+$KAT/$3}; ZESTAW=${ZESTAW:-$KAT}
WYN=$ZESTAW/wyniki; mkdir -p $WYN
cat > $KAT/mcp.json <<JSON
{"mcpServers":{"sejm":{"command":"node","args":["$REPO/dist/index.js"]}}}
JSON
# Wariant „plugin”: prawdziwa wtyczka Claude Code (serwer + skill) z serwerem z lokalnego dist/.
# Uwaga: w trybie -p serwer wtyczki startuje w tle i model potrafi zacząć odpowiadać, zanim się
# połączy (runda A/B 2026-09-24: 50 ze 100 przebiegów bez narzędzi). Do porównań używaj „skill”.
# Wariant „skill”: ten sam serwer co w „serwer” (--mcp-config, czeka na start) + wtyczka z samym skillem.
if [[ $WARIANT == skill ]]; then
  rm -rf $KAT/.skill-test && mkdir -p $KAT/.skill-test/.claude-plugin && cp -R $REPO/plugin/skills $KAT/.skill-test/
  cp $REPO/plugin/.claude-plugin/plugin.json $KAT/.skill-test/.claude-plugin/
fi
if [[ $WARIANT == plugin ]]; then
  rm -rf $KAT/.plugin-test && cp -R $REPO/plugin $KAT/.plugin-test
  cat > $KAT/.plugin-test/.mcp.json <<JSON2
{"mcpServers":{"sejm":{"command":"node","args":["$REPO/dist/index.js"]}}}
JSON2
fi
jeden() {
  local wariant=$1 id=$2 pytanie=$3
  if [[ $WARIANT == skill ]]; then
    (cd $KAT && MCP_TIMEOUT=60000 claude -p "$pytanie" --model $MODEL --plugin-dir $KAT/.skill-test --tools "Skill" \
      --strict-mcp-config --mcp-config mcp.json --allowedTools "mcp__sejm,Skill" --setting-sources "" --no-session-persistence \
      --output-format stream-json --verbose < /dev/null > $WYN/$wariant-$id.jsonl 2> $WYN/$wariant-$id.err)
  elif [[ $WARIANT == plugin ]]; then
    (cd $KAT && MCP_TIMEOUT=60000 claude -p "$pytanie" --model $MODEL --plugin-dir $KAT/.plugin-test --tools "Skill" \
      --allowedTools "mcp__plugin_sejm_sejm,Skill" --setting-sources "" --no-session-persistence \
      --output-format stream-json --verbose < /dev/null > $WYN/$wariant-$id.jsonl 2> $WYN/$wariant-$id.err)
  else
    (cd $KAT && MCP_TIMEOUT=60000 claude -p "$pytanie" --model $MODEL --tools "" --strict-mcp-config --mcp-config mcp.json \
      --allowedTools "mcp__sejm" --setting-sources "" --no-session-persistence \
      --output-format stream-json --verbose < /dev/null > $WYN/$wariant-$id.jsonl 2> $WYN/$wariant-$id.err)
  fi
  echo "$wariant-$id"
}
for w in $WARIANT; do
  while IFS=$'\t' read -r id q; do
    [[ $id =~ $FILTR ]] || continue
    jeden $w $id "$q" &
    while (( $(jobs -r | wc -l) >= 3 )); do sleep 1; done
  done < $ZESTAW/pytania.tsv
done
wait
