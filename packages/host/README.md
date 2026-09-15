# @dslegal/host

DSLegalPlugin 的 DSH host 插件（Node 侧）：注册 `legal_*` 工具、扫描三级目录、读写「1. 工作日志.md」、监听外部改动。

**状态：P3 已完成**（工具集 + 文件访问 + 文件监听；84 项测试）。

## 组成

- **`config.ts`** —— 插件配置（schemastery）+ 类型目录映射解析。
- **`workspace.ts`** —— 扫描 `<根目录>/<类型目录>/<项目目录>/0. 协作/1. 工作日志.md`；区分完整项目与结构不完整的项目。**三级目录可各自独立设定**：类型目录与项目目录都可以另行指定绝对路径（可在根目录之外）。根目录下的子文件夹走**两条判据**——名称在映射里的，或是**其下存在**符合项目目录形式规则的子文件夹的（**结构补判**，认出来之后不限类别、其余子文件夹不进"结构不完整"清单）；两条都不满足的完全不扫。
- **`store.ts`** —— 读取并解析工作日志；**原子写入**（临时文件 + rename）。
- **`watcher.ts`** —— chokidar 监听 + **防抖** + **回环抑制**；适配器与时钟可注入，便于测试。
- **`tools.ts`** —— 10 个 `legal_*` 工具的 schema 与实现。
- **`index.ts`** —— Cordis 插件入口（`name` / `inject` / `Config` / `apply`）。

## 工具清单

| 工具 | 作用 |
| --- | --- |
| `legal_project_list` | 列出已就绪的项目（项目名 / 类型目录 / 类别 / 工作日志路径） |
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
    rootDir: 'D:/法律工作'
    extraTypeDirs: ['E:/另一处/顾问单位']
    extraProjectDirs: ['F:/临时接的案件/某某案']
    debounceMs: 150
    echoWindowMs: 500
```

- `rootDir`（可选）：根目录绝对路径；省略表示尚未设定（可由界面在「插件设置」里填）。
- `typeDirs`（可选）：类型目录名 → 服务类别列表；省略时使用 `@dslegal/core` 的默认映射。映射里没有这个名字的类型目录**不限类别**。
- `extraTypeDirs`（可选）：**另行指定的类型目录**（绝对路径列表，可在根目录之外）；其下的子文件夹即项目目录。
- `extraProjectDirs`（可选）：**另行指定的项目目录**（绝对路径列表，可在根目录之外）；其"类型目录名"取父文件夹名。
- `debounceMs` / `echoWindowMs`（可选）：文件监听的防抖与回环抑制窗口。

以上都是**组合层默认值**，界面上保存的用户设置（`$DSH_HOME/settings.yaml` 的 `dslegal:` 段）优先。三级目录**一个都没设定**时，工具与接口返回「尚未设定目录」提示。

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
