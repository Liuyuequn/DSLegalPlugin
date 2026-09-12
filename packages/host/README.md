# @dslegal/host

DSLegalPlugin 的 DSH host 插件（Node 侧）：注册 `legal_*` 工具、扫描数据根目录、读写「1. 工作日志.md」、监听外部改动。

**状态：P3 已完成**（工具集 + 文件访问 + 文件监听，18 项测试）。

## 组成

- **`config.ts`** —— 插件配置（schemastery）+ 顶级目录映射解析。
- **`workspace.ts`** —— 扫描 `<数据根目录>/<顶级目录>/<项目>/0. 协作/1. 工作日志.md`；区分完整项目与结构不完整的项目。
- **`store.ts`** —— 读取并解析工作日志；**原子写入**（临时文件 + rename）。
- **`watcher.ts`** —— chokidar 监听 + **防抖** + **回环抑制**；适配器与时钟可注入，便于测试。
- **`tools.ts`** —— 10 个 `legal_*` 工具的 schema 与实现。
- **`index.ts`** —— Cordis 插件入口（`name` / `inject` / `Config` / `apply`）。

## 工具清单

| 工具 | 作用 |
| --- | --- |
| `legal_project_list` | 列出已就绪的项目（项目名 / 顶级目录 / 类别 / 工作日志路径） |
| `legal_todo_list` | 列出某项目的待办（未完成优先 → 优先级 → 原文序） |
| `legal_todo_add` | 追加待办 |
| `legal_todo_set` | 修改待办（标题 / 优先级 / 备注 / 完成状态） |
| `legal_todo_remove` | 删除待办 |
| `legal_schedule_list` | 列出某项目的日程（开始时刻升序，可按日期范围筛选） |
| `legal_schedule_add` | 追加日程 |
| `legal_schedule_set` | 修改日程 |
| `legal_schedule_remove` | 删除日程 |
| `legal_agenda_query` | 跨项目汇总（未完成待办数、进行中日程数等） |

**条目定位约定**：所有修改 / 删除操作都要传 `target: { line, title }`，两者必须与 `legal_*_list` 返回的一致；不一致即拒绝写入并提示重新 list——防止文件被外部改动后误改到别的条目。

## 配置

在 profile 的 `cordis.patch.yml` 中通过该行的 `config` 提供：

```yaml
- id: dslegal-host
  name: '@dslegal/host'
  config:
    dataRoot: 'D:/法律工作'
    debounceMs: 150
    echoWindowMs: 500
```

- `dataRoot`（必填）：数据根目录绝对路径。
- `topLevelDirs`（可选）：顶级目录名 → 服务类别列表；省略时使用 `@dslegal/core` 的默认映射。
- `debounceMs` / `echoWindowMs`（可选）：文件监听的防抖与回环抑制窗口。

## 事件

插件会发出 `dslegal/work-log-changed` 事件（payload `{ path }`），供后续 client 层（P4）刷新界面。该事件已防抖并抑制了插件自身写入产生的回环。

## 硬约束

- **禁止 `export default`**：必须是 `{ name, inject, apply }` 命名导出。
- **不创建目录**：只读取用户已建好的结构。
- **写入只改目标行**：写回由 `@dslegal/core` 的外科手术式引擎产出，host 只做原子落盘。
- 工具名一律 `legal_` 前缀，避免与 DSH 内建 `todo_write` / `schedule_*` 语义冲突。

## 开发

```sh
corepack pnpm --filter @dslegal/host typecheck
corepack pnpm --filter @dslegal/host test
corepack pnpm --filter @dslegal/host build
```
