<h1 align="center">
  <img src="https://raw.githubusercontent.com/leniwyposel/sejm-mcp/main/.github/assets/baner.jpg" width="800" alt="sejm-mcp by Leniwy Poseł: the Polish Sejm and Polish law in your AI assistant. In the background, the dome of the Sejm's plenary chamber.">
</h1>

<p align="center"><a href="https://github.com/leniwyposel/sejm-mcp/blob/main/README.md">Polski</a> · <strong>English</strong></p>

<p align="center">
  Ask your AI assistant about Polish MPs, votes, interpellations and the law in force.<br>
  Answers come from the official data of the Polish Sejm, with a link to the source.
</p>

# sejm-mcp

**sejm-mcp** is a Model Context Protocol (MCP) server for the public APIs of the Polish
parliament (Sejm) and the Polish legal acts database (ELI): MPs, clubs, committees, votes,
interpellations and written questions, legislative processes, prints (full text page by page,
with optional local OCR of scans), sittings, transcripts and laws in force. It runs on your
machine, only reads, and talks to nothing but `api.sejm.gov.pl`. No accounts, keys or telemetry.
Tool names and answers are in Polish; ask in any language.

## Install

Requires [Node.js](https://nodejs.org) 22+ (except Claude Desktop, which ships its own).

- **Run it:** `npx -y sejm-mcp` (stdio; normally your MCP client starts it for you).
- **Claude Desktop:** download [`sejm-mcp.mcpb`](https://github.com/leniwyposel/sejm-mcp/releases/latest/download/sejm-mcp.mcpb)
  and double-click it, or add this to `claude_desktop_config.json`:

  ```json
  { "mcpServers": { "sejm": { "command": "npx", "args": ["-y", "sejm-mcp"] } } }
  ```

- **Claude Code:** `claude mcp add sejm -- npx -y sejm-mcp` (add `--scope user` for all projects).
- **Cursor, VS Code, Windsurf and others:** the same `command`/`args` entry (see the [Polish README](https://github.com/leniwyposel/sejm-mcp/blob/main/README.md#instalacja) for exact file paths).

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

## Quick start for developers

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

## Tools

The 29 tool names are Polish (see the [table in the Polish README](https://github.com/leniwyposel/sejm-mcp/blob/main/README.md#narzędzia)). Two of them take options worth knowing:
`lista_posiedzen` (sittings) returns the 10 latest sittings plus the next one by default;
`wszystkie: true` returns the whole term and `od`/`do` a date range. `glosowania_posiedzenia`
(votes of a sitting) with `porzadek: true` groups the votes under the points of the sitting's
agenda, with the rest under „Pozostałe głosowania” (procedural motions, quorum checks); long
agendas continue with `odPunktu`. A quorum check where the Speaker asked MPs to press *any*
button is recorded by the Sejm like a vote (e.g. sitting 33, vote 5); the server knows the five
such cases, with transcript quotes, and reports them as quorum checks, not as passed motions.

## Data and licence

Data comes from the public APIs of the Chancellery of the Sejm
([api.sejm.gov.pl](https://api.sejm.gov.pl)); this project is not affiliated with or endorsed by
the Chancellery. Please credit it as "Source: Chancellery of the Sejm, api.sejm.gov.pl". Derived
figures served by the hosted version from Leniwy Poseł are
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credit "Leniwy Poseł, leniwyposel.pl".

Code: [Apache 2.0](https://github.com/leniwyposel/sejm-mcp/blob/main/LICENSE); bundled third-party components (Tesseract OCR, tessdata, pdf.js)
are listed in [NOTICE](https://github.com/leniwyposel/sejm-mcp/blob/main/NOTICE). Security issues: report privately via
[SECURITY.md](https://github.com/leniwyposel/sejm-mcp/blob/main/SECURITY.md). Contributions: [CONTRIBUTING.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](https://github.com/leniwyposel/sejm-mcp/blob/main/CODE_OF_CONDUCT.md). Issues and PRs in Polish or English are welcome.
