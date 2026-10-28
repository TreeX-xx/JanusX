import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { realpathSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { browserTestFiles, integrationTestFiles } from './tests/helpers/test-suites'

// Note: canonical temp paths and test groups — see .agents/notes/desktop/reproducible-verification.md
// https://github.com/libuv/libuv/issues/5010: watcher events expand 8.3 names,
// but affected libuv versions compare them against the unexpanded directory.
// Set these before workers start so real filesystem tests use long paths too.
if (process.platform === 'win32') {
  const temp = realpathSync.native(tmpdir())
  process.env.TEMP = temp
  process.env.TMP = temp
}

// Keep CI's memory use bounded; serialization alone does not fix native watchers.
const isCI = process.env.CI === 'true'

export default defineConfig({
  resolve: {
    alias: {
      '@janusx/plugin-sdk/native': resolve(__dirname, 'packages/plugin-sdk/src/native.ts'), '@janusx/plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude: [...browserTestFiles, ...integrationTestFiles],
        },
      },
      { extends: true, test: { name: 'integration', include: integrationTestFiles } },
      { extends: true, test: { name: 'browser', include: browserTestFiles } },
    ],
    allowOnly: !isCI,
    watch: false,
    pool: 'forks',
    maxWorkers: isCI ? 1 : Math.min(4, availableParallelism()),
    minWorkers: 1,
    fileParallelism: !isCI,
    // Do not shuffle CI test files; duration caching can still affect ordering.
    sequence: {
      shuffle: false,
    },
    poolOptions: {
      forks: {
        singleFork: isCI,
        isolate: true,
      },
    },
    // 未处理的 rejection 直接 fail 而不是静默吞掉尾部报告；Windows 下 worker 崩溃时
    // 至少保留可归因的用例级错误，而不是只有一句 `Channel closed`。
    dangerouslyIgnoreUnhandledErrors: false,
    // CI runner 比本地慢，15s 会让"对全仓语料做真实投影"这类用例轮流撞天花板
    // （workflowx-v2 语料可达、note-repair 整套替换都曾在 CI 上以 15.0s 超时）。
    // 放宽到 60s：通过中的用例不受影响，只有真正挂死的用例才等更久。
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 5000,
  },
})
