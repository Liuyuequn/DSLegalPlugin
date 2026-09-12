# @dslegal/client-ui

DSLegalPlugin 的 DSH client UI 插件（浏览器侧）：工作台面板。

**状态：P4 已完成**——构建管线、插槽注册、数据通道与工作台面板均已实装。

## 双半结构

| 出口 | 运行位置 | 作用 |
| --- | --- | --- |
| `lib/index.js`（`exports["."]`） | host（Node） | 预留 |
| `lib/client.js`（`exports["./client"]`） | client（浏览器） | 注册工作台面板 |

## 关键：浏览器侧产物形态

DSH 的浏览器插件**不是普通 ESM**，必须由 client module loader 以工厂形式加载：

```js
window.__ModuleLoader__.load({ id: '@dslegal/client-ui', factory: (require) => { ... } })
```

由 `tsdown.config.ts` 用 `format: cjs` + `banner`/`footer` 生成，规则：

- **只有 shell 提供的共享模块可以 `require`**（react / react/jsx-runtime / cordis / dsh-client-*）；
- **包名不得以 `/client` 结尾**——DSH 的 `stripClientSuffix` 会把 `@pkg/client` 误削成 `@pkg`，boot graph 查不到该行，插件装配整体失败（本包因此更名 `@dslegal/client` → `@dslegal/client-ui`）；守卫见 `test/package-name.test.ts`；
- **`@dslegal/core` 必须内联**（`noExternal`），否则浏览器模块表里找不到它。

## 插槽

注册进 **`shell.overlay`**（`kind: list`、`scope: root`、无必需 owner props 的加法插槽）：

```ts
slots.inject('shell.overlay', () => {
  slots.register({ name: 'shell.overlay', id: 'dslegal-workbench' }, () => <Workbench />)
})
```

`slots` 通过 `ctx.get('slots')` 可选获取；插槽名一律以实查为准，不硬编码其它插槽。

## 数据通道

通过 host 半边注册的 `/dslegal/*` HTTP 接口取数与写入：

- `GET /dslegal/projects` —— 项目列表（含类别、类别诊断）
- `GET /dslegal/agenda?project=<名>[&topLevelDir=<名>]` —— 待办 + 日程 + 格式异常
- `POST /dslegal/edit` —— 单一写入端点，body 形如
  `{ op: 'todo.add' | 'todo.set' | 'todo.remove' | 'schedule.add' | 'schedule.set' | 'schedule.remove', project, topLevelDir?, target?: { line, title }, input?: {...} }`

> 选型说明：DSH 的 Client RPC 走 Typert（需要严格生成的贡献产物），本项目为个人本地使用，
> 采用 `ctx.webServer.register()` 的命名路由，实现简单且可测。若将来要发布给他人，再迁移到 Typert。

**写入安全**：所有修改 / 删除都传 `target: { line, title }`，host 会校验其与文件当前内容一致，不一致即拒绝。

## 界面内容

- 右下角「工作台」按钮 → 展开面板
- 项目选择（显示类别，类别异常时提示）
- 待办列表：优先级色点（`PRIORITY_COLORS`）、复选框直接切换完成状态、输入框快速新增
- 自建月历：周一格起始的 42 格网格，按开始日期聚合日程，显示时间与优先级色点
- 底部列出格式异常行

样式全部使用 DSH 主题 CSS 变量，未引入 Tailwind 或第三方日历库。

## 开发

```sh
corepack pnpm --filter @dslegal/client-ui typecheck
corepack pnpm --filter @dslegal/client-ui build
```
