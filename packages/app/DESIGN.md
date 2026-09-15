# dsh-legal-schedule · 内部设计

本文件面向**维护者**。想安装使用请读 [`README.md`](./README.md)。

---

## 1. 一个包，两半

DSH 插件可以同时拥有 **host 面**（Node）与**浏览器面**（Web），二者都要有入口：

| 出口 | 运行位置 | 内容 |
| --- | --- | --- |
| `lib/index.js`（`exports["."]`） | host（Node） | 10 个 `legal_*` 工具 + `/dslegal/*` HTTP + 工作日志监听 |
| `lib/client.js`（`exports["./client"]`） | client（浏览器） | `shell.overlay` 插槽里的「法程」工作台面板 |

浏览器面通过 `package.json` 的 `dsh.client` 声明**挂在同一行 loader 条目上**被发现，所以只需要一行配置。平台自身的 `dsh-web-plugin-manager` 也是这个形态。

### 为什么**不**拆成两个包

因为 DSH 的「插件设置」列出的是 **loader 行**（`dsh-host-plugin-inventory` 的 `list()` 直接遍历 `ctx.loader.entries()` 取 `entry.id` / `entry.options.name`），而

> **一行 loader = 一张卡。**

早先的形态是两个包各占一行（`@dslegal/host` + `@dslegal/client-ui`），于是搜索 `legal` 会命中两次、界面出现两张卡。合并成一个包后只剩一张卡（这正是 2026-09-13 那轮重构的目标）。

配套的取舍：`packages/core`、`packages/host`、`packages/client` 仍是独立的 workspace 包（各自可独立单测、类型检查），但它们**不是插件包**——只有 `packages/app` 声明 `dsh.client`，并由它把三者**内联**进自己的产物。

---

## 2. bundle 协议：让安装不必手改 YAML

`package.json` 里：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "inject": ["@deepseek-ai/dsh-client-ui-layout"], "platform": "web" }
}
```

平台的 `dsh-app-boot` 会按 `profile.dsh.profile.bundles` 的顺序，逐层应用每个 bundle 自带的 patch 文件，最后才应用 profile 自己的 `cordis.patch.yml`：

> Bundles are npm packages whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`.

因此用户只需「装包 + 把包名加进 bundles 列表」，**不必手写 insert 行**。已实测：profile 的 `cordis.patch.yml` 留空数组 `[]` 时，host 面照样挂载。

**关于"手工行与 bundle 行同时存在"**：`applyEntryPatches` 的 `insert` 不做去重，但浏览器侧的模块表与 boot graph 都**按 id 去重**，所以只是多一个冗余行，不会出错。

---

## 3. 构建：两半都必须自足

```ts
// packages/app/tsdown.config.ts
deps: { alwaysBundle: [/^@dslegal\//] }
```

产物体量（`0.2.0`）：

| 产物 | 大小 | 外部依赖 |
| --- | --- | --- |
| `lib/index.js` | 855 KB | **只有 `node:*` 内置模块**（`schemastery`、`chokidar` 已内联） |
| `lib/client.js` | 708 KB | **只有 `react`、`react/jsx-runtime`**（由 shell 提供） |

所以 `dependencies` 是**空的**——这是刻意的：内部三包从未发布到 npm，若留在 `dependencies` 里，`pnpm publish` 会把 `workspace:*` 改写成 `@dslegal/core@0.0.0` 这类**不存在的版本**，用户安装必然失败。它们只出现在 `devDependencies`（构建输入）。

### 四个已踩过的构建坑

1. **必须用 `deps.alwaysBundle`，不能用已废弃的 `noExternal`**：后者只按**裸包名**匹配，带子路径的 specifier（如 `@dslegal/client-ui/browser`）匹配不上，那一半会被留成 `require(...)`，产物缩到 0.7 kB。
2. **浏览器面必须从对方的 `src/` 源码入口打包**，不能从它的 `lib/client.js`：后者已是构建好的 CJS 工厂形态，外层 rolldown 解析不出命名导出，直接报 `[MISSING_EXPORT]`。
3. **`react` 必须在 `peerDependencies`**（peer 默认保持 external）。曾把它挪进 `devDependencies`，打包器就把 React **整个内联**进浏览器产物（687 KB → 791 KB，且 `require` 列表变空）。这类"降级成内联"不报错、只是悄悄变胖，**必须靠守卫断言**。
4. **host 入口必须 `dts: false`**：`src/index.ts` 只是再导出 `@dslegal/host`，开着 dts 时 tsdown 会顺着 import 去生成跨包声明，把 `.d.ts` 写到**别的包的源码目录**里（实测 `packages/client/src/` 下冒出 6 组，每次构建都复现）。本包只被"复制产物"进 profile，运行时不需要声明文件。

### 发布时的坑（2026-09-13 首次发布踩到）

**遇到 `Enter OTP:` 或 `Press ENTER to open in the browser...`，第一动作是"按回车"。**

那两行是 npm 在说"我要走浏览器授权"。按回车 → 浏览器打开授权页 → 点一下 → 发布完成。**不需要任何验证码生成器**。

我在这上面走了远路：先去找 Edge 的"一次性密码"功能（Edge 153 没有），又写了个 Node TOTP 工具并配了测试。**正确做法只是按一下回车。**

> **教训（比这条坑本身更重要）**：交互式提示先穷尽"按一下"的可能，再考虑"造工具"。造工具之前应该先试最简单的那个动作。当时我甚至没试。
>
> 另外两条与发布相关的实测：`--otp=` 必须是**当前有效的 6 位**（写 7 位会被忽略并转入交互式索要）；走浏览器授权时**完全不用**这个参数。

---

## 4. 守卫

`test/plugin.test.ts`（**11 项**）钉住上面这些不变量：

- 全仓库**只有本包**声明 `dsh.client`（多一处 = 插件设置里多一张卡）；
- 声明了 `dsh.client`（platform: web）与 `./client` 出口；
- 产物 banner 的模块 id 等于包名（不等会报 `not a row in the boot graph`，而服务器端探针全部正常，极具迷惑性）；
- 浏览器面只 `require` `react` / `react/jsx-runtime`，且不含任何 `@dslegal/*` 外部导入；
- host 面不含任何 `@dslegal/*` 外部导入，且**不得有 `export default`**（loader 会拆包导致 `inject` 丢失）；
- **host 面只依赖 `node:*` 内置模块**，且 **`dependencies` 必须为空**——这两条守的是"发布后能装"：内部三包若留在 `dependencies`，`pnpm publish` 会把 `workspace:*` 改写成不存在的版本；若某个包（chokidar / schemastery）漏出成外部 import，用户侧会 `ERR_MODULE_NOT_FOUND`，而**本地 profile 与服务器端都不报错**（本地 node_modules 里恰好有这些包）。

---

## 5. 浏览器侧的硬约束（改客户端代码前必读）

- 产物必须是 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` 工厂形态；`id` 必须等于包名。
- 只能 `require` shell 提供的共享模块；`@dslegal/*` 一律内联。
- **包名不得以 `/client` 结尾**：DSH 的 `stripClientSuffix` 会把 `@pkg/client` 误削成 `@pkg`，boot graph 行永远查不到。
- **插件面必须声明 `inject: ['slots']`**：客户端 runner 用它决定"这一行要不要等依赖就绪再 apply"。声明为空数组时 `apply` 会在 `slots` 就绪前跑完，`ctx.get('slots')` 是 `undefined` → 静默 `return` → **界面上连按钮都不出现，控制台一句错都不报**（2026-09-13 实测踩到）。
- **不要引用已消失的平台包**：`@deepseek-ai/dsh-client-runtime` 与 `dsh-client-ui-slots` 在 DSH 0.1.5-rc.2 已取消；`ClientContext` 直接用 `@deepseek-ai/cordis` 的 `Context`。

---

## 6. 改完代码后怎么让 DSH 用上

浏览器面是被**内联**进 `packages/app/lib/client.js` 的，所以：

```powershell
corepack pnpm --filter dsh-legal-schedule build
# 再把 packages/app 的 package.json + lib/*.js + cordis.patch.yml
# 复制到 ~/.dsh/profiles/web/node_modules/dsh-legal-schedule/
# 然后重启 dsh
```

只跑 `--filter @dslegal/client-ui build` **不会**影响 profile——`packages/client/lib/` 不直接进 profile。

---

## 7. 仓库结构

```
packages/
├── core/    @dslegal/core        领域逻辑：解析/回写工作日志、格式化条目、四象限颜色、农历与法定节假日
├── host/    @dslegal/host        host 面实现：工具、HTTP、扫描、监听
├── client/  @dslegal/client-ui   浏览器面实现（UI 库，不是插件包）
└── app/     dsh-legal-schedule   **唯一的 DSH 插件包**：再导出两半 + 内联三者 + 自带 bundle patch
```
