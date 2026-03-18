import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/availability.test.ts'],
    globals: true,
  },
});
