import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['testy/**/*.test.ts'],
    testTimeout: 20_000,
    setupFiles: ['testy/przygotowanie.ts'],
    // Schowek (teksty aktów z PDF) w katalogu tymczasowym jednego przebiegu, nigdy w katalogu użytkownika.
    env: { SEJM_MCP_SCHOWEK: mkdtempSync(join(tmpdir(), 'sejm-mcp-vitest-')) },
  },
});
