/**
 * `legal_*` 工具注册。
 *
 * 工具名一律加 `legal_` 前缀，避免与 DSH 内建 `todo_write`（agent 自身任务清单）
 * 和 `schedule_create` / `schedule_list` / `schedule_delete`（DSH 提醒系统）语义冲突。
 *
 * 约定：写入失败一律抛出 `Error`，由工具注册表物化为错误结果；模型据此可自行纠正。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  PRIORITIES,
  addScheduleItem,
  addTodoItem,
  filterScheduleByRange,
  groupByDone,
  removeItem,
  replaceScheduleItem,
  replaceTodoItem,
  schedulePhase,
  sortSchedule,
  sortTodos,
  summarize,
  type Priority,
  type ScheduleItem,
  type TodoItem,
} from '@dslegal/core'

import {
  commit,
  issuesJson,
  locate,
  requireProject,
  scheduleJson,
  todoJson,
  type JsonObject,
  type LegalDeps,
} from './deps.js'

/** 工具实现所需的依赖（与 HTTP 适配器共享同一份领域操作）。 */
export type ToolDeps = LegalDeps

// ---------------------------------------------------------------------------
// 参数片段
// ---------------------------------------------------------------------------

const PROJECT = {
  type: 'string',
  required: true,
  description: '项目名（项目文件夹名）。若同名项目存在于多个顶级目录，请同时提供 topLevelDir。',
} as const

const TOP_LEVEL = {
  type: 'string',
  description: '顶级目录名（如「诉讼案件」），用于消歧同名项目。',
} as const

const PRIORITY = {
  type: 'string',
  enum: [...PRIORITIES],
  description: `优先级：${PRIORITIES.join(' / ')}。省略表示不设置。`,
} as const

const NOTE = { type: 'string', description: '备注。省略表示不设置；传空串表示清除。' } as const

const TARGET = {
  type: 'object',
  required: true,
  additionalProperties: false,
  description:
    '目标条目：line 与 title 必须与 legal_*_list 返回的一致；不一致会拒绝写入，请重新 list。',
  properties: {
    line: { type: 'integer', required: true, description: '条目的 1-based 行号。' },
    title: { type: 'string', required: true, description: '该行的标题（校验用）。' },
  },
} as const

// ---------------------------------------------------------------------------
// 输出片段（output 必须是 { schema, render }）
// ---------------------------------------------------------------------------

const WRITE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project: { type: 'string', required: true },
      line: { type: 'integer', required: true },
      message: { type: 'string', required: true },
    },
  },
  render: (_args: unknown, value: { message: string }) => [
    { type: 'text' as const, text: value.message },
  ],
} as const

const LIST_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project: { type: 'string', required: true },
      workLogPath: { type: 'string', required: true },
      category: { type: 'string', description: '由工作日志 H1 解析出的服务类别。' },
      count: { type: 'integer', required: true },
      items: { type: 'array', required: true, items: { type: 'json' } },
      issues: { type: 'array', required: true, items: { type: 'json' } },
      message: { type: 'string', required: true },
    },
  },
  render: (_args: unknown, value: { message: string }) => [
    { type: 'text' as const, text: value.message },
  ],
} as const

const PROJECT_LIST_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      count: { type: 'integer', required: true },
      projects: { type: 'array', required: true, items: { type: 'json' } },
      incomplete: { type: 'array', required: true, items: { type: 'json' } },
      message: { type: 'string', required: true },
    },
  },
  render: (_args: unknown, value: { message: string }) => [
    { type: 'text' as const, text: value.message },
  ],
} as const

const QUERY_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      projects: { type: 'array', required: true, items: { type: 'json' } },
      total: { type: 'json', required: true },
      message: { type: 'string', required: true },
    },
  },
  render: (_args: unknown, value: { message: string }) => [
    { type: 'text' as const, text: value.message },
  ],
} as const

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function todoText(item: TodoItem): string {
  const parts = [`第 ${item.line} 行`, item.done ? '[x]' : '[ ]', item.title]
  if (item.priority !== null) parts.push(`· ${item.priority}`)
  if (item.note !== null) parts.push(`· ${item.note}`)
  return parts.join(' ')
}

function scheduleText(item: ScheduleItem, now: Date): string {
  const time =
    item.startTime === null
      ? '全天'
      : item.endTime === null
        ? item.startTime
        : `${item.startTime}-${item.endTime}`
  const span = item.endDate === null ? item.startDate : `${item.startDate}→${item.endDate}`
  const parts = [
    `第 ${item.line} 行`,
    item.done ? '[x]' : '[ ]',
    item.title,
    `· ${span} ${time}`,
    `· ${schedulePhase(item, now)}`,
  ]
  if (item.priority !== null) parts.push(`· ${item.priority}`)
  if (item.location !== null) parts.push(`· ${item.location}`)
  if (item.note !== null) parts.push(`· ${item.note}`)
  return parts.join(' ')
}

function rangeFrom(from?: string): Date {
  return from === undefined ? new Date(0) : new Date(`${from}T00:00:00`)
}

function rangeTo(to?: string): Date {
  return to === undefined ? new Date(8640000000000000) : new Date(`${to}T00:00:00`)
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

/** 在 `ctx.tools` 上注册全部 `legal_*` 工具。 */
export function registerTools(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'legal_project_list',
      description:
        '列出数据根目录下已就绪的法律服务项目（每个项目一个文件夹，内含「0. 协作/1. 工作日志.md」）。返回项目名、顶级目录、服务类别与工作日志路径。读写日程/待办前先用它确认项目。',
      parameters: { topLevelDir: TOP_LEVEL },
      output: PROJECT_LIST_OUTPUT,
      async execute(args) {
        const { projects: all, incomplete } = await deps.scan()
        const projects =
          args.topLevelDir === undefined
            ? all
            : all.filter((item) => item.topLevelDir === args.topLevelDir)
        const lines = projects.map(
          (item) =>
            `- ${item.topLevelDir} / ${item.project}：类别 ${item.category ?? '未知'}${
              item.categoryIssue === null ? '' : `（${item.categoryIssue}）`
            }`,
        )
        const incompleteNote =
          incomplete.length > 0 ? `\n另有 ${incomplete.length} 个项目目录缺少「1. 工作日志.md」。` : ''
        return {
          count: projects.length,
          projects: projects.map((item) => {
            const row: JsonObject = {
              project: item.project,
              topLevelDir: item.topLevelDir,
              allowedCategories: [...item.allowedCategories],
              workLogPath: item.workLogPath,
            }
            if (item.category !== null) row.category = item.category
            if (item.title !== null) row.title = item.title
            if (item.categoryIssue !== null) row.categoryIssue = item.categoryIssue
            return row
          }),
          incomplete: incomplete.map((item) => ({
            project: item.project,
            topLevelDir: item.topLevelDir,
          })),
          message:
            projects.length === 0
              ? `没有找到已就绪的项目（需要「<项目>/0. 协作/1. 工作日志.md」）。${incompleteNote}`
              : `共 ${projects.length} 个项目：\n${lines.join('\n')}${incompleteNote}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_todo_list',
      description:
        '列出某个项目「1. 工作日志.md」中「## 1. 待办事项」章节的全部待办（未完成优先、按优先级、再按原文顺序）。返回每条的 line（行号）与 title，修改/删除/完成操作需要它们。',
      parameters: {
        project: PROJECT,
        topLevelDir: TOP_LEVEL,
        done: { type: 'boolean', description: 'true 只看已完成，false 只看未完成；省略看全部。' },
      },
      output: LIST_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const all = sortTodos(snapshot.result.todo.items)
        const items = args.done === undefined ? all : all.filter((item) => item.done === args.done)
        return {
          project: location.project,
          workLogPath: location.workLogPath,
          count: items.length,
          items: items.map(todoJson),
          issues: issuesJson(snapshot),
          ...(location.category === null ? {} : { category: location.category }),
          message:
            items.length === 0
              ? `项目「${location.project}」没有匹配的待办。`
              : `项目「${location.project}」共 ${items.length} 条待办：\n${items.map(todoText).join('\n')}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_todo_add',
      description:
        '在指定项目的待办章节末尾追加一条待办。写入只改动目标行，文件其余部分字节不变。',
      parameters: {
        project: PROJECT,
        topLevelDir: TOP_LEVEL,
        title: { type: 'string', required: true, description: '待办标题（非空）。' },
        priority: PRIORITY,
        note: NOTE,
      },
      output: WRITE_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const line = await commit(
          deps,
          location.workLogPath,
          addTodoItem(snapshot.text, {
            title: args.title,
            priority: args.priority as Priority | undefined,
            note: args.note,
          }),
        )
        return {
          project: location.project,
          line,
          message: `已在「${location.project}」第 ${line} 行新增待办：${args.title}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_todo_set',
      description:
        '修改指定项目中的一条待办：可改标题、优先级、备注，或标记完成/未完成。未提供的字段保持不变。target 的 line 与 title 必须与 legal_todo_list 返回的一致。',
      parameters: {
        project: PROJECT,
        topLevelDir: TOP_LEVEL,
        target: TARGET,
        title: { type: 'string', description: '新的标题；省略则不变。' },
        priority: PRIORITY,
        clearPriority: { type: 'boolean', description: 'true 表示清除优先级。' },
        note: NOTE,
        done: { type: 'boolean', description: 'true 标记完成，false 标记未完成；省略则不变。' },
      },
      output: WRITE_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const item = locate(snapshot, 'todo', args.target.line, args.target.title) as TodoItem
        const priority =
          args.clearPriority === true
            ? null
            : ((args.priority as Priority | undefined) ?? item.priority)
        const line = await commit(
          deps,
          location.workLogPath,
          replaceTodoItem(snapshot.text, item, {
            title: args.title ?? item.title,
            priority,
            note: args.note ?? item.note,
            done: args.done ?? item.done,
          }),
        )
        return {
          project: location.project,
          line,
          message: `已更新「${location.project}」第 ${line} 行待办。`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_todo_remove',
      description:
        '删除指定项目中的一条待办。target 的 line 与 title 必须与 legal_todo_list 返回的一致。',
      parameters: { project: PROJECT, topLevelDir: TOP_LEVEL, target: TARGET },
      output: WRITE_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const item = locate(snapshot, 'todo', args.target.line, args.target.title)
        const line = await commit(deps, location.workLogPath, removeItem(snapshot.text, item))
        return {
          project: location.project,
          line,
          message: `已删除「${location.project}」的待办：${args.target.title}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_schedule_list',
      description:
        '列出某个项目「1. 工作日志.md」中「## 2. 日程安排」章节的日程（按开始时刻升序）。可用 from/to（YYYY-MM-DD）筛选与该区间有交集的日程。返回每条的 line 与 title，后续操作需要它们。',
      parameters: {
        project: PROJECT,
        topLevelDir: TOP_LEVEL,
        from: { type: 'string', description: '起始日期 YYYY-MM-DD（含）。' },
        to: { type: 'string', description: '结束日期 YYYY-MM-DD（不含）。' },
      },
      output: LIST_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        let items = sortSchedule(snapshot.result.schedule.items)
        if (args.from !== undefined || args.to !== undefined) {
          items = filterScheduleByRange(items, rangeFrom(args.from), rangeTo(args.to))
        }
        const now = new Date()
        return {
          project: location.project,
          workLogPath: location.workLogPath,
          count: items.length,
          items: items.map(scheduleJson),
          issues: issuesJson(snapshot),
          ...(location.category === null ? {} : { category: location.category }),
          message:
            items.length === 0
              ? `项目「${location.project}」在该范围内没有日程。`
              : `项目「${location.project}」共 ${items.length} 条日程：\n${items
                  .map((item) => scheduleText(item, now))
                  .join('\n')}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_schedule_add',
      description:
        '在指定项目的日程章节末尾追加一条日程。开始日期必填；只填开始日期表示全天事项；填了开始时间且未填结束时间时，默认持续到当日结束。',
      parameters: {
        project: PROJECT,
        topLevelDir: TOP_LEVEL,
        title: { type: 'string', required: true, description: '日程标题（非空）。' },
        priority: PRIORITY,
        note: NOTE,
        startDate: { type: 'string', required: true, description: '开始日期 YYYY-MM-DD。' },
        endDate: { type: 'string', description: '结束日期 YYYY-MM-DD（跨日事项）。' },
        startTime: { type: 'string', description: '开始时间 HH:mm；省略即全天事项。' },
        endTime: { type: 'string', description: '结束时间 HH:mm。' },
        location: { type: 'string', description: '地点。' },
      },
      output: WRITE_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const line = await commit(
          deps,
          location.workLogPath,
          addScheduleItem(snapshot.text, {
            title: args.title,
            priority: args.priority as Priority | undefined,
            note: args.note,
            startDate: args.startDate,
            endDate: args.endDate,
            startTime: args.startTime,
            endTime: args.endTime,
            location: args.location,
          }),
        )
        return {
          project: location.project,
          line,
          message: `已在「${location.project}」第 ${line} 行新增日程：${args.title}（${args.startDate}）`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_schedule_set',
      description:
        '修改指定项目中的一条日程。未提供的字段保持不变；备注/地点/结束日期/起止时间传空串表示清除。target 的 line 与 title 必须与 legal_schedule_list 返回的一致。',
      parameters: {
        project: PROJECT,
        topLevelDir: TOP_LEVEL,
        target: TARGET,
        title: { type: 'string', description: '新的标题；省略则不变。' },
        priority: PRIORITY,
        clearPriority: { type: 'boolean', description: 'true 表示清除优先级。' },
        note: NOTE,
        startDate: { type: 'string', description: '新的开始日期 YYYY-MM-DD；省略则不变。' },
        endDate: { type: 'string', description: '新的结束日期；传空串清除。' },
        startTime: {
          type: 'string',
          description: '新的开始时间 HH:mm；传空串清除（转为全天事项）。',
        },
        endTime: { type: 'string', description: '新的结束时间 HH:mm；传空串清除。' },
        location: { type: 'string', description: '新的地点；传空串清除。' },
        done: { type: 'boolean', description: 'true 标记完成，false 标记未完成；省略则不变。' },
      },
      output: WRITE_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const item = locate(snapshot, 'schedule', args.target.line, args.target.title) as ScheduleItem
        const priority =
          args.clearPriority === true
            ? null
            : ((args.priority as Priority | undefined) ?? item.priority)
        const line = await commit(
          deps,
          location.workLogPath,
          replaceScheduleItem(snapshot.text, item, {
            title: args.title ?? item.title,
            priority,
            note: args.note ?? item.note,
            startDate: args.startDate ?? item.startDate,
            endDate: args.endDate ?? item.endDate,
            startTime: args.startTime ?? item.startTime,
            endTime: args.endTime ?? item.endTime,
            location: args.location ?? item.location,
            done: args.done ?? item.done,
          }),
        )
        return {
          project: location.project,
          line,
          message: `已更新「${location.project}」第 ${line} 行日程。`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_schedule_remove',
      description:
        '删除指定项目中的一条日程。target 的 line 与 title 必须与 legal_schedule_list 返回的一致。',
      parameters: { project: PROJECT, topLevelDir: TOP_LEVEL, target: TARGET },
      output: WRITE_OUTPUT,
      async execute(args) {
        const location = await requireProject(deps, args.project, args.topLevelDir)
        const snapshot = await deps.readWorkLog(location.workLogPath)
        const item = locate(snapshot, 'schedule', args.target.line, args.target.title)
        const line = await commit(deps, location.workLogPath, removeItem(snapshot.text, item))
        return {
          project: location.project,
          line,
          message: `已删除「${location.project}」的日程：${args.target.title}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'legal_agenda_query',
      description:
        '跨项目汇总查询：统计各项目的待办与日程（含进行中数量），可限定顶级目录、单个项目与日期范围。用于回答「今天/本周有什么安排」「哪些项目有未完成待办」。',
      parameters: {
        topLevelDir: TOP_LEVEL,
        project: { type: 'string', description: '只查该项目；省略则查全部项目。' },
        from: { type: 'string', description: '日程起始日期 YYYY-MM-DD（含）。' },
        to: { type: 'string', description: '日程结束日期 YYYY-MM-DD（不含）。' },
      },
      output: QUERY_OUTPUT,
      async execute(args) {
        const { projects: all } = await deps.scan()
        const targets = all.filter(
          (item) =>
            (args.topLevelDir === undefined || item.topLevelDir === args.topLevelDir) &&
            (args.project === undefined || item.project === args.project),
        )
        const now = new Date()
        const rows: JsonObject[] = []
        const lines: string[] = []
        let todoPending = 0
        let ongoing = 0

        for (const target of targets) {
          const snapshot = await deps.readWorkLog(target.workLogPath)
          let schedule = snapshot.result.schedule.items
          if (args.from !== undefined || args.to !== undefined) {
            schedule = filterScheduleByRange(schedule, rangeFrom(args.from), rangeTo(args.to))
          }
          const summary = summarize(snapshot.result.todo.items, schedule, now)
          const pendingTodos = groupByDone(snapshot.result.todo.items).pending
          todoPending += summary.todoPending
          ongoing += summary.ongoing
          const row: JsonObject = {
            project: target.project,
            topLevelDir: target.topLevelDir,
            allowedCategories: [...target.allowedCategories],
            todoPending: summary.todoPending,
            todoDone: summary.todoDone,
            scheduleTotal: summary.scheduleTotal,
            ongoing: summary.ongoing,
            pendingTitles: pendingTodos.slice(0, 5).map((item) => item.title),
          }
          if (target.category !== null) row.category = target.category
          rows.push(row)
          lines.push(
            `- ${target.topLevelDir} / ${target.project}：待办 ${summary.todoPending} 未完成 / ${summary.todoDone} 已完成；日程 ${summary.scheduleTotal} 条，进行中 ${summary.ongoing}`,
          )
        }

        return {
          projects: rows,
          total: { projectCount: targets.length, todoPending, ongoing },
          message:
            targets.length === 0
              ? '没有匹配的项目。'
              : `共 ${targets.length} 个项目，未完成待办合计 ${todoPending} 条，进行中日程 ${ongoing} 条：\n${lines.join('\n')}`,
        }
      },
    }),
  )
}
