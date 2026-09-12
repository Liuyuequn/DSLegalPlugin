/**
 * 工具与 HTTP 两个适配器共享的领域操作。
 */

import type {
  AgendaItem,
  PriorityColorIssue,
  PriorityColorOverrides,
  ResolvedPriorityColors,
  ScheduleItem,
  TodoItem,
  WorkLogParseResult,
} from '@dslegal/core'
import type { JsonValue } from '@deepseek-ai/dsh-tools'

import type { OpenOutcome } from './opener.js'
import type { WorkLogSnapshot } from './store.js'
import { findProject, isAmbiguous, type ProjectLocation, type ScanResult } from './workspace.js'

/** JSON 对象（工具输出与 HTTP 响应共用）。 */
export type JsonObject = { [key: string]: JsonValue }

/** 保存数据根目录后的结果。 */
export interface DataRootUpdate {
  /** 落盘后的绝对路径。 */
  readonly dataRoot: string
  /** 该目录下已就绪的项目数。 */
  readonly projectCount: number
  /** 结构不完整的项目目录数。 */
  readonly incompleteCount: number
}

/** 保存优先级颜色后的结果。 */
export interface PriorityColorsUpdate {
  /** 落盘后**生效的**四个颜色（已合过默认值）。 */
  readonly colors: ResolvedPriorityColors['colors']
  /** 被兜底掉的键及原因；界面据此提示"哪一格没生效"。 */
  readonly issues: readonly PriorityColorIssue[]
}

/** 领域操作的依赖。 */
export interface LegalDeps {
  /**
   * 扫描数据根目录。
   *
   * `force` 为真时忽略缓存、直接读磁盘：**显式读取**（界面刷新、列出项目、定位写入目标）
   * 必须走这条路，否则用户在工作日志之外新建/改名/删除案件目录后，界面与工具会一直看到
   * 旧结果——文件是唯一真相，缓存不能变成第二个真相。`false`/省略则允许复用缓存
   * （供同一轮里反复调用的 agent 工具使用）。
   *
   * 未设定数据目录时抛出可读错误。
   */
  readonly scan: (force?: boolean) => Promise<ScanResult>
  readonly readWorkLog: (path: string) => Promise<WorkLogSnapshot>
  readonly writeWorkLog: (path: string, text: string) => Promise<void>
  /** 通知监听器"这是本插件自己写的"，抑制回环事件。 */
  readonly markSelfWrite: (path: string) => void
  /** 当前数据根目录；`null` 表示尚未设定。 */
  readonly getDataRoot: () => string | null
  /** 校验并保存数据根目录（写入用户设置），随即生效并重新扫描。 */
  readonly setDataRoot: (input: string) => Promise<DataRootUpdate>
  /**
   * 当前生效的四个优先级颜色（已合过默认值，**一定有值**）+ 被兜底掉的键。
   *
   * 与数据目录走同一份用户设置；设置服务缺席时退回默认色。
   * 一次返回两者，是因为界面既要拿颜色渲染、也要拿到"哪一格没生效"去如实提示。
   */
  readonly getPriorityColors: () => ResolvedPriorityColors
  /** 保存优先级颜色（写入用户设置），返回落盘后生效的值。 */
  readonly setPriorityColors: (input: PriorityColorOverrides) => Promise<PriorityColorsUpdate>
  /**
   * 用系统默认程序打开一份工作日志，并尽量把光标定位到第 `line` 行（1-based）。
   *
   * 做成依赖而不是在接口层直接 import：单测要能注入一个假的"打开器"，否则每跑一次
   * 测试就会在开发机上真的弹一个编辑器出来。
   */
  readonly openWorkLog: (path: string, line: number) => Promise<OpenOutcome>
}

/** 定位项目；找不到或重名时抛出可读错误。 */
export async function requireProject(
  deps: LegalDeps,
  project: string,
  topLevelDir?: string,
): Promise<ProjectLocation> {
  // 强制重扫：刚新建的案件目录必须立刻可写，不能等下一次文件变更或重启。
  const { projects } = await deps.scan(true)
  const found = findProject(projects, project, topLevelDir)
  if (found !== undefined) return found
  if (isAmbiguous(projects, project)) {
    throw new Error(`项目「${project}」在多个顶级目录中重名，请同时提供 topLevelDir。`)
  }
  throw new Error(`未找到项目「${project}」；请先查看可用项目。`)
}

type WriteOutcome =
  | { readonly ok: true; readonly text: string; readonly line: number }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** 落盘一次写回结果（先标记自身写入以抑制回环）。 */
export async function commit(
  deps: LegalDeps,
  path: string,
  result: WriteOutcome,
): Promise<number> {
  if (!result.ok) throw new Error(`写入失败（${result.code}）：${result.message}`)
  deps.markSelfWrite(path)
  await deps.writeWorkLog(path, result.text)
  return result.line
}

/** 按 `line` + `title` 定位条目；两者与文件不一致即拒绝。 */
export function locate(
  snapshot: WorkLogSnapshot,
  kind: 'todo' | 'schedule',
  line: number,
  title: string,
): TodoItem | ScheduleItem {
  const section = kind === 'todo' ? snapshot.result.todo : snapshot.result.schedule
  const item = section.items.find((candidate) => candidate.line === line)
  const label = kind === 'todo' ? '待办' : '日程'
  if (item === undefined) {
    throw new Error(`第 ${line} 行不是一条已解析的${label}；文件可能已变化，请重新读取。`)
  }
  if (item.title !== title) {
    throw new Error(
      `第 ${line} 行的标题是「${item.title}」，与提供的「${title}」不一致；文件可能已被修改，请重新读取。`,
    )
  }
  return item
}

/** 条目 → 可 JSON 化的对象（省略 null 字段）。 */
export function todoJson(item: TodoItem): { [key: string]: JsonValue } {
  const json: { [key: string]: JsonValue } = {
    line: item.line,
    done: item.done,
    title: item.title,
  }
  if (item.priority !== null) json.priority = item.priority
  if (item.note !== null) json.note = item.note
  return json
}

/** 日程 → 可 JSON 化的对象（省略 null 字段）。 */
export function scheduleJson(item: ScheduleItem): { [key: string]: JsonValue } {
  const json: { [key: string]: JsonValue } = {
    line: item.line,
    done: item.done,
    title: item.title,
    startDate: item.startDate,
  }
  if (item.priority !== null) json.priority = item.priority
  if (item.note !== null) json.note = item.note
  if (item.endDate !== null) json.endDate = item.endDate
  if (item.startTime !== null) json.startTime = item.startTime
  if (item.endTime !== null) json.endTime = item.endTime
  if (item.location !== null) json.location = item.location
  return json
}

/** 解析问题 → 可 JSON 化的对象。 */
export function issuesJson(snapshot: WorkLogSnapshot): { [key: string]: JsonValue }[] {
  const result: WorkLogParseResult = snapshot.result
  return [...result.issues, ...result.todo.issues, ...result.schedule.issues].map((issue) => ({
    line: issue.line,
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
  }))
}

/** 项目 + 工作日志 → 界面/模型可用的聚合视图。 */
export interface AgendaView {
  readonly project: string
  readonly topLevelDir: string
  readonly category: string | null
  readonly title: string | null
  readonly categoryIssue: string | null
  readonly workLogPath: string
  readonly todos: readonly { [key: string]: JsonValue }[]
  readonly schedule: readonly { [key: string]: JsonValue }[]
  readonly issues: readonly { [key: string]: JsonValue }[]
}

/** 读取一个项目的待办与日程。 */
export async function readAgenda(
  deps: LegalDeps,
  location: ProjectLocation,
): Promise<AgendaView> {
  const snapshot = await deps.readWorkLog(location.workLogPath)
  return {
    project: location.project,
    topLevelDir: location.topLevelDir,
    category: location.category,
    title: location.title,
    categoryIssue: location.categoryIssue,
    workLogPath: location.workLogPath,
    todos: snapshot.result.todo.items.map(todoJson),
    schedule: snapshot.result.schedule.items.map(scheduleJson),
    issues: issuesJson(snapshot),
  }
}

/** 条目类型（供类型收窄使用）。 */
export type { AgendaItem }
