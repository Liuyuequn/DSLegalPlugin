import { defineConfig } from 'tsdown'

/**
 * 统一包 `dsh-legal-schedule`：一个包、两半产物。
 *
 * 与 `packages/client/tsdown.config.ts` 同样的两个入口，区别只在**内联范围**：
 *
 * - `src/index.ts` → `lib/index.js`：host 面。**把 @dslegal/host 与 @dslegal/core 一并内联**，
 *   于是 profile 里不需要再放 `@dslegal/{host,core}`——"复制产物"的安装方式要求产物自足
 *   （见 AGENTS.md「profile 安装方式」）。
 * - `src/client.tsx` → `lib/client.js`：浏览器面，必须构建成 DSH 的模块工厂
 *   `window.__ModuleLoader__.load({ id, factory })`，只允许 `require` shell 共享的模块
 *   （react / react/jsx-runtime）；`@dslegal/client-ui` 与 `@dslegal/core` 一律内联。
 *
 * 包名即 loader 行的 `name`，也就是插件设置里那张卡的标识；`dsh.client` 声明让
 * 浏览器面通过**同一行**被发现，因此不再需要单独的 client 行。
 */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    fixedExtension: false,
    // workspace 包默认是 external；这里**强制内联**，产物才自足。
    deps: { alwaysBundle: [/^@dslegal\//] },
    /**
     * **必须关掉 dts**：`src/index.ts` 只是把 `@dslegal/host` 再导出，而 tsdown 会顺着
     * import 去生成跨包声明，把 `packages/host/src/*.d.ts` 之类写进**源码目录**
     * （实测：`packages/client/src/` 下冒出 6 组 `.d.ts` + `.d.ts.map`，每次构建都复现）。
     * 本包只被"复制产物"进 profile，运行时不需要 `.d.ts`；类型由 `packages/host` 自己保证。
     */
    dts: false,
    sourcemap: true,
    clean: true,
  },
  {
    entry: ['src/client.tsx'],
    outDir: 'lib',
    format: ['cjs'],
    // 必须用 alwaysBundle（而不是已废弃的 noExternal）：`noExternal` 只按裸包名
    // 匹配，带子路径的 `@dslegal/client-ui/browser` 匹配不上，那一半就被留成
    // `require("@dslegal/client-ui/browser")`——浏览器里没有这个模块，整包失效
    // （实测踩过：产物只有 0.7 kB）。
    deps: { alwaysBundle: [/^@dslegal\//] },
    dts: false,
    sourcemap: false,
    clean: false,
    outExtensions: () => ({ js: '.js' }),
    // 包名不得以 `/client` 结尾：DSH client-modules 的 stripClientSuffix 会把
    // `.../client` 误削成上一级，导致 boot graph 行永远查不到（历史事故，见 AGENTS.md 5.1）。
    banner: `window.__ModuleLoader__.load({ id: 'dsh-legal-schedule', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    footer: `return module.exports; } });`,
  },
])
