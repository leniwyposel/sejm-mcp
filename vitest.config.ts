import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['testy/**/*.test.ts'], testTimeout: 20_000 },
});
