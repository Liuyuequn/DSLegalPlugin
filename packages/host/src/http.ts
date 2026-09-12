/**
 * 浏览器侧的只读 / 可写 HTTP 接口。
 *
 * 为什么不用 Typert RPC：Client 侧只接受**严格生成**的贡献（需要一套代码生成产物），
 * 而本项目是个人本地使用，用 `ctx.webServer.register()` 注册命名路由即可满足需求，
 * 且完全可测。路由前缀 `/dslegal` 独占，避免与 `/api` 等既有路由冲突。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  addScheduleItem,
  addTodoItem,
  isOngoing,
  removeItem,
  replaceScheduleItem,
  replaceTodoItem,
  scheduleInterval,
  PRIORITY_COLORS,
  type Priority,
  type PriorityColorOverrides,
  type ScheduleItem,
  type TodoItem,
} from '@dslegal/core'

import {
  commit,
  locate,
  readAgenda,
  requireProject,
  scheduleJson,
  todoJson,
  type LegalDeps,
} from './deps.js'
import type { ProjectLocation } from './workspace.js'

/** 本插件占用的 HTTP 路径前缀。 */
export const HTTP_PREFIX = '/dslegal'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

function projectJson(location: ProjectLocation): Record<string, unknown> {
  const json: Record<string, unknown> = {
    project: location.project,
    topLevelDir: location.topLevelDir,
    workLogPath: location.workLogPath,
    allowedCategories: [...location.allowedCategories],
  }
  if (location.category !== null) json.category = location.category
  if (location.title !== null) json.title = location.title
  if (location.categoryIssue !== null) json.categoryIssue = location.categoryIssue
  return json
}

type Target = { readonly line: number; readonly title: string }

function readTarget(value: unknown): Target {
  if (value === null || typeof value !== 'object') {
    throw new Error('该操作需要 target: { line, title }。')
  }
  const record = value as Record<string, unknown>
  const line = record.line
  const title = record.title
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    throw new Error('target.line 必须是正整数。')
  }
  if (typeof title !== 'string' || title.length === 0) {
    throw new Error('target.title 必须是非空字符串。')
  }
  return { line, title }
}

function text(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function optionalText(input: Record<string, unknown>, key: string): string | null | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${key} 必须是字符串。`)
  return value.length === 0 ? null : value
}

function priority(input: Record<string, unknown>): Priority | undefined {
  const value = input.priority
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('priority 必须是字符串。')
  return value as Priority
}

function bool(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} 必须是布尔值。`)
  return value
}

async function applyEdit(
  deps: LegalDeps,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const op = text(body, 'op')
  const project = text(body, 'project')
  if (op === undefined) throw new Error('缺少 op。')
  if (project === undefined || project.length === 0) throw new Error('缺少 project。')

  const location = await requireProject(deps, project, text(body, 'topLevelDir'))
  const snapshot = await deps.readWorkLog(location.workLogPath)
  const input = (body.input ?? {}) as Record<string, unknown>
  const path = location.workLogPath

  switch (op) {
    case 'todo.add': {
      const title = text(input, 'title')
      if (title === undefined) throw new Error('todo.add 需要 input.title。')
      const line = await commit(
        deps,
        path,
        addTodoItem(snapshot.text, {
          title,
          priority: priority(input),
          note: optionalText(input, 'note') ?? null,
        }),
      )
      return { project: location.project, line }
    }
    case 'todo.set': {
      const target = readTarget(body.target)
      const item = locate(snapshot, 'todo', target.line, target.title) as TodoItem
      const clearPriority = bool(input, 'clearPriority') === true
      const nextPriority = clearPriority ? null : (priority(input) ?? item.priority)
      const line = await commit(
        deps,
        path,
        replaceTodoItem(snapshot.text, item, {
          title: text(input, 'title') ?? item.title,
          priority: nextPriority,
          note: optionalText(input, 'note') ?? item.note,
          done: bool(input, 'done') ?? item.done,
        }),
      )
      return { project: location.project, line }
    }
    case 'todo.remove': {
      const target = readTarget(body.target)
      const item = locate(snapshot, 'todo', target.line, target.title)
      return { project: location.project, line: await commit(deps, path, removeItem(snapshot.text, item)) }
    }
    case 'schedule.add': {
      const title = text(input, 'title')
      const startDate = text(input, 'startDate')
      if (title === undefined) throw new Error('schedule.add 需要 input.title。')
      if (startDate === undefined) throw new Error('schedule.add 需要 input.startDate。')
      const line = await commit(
        deps,
        path,
        addScheduleItem(snapshot.text, {
          title,
          priority: priority(input),
          note: optionalText(input, 'note') ?? null,
          startDate,
          endDate: optionalText(input, 'endDate') ?? null,
          startTime: optionalText(input, 'startTime') ?? null,
          endTime: optionalText(input, 'endTime') ?? null,
          location: optionalText(input, 'location') ?? null,
        }),
      )
      return { project: location.project, line }
    }
    case 'schedule.set': {
      const target = readTarget(body.target)
      const item = locate(snapshot, 'schedule', target.line, target.title) as ScheduleItem
      const clearPriority = bool(input, 'clearPriority') === true
      const line = await commit(
        deps,
        path,
        replaceScheduleItem(snapshot.text, item, {
          title: text(input, 'title') ?? item.title,
          priority: clearPriority ? null : (priority(input) ?? item.priority),
          note: optionalText(input, 'note') ?? item.note,
          startDate: text(input, 'startDate') ?? item.startDate,
          endDate: optionalText(input, 'endDate') ?? item.endDate,
          startTime: optionalText(input, 'startTime') ?? item.startTime,
          endTime: optionalText(input, 'endTime') ?? item.endTime,
          location: optionalText(input, 'location') ?? item.location,
          done: bool(input, 'done') ?? item.done,
        }),
      )
      return { project: location.project, line }
    }
    case 'schedule.remove': {
      const target = readTarget(body.target)
      const item = locate(snapshot, 'schedule', target.line, target.title)
      return { project: location.project, line: await commit(deps, path, removeItem(snapshot.text, item)) }
    }
    default:
      throw new Error(`未知操作：${op}`)
  }
}

/**
 * 与 `@deepseek-ai/dsh-host-webserver` 的 `WebRoute` 结构一致。
 * 这里结构化声明而不 import 该包：它是组合提供的可选服务，
 * 不引入类型依赖可以让本插件在缺少它的 profile 里也能编译与加载。
 */
export interface WebRouteLike {
  kind: 'exact' | 'prefix'
  /** 绝对路径，无尾斜杠。 */
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** webServer 的最小结构契约。 */
export interface WebServerLike {
  register(route: WebRouteLike): () => void
}

/** 本地日期键 `YYYY-MM-DD`。 */
function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 插件设置（数据目录 + 四象限颜色）。
 *
 * 未设定数据目录时返回 `configured: false`，界面据此改显路径输入框；**颜色与数据目录
 * 无关，任何情况下都下发**——否则界面连"配色"这一块都画不出来。
 */
async function buildSettings(deps: LegalDeps): Promise<Record<string, unknown>> {
  const { colors, issues } = deps.getPriorityColors()
  const dataRoot = deps.getDataRoot()
  const common = {
    priorityColors: colors,
    defaultPriorityColors: PRIORITY_COLORS,
    colorIssues: issues,
  }
  if (dataRoot === null) {
    return { configured: false, dataRoot: null, projectCount: 0, incompleteCount: 0, ...common }
  }
  const { projects, incomplete } = await deps.scan(true)
  return {
    configured: true,
    dataRoot,
    projectCount: projects.length,
    incompleteCount: incomplete.length,
    ...common,
  }
}

/**
 * 跨项目总览（**只读聚合**，供 client 的三条线索使用）。
 *
 * 界面已改为以「日程 / 待办 / 项目」三条**并列且互斥**的线索组织内容，因此接口
 * 提供**完整数据集**而非"今日切片"，由 client 按所选线索切片：
 *
 * - `schedules`：全部日程（跨项目）。client 的「日 / 星期 / 月」三种形态分别在
 *   本地按有效时间区间过滤——区间语义见数据约定规范 4.4（全天 = 当日 00:00 至次日
 *   00:00；有开始时间无结束时间 = 持续到当日结束），故一条跨日日程会在它覆盖的
 *   每一天出现，这是刻意的：日程的"属于哪天"就是它的有效区间与哪天相交。
 * - `todos`：全部待办（**含已完成**）。界面需要展示完成状态，且设计要求"已完成划线
 *   置灰并排在所有未完成之后"，因此不能像早期版本那样只下发未完成项。
 * - `ongoing` 是派生状态，由 host 统一计算，避免 client 与 host 各算一套时间。
 * - 创建时间：数据契约里没有时间戳，"最近创建"以**文件中的行号**近似（条目追加在
 *   章节末尾，行号越大越晚写入）。host 不排序待办，只按 `项目 → 行号` 稳定下发。
 *
 * 尚未设定数据目录时返回空集 + `configured: false`，界面改显「数据目录」表单。
 *
 * 扫描一律 `force`：案件目录是用户在工作日志之外新建/改名/删除的，**磁盘才是真相**，
 * 走缓存会让新建的案件在界面与工具里"不存在"，直到碰巧有别的文件变更或重启 DSH。
 */
async function buildOverview(deps: LegalDeps, now: Date): Promise<Record<string, unknown>> {
  const today = localKey(now)
  const { colors, issues } = deps.getPriorityColors()
  // 颜色与数据目录无关，未设定目录时也要下发，否则界面连空态都画不出正确的配色。
  const palette = { priorityColors: colors, colorIssues: issues }
  const dataRoot = deps.getDataRoot()
  if (dataRoot === null) {
    return {
      configured: false,
      dataRoot: null,
      today,
      projects: [],
      todos: [],
      schedules: [],
      ...palette,
    }
  }

  const { projects } = await deps.scan(true)
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 0, 0, 0, 0)

  const rows: Record<string, unknown>[] = []
  const todos: Record<string, unknown>[] = []
  const schedules: { readonly start: number; readonly row: Record<string, unknown> }[] = []

  for (const location of projects) {
    const snapshot = await deps.readWorkLog(location.workLogPath)
    const issueCount =
      snapshot.result.issues.length +
      snapshot.result.todo.issues.length +
      snapshot.result.schedule.issues.length

    const allTodos = snapshot.result.todo.items
    for (const item of allTodos) {
      todos.push({
        project: location.project,
        topLevelDir: location.topLevelDir,
        ...todoJson(item),
      })
    }

    let next7 = 0
    let ongoing = 0
    const allSchedule = snapshot.result.schedule.items
    for (const item of allSchedule) {
      const interval = scheduleInterval(item)
      const live = isOngoing(item, now)
      if (live) ongoing += 1
      if (interval.start.getTime() < weekEnd.getTime() && interval.end.getTime() > now.getTime()) {
        next7 += 1
      }
      schedules.push({
        start: interval.start.getTime(),
        row: {
          project: location.project,
          topLevelDir: location.topLevelDir,
          category: location.category,
          ongoing: live,
          ...scheduleJson(item),
        },
      })
    }

    const doneCount = allTodos.reduce((sum, item) => sum + (item.done ? 1 : 0), 0)
    rows.push({
      project: location.project,
      topLevelDir: location.topLevelDir,
      ...(location.category === null ? {} : { category: location.category }),
      ...(location.title === null ? {} : { title: location.title }),
      ...(location.categoryIssue === null ? {} : { categoryIssue: location.categoryIssue }),
      todoPending: allTodos.length - doneCount,
      todoDone: doneCount,
      scheduleTotal: allSchedule.length,
      scheduleNext7: next7,
      ongoing,
      issueCount,
    })
  }

  // 有异常的排前（异常更可能阻塞工作）。
  rows.sort((a, b) => {
    const diff = (b.issueCount as number) - (a.issueCount as number)
    return diff !== 0 ? diff : String(a.project).localeCompare(String(b.project))
  })

  // 日程按有效区间的开始时刻升序；时刻相同再按项目名，保证顺序稳定可测。
  schedules.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return String(a.row.project).localeCompare(String(b.row.project))
  })

  return {
    configured: true,
    dataRoot,
    today,
    projects: rows,
    todos,
    schedules: schedules.map((entry) => entry.row),
    ...palette,
  }
}

/** 注册 `/dslegal/*` 路由；返回 disposer。 */
export function registerHttpRoutes(webServer: WebServerLike, deps: LegalDeps): () => void {
  return webServer.register({
    kind: 'prefix',
    path: HTTP_PREFIX,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname

        if (req.method === 'GET' && path === `${HTTP_PREFIX}/projects`) {
          const { projects, incomplete } = await deps.scan(true)
          sendJson(res, 200, {
            projects: projects.map(projectJson),
            incomplete: incomplete.map((item) => ({
              project: item.project,
              topLevelDir: item.topLevelDir,
            })),
          })
          return
        }

        if (req.method === 'GET' && path === `${HTTP_PREFIX}/agenda`) {
          const project = url.searchParams.get('project')
          if (project === null || project.length === 0) {
            sendJson(res, 400, { error: '缺少 project 查询参数。' })
            return
          }
          const topLevelDir = url.searchParams.get('topLevelDir') ?? undefined
          const location = await requireProject(deps, project, topLevelDir)
          sendJson(res, 200, await readAgenda(deps, location))
          return
        }

        if (req.method === 'GET' && path === `${HTTP_PREFIX}/overview`) {
          sendJson(res, 200, await buildOverview(deps, new Date()))
          return
        }

        if (req.method === 'GET' && path === `${HTTP_PREFIX}/settings`) {
          sendJson(res, 200, await buildSettings(deps))
          return
        }

        if (req.method === 'POST' && path === `${HTTP_PREFIX}/settings`) {
          const body = await readJsonBody(req)
          const value = text(body, 'dataRoot')
          const colors = (body as { priorityColors?: unknown }).priorityColors
          // 两个字段都可单独保存：改颜色不必先设数据目录，反之亦然。
          if (value === undefined && colors === undefined) {
            throw new Error('缺少要保存的设置项（dataRoot 或 priorityColors）。')
          }
          // **先落盘、后读回**：`buildSettings` 读的是当前生效值，顺序反了会把旧值回给界面。
          if (value !== undefined) await deps.setDataRoot(value)
          // 写坏的颜色在这一步被逐键兜底掉（不落盘），但**这一次的**问题要当场告诉界面，
          // 否则用户只会看到颜色"自己变回去了"却不知道为什么。
          const colorIssues =
            colors === undefined
              ? undefined
              : (await deps.setPriorityColors(colors as PriorityColorOverrides)).issues
          const result = await buildSettings(deps)
          if (colorIssues !== undefined) result.colorIssues = colorIssues
          sendJson(res, 200, result)
          return
        }

        if (req.method === 'POST' && path === `${HTTP_PREFIX}/edit`) {
          const body = await readJsonBody(req)
          sendJson(res, 200, await applyEdit(deps, body))
          return
        }

        sendJson(res, 404, { error: `未知路径：${path}` })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
