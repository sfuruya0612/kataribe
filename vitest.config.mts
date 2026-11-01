import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    // 話者分離モデルのテストは実際の HTTP、tar、SHA-256 を使うため、
    // CI の並列実行でも既定の 5 秒に収まるとは限らない。
    testTimeout: 15_000,
  },
});
