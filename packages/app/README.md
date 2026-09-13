# dsh-legal-schedule

DSLegalPlugin 的**对外统一包**——也是本仓库**唯一**的 DSH 插件包。

一个包同时提供两半，因此 DSH 的「插件设置」里只出现**一个条目**：

| 出口 | 运行位置 | 内容 |
| --- | --- | --- |
| `lib/index.js`（`exports["."]`） | host（Node） | `legal_*` 工具 + `/dslegal/*` HTTP + 工作日志监听 |
| `lib/client.js`（`exports["./client"]`，由 `dsh.client` 声明） | client（浏览器） | 「法程」工作台面板 |

## 为什么是"一个包"而不是"一个 host 包 + 一个 client 包"

DSH 的插件设置列出的是 **loader 行**（`dsh-host-plugin-inventory` 直接遍历
`ctx.loader.entries()` 取 `entry.id` / `entry.options.name`）。所以：

> **一行 loader = 一张卡。**

早先的形态是两行（`@dslegal/host` + `@dslegal/client-ui`），于是搜索 `legal` 会命中两次、
界面上出现两张卡。DSH 支持"一个包同时是 host 插件与 client 插件"——浏览器面通过
package.json 的 `dsh.client` 声明挂在**同一行**上——所以合并成一个包后：

- 仍然只需要一行 loader 条目；
- 浏览器面被发现的机制不变（`dsh-client-modules` 扫描各行的 `dsh.client` 声明）；
- 界面上只剩一张卡。

平台自己的 `dsh-web-plugin-manager` 就是这个形态。

## 构建：两半都自足

```tsdown.config.ts` 有两个入口，`deps.alwaysBundle: [/^@dslegal\//]` 把 workspace 包**强制内联**：

- host 面 ≈ 778 KB（内联 `@dslegal/host` + `@dslegal/core`）
- 浏览器面 ≈ 687 KB（从 `@dslegal/client-ui` 的**源码**内联，含 `@dslegal/core`）

这样"复制产物"的安装方式（见 AGENTS.md「profile 安装方式」）只需放一个目录。

两个必须记住的构建坑：

1. **必须用 `deps.alwaysBundle`，不能用已废弃的 `noExternal`**：`noExternal` 只按**裸包名**
   匹配，带子路径的 `@dslegal/client-ui/browser` 匹配不上，产物只剩 0.7 kB（实测踩过）。
2. **浏览器面必须从对方的 `src/` 源码入口打包**，不能从它的 `lib/client.js`：后者已是构建好的
   CJS 工厂形态，外层 rolldown 解析不出命名导出，直接报 `[MISSING_EXPORT]`。

另外：`packages/client/lib/` 与 `packages/app/lib/` 都是构建产物（`.gitignore` 忽略 `lib/`），
改完 `packages/client/src/**` 后**必须重新构建本包**才会进 profile。

## 装入 profile

```powershell
corepack pnpm --filter dsh-legal-schedule build
# 复制到 ~/.dsh/profiles/web/node_modules/dsh-legal-schedule/（package.json + lib/）
```

`~/.dsh/profiles/web/cordis.patch.yml` 只需一行：

```yaml
- insert:
    - id: dsh-legal-schedule
      name: 'dsh-legal-schedule'
```

## 守卫

`test/plugin.test.ts`（9 项）：

- 全仓库**只有本包**声明 `dsh.client`（多一处声明 = 插件设置里多一张卡）；
- 声明了 `dsh.client`（platform: web）与 `./client` 出口；
- 产物 banner 的模块 id 等于包名；
- 两半产物自足：浏览器面只 `require` react / react/jsx-runtime，`@dslegal/*` 一个不留；
- host 面不得有 `export default`（loader 会拆包导致 `inject` 丢失）。
