# @dslegal/core

DSLegalPlugin 领域核心：数据模型、数据契约常量与「1. 工作日志.md」解析器。

**纯逻辑，无运行时依赖，可独立发布与复用。**

数据契约的权威定义在仓库的 `maintenance/2. DSLegalPlugin 数据约定规范.md`。

## 组成

- **`model.ts`** —— 优先级与默认颜色、8 类法律服务、待办 / 日程条目类型、解析问题类型。
- **`convention.ts`** —— 目录名、文件名、章节标题、日期 / 时间格式、字段数上限，以及日期 / 时间校验函数。
- **`parse.ts`** —— 解析「1. 工作日志.md」为待办 / 日程条目 + 问题清单（只读）。
- **`format.ts`** —— 条目行渲染与输入校验（渲染结果保证能被解析器无损读回）。
- **`write.ts`** —— 外科手术式写回：追加 / 替换 / 删除 / 切换完成，只改目标行。
- **`query.ts`** —— 状态派生（有效时间区间、"进行中"）、分组、排序、筛选、汇总。

## 设计约束

- **异常行不作为条目**：任何校验失败的行只在 `issues` 中报告，调用方必须原样保留该行，不得静默丢弃或改写。
- **可定位**：每个条目保留 `line`（1-based 行号）与 `raw`（原始行文本），写回时据此定点替换。
- **写回字节保真**：只替换目标行，保留 BOM、CRLF / LF、结尾换行与否，以及章节之外的一切内容。
- **写入前置校验**：传入条目的 `raw` 与文件当前行不一致时拒绝写入（`stale-item`），避免落到错误的行上。
- **文件监听不属于本包**：它属于 host 层（P3）。

## 用法

```ts
import { addTodoItem, parseWorkLog, sortTodos, summarize } from '@dslegal/core'

// 读取
const result = parseWorkLog(markdownText)
result.todo.items      // TodoItem[]，按文件顺序
result.schedule.items  // ScheduleItem[]，按文件顺序
result.todo.issues     // 章节内问题（含行号与原始行文本）
result.issues          // 章节级问题（缺失 / 重复）

// 写回（只改目标行，其余字节不变）
const written = addTodoItem(markdownText, { title: '起草起诉状', priority: '重要且紧急' })
if (written.ok) await writeFile(filePath, written.text, 'utf8')
else console.error(written.code, written.message)

// 查询 / 分组 / 排序 / 汇总
sortTodos(result.todo.items)
summarize(result.todo.items, result.schedule.items, new Date())
```

## 开发

```sh
corepack pnpm --filter @dslegal/core test
corepack pnpm --filter @dslegal/core typecheck
corepack pnpm --filter @dslegal/core build
```

测试覆盖正常路径（`test/fixtures/1. 工作日志.md`）与全部校验分支。
