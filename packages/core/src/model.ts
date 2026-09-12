/**
 * DSLegalPlugin 领域模型。
 *
 * 数据契约见 `maintenance/2. DSLegalPlugin 数据约定规范.md`。
 */

/** 优先级：四象限。 */
export const PRIORITIES = ['重要且紧急', '紧急不重要', '重要不紧急', '不重要不紧急'] as const

/** 优先级。 */
export type Priority = (typeof PRIORITIES)[number]

/** 优先级默认颜色（赤 / 橙 / 黄 / 绿）。 */
export const PRIORITY_COLORS: Readonly<Record<Priority, string>> = {
  重要且紧急: '#E53E3E',
  紧急不重要: '#ED8936',
  重要不紧急: '#f3e417',
  不重要不紧急: '#98c51e',
}

/** 颜色写法只接受 `#RRGGBB`（大小写均可）。 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/** 是否为合法的 `#RRGGBB`。 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

/** 用户在设置里为四个优先级各配的颜色；缺某个键即该优先级用默认色。 */
export type PriorityColorOverrides = Partial<Record<Priority, string>>

/** 一条颜色配置的问题（原值 + 原因），由界面如实提示。 */
export interface PriorityColorIssue {
  readonly priority: Priority
  readonly value: string
  readonly message: string
}

/** 颜色规范化结果。 */
export interface ResolvedPriorityColors {
  /** 四个优先级**一定有值**，可直接拿去渲染。 */
  readonly colors: Record<Priority, string>
  readonly issues: readonly PriorityColorIssue[]
}

/**
 * 把用户配的颜色合并到默认色上。
 *
 * **逐键兜底**：某一键非法只影响它自己，其余照常生效——一个笔误不该把整个界面染坏。
 * 非法值不静默丢弃，而是连同原值一起报出来（`issues`），由界面提示。
 *
 * 入参声明为 `unknown` 是刻意的：它直接接 HTTP 请求体里那一格，可能是任何东西。
 *
 * @param input - 用户配置（通常来自 `settings.yaml` 的 `dslegal.priorityColors`）。
 */
export function resolvePriorityColors(input?: unknown): ResolvedPriorityColors {
  const colors: Record<Priority, string> = { ...PRIORITY_COLORS }
  const issues: PriorityColorIssue[] = []
  if (typeof input !== 'object' || input === null) return { colors, issues }

  const record = input as Record<string, unknown>
  for (const priority of PRIORITIES) {
    const raw = record[priority]
    // 键缺席 = 用默认色，不是问题。
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      issues.push({ priority, value: String(raw), message: '颜色留空了，已改用默认色。' })
      continue
    }
    const value = raw.trim()
    if (!isHexColor(value)) {
      issues.push({
        priority,
        value,
        message: `颜色写法应为 #RRGGBB（如 #E53E3E），「${value}」无法识别，已改用默认色。`,
      })
      continue
    }
    colors[priority] = value
  }
  return { colors, issues }
}

/** 8 类法律服务。 */
export const SERVICE_CATEGORIES = [
  '民事诉讼',
  '刑事诉讼',
  '行政诉讼',
  '法律顾问',
  '专项服务',
  '法律咨询',
  '专利代理',
  '商标代理',
] as const

/** 法律服务类别。 */
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]

/** 条目在源文件中的位置，供"外科手术式"写回使用。 */
export interface SourceLocation {
  /** 1-based 行号。 */
  readonly line: number
  /** 原始行文本（不含换行符）。 */
  readonly raw: string
}

/** 待办事项条目（无具体时间）。 */
export interface TodoItem extends SourceLocation {
  readonly kind: 'todo'
  /** 复选框：`false` = 未完成，`true` = 已完成。 */
  readonly done: boolean
  readonly title: string
  readonly priority: Priority | null
  readonly note: string | null
}

/** 日程安排条目（有具体时间）。 */
export interface ScheduleItem extends SourceLocation {
  readonly kind: 'schedule'
  /** 复选框：`false` = 未完成，`true` = 已完成。 */
  readonly done: boolean
  readonly title: string
  readonly priority: Priority | null
  readonly note: string | null
  /** 开始日期，`YYYY-MM-DD`，必填。 */
  readonly startDate: string
  /** 结束日期，`YYYY-MM-DD`，可选（跨日事项）。 */
  readonly endDate: string | null
  /** 开始时间，`HH:mm`，可选；为空表示全天事项。 */
  readonly startTime: string | null
  /** 结束时间，`HH:mm`，可选。 */
  readonly endTime: string | null
  readonly location: string | null
}

/** 日程或待办条目。 */
export type AgendaItem = TodoItem | ScheduleItem

/** 解析问题错误码。 */
export type IssueCode =
  | 'section-missing'
  | 'section-duplicated'
  | 'title-missing'
  | 'title-invalid'
  | 'checkbox-missing'
  | 'field-count'
  | 'title-empty'
  | 'priority-invalid'
  | 'date-invalid'
  | 'time-invalid'
  | 'time-range-invalid'
  | 'stray-text'

/** 解析问题。异常行原样保留，仅在此报告。 */
export interface ParseIssue {
  readonly code: IssueCode
  readonly message: string
  readonly severity: 'error' | 'warning'
  /** 1-based 行号；章节级问题为 `null`。 */
  readonly line: number | null
  /** 原始行文本；章节级问题为 `null`。 */
  readonly raw: string | null
}
