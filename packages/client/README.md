# @dslegal/client-ui

DSLegalPlugin 的**浏览器侧 UI 库**：日历视图、待办视图、项目分组。

> **本包不是 DSH 插件包。** 它对外的身份是"一份浏览器代码"，由统一包
> `dsh-legal-schedule`（`packages/app`）从 `src/client.tsx` 内联进它自己的产物。
> 全仓库**只有 `dsh-legal-schedule` 一个包声明 `dsh.client`**，因此 DSH 的
> 「插件设置」里只有一个条目（守卫：`packages/app/test/plugin.test.ts`）。

**状态：P4 已完成**——构建管线、插槽注册、数据通道与工作台面板均已实装。

## 唯一出口

| 出口 | 运行位置 | 作用 |
| --- | --- | --- |
| `lib/client.js`（`exports["./client"]`） | client（浏览器） | 工作台面板本体 |

原先还有一个 `lib/index.js` 的 host 侧半边（P1 骨架，空 `apply`），**已删除**：
本包不再挂载为 loader 行，那个半边永远不会被加载。

## 关键：浏览器侧产物形态

DSH 的浏览器插件**不是普通 ESM**，必须由 client module loader 以工厂形式加载：

```js
window.__ModuleLoader__.load({ id: '@dslegal/client-ui', factory: (require) => { ... } })
```

由 `tsdown.config.ts` 用 `format: cjs` + `banner`/`footer` 生成，规则：

- **只有 shell 提供的共享模块可以 `require`**（react / react/jsx-runtime / cordis / dsh-client-*）；
- **包名不得以 `/client` 结尾**——DSH 的 `stripClientSuffix` 会把 `@pkg/client` 误削成 `@pkg`，
  boot graph 查不到该行，插件装配整体失败（本包因此更名 `@dslegal/client` → `@dslegal/client-ui`）；
- **`@dslegal/core` 必须内联**，否则浏览器模块表里找不到它。

## 插槽

注册进 **`shell.overlay`**（`kind: list`、`scope: root`、无必需 owner props 的加法插槽）：

```ts
slots.inject('shell.overlay', () => {
  slots.register({ name: 'shell.overlay', id: 'dslegal-workbench' }, () => <Workbench />)
})
```

`slots` 通过 `ctx.get('slots')` 获取，且**必须在插件面声明 `inject: ['slots']`**：
声明为空数组时 `apply` 会在 `slots` 就绪前跑完并静默 `return`，界面上连按钮都不会出现
（2026-09-13 升级 DSH 后实测踩到）。

## 数据通道

通过统一包 host 面注册的 `/dslegal/*` HTTP 接口取数与写入：

- `GET /dslegal/overview` —— 一次取回完整数据集（全部项目 + 全部待办含已完成 + 全部日程）
- `GET /dslegal/projects` —— 项目列表（含类别、类别诊断）
- `GET /dslegal/agenda?project=<名>[&typeDir=<名>]` —— 待办 + 日程 + 格式异常
- `GET /dslegal/settings` / `POST /dslegal/settings` —— 三级目录设置与四象限颜色
- `POST /dslegal/edit` —— 单一写入端点，body 形如
  `{ op: 'todo.add' | 'todo.set' | 'todo.remove' | 'schedule.add' | 'schedule.set' | 'schedule.remove', project, typeDir?, target?: { line, title }, input?: {...} }`
- `POST /dslegal/open` —— 用系统默认程序打开某条目所在的工作日志（**只送项目 + 行号，从不送路径**）

> 选型说明：DSH 的 Client RPC 走 Typert（需要严格生成的贡献产物），本项目为个人本地使用，
> 采用 `ctx.webServer.register()` 的命名路由，实现简单且可测。若将来要发布给他人，再迁移到 Typert。

**写入安全**：所有修改 / 删除都传 `target: { line, title }`，host 会校验其与文件当前内容一致，不一致即拒绝。

### 三级目录与目录设置

数据路径是 **`<根目录>/<类型目录>/<项目目录>/0. 协作/1. 工作日志.md`**，三级可**各自独立设定**：

| 字段 | 含义 | 界面形态 |
| --- | --- | --- |
| `rootDir` | 根目录：里面放各类型目录；未设定为 `null`，`''` 表示清空 | 单行 `<input>` |
| `extraTypeDirs` | **另行指定**的类型目录（可以位于根目录之外） | 多行 `<textarea>`，一行一个绝对路径 |
| `extraProjectDirs` | **另行指定**的项目目录（可以位于根目录之外，也可直接指向某个案件文件夹） | 同上 |

- `configured === false` 的判定是「三级目录**一个都没设定**」——只设了「另行指定的项目目录」也算已配置。
- `POST /dslegal/settings` 是**部分保存**：
  `{ rootDir?, extraTypeDirs?, extraProjectDirs?, priorityColors? }`，没传的键保持原值
  （四组都能单独保存，一组都不传则 400）。
- 多行文本 ↔ 数组的转换是 `view.ts` 的纯函数 `directoryListOf`：按行拆分 → 去首尾空白 →
  丢弃空行 → **保序去重（Windows 大小写不敏感）**，有单测。表单里不自己写第二份解析。

**取数时的降级策略（刻意分成两档）**：

| 字段 | 缺失时 | 为什么 |
| --- | --- | --- |
| `schedules` / `todos` | **抛错**（`HOST_OUTDATED`） | 缺失等于"数据是错的"：界面会把"接口没这个字段"渲染成"今天没有安排" |
| `priorityColors` | 退回内置默认色 + `colorsUnavailable` 标记 | 内置默认色正是旧 host 一直在用的那一套，是**可证明正确**的兜底 |
| `rootDir` / `extraTypeDirs` / `extraProjectDirs` | 降级成 `null` / `[]` | 旧 host 的响应里本来就没有这些键（那是常态）；抛错会让设置页整页打不开 |

降级只在 `api.ts` 里做一次（`dirFieldsOf`），所以 `Overview` / `SettingsView` 上的这三个字段是**必填**的，
调用方不必再判 `undefined`；`client.tsx` 的 `openSetup` 另有一道「字段确实存在才覆盖草稿」的判断，
防的是"旧 host 的 `/dslegal/settings` 把用户已配好的目录覆盖成空"。

## 界面内容

- 左下角「法程」浮标 → 展开面板（可按住拖动，落点存 `localStorage`）
- 三条并列线索：日程（日 / 周 / 月）、待办（四象限）、项目（分组明细）
- 「插件设置」子页里两块，**各自独立保存**：「目录设置」（根目录单行输入 + 两份「一行一个
  绝对路径」的清单）与「四象限颜色」
- 自建月历：格线只画内部细分隔线，格内铺农历 / 节气 / 传统节日与法定节假日「休 · 班」
- 使用说明：折叠式；讲了三级目录各自可独立设定、可指向根目录之外，而 `0. 协作` 与
  `1. 工作日志.md` 两个名字**固定不可配**

样式全部使用 DSH 主题 CSS 变量，未引入 Tailwind 或第三方日历库。

## 开发

```sh
corepack pnpm --filter @dslegal/client-ui typecheck
corepack pnpm --filter @dslegal/client-ui test
corepack pnpm --filter @dslegal/client-ui build

# 装进 profile：先构建统一包，再复制它的产物
corepack pnpm --filter dsh-legal-schedule build
```

> 改完本包的 `src/**` 后，**必须重新构建 `dsh-legal-schedule` 并重启 dsh** 才会生效：
> 浏览器面是被内联进那个包的产物的，本包自己的 `lib/` 不直接进 profile。
