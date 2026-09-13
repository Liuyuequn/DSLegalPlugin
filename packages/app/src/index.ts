/**
 * `dsh-legal-schedule` 的 **host 面**。
 *
 * 这一层刻意做得极薄：把 `@dslegal/host` 的插件面原样再导出。DSH loader 取插件的方式是
 * `unwrapExports(await import(行的 name))`（`cordis-plugin-loader`），所以只要最终的模块
 * 命名空间里有 `name` / `inject` / `apply` 三个导出即可——**不允许** `export default`
 * （loader 会拆包导致 `inject` 丢失，插件静默失效，见 AGENTS.md 5.1 第 1 条）。
 *
 * 真正干活的是 `@dslegal/host`；这里只负责让它以 `dsh-legal-schedule` 这个名字被挂上，
 * 从而与浏览器面**共用同一个包、同一行 loader 条目**。
 */

export { Config, apply, inject, name } from '@dslegal/host'
