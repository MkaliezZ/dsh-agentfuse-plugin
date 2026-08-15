import { defineConfig } from 'vitest/config'

/**
 * Standalone test config for the zero-dependency core: run
 * `vitest run --config vitest.config.ts` from this directory (or reference
 * this file by path), independent of any host monorepo's test globs.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
