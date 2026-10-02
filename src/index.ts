#!/usr/bin/env node
/**
 * sejm-mcp: serwer MCP na stdio. Uruchomienie: `npx -y sejm-mcp`.
 *
 * Na stdout idzie wyłącznie protokół MCP; wszystko inne (błędy) na stderr.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { KlientSejmu, WERSJA } from './klient.js';
import { PamiecKrotka } from './pamiec.js';
import { utworzSerwer } from './serwer.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stderr.write(`sejm-mcp ${WERSJA}\n`);
  process.exit(0);
}

// Na stdout idzie wyłącznie protokół MCP: biblioteki, które piszą przez console.log (pdf.js ostrzega
// tak o brakującym canvas), trafiają na stderr, zamiast psuć rozmowę z klientem.
console.log = console.error;
console.info = console.error;
console.warn = console.error;

// Odpowiedzi Sejmu bez pamięci na dysku: każde pytanie idzie do Sejmu, powtórka w ciągu minuty bierze odpowiedź z procesu.
// Wyjątek: pliki druków (tekst_druku) leżą w schowku użytkownika, patrz src/schowek.ts.
const zrodlo = new KlientSejmu(new PamiecKrotka());

serveStdio(() => utworzSerwer(zrodlo), {
  onerror: (e) => process.stderr.write(`sejm-mcp: ${e.message}\n`),
});
