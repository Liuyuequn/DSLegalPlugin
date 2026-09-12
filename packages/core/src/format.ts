/**
 * 条目行渲染与输入校验。
 *
 * 渲染结果必须能被 `parse.ts` 原样解析回来（往返一致），因此这里执行与解析器同源的校验。
 */

import { FIELD_SEPARATOR, isValidDate, isValidTime } from './convention.js'
import { PRIORITIES, type Priority } from './model.js'

/** 渲染 / 校验错误码。 */
export type FormatCode =
  | 'title-empty'
  | 'bracket-in-field'
  | 'priority-invalid'
  | 'date-invalid'
  | 'time-invalid'
  | 'time-range-invalid'

export type FormatResult =
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly code: FormatCode; readonly message: string }

/** 待办条目的写入输入。 */
export interface TodoInput {
  readonly title: string
  readonly priority?: Priority | null
  readonly note?: string | null
  readonly done?: boolean
}

/** 日程条目的写入输入。 */
export interface ScheduleInput {
  readonly title: string
  readonly priority?: Priority | null
  readonly note?: string | null
  /** `YYYY-MM-DD`，必填。 */
  readonly startDate: string
  /** `YYYY-MM-DD`，可选。 */
  readonly endDate?: string | null
  /** `HH:mm`，可选；为空即全天事项。 */
  readonly startTime?: string | null
  /** `HH:mm`，可选。 */
  readonly endTime?: string | null
  readonly location?: string | null
  readonly done?: boolean
}

function fail(code: FormatCode, message: string): FormatResult {
  return { ok: false, code, message }
}

/** 空串与纯空白一律归一为 `null`。 */
function optional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function bracketError(value: string, label: string): string | null {
  if (value.includes('[') || value.includes(']')) {
    return `${label}中不得出现半角方括号（[ 或 ]）；如需请改用全角【】。`
  }
  return null
}

function priorityError(priority: Priority | null): string | null {
  if (priority === null) return null
  return (PRIORITIES as readonly string[]).includes(priority)
    ? null
    : `优先级取值非法：「${priority}」；应为 ${PRIORITIES.join(' / ')}。`
}

/** 渲染字段串：中间的 null 渲染为 `[]`，尾部连续的 null 省略。 */
function renderFields(fields: readonly (string | null)[]): string {
  const values = [...fields]
  while (values.length > 0 && values[values.length - 1] === null) values.pop()
  return values.map((value) => `[${value ?? ''}]`).join(FIELD_SEPARATOR)
}

function checkbox(done: boolean): string {
  return done ? '- [x]' : '- [ ]'
}

/** 渲染一条待办条目行。 */
export function formatTodoLine(input: TodoInput): FormatResult {
  const title = input.title.trim()
  if (title.length === 0) return fail('title-empty', '标题不能为空。')
  const titleBracket = bracketError(title, '标题')
  if (titleBracket !== null) return fail('bracket-in-field', titleBracket)

  const priority = input.priority ?? null
  const badPriority = priorityError(priority)
  if (badPriority !== null) return fail('priority-invalid', badPriority)

  const note = optional(input.note)
  if (note !== null) {
    const noteBracket = bracketError(note, '备注')
    if (noteBracket !== null) return fail('bracket-in-field', noteBracket)
  }

  return { ok: true, line: `${checkbox(input.done === true)} ${renderFields([title, priority, note])}` }
}

/** 渲染一条日程条目行。 */
export function formatScheduleLine(input: ScheduleInput): FormatResult {
  const title = input.title.trim()
  if (title.length === 0) return fail('title-empty', '标题不能为空。')
  const titleBracket = bracketError(title, '标题')
  if (titleBracket !== null) return fail('bracket-in-field', titleBracket)

  const priority = input.priority ?? null
  const badPriority = priorityError(priority)
  if (badPriority !== null) return fail('priority-invalid', badPriority)

  const note = optional(input.note)
  if (note !== null) {
    const noteBracket = bracketError(note, '备注')
    if (noteBracket !== null) return fail('bracket-in-field', noteBracket)
  }

  const location = optional(input.location)
  if (location !== null) {
    const locationBracket = bracketError(location, '地点')
    if (locationBracket !== null) return fail('bracket-in-field', locationBracket)
  }

  const startDate = input.startDate.trim()
  if (!isValidDate(startDate)) {
    return fail(
      'date-invalid',
      startDate.length === 0
        ? '开始日期必填。'
        : `开始日期格式非法：「${startDate}」；应为 YYYY-MM-DD。`,
    )
  }
  const endDate = optional(input.endDate)
  if (endDate !== null && !isValidDate(endDate)) {
    return fail('date-invalid', `结束日期格式非法：「${endDate}」；应为 YYYY-MM-DD。`)
  }
  const startTime = optional(input.startTime)
  if (startTime !== null && !isValidTime(startTime)) {
    return fail('time-invalid', `开始时间格式非法：「${startTime}」；应为 HH:mm。`)
  }
  const endTime = optional(input.endTime)
  if (endTime !== null && !isValidTime(endTime)) {
    return fail('time-invalid', `结束时间格式非法：「${endTime}」；应为 HH:mm。`)
  }

  if (endTime !== null) {
    const startMoment = `${startDate}T${startTime ?? '00:00'}`
    const endMoment = `${endDate ?? startDate}T${endTime}`
    if (endMoment < startMoment) {
      return fail(
        'time-range-invalid',
        `结束时刻早于开始时刻（${endMoment.replace('T', ' ')} < ${startMoment.replace('T', ' ')}）。`,
      )
    }
  }

  return {
    ok: true,
    line: `${checkbox(input.done === true)} ${renderFields([
      title,
      priority,
      note,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
    ])}`,
  }
}
