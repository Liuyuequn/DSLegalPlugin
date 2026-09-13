/**
 * `dsh-legal-schedule` 的 **浏览器面**。
 *
 * 从 `@dslegal/client-ui` 的**源码**入口再导出并打包（不是从它的 `lib/`）：
 * `lib/client.js` 已经是构建好的 CJS 工厂形态，外层的 rolldown 解析不出它的命名导出
 * （实测报 `[MISSING_EXPORT] "apply" is not exported by ../client/lib/client.js`），
 * 而且把一份已构建产物再打包一次也是白费。走源码则与 client 自己那份构建完全同构：
 * react 保持 external（由 shell 提供），`@dslegal/core` 由 `deps.alwaysBundle` 内联。
 *
 * 因为不是从包名导入，`packages/client/package.json` 里那条 `./browser` 条件导出
 * **不再需要**（保留亦无害，但不要在这条路径上依赖它）。
 *
 * DSH 通过 package.json 的 `dsh.client` 声明在**同一行**发现这一面，
 * 因此插件设置里不会再多出一张卡。
 */

export { apply, inject, name } from '../../client/src/client.js'
