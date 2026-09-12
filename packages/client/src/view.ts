/**
 * 视图模型：把"完整数据集"切成三条线索各自要展示的内容。
 *
 * 全部是**纯函数**，不碰 DOM、不发请求，因而可以完整单测——界面里最容易出错的地方
 * （日期归属、完成状态排序、"只显示能容纳的条目"）都在这里，而不是散在组件里。
 *
 * 两条必须守住的领域规则：
 *
 * 1. **日程"属于哪天"= 有效时间区间与哪天相交**（数据约定规范 4.4）。一条 9/1→9/3 的
 *    跨日事项在 9/1、9/2、9/3 三天都会出现；全天事项默认占满当日。区间计算直接复用
 *    `@dslegal/core` 的 `scheduleInterval`，与 host 判定 `ongoing` 用的是同一份实现。
 * 2. **待办排序：未完成在前，已完成一律排在所有未完成之后**；两组内部都按"最近创建"
 *    倒序。数据契约没有创建时间戳，以**行号**近似——条目追加在章节末尾，行号越大越晚
 *    写入（这一点已写进《数据约定规范》的读取约定）。
 */

import {
  PRIORITIES,
  formatScheduleLine,
  formatTodoLine,
  scheduleInterval,
  type Priority,
} from '@dslegal/core'

import type { OpenSourceResult, ScheduleCore, TodoCore } from './api.js'

// ---------------------------------------------------------------------------
// 日期键运算（本地时区；数据契约中的日期不含时区，故一律用本地日历运算）
// ---------------------------------------------------------------------------

/** 周一为一周之始，与月历表头「一二三四五六日」一致。 */
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** `Date` → 本地日期键 `YYYY-MM-DD`。 */
export function dayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 今天的日期键。 */
export const todayKey = (now: Date = new Date()): string => dayKey(now)

/** 日期键 → 当日 00:00（本地时区）。 */
export function parseDayKey(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}

/** 日期键偏移若干天。按日历字段运算，避免夏令时下 23/25 小时的误差。 */
export function addDays(key: string, days: number): string {
  const date = parseDayKey(key)
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

/** 星期序号：0 = 周一 … 6 = 周日。 */
export function weekdayIndex(key: string): number {
  return (parseDayKey(key).getDay() + 6) % 7
}

/** 所在周的周一。 */
export function startOfWeek(key: string): string {
  return addDays(key, -weekdayIndex(key))
}

/** 所在周的 7 天（周一 → 周日）。 */
export function weekDays(key: string): string[] {
  const monday = startOfWeek(key)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

/** 所在月的 1 号。 */
export function monthAnchor(key: string): string {
  return `${key.slice(0, 7)}-01`
}

/**
 * 按月偏移。
 *
 * **保留日号**（09-12 → 08-12），不是一律跳到 1 号：面板顶部的中间那一格恒显
 * 当前聚焦的那一天，若一次翻页就把焦点摔到 1 号，那一格的含义每次翻页都变，
 * 用户没法靠它判断自己在哪。
 *
 * 日号超出目标月份天数时**夹到当月最后一天**（3-31 往回一个月是 2-28/2-29）。
 * 直接 `new Date(y, m + delta, 31)` 会溢出到下个月初——这是 JS Date 的经典陷阱，
 * 会让"翻到 2 月"变成"翻到 3 月"。
 */
export function shiftMonth(key: string, delta: number): string {
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7)) - 1
  const day = Number(key.slice(8, 10))
  // 目标月的最后一天：下月 0 号（不必查表，闰年也对）。
  const lastDay = new Date(year, month + delta + 1, 0).getDate()
  return dayKey(new Date(year, month + delta, Math.min(day, lastDay)))
}

/** 某月日历的 42 个格子（周一起始，含上下月补白）。 */
export function monthGrid(anchorKey: string): { key: string; day: number; inMonth: boolean }[] {
  const anchor = monthAnchor(anchorKey)
  const monday = startOfWeek(anchor)
  const month = anchor.slice(0, 7)
  return Array.from({ length: 42 }, (_, index) => {
    const key = addDays(monday, index)
    return { key, day: Number(key.slice(8)), inMonth: key.slice(0, 7) === month }
  })
}

/**
 * 某月在周一起始的日历里占几个星期行（5 或 6）。
 *
 * `monthGrid` 恒定返回 42 格，但 2 月或 9 月这类月份只需 5 行；照 6 行铺会把每一格
 * 压掉六分之一的高度，月历里能放下的条目数随之少一条。故由调用方按真实行数裁剪。
 */
export function monthWeekCount(anchorKey: string): number {
  const anchor = monthAnchor(anchorKey)
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7))
  // 下月 0 号 = 本月最后一天，天数不靠查表。
  const daysInMonth = new Date(year, month, 0).getDate()
  return Math.ceil((weekdayIndex(anchor) + daysInMonth) / 7)
}

/** `2026 年 9 月`。 */
export function monthLabel(key: string): string {
  return `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`
}

/** `9-11 周五`（不含"今天/明天"这类相对措辞）。 */
export function dayLabel(key: string): string {
  return `${Number(key.slice(5, 7))}-${key.slice(8)} 周${WEEKDAYS[weekdayIndex(key)]}`
}

/**
 * `2026 年 09 月 11 日`：日程线索头部那一行中央的焦点日期。
 *
 * 三种形态（日 / 周 / 月）共用同一个格式，于是切换形态时中间那一段不换写法、
 * 也不跳字号，只有数字在变——这正是"当前焦点在哪"最容易被读出来的样子。
 * 月与日一律补零，位数固定，翻页时不会左右抽动（与 `TABULAR` 一起用）。
 */
export function fullDateLabel(key: string): string {
  return `${key.slice(0, 4)} 年 ${key.slice(5, 7)} 月 ${key.slice(8, 10)} 日`
}

/** 相对今天的措辞；非邻近日期返回空串，由调用方决定是否补日期。 */
export function relativeLabel(key: string, today: string): string {
  if (key === today) return '今天'
  if (key === addDays(today, 1)) return '明天'
  if (key === addDays(today, -1)) return '昨天'
  return ''
}

/** 星期形态的分组标题：`今天 · 9-11 周五`。 */
export function dayHeading(key: string, today: string): string {
  const relative = relativeLabel(key, today)
  return relative.length === 0 ? dayLabel(key) : `${relative} · ${dayLabel(key)}`
}

// ---------------------------------------------------------------------------
// 日程切片
// ---------------------------------------------------------------------------

/** 按有效区间的开始时刻升序；同一时刻再按原文行号，保证顺序稳定可测。 */
export function sortSchedules<T extends ScheduleCore>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const diff = scheduleInterval(a).start.getTime() - scheduleInterval(b).start.getTime()
    return diff !== 0 ? diff : a.line - b.line
  })
}

/** 与 `[fromKey, toKeyExclusive)` 有交集的日程，按开始时刻升序。 */
export function schedulesInRange<T extends ScheduleCore>(
  items: readonly T[],
  fromKey: string,
  toKeyExclusive: string,
): T[] {
  const from = parseDayKey(fromKey).getTime()
  const to = parseDayKey(toKeyExclusive).getTime()
  return sortSchedules(
    items.filter((row) => {
      const { start, end } = scheduleInterval(row)
      return start.getTime() < to && end.getTime() > from
    }),
  )
}

/** 某一天的日程。 */
export function schedulesOnDay<T extends ScheduleCore>(items: readonly T[], key: string): T[] {
  return schedulesInRange(items, key, addDays(key, 1))
}

/** 把一批日期键各自映射到当天的日程（顺序与传入的日期键一致）。 */
export function schedulesByDay<T extends ScheduleCore>(
  items: readonly T[],
  days: readonly string[],
): { readonly key: string; readonly items: T[] }[] {
  return days.map((key) => ({ key, items: schedulesOnDay(items, key) }))
}

// ---------------------------------------------------------------------------
// 待办四象限
// ---------------------------------------------------------------------------

type Rankable = Pick<TodoCore, 'done' | 'line'> & { readonly project: string; readonly topLevelDir: string }

/**
 * 待办排序：**未完成（按行号倒序）→ 已完成（按行号倒序）**。
 *
 * 已完成绝不排在任何一个未完成之前；同一行号（不同项目）用项目名兜底，保证顺序稳定。
 */
export function rankTodos<T extends Rankable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.line !== b.line) return b.line - a.line
    const byProject = a.project.localeCompare(b.project)
    return byProject !== 0 ? byProject : a.topLevelDir.localeCompare(b.topLevelDir)
  })
}

/** 一个象限的内容。四个象限**恒等大**，空象限也要占位，故空组不省略。 */
export interface QuadrantBucket<T> {
  readonly quadrant: Priority
  /** 未完成，最近创建在前。 */
  readonly pending: readonly T[]
  /** 已完成，最近创建在前；永远排在全部未完成之后。 */
  readonly done: readonly T[]
  readonly total: number
}

/**
 * 按四个优先级分桶，恒定返回 4 项（顺序即领域顺序）。
 *
 * 未设优先级的待办不属于任何象限，由 `unrankedTodos` 单独统计并在界面上如实提示——
 * 硬塞进「不重要不紧急」是对数据的曲解。
 */
export function quadrantBuckets<T extends Rankable & Pick<TodoCore, 'priority'>>(
  todos: readonly T[],
): QuadrantBucket<T>[] {
  return PRIORITIES.map((quadrant) => {
    const ranked = rankTodos(todos.filter((row) => row.priority === quadrant))
    return {
      quadrant,
      pending: ranked.filter((row) => !row.done),
      done: ranked.filter((row) => row.done),
      total: ranked.length,
    }
  })
}

/** 未设优先级的待办（不属于任何象限）。 */
export function unrankedTodos<T extends Pick<TodoCore, 'priority'>>(
  todos: readonly T[],
): T[] {
  return todos.filter((row) => row.priority === undefined)
}

/** 象限内容 = 未完成在前 + 已完成在后。 */
export function quadrantItems<T>(bucket: QuadrantBucket<T>): T[] {
  return [...bucket.pending, ...bucket.done]
}

// ---------------------------------------------------------------------------
// "当前界面能容纳多少条"
// ---------------------------------------------------------------------------

/** 固定行高下能放下多少行；高度未知（0 / NaN）时返回 0，不做臆测。 */
export function rowCapacity(availablePx: number, rowPx: number): number {
  if (!Number.isFinite(availablePx) || !Number.isFinite(rowPx) || rowPx <= 0) return 0
  return Math.max(0, Math.floor(availablePx / rowPx))
}

/** 取前 `capacity` 条，并如实报告被截掉了多少条（界面据此提示，避免"看起来就这些"）。 */
export function fitRows<T>(
  items: readonly T[],
  capacity: number,
): { readonly shown: readonly T[]; readonly hidden: number } {
  if (capacity <= 0) return { shown: [], hidden: items.length }
  if (items.length <= capacity) return { shown: items, hidden: 0 }
  return { shown: items.slice(0, capacity), hidden: items.length - capacity }
}

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

/**
 * 时间标签。依据数据约定规范 4.3 的默认持续时间语义：
 * 无开始时间 = 全天；有开始时间无结束时间 = 只显示起始（不臆造结束）。
 */
export function timeLabel(item: Pick<ScheduleCore, 'startTime' | 'endTime'>): string {
  if (item.startTime === undefined) return '全天'
  return item.endTime === undefined ? `${item.startTime} 起` : `${item.startTime}–${item.endTime}`
}

/** 日期标签：跨日事项显示区间。 */
export function dateLabel(item: Pick<ScheduleCore, 'startDate' | 'endDate'>): string {
  const from = `${Number(item.startDate.slice(5, 7))}-${item.startDate.slice(8)}`
  if (item.endDate === undefined || item.endDate === item.startDate) return from
  return `${from} → ${Number(item.endDate.slice(5, 7))}-${item.endDate.slice(8)}`
}

/**
 * 格式异常提示语。
 *
 * 解析器把格式异常的行**排除在模型之外**（原样留在文件里、只在异常清单中报告），
 * 于是它们在日程 / 待办线索里根本不出现。若不说明，用户会以为条目**丢了**——
 * 对一份任务清单来说，这比"排错象限"严重得多。故三条线索都要如实报出这个条数，
 * 并指明明细在「项目」线索里看。
 */
export function issueNotice(projects: readonly { readonly issueCount: number }[]): string {
  const total = projects.reduce((sum, row) => sum + row.issueCount, 0)
  return total === 0 ? '' : `⚠ 另有 ${total} 行格式异常未进入列表（在「项目」线索里看明细）`
}

// ---------------------------------------------------------------------------
// 悬浮窗：日程明细 + 定位
// ---------------------------------------------------------------------------

/** 视口坐标下的一个矩形。 */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** 元素尺寸。 */
export interface Size {
  readonly width: number
  readonly height: number
}

/** 悬浮窗相对视口的落点。 */
export interface PopoverSpot {
  readonly left: number
  readonly top: number
}

/**
 * 两个落点是否可视为同一个（亚像素差异忽略）。
 *
 * 存在的唯一理由是**防死循环**：悬浮窗"量自己的高度 → 写回落点"这件事必须在没有依赖
 * 数组的 `useLayoutEffect` 里做（内容一变就要重量），而 `popoverPosition()` 每次都返回
 * **新对象**。直接 `setSpot(next)` 会形成"渲染 → 测量 → 写状态 → 再渲染"的自激，
 * React 抛 `Maximum update depth exceeded`，DSH 记一条
 * `slot entry crashed in 'shell.overlay'`，**整块面板连 `aside` 一起消失**
 * （实测踩过）。先比一比、相同就返回原对象，React 才会跳过这次更新。
 *
 * 同一个坑在 `views.tsx` 的 `useBoxSize`、`client.tsx` 的 `useShellGeometry` 里
 * 也各防过一次——凡"测量后写回"的地方都要过这一道。
 */
export function sameSpot(a: PopoverSpot | null, b: PopoverSpot): boolean {
  return a !== null && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/**
 * 把悬浮窗摆到被点元素的旁边，并保证它整个落在 `bounds` 里。
 *
 * 规则三条，按顺序：**默认贴在元素下方、左对齐**；下方装不下就**翻到上方**；
 * 左右越界就**夹回来**。最后再整体夹一次，兜住"元素在角落、悬浮窗比可视区还高"这种
 * 极端情况——宁可压住元素，也不要溢出去被面板裁掉。
 *
 * 纯函数，不碰 DOM：调用方负责把 `getBoundingClientRect()` 的结果传进来。这样"贴哪儿"
 * 这件事可以完整单测，不必去浏览器里靠眼睛判断（我本来也看不到）。
 *
 * @param anchor - 被点元素的矩形（视口坐标）。
 * @param size - 悬浮窗自身的尺寸。
 * @param bounds - 允许出现的范围，通常是面板主体区（视口坐标）。
 * @param gap - 与元素之间的间距。
 * @param margin - 与 `bounds` 各边的留白。
 */
export function popoverPosition(
  anchor: Rect,
  size: Size,
  bounds: Rect,
  gap = 6,
  margin = 8,
): PopoverSpot {
  const minLeft = bounds.left + margin
  const maxLeft = bounds.right - margin - size.width
  const left = clamp(anchor.left, minLeft, Math.max(minLeft, maxLeft))

  const minTop = bounds.top + margin
  const maxTop = bounds.bottom - margin - size.height
  const below = anchor.bottom + gap
  const above = anchor.top - gap - size.height
  // 下方放不下才翻上去；翻上去也放不下就交给最后那一次夹取。
  const preferred = below + size.height > bounds.bottom - margin ? above : below

  return { left, top: clamp(preferred, minTop, Math.max(minTop, maxTop)) }
}

/** 悬浮窗里的一行「标签 / 值」。 */
export interface DetailField {
  readonly label: string
  readonly value: string
}

/** 一条**日程或待办**在明细窗里要显示的内容——两者同构，所以共用一个类型与一份渲染。 */
export interface DetailView {
  readonly title: string
  readonly priority: Priority | null
  readonly done: boolean
  /** 只列出**有值**的字段，空字段不占行。 */
  readonly fields: readonly DetailField[]
}

/**
 * 把一条日程整理成悬浮窗要显示的内容。
 *
 * 只列有值的字段：一条"全天、无地点、无备注"的日程本该只有三行，不该撑出一堆「—」。
 */
export function scheduleDetail(row: ScheduleCore & { readonly project: string }): DetailView {
  const fields: DetailField[] = [
    { label: '日期', value: dateLabel(row) },
    { label: '时间', value: timeLabel(row) },
  ]
  if (row.location !== undefined) fields.push({ label: '地点', value: row.location })
  fields.push({ label: '项目', value: row.project })
  if (row.note !== undefined) fields.push({ label: '备注', value: row.note })

  return {
    title: row.title,
    priority: row.priority ?? null,
    done: row.done,
    fields,
  }
}

/**
 * 把一条待办整理成悬浮窗要显示的内容（与 `scheduleDetail` 同构，明细窗才能共用一套渲染）。
 *
 * 待办可显示的字段本来就少（没有日期 / 时间 / 地点），所以只有「项目」与有值的「备注」；
 * 完成状态由窗底部那个切换按钮表达，不再单独占一行——**同一件事在窗里出现两次，
 * 用户会怀疑它们是不是一回事**。
 */
export function todoDetail(row: TodoCore & { readonly project: string }): DetailView {
  const fields: DetailField[] = [{ label: '项目', value: row.project }]
  if (row.note !== undefined && row.note.length > 0) fields.push({ label: '备注', value: row.note })

  return {
    title: row.title,
    priority: row.priority ?? null,
    done: row.done,
    fields,
  }
}

/**
 * 「点日程标题 → 打开原始 markdown」之后要报什么。
 *
 * 写成纯函数是为了把**该说的话**和组件分开：这里的话术有几条硬规则，
 * 每一条都对应一个真实会发生的状态，而不是随手拼字符串：
 *
 * 1. **跳行没跳成必须明说**。关联程序认不出（Typora 这类）时我们只能打开整个文件，
 *    此时要告诉用户"行号没跳过去，日程在第 N 行"——不然他会在文件里白找。
 * 2. **文件被外部改过要说**（`exact: false`）：行号是从上一次读取来的，可能已经偏了。
 * 3. **不展示绝对路径**。横幅是给"我点了什么、发生了什么"用的，一串本机路径
 *    既读不下去也没必要（真要找文件，编辑器标题栏里就是）。
 */
export function openSourceMessage(result: OpenSourceResult): {
  readonly kind: 'info' | 'warn'
  readonly text: string
} {
  const where = `第 ${result.line} 行`
  const drift = result.exact ? '' : '（文件已改动，行号可能不准）'

  if (result.dryRun) {
    return { kind: 'warn', text: `演练模式：本应打开工作日志${where}${drift}` }
  }
  if (!result.launched) {
    return { kind: 'warn', text: `未能打开工作日志${where}${drift}` }
  }
  if (result.lineCapable) {
    return { kind: 'info', text: `已用 ${result.app} 打开工作日志${where}${drift}` }
  }
  return {
    kind: 'warn',
    text: `已用 ${result.app} 打开工作日志，但它不支持跳到指定行：日程在第 ${result.line} 行${drift}`,
  }
}

/**
 * 项目选择器的候选筛选。
 *
 * 案件名很长（通常是「办理中_日期 + 当事人 + 案由」那种写法），纯下拉在这种名单里认不出来，
 * 所以给一个关键字框：**输入片段 → 列出命中的项目**。
 *
 * 三条约定：
 * - 关键字为空 → 返回**全部**（打开列表就该看到所有候选，而不是一片空白）；
 * - 前后空白忽略（用户粘一个名字进来时末尾常带空格）；
 * - 同时匹配**项目名**与**顶级目录名**（"诉讼案件" 这样的大类词也能筛），大小写不敏感
 *   （对中文是空操作，对拼音 / 英文目录名有用）。
 *
 * 纯函数，返回新数组，不改动入参顺序——候选顺序由调用方给（host 的排序已经稳定）。
 */
export function filterProjects<T extends { readonly project: string; readonly topLevelDir: string }>(
  projects: readonly T[],
  keyword: string,
): T[] {
  const needle = keyword.trim().toLowerCase()
  if (needle.length === 0) return [...projects]
  return projects.filter(
    (row) =>
      row.project.toLowerCase().includes(needle) || row.topLevelDir.toLowerCase().includes(needle),
  )
}

// ---------------------------------------------------------------------------
// 新建条目：空白处点一下 → 悬浮窗表单
// ---------------------------------------------------------------------------

/**
 * 「点空白 → 新建」这条手势的**纯逻辑**部分。
 *
 * 设计上只有一条规则：**点在哪儿，就决定了新建什么、预填什么**。所以「重要且紧急」
 * 那一行点下去开出来的是一条该优先级的待办，日卡表头「09/12 今天」点下去开出来的是一条
 * 9 月 12 日的日程——不需要用户在窗里再选一次"我是从哪儿点的"。
 */

/** 新建的两种东西。 */
export type ComposeKind = 'todo' | 'schedule'

/** 项目的定位对（重名项目靠 `topLevelDir` 消歧）。 */
export interface ProjectRef {
  readonly project: string
  readonly topLevelDir: string
}

/**
 * 「点在哪儿」→「要新建什么、预填什么」。
 *
 * `project` 省略表示"由窗里的项目选择器决定"（待办 / 日程线索都是跨项目的，
 * 用户在那两处点空白时并没有指定案件）；给了就锁死（项目详情里点的，只能是这个案件）。
 */
export interface ComposeRequest {
  readonly kind: ComposeKind
  readonly project?: string
  readonly topLevelDir?: string
  readonly priority?: Priority
  /** 日程的预填开始日期（日卡 / 周列 / 月格各自给出自己那一天的键）。 */
  readonly startDate?: string
  /** 点击位置（视口坐标），悬浮窗贴着它弹出来。 */
  readonly anchor: Rect
}

/** 新建窗里的表单草稿（受控字段，全部是字符串，空串即"没填"）。 */
export interface ComposeDraft {
  readonly kind: ComposeKind
  readonly project: string
  readonly topLevelDir: string
  readonly title: string
  /** `null` = 未设优先级（合法值，不是"还没选"）。 */
  readonly priority: Priority | null
  readonly note: string
  readonly startDate: string
  readonly endDate: string
  readonly startTime: string
  readonly endTime: string
  readonly location: string
}

/**
 * 新建条目时默认写到哪个项目。
 *
 * **记忆优先**：待办线索是跨项目的，连着录三条时第二条不该再选一次案件。记忆里的项目
 * 已经不存在了（改名 / 删除 / 换了数据目录）就退回第一个——文件是唯一真相，
 * 抱着一个指向已消失项目的记忆只会让"新建"必然失败。
 *
 * 一个项目都没有（还没设定数据目录、或目录里没有已就绪的项目）时返回 `null`，
 * 由调用方给出可执行的提示，而不是开一张注定写不进去的表单。
 */
export function defaultComposeProject(
  projects: readonly ProjectRef[],
  remembered: ProjectRef | null,
): ProjectRef | null {
  if (remembered !== null) {
    const hit = projects.find(
      (row) => row.project === remembered.project && row.topLevelDir === remembered.topLevelDir,
    )
    if (hit !== undefined) return { project: hit.project, topLevelDir: hit.topLevelDir }
  }
  const first = projects[0]
  return first === undefined ? null : { project: first.project, topLevelDir: first.topLevelDir }
}

/** 由"点在哪儿"开出一份空白草稿；没地方可写（一个项目都没有）时返回 `null`。 */
export function composeDraftOf(
  request: ComposeRequest,
  fallback: ProjectRef | null,
  today: string,
): ComposeDraft | null {
  // 项目是**成对**的：重名案件靠 `topLevelDir` 消歧，所以两个一起给才算指定了案件。
  // 只给一半时整对退回兜底，免得拼出"乙案 + 诉讼案件"这种不存在的组合。
  const picked =
    request.project !== undefined && request.topLevelDir !== undefined
      ? { project: request.project, topLevelDir: request.topLevelDir }
      : fallback
  if (picked === null) return null
  return {
    kind: request.kind,
    project: picked.project,
    topLevelDir: picked.topLevelDir,
    title: '',
    priority: request.priority ?? null,
    note: '',
    // 日程必须有开始日期：调用方给了（日卡 / 周列 / 月格）就用它，没给就落在今天。
    startDate: request.kind === 'schedule' ? (request.startDate ?? today) : '',
    endDate: '',
    startTime: '',
    endTime: '',
    location: '',
  }
}

/**
 * 草稿 → `/dslegal/edit` 的请求体。
 *
 * 空字段**整个省略**而不是送空串：host 的 `optionalText` 两者等价，但省掉之后
 * 请求体读起来就是"用户填了哪几项"，排查问题时不用去猜空串是什么意思。
 */
export function composeEditBody(draft: ComposeDraft): Record<string, unknown> {
  const note = draft.note.trim()
  const head = { project: draft.project, topLevelDir: draft.topLevelDir }
  const common = {
    title: draft.title.trim(),
    ...(draft.priority === null ? {} : { priority: draft.priority }),
    ...(note.length === 0 ? {} : { note }),
  }
  if (draft.kind === 'todo') return { op: 'todo.add', ...head, input: common }

  const endDate = draft.endDate.trim()
  const startTime = draft.startTime.trim()
  const endTime = draft.endTime.trim()
  const location = draft.location.trim()
  return {
    op: 'schedule.add',
    ...head,
    input: {
      ...common,
      startDate: draft.startDate.trim(),
      ...(endDate.length === 0 ? {} : { endDate }),
      ...(startTime.length === 0 ? {} : { startTime }),
      ...(endTime.length === 0 ? {} : { endTime }),
      ...(location.length === 0 ? {} : { location }),
    },
  }
}

/**
 * 校验草稿，返回第一条错误；没有错误返回 `null`。
 *
 * **直接调用 `@dslegal/core` 的渲染器**，不在这里另写一套规则：`formatTodoLine` /
 * `formatScheduleLine` 正是 host 落盘前用的那两个函数（client 产物里已经内联了 core）。
 * 于是"界面说没问题、写下去却被打回来"这类错位在结构上不可能发生，提示文案也逐字一致
 * ——包括"标题里不能出现半角方括号"这种只有一方记得写的琐碎规则。
 *
 * 注意它在**打开窗的那一刻就会返回「标题不能为空」**（草稿本来就是空的）。这不算错，
 * 所以调用方要等用户点过「创建」之后再显示它，否则一开窗就摆一条红字。
 */
export function composeError(draft: ComposeDraft): string | null {
  const result =
    draft.kind === 'todo'
      ? formatTodoLine({ title: draft.title, priority: draft.priority, note: draft.note })
      : formatScheduleLine({
          title: draft.title,
          priority: draft.priority,
          note: draft.note,
          startDate: draft.startDate,
          endDate: draft.endDate,
          startTime: draft.startTime,
          endTime: draft.endTime,
          location: draft.location,
        })
  return result.ok ? null : result.message
}
