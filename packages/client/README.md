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

- `GET /dslegal/projects` —— 项目列表（含类别、类别诊断）
- `GET /dslegal/agenda?project=<名>[&topLevelDir=<名>]` —— 待办 + 日程 + 格式异常
- `POST /dslegal/edit` —— 单一写入端点，body 形如
  `{ op: 'todo.add' | 'todo.set' | 'todo.remove' | 'schedule.add' | 'schedule.set' | 'schedule.remove', project, topLevelDir?, target?: { line, title }, input?: {...} }`

> 选型说明：DSH 的 Client RPC 走 Typert（需要严格生成的贡献产物），本项目为个人本地使用，
> 采用 `ctx.webServer.register()` 的命名路由，实现简单且可测。若将来要发布给他人，再迁移到 Typert。

**写入安全**：所有修改 / 删除都传 `target: { line, title }`，host 会校验其与文件当前内容一致，不一致即拒绝。

## 界面内容

- 左下角「法程」浮标 → 展开面板（可按住拖动，落点存 `localStorage`）
- 三条并列线索：日程（日 / 周 / 月）、待办（四象限）、项目（分组明细）
- 自建月历：格线只画内部细分隔线，格内铺农历 / 节气 / 传统节日与法定节假日「休 · 班」

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
