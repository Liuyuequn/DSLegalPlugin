/**
 * 查询 / 分组 / 排序 / 状态派生。
 *
 * 全部为纯函数；时间计算使用**本地时区**（数据契约中的日期时间均为本地书写，不含时区）。
 */

import {
  PRIORITIES,
  type AgendaItem,
  type Priority,
  type ScheduleItem,
  type TodoItem,
} from './model.js'

/** 日程的有效时间区间（半开区间 `[start, end)`）。 */
export interface TimeInterval {
  readonly start: Date
  readonly end: Date
  /** 全天事项（未填开始时间）。 */
  readonly allDay: boolean
}

/**
 * 日程的**时间字段子集**。
 *
 * 刻意声明为结构子集而不是 `ScheduleItem`：host 把日程 JSON 化后（省略 null 字段）
 * 就只剩这几个字段，而 client 需要按"日 / 星期 / 月"切片，必须算有效区间。
 * 让 core 成为区间语义的**唯一实现**，client 与 host 才不会各算一套时间
 * （`ScheduleItem` 结构上满足本类型，原有调用不受影响）。
 */
export interface ScheduleTiming {
  /** 开始日期，`YYYY-MM-DD`。 */
  readonly startDate: string
  /** 结束日期；`null` / 缺省表示与开始日期同日。 */
  readonly endDate?: string | null
  /** 开始时间，`HH:mm`；`null` / 缺省表示全天事项。 */
  readonly startTime?: string | null
  /** 结束时间，`HH:mm`；`null` / 缺省表示持续到当日结束。 */
  readonly endTime?: string | null
}

/** 日程相对当前时刻的阶段。 */
export type SchedulePhase = '未开始' | '进行中' | '已结束'

/** 用本地时区构造时刻。 */
function localMoment(date: string, time: string): Date {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const hour = Number(time.slice(0, 2))
  const minute = Number(time.slice(3, 5))
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/**
 * 计算日程的有效时间区间。
 *
 * - 全天事项（无开始时间）：当日 00:00 – 次日 00:00
 * - 有开始时间、无结束时间：开始时间 – 次日 00:00
 * - 有结束时间：开始时刻 – （结束日期或开始日期）的结束时间
 */
export function scheduleInterval(item: ScheduleTiming): TimeInterval {
  const startTime = item.startTime ?? null
  const endTime = item.endTime ?? null
  const endDate = item.endDate ?? null
  const allDay = startTime === null
  const start = localMoment(item.startDate, startTime ?? '00:00')

  if (endTime !== null) {
    return { start, end: localMoment(endDate ?? item.startDate, endTime), allDay }
  }

  const base = localMoment(endDate ?? item.startDate, '00:00')
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0, 0)
  return { start, end, allDay }
}

/** 当前时刻是否落在有效时间区间内。 */
export function isOngoing(item: ScheduleTiming, now: Date): boolean {
  const { start, end } = scheduleInterval(item)
  const time = now.getTime()
  return time >= start.getTime() && time < end.getTime()
}

/** 相对当前时刻的阶段（与复选框的完成状态相互独立）。 */
export function schedulePhase(item: ScheduleTiming, now: Date): SchedulePhase {
  const { start, end } = scheduleInterval(item)
  const time = now.getTime()
  if (time < start.getTime()) return '未开始'
  if (time < end.getTime()) return '进行中'
  return '已结束'
}

/** 本地日期键 `YYYY-MM-DD`。 */
export function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 按开始日期分组（使用原文日期字符串，跨日事项归入开始日期）。 */
export function groupScheduleByDate(items: readonly ScheduleItem[]): Map<string, ScheduleItem[]> {
  const groups = new Map<string, ScheduleItem[]>()
  for (const item of items) {
    const bucket = groups.get(item.startDate)
    if (bucket === undefined) groups.set(item.startDate, [item])
    else bucket.push(item)
  }
  return groups
}

/** 优先级比较：四象限顺序，`null` 排最后。 */
export function comparePriority(a: Priority | null, b: Priority | null): number {
  const indexA = a === null ? PRIORITIES.length : PRIORITIES.indexOf(a)
  const indexB = b === null ? PRIORITIES.length : PRIORITIES.indexOf(b)
  return indexA - indexB
}

/** 按优先级分组（跳过无优先级的条目）。 */
export function groupByPriority<T extends AgendaItem>(items: readonly T[]): Map<Priority, T[]> {
  const groups = new Map<Priority, T[]>()
  for (const item of items) {
    if (item.priority === null) continue
    const bucket = groups.get(item.priority)
    if (bucket === undefined) groups.set(item.priority, [item])
    else bucket.push(item)
  }
  return groups
}

/** 按完成状态拆分。 */
export function groupByDone<T extends AgendaItem>(items: readonly T[]): {
  readonly pending: T[]
  readonly done: T[]
} {
  const pending: T[] = []
  const done: T[] = []
  for (const item of items) (item.done ? done : pending).push(item)
  return { pending, done }
}

/** 待办排序：未完成在前 → 优先级 → 原文顺序。 */
export function sortTodos(items: readonly TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    const byPriority = comparePriority(a.priority, b.priority)
    if (byPriority !== 0) return byPriority
    return a.line - b.line
  })
}

/** 日程排序：开始时刻升序 → 原文顺序。 */
export function sortSchedule(items: readonly ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => {
    const diff = scheduleInterval(a).start.getTime() - scheduleInterval(b).start.getTime()
    if (diff !== 0) return diff
    return a.line - b.line
  })
}

/** 筛选与 `[from, to)` 有交集的日程。 */
export function filterScheduleByRange(
  items: readonly ScheduleItem[],
  from: Date,
  to: Date,
): ScheduleItem[] {
  const fromTime = from.getTime()
  const toTime = to.getTime()
  return items.filter((item) => {
    const { start, end } = scheduleInterval(item)
    return start.getTime() < toTime && end.getTime() > fromTime
  })
}

/** 筛选进行中的日程。 */
export function filterOngoing(items: readonly ScheduleItem[], now: Date): ScheduleItem[] {
  return items.filter((item) => isOngoing(item, now))
}

/** 筛选未完成条目。 */
export function filterPending<T extends AgendaItem>(items: readonly T[]): T[] {
  return items.filter((item) => !item.done)
}

/** 筛选已完成条目。 */
export function filterDone<T extends AgendaItem>(items: readonly T[]): T[] {
  return items.filter((item) => item.done)
}

/** 项目 / 类别维度的汇总。 */
export interface AgendaSummary {
  readonly todoTotal: number
  readonly todoPending: number
  readonly todoDone: number
  readonly scheduleTotal: number
  readonly schedulePending: number
  readonly scheduleDone: number
  /** 当前时刻处于有效时间区间内的日程数。 */
  readonly ongoing: number
}

/** 汇总统计。 */
export function summarize(
  todos: readonly TodoItem[],
  schedule: readonly ScheduleItem[],
  now: Date,
): AgendaSummary {
  const todo = groupByDone(todos)
  const events = groupByDone(schedule)
  return {
    todoTotal: todos.length,
    todoPending: todo.pending.length,
    todoDone: todo.done.length,
    scheduleTotal: schedule.length,
    schedulePending: events.pending.length,
    scheduleDone: events.done.length,
    ongoing: filterOngoing(schedule, now).length,
  }
}
