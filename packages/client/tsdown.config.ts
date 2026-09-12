import { defineConfig } from 'tsdown'

/**
 * 两个入口，两种产物形态：
 *
 * - `src/index.ts` → `lib/index.js`：host 半边，普通 ESM，由 Node 加载。
 * - `src/client.ts` → `lib/client.js`：client 半边，必须构建成 DSH 的浏览器模块工厂
 *   `window.__ModuleLoader__.load({ id, factory: (require) => { ... } })`，
 *   并以 `require(...)` 引用 shell 提供的共享模块（react / cordis / dsh-client-*）。
 */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: ['src/client.tsx'],
    outDir: 'lib',
    format: ['cjs'],
    // `@dslegal/core` 必须**内联**：浏览器侧的模块表里没有它，只有 react / cordis / dsh-client-* 是共享的。
    noExternal: ['@dslegal/core'],
    outExtensions: () => ({ js: '.js' }),
    // 包名不得以 `/client` 结尾：DSH client-modules 的 stripClientSuffix 会把
    // `@dslegal/client` 误削成 `@dslegal`，导致 boot graph 行永远查不到
    // （"not a row in the boot graph" 死锁）。
    banner: `window.__ModuleLoader__.load({ id: '@dslegal/client-ui', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    footer: `return module.exports; } });`,
    dts: false,
    sourcemap: false,
    clean: false,
  },
])
