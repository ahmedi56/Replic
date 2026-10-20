import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each integration test file owns its own SQLite file, so they must not share a process.
    fileParallelism: false,
    // Integration setup spawns a migration subprocess and bcrypt-hashes real passwords.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/setup/server-only-stub.ts'),
    },
  },
});
