/**
 * 数据层：host 的只读聚合接口与唯一的写入接口。
 *
 * 本文件只做**传输与类型**，不含任何视图逻辑（视图模型见 `view.ts`，样式见 `styles.ts`）。
 *
 * 接口分工：
 * - `/dslegal/overview` —— 一次取回**完整数据集**（全部项目 + 全部待办 + 全部日程），
 *   三条线索（日程 / 待办 / 项目）都在本地切片，切换线索不再发请求、不会闪。
 * - `/dslegal/agenda` —— 单个项目的明细，用于项目详情里的格式异常清单。
 * - `/dslegal/edit` —— 全部写入；`target: { line, title }` 的校验语义由 host 保证。
 */

import { PRIORITY_COLORS, type Priority, type PriorityColorIssue, type PriorityColorOverrides } from '@dslegal/core'

/** 待办的**共有字段**（跨项目聚合行与单项目明细行共用）。 */
export interface TodoCore {
  readonly line: number
  readonly done: boolean
  readonly title: string
  readonly priority?: Priority
  readonly note?: string
}

/** 日程的**共有字段**（跨项目聚合行与单项目明细行共用）。 */
export interface ScheduleCore {
  readonly line: number
  readonly done: boolean
  readonly title: string
  readonly priority?: Priority
  readonly note?: string
  /** 开始日期 `YYYY-MM-DD`，必填（解析器丢弃日期非法的行）。 */
  readonly startDate: string
  /** 结束日期，跨日事项才有。 */
  readonly endDate?: string
  /** 开始时间 `HH:mm`；缺省表示全天事项。 */
  readonly startTime?: string
  /** 结束时间；缺省表示持续到当日结束。 */
  readonly endTime?: string
  readonly location?: string
}

/** 待办 + 所属项目。 */
export interface TodoRow extends TodoCore {
  readonly project: string
  readonly topLevelDir: string
}

/** 日程 + 所属项目与派生状态。 */
export interface ScheduleRow extends ScheduleCore {
  readonly project: string
  readonly topLevelDir: string
  readonly category: string | null
  /** 派生状态：当前时刻落在有效时间区间内（由 host 统一计算，client 不自己算）。 */
  readonly ongoing: boolean
}

/** 项目汇总行。 */
export interface ProjectRow {
  readonly project: string
  readonly topLevelDir: string
  readonly category?: string
  readonly title?: string
  readonly categoryIssue?: string
  /** 未完成待办数。 */
  readonly todoPending: number
  readonly todoDone: number
  /** 日程总数。 */
  readonly scheduleTotal: number
  /** 未来 7 天内有效（未结束）的日程数。 */
  readonly scheduleNext7: number
  /** 此刻处于有效时间区间内的日程数（派生状态）。 */
  readonly ongoing: number
  /** 文档与条目异常数。 */
  readonly issueCount: number
}

/** 解析问题行。 */
export interface IssueRow {
  readonly line: number | null
  readonly severity: string
  readonly message: string
}

/** 跨项目总览。 */
export interface Overview {
  /** 数据目录是否已设定；`false` 时其余字段为空，界面改显数据目录表单。 */
  readonly configured: boolean
  /** 当前数据根目录（绝对路径）；未设定时为 `null`。 */
  readonly dataRoot: string | null
  /** host 认定的今天（`YYYY-MM-DD`）。 */
  readonly today: string
  readonly projects: readonly ProjectRow[]
  /** 全部待办（**含已完成**）：待办线索要展示完成状态。 */
  readonly todos: readonly TodoRow[]
  /** 全部日程（不限今天）：日程线索按日 / 周 / 月三形态本地切片。 */
  readonly schedules: readonly ScheduleRow[]
  /**
   * 四个优先级当前生效的显示颜色（host 已合过用户设置与默认值，**一定有值**）。
   *
   * 颜色随数据一起下发，而不是让 client 自己再读一遍设置：client 与 host 是两个插件，
   * 让两边各算一套"用户设置 → 默认色"的兜底，迟早会算出两个配色的界面。
   */
  readonly priorityColors: Record<Priority, string>
  /** 设置里写坏的颜色键及原因（host 已逐键兜底，这里只负责如实提示）。 */
  readonly colorIssues?: readonly PriorityColorIssue[]
  /**
   * host 较旧、没有下发颜色，界面正用内置默认色凑合。
   *
   * 这里**不抛错**（与 `schedules`/`todos` 的处理相反）：字段缺失在那里等于"数据是错的"
   * （会把"接口没这个字段"渲染成"今天没有安排"），而颜色缺失有一个**可证明正确的兜底**
   * ——内置默认色正是旧 host 一直在用的那一套。所以降级渲染 + 明确告知，比让整个面板
   * 打不开有用得多。
   */
  readonly colorsUnavailable?: boolean
}

/** 数据目录状态（`/dslegal/settings`）。 */
export interface SettingsView {
  readonly configured: boolean
  readonly dataRoot: string | null
  readonly projectCount: number
  readonly incompleteCount: number
  /** 当前生效的四个颜色。 */
  readonly priorityColors: Record<Priority, string>
  /** 出厂默认色，供「恢复默认」用。 */
  readonly defaultPriorityColors: Record<Priority, string>
  /** 被兜底掉的颜色键及原因。 */
  readonly colorIssues: readonly PriorityColorIssue[]
}

/** 单项目明细（`/dslegal/agenda`）。 */
export interface Agenda {
  readonly project: string
  readonly category: string | null
  readonly title?: string
  readonly categoryIssue?: string
  readonly todos: readonly TodoCore[]
  readonly schedule: readonly ScheduleCore[]
  readonly issues: readonly IssueRow[]
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`)
  return (await response.json()) as T
}

/** 版本错配的提示语：client 与 host 是同一 profile 里的两个插件，升级后可能只热更了一半。 */
export const HOST_OUTDATED =
  '插件数据接口版本过旧（未返回 schedules 字段）：请在重启 DSH 后刷新本页。'

/** 同上，但缺的是颜色字段（做了颜色自定义之后才有的字段）。 */
export const HOST_OUTDATED_COLORS =
  '插件数据接口版本过旧（未返回 priorityColors 字段）：请在重启 DSH 后刷新本页，否则自定义颜色不会生效。'

/**
 * 总览。
 *
 * 这里**校验形状**而不是盲目断言：client 产物按请求从磁盘读、刷新页面即生效，而 host
 * 插件要重启 DSH 才换新。若先刷新了页面、后重启 DSH，新界面会拿到旧接口的响应
 * （只有 `timeline`、没有 `schedules`），此时必须给出可执行的提示，而不是白屏或
 * "今天没有安排"这类看似正常的假象。
 */
export async function getOverview(): Promise<Overview> {
  const payload = await getJson<Partial<Overview>>('/dslegal/overview')
  if (!Array.isArray(payload.schedules) || !Array.isArray(payload.todos)) {
    throw new Error(HOST_OUTDATED)
  }
  // 颜色字段是后加的：旧 host 不返回它。**不抛错**——内置默认色是可证明正确的兜底
  // （正是旧 host 一直在用的那一套），降级渲染 + 标记出来提示用户重启 DSH 即可；
  // 抛错会让整个面板在"页面已刷新、DSH 还没重启"的窗口期里直接不可用。
  const colors = payload.priorityColors
  if (colors === undefined || colors === null) {
    return { ...(payload as Overview), priorityColors: { ...PRIORITY_COLORS }, colorsUnavailable: true }
  }
  return payload as Overview
}

/** 写入失败时携带 host 的错误码，供界面区分"外部已变更"与普通错误。 */
export class EditError extends Error {
  constructor(
    message: string,
    readonly code: 'stale' | 'other',
  ) {
    super(message)
  }
}

export async function postEdit(body: unknown): Promise<void> {
  const response = await fetch('/dslegal/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let payload: { error?: string } = {}
  try {
    payload = (await response.json()) as { error?: string }
  } catch {
    payload = {}
  }
  if (response.ok && payload.error === undefined) return
  const message = payload.error ?? `写入失败：HTTP ${response.status}`
  // host 的 stale 守卫 = 外部已改过文件（数据约定规范 5.4：以文件为准）。
  throw new EditError(message, /不一致|已被修改|可能已变化/.test(message) ? 'stale' : 'other')
}

export const getSettings = (): Promise<SettingsView> => getJson<SettingsView>('/dslegal/settings')

/** 保存数据根目录；host 会校验目录存在并立即重新扫描。 */
export async function postSettings(patch: {
  readonly dataRoot?: string
  readonly priorityColors?: PriorityColorOverrides
}): Promise<SettingsView> {
  const response = await fetch('/dslegal/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  // 旧版 host 没有该路由，返回的是 HTML 而非 JSON——不能直接 .json()（会抛语法错误）。
  const text = await response.text()
  let payload: { error?: string } = {}
  try {
    payload = JSON.parse(text) as { error?: string }
  } catch {
    payload = {}
  }
  if (!response.ok || payload.error !== undefined) {
    const hint = response.status === 404 ? '（host 插件未加载该接口，请重启 DSH）' : ''
    throw new Error(payload.error ?? `保存失败：HTTP ${response.status}${hint}`)
  }
  return payload as unknown as SettingsView
}

export const getAgenda = (project: string, topLevelDir?: string): Promise<Agenda> =>
  getJson<Agenda>(
    `/dslegal/agenda?project=${encodeURIComponent(project)}${
      topLevelDir === undefined ? '' : `&topLevelDir=${encodeURIComponent(topLevelDir)}`
    }`,
  )
