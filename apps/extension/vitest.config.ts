import { defineConfig } from 'vitest/config';

// Unit tests. Files that need a DOM declare `// @vitest-environment jsdom` at the top.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
