import { defineConfig } from 'tsdown'

/**
 * `@dslegal/client-ui` 是**浏览器侧的 UI 库**，不是 DSH 插件包。
 *
 * 它只有一个入口：`src/client.tsx` → `lib/client.js`，产物形态是 DSH 的浏览器模块工厂
 * `window.__ModuleLoader__.load({ id, factory })`，只允许 `require` shell 提供的共享模块
 * （react / react/jsx-runtime）；`@dslegal/core` 必须内联（浏览器模块表里没有它）。
 *
 * **为什么不再有 host 侧入口**：本包挂载为 loader 行时才有 host 面，而它现在**不挂载**——
 * 对外只有 `dsh-legal-schedule`（`packages/app`）一行，浏览器面由 `packages/app` 从
 * `src/client.tsx` 源码内联进去。原先那个"P1 骨架"host 半边（空 `apply`）已删除。
 *
 * banner 的 `id` **保留本包名**：它标识的是"这段浏览器代码是谁的"，与哪个 loader 行
 * 加载它无关（`packages/app` 的产物另有一套 banner）。
 */
export default defineConfig({
  entry: ['src/client.tsx'],
  outDir: 'lib',
  format: ['cjs'],
  // `@dslegal/core` 必须内联：浏览器侧的模块表里只有 shell 共享模块，没有它。
  deps: { alwaysBundle: [/^@dslegal\//] },
  dts: false,
  sourcemap: false,
  outExtensions: () => ({ js: '.js' }),
  // 包名不得以 `/client` 结尾：DSH client-modules 的 stripClientSuffix 会把
  // `@pkg/client` 误削成 `@pkg`，boot graph 查不到该行（历史事故，见 AGENTS.md 5.1）。
  banner: `window.__ModuleLoader__.load({ id: '@dslegal/client-ui', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  footer: `return module.exports; } });`,
})
