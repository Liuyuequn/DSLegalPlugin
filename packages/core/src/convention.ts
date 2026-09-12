/**
 * 数据契约常量。
 *
 * 数据契约见 `maintenance/2. DSLegalPlugin 数据约定规范.md`。
 */

import type { ServiceCategory } from './model.js'

/** 协作工作空间目录名（固定，不可配置）。 */
export const COLLAB_DIR = '0. 协作'

/** 工作日志文件名（固定，不可配置）。 */
export const WORK_LOG_FILE = '1. 工作日志.md'

/** 待办事项章节标题（H2 文本，精确匹配，前后空白容错）。 */
export const SECTION_TODO = '1. 待办事项'

/** 日程安排章节标题（H2 文本，精确匹配，前后空白容错）。 */
export const SECTION_SCHEDULE = '2. 日程安排'

/** 顶级目录默认名称 → 服务类别。名称可配置，此处为默认值。 */
export const DEFAULT_TOP_LEVEL_DIRS: Readonly<Record<string, readonly ServiceCategory[]>> = {
  诉讼案件: ['民事诉讼', '刑事诉讼', '行政诉讼'],
  法律顾问: ['法律顾问'],
  知产代理: ['专利代理', '商标代理'],
  专项服务: ['专项服务'],
  法律咨询: ['法律咨询'],
}

/** 日期格式：`YYYY-MM-DD`。 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 时间格式：`HH:mm`。 */
export const TIME_PATTERN = /^\d{2}:\d{2}$/

/** 字段分隔符（仅书写用；解析以方括号为准，不依赖它）。 */
export const FIELD_SEPARATOR = '，'

/** 待办条目字段数上限：标题 / 优先级 / 备注。 */
export const TODO_FIELD_COUNT = 3

/** 日程条目字段数上限：标题 / 优先级 / 备注 / 开始日期 / 结束日期 / 开始时间 / 结束时间 / 地点。 */
export const SCHEDULE_FIELD_COUNT = 8

/** 工作日志 H1 标题前缀：`# 工作日志_<类别>`。 */
export const WORK_LOG_TITLE_PREFIX = '工作日志_'

/**
 * 服务类别 → H1 标题后缀。
 *
 * 诉讼类使用简称（民事 / 刑事 / 行政），其余类别使用类别全名。
 */
export const CATEGORY_TITLE_SUFFIX: Readonly<Record<ServiceCategory, string>> = {
  民事诉讼: '民事',
  刑事诉讼: '刑事',
  行政诉讼: '行政',
  法律顾问: '法律顾问',
  专项服务: '专项服务',
  法律咨询: '法律咨询',
  专利代理: '专利代理',
  商标代理: '商标代理',
}

/** 某类服务的标准工作日志标题（不含 `# `）。 */
export function workLogTitleFor(category: ServiceCategory): string {
  return `${WORK_LOG_TITLE_PREFIX}${CATEGORY_TITLE_SUFFIX[category]}`
}

/** 从 H1 标题解析服务类别；无法识别返回 `null`。 */
export function categoryFromTitle(title: string): ServiceCategory | null {
  const trimmed = title.trim()
  if (!trimmed.startsWith(WORK_LOG_TITLE_PREFIX)) return null
  const suffix = trimmed.slice(WORK_LOG_TITLE_PREFIX.length).trim()
  for (const [category, value] of Object.entries(CATEGORY_TITLE_SUFFIX)) {
    if (value === suffix) return category as ServiceCategory
  }
  return null
}

/** 校验 `YYYY-MM-DD` 是否为真实存在的日历日期。 */
export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** 校验 `HH:mm` 是否为合法时刻。 */
export function isValidTime(value: string): boolean {
  if (!TIME_PATTERN.test(value)) return false
  const hour = Number(value.slice(0, 2))
  const minute = Number(value.slice(3, 5))
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}
