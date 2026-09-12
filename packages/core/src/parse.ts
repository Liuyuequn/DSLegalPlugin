/**
 * 「1. 工作日志.md」解析器（只读）。
 *
 * 规则来源：`maintenance/2. DSLegalPlugin 数据约定规范.md`。
 *
 * 设计要点：
 * - 只解析两个二级章节（`## 1. 待办事项`、`## 2. 日程安排`）；章节以外内容不读取。
 * - 章节内除条目行外的内容不参与解析。
 * - 条目字段由**半角方括号**界定，全角逗号仅作书写分隔、可出现在字段内容中。
 * - 任何校验失败 → 该行**不作为条目**，仅在 `issues` 中报告；调用方负责原样保留该行。
 */

import {
  SCHEDULE_FIELD_COUNT,
  SECTION_SCHEDULE,
  SECTION_TODO,
  TODO_FIELD_COUNT,
  categoryFromTitle,
  isValidDate,
  isValidTime,
} from './convention.js'
import {
  PRIORITIES,
  type ParseIssue,
  type Priority,
  type ScheduleItem,
  type ServiceCategory,
  type TodoItem,
} from './model.js'

/** 一级标题：`# ` + 文本（前后空白容错）。 */
const H1_PATTERN = /^#(?!#)\s*(.*?)\s*$/

/** 二级标题：`## ` + 文本（前后空白容错）。 */
const H2_PATTERN = /^##(?!#)\s*(.*?)\s*$/

/** 条目行：`- [ ]` / `- [x]` + 余下文本。 */
const ITEM_PATTERN = /^-\s+\[([ xX])\]\s*(.*)$/

/** 疑似条目（以 `- ` 开头但缺少复选框）。 */
const LIST_LIKE_PATTERN = /^-\s+/

/** 方括号字段组。 */
const FIELD_PATTERN_SOURCE = '\\[([^[\\]]*)\\]'

/** 字段之间的合法填充（分隔逗号与空白）。 */
const FILLER_PATTERN = /[\s，,]/g

/** 单个章节的解析结果。 */
export interface SectionParse<T> {
  /** 是否找到该章节。 */
  readonly found: boolean
  /** 标题行的 1-based 行号；未找到为 `null`。 */
  readonly headingLine: number | null
  /** 成功解析的条目（按文件顺序）。 */
  readonly items: readonly T[]
  /** 该章节内的问题。 */
  readonly issues: readonly ParseIssue[]
}

/** 整个工作日志的解析结果。 */
export interface WorkLogParseResult {
  /** 文档 H1 标题（去除 `#` 与首尾空白）；无 H1 为 `null`。 */
  readonly title: string | null
  /** 由 H1 标题解析出的服务类别；无法识别为 `null`。 */
  readonly category: ServiceCategory | null
  readonly todo: SectionParse<TodoItem>
  readonly schedule: SectionParse<ScheduleItem>
  /** 文档级与章节级问题（标题缺失 / 非法、章节缺失 / 重复）。 */
  readonly issues: readonly ParseIssue[]
}

interface RawLine {
  readonly line: number
  readonly text: string
}

interface ExtractedFields {
  readonly fields: readonly string[]
  /** 方括号之外的残留文本（去掉分隔符与空白后）；无则为 `null`。 */
  readonly stray: string | null
}

/**
 * 按行切分，行号为 1-based。
 *
 * **先剥离 UTF-8 BOM**：Windows 编辑器（记事本、部分脚本写入）常给文件加 BOM，
 * 若不清除，首行的 `# 工作日志_民事` 或 `## 1. 待办事项` 会因前缀 `\uFEFF` 匹配失败，
 * 表现为"类别未知 + 误报缺少 H1 标题"。写回路径（`write.ts`）原样保留 BOM，
 * 因此这里只影响解析结果，不改变文件字节。
 */
function splitLines(text: string): RawLine[] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  return body.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line }))
}

/** 提取方括号字段组，并报告方括号外的残留文本。 */
function extractFields(text: string): ExtractedFields {
  const pattern = new RegExp(FIELD_PATTERN_SOURCE, 'g')
  const fields: string[] = []
  let stray = ''
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    stray += text.slice(cursor, match.index)
    fields.push(match[1] ?? '')
    cursor = match.index + match[0].length
  }
  stray += text.slice(cursor)
  const leftover = stray.replace(FILLER_PATTERN, '')
  return { fields, stray: leftover.length > 0 ? leftover : null }
}

function issue(
  code: ParseIssue['code'],
  message: string,
  line: RawLine | null,
  severity: ParseIssue['severity'] = 'error',
): ParseIssue {
  return {
    code,
    message,
    severity,
    line: line === null ? null : line.line,
    raw: line === null ? null : line.text,
  }
}

/** 空字段 → `null`；非空字段 → 去首尾空白后的文本。 */
function optionalField(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** 读取优先级字段；非法值会追加 issue 并使调用方放弃该行。 */
function readPriority(
  value: string | undefined,
  line: RawLine,
  issues: ParseIssue[],
): Priority | null {
  const raw = optionalField(value)
  if (raw === null) return null
  if ((PRIORITIES as readonly string[]).includes(raw)) return raw as Priority
  issues.push(
    issue('priority-invalid', `优先级取值非法：「${raw}」；应为 ${PRIORITIES.join(' / ')}。`, line),
  )
  return null
}

function parseTodoItem(line: RawLine, issues: ParseIssue[]): TodoItem | null {
  const body = ITEM_PATTERN.exec(line.text)
  if (body === null) return null

  const start = issues.length
  const done = (body[1] ?? ' ').toLowerCase() === 'x'
  const { fields, stray } = extractFields(body[2] ?? '')

  if (stray !== null) {
    issues.push(issue('stray-text', `方括号之外出现多余文本：「${stray}」。`, line))
  }

  const title = (fields[0] ?? '').trim()
  if (title.length === 0) {
    issues.push(
      issue('title-empty', fields.length === 0 ? '条目缺少标题字段。' : '标题不能为空。', line),
    )
  }
  if (fields.length > TODO_FIELD_COUNT) {
    issues.push(
      issue('field-count', `字段数超出预期（${fields.length} > ${TODO_FIELD_COUNT}）。`, line),
    )
  }

  const priority = readPriority(fields[1], line, issues)
  const note = optionalField(fields[2])

  if (issues.length > start) return null
  return { kind: 'todo', done, title, priority, note, line: line.line, raw: line.text }
}

function parseScheduleItem(line: RawLine, issues: ParseIssue[]): ScheduleItem | null {
  const body = ITEM_PATTERN.exec(line.text)
  if (body === null) return null

  const start = issues.length
  const done = (body[1] ?? ' ').toLowerCase() === 'x'
  const { fields, stray } = extractFields(body[2] ?? '')

  if (stray !== null) {
    issues.push(issue('stray-text', `方括号之外出现多余文本：「${stray}」。`, line))
  }

  const title = (fields[0] ?? '').trim()
  if (title.length === 0) {
    issues.push(
      issue('title-empty', fields.length === 0 ? '条目缺少标题字段。' : '标题不能为空。', line),
    )
  }
  if (fields.length > SCHEDULE_FIELD_COUNT) {
    issues.push(
      issue('field-count', `字段数超出预期（${fields.length} > ${SCHEDULE_FIELD_COUNT}）。`, line),
    )
  }

  const priority = readPriority(fields[1], line, issues)
  const note = optionalField(fields[2])
  const startDate = (fields[3] ?? '').trim()
  const endDate = optionalField(fields[4])
  const startTime = optionalField(fields[5])
  const endTime = optionalField(fields[6])
  const location = optionalField(fields[7])

  if (!isValidDate(startDate)) {
    issues.push(
      issue(
        'date-invalid',
        startDate.length === 0
          ? '开始日期必填。'
          : `开始日期格式非法：「${startDate}」；应为 YYYY-MM-DD。`,
        line,
      ),
    )
  }
  if (endDate !== null && !isValidDate(endDate)) {
    issues.push(issue('date-invalid', `结束日期格式非法：「${endDate}」；应为 YYYY-MM-DD。`, line))
  }
  if (startTime !== null && !isValidTime(startTime)) {
    issues.push(issue('time-invalid', `开始时间格式非法：「${startTime}」；应为 HH:mm。`, line))
  }
  if (endTime !== null && !isValidTime(endTime)) {
    issues.push(issue('time-invalid', `结束时间格式非法：「${endTime}」；应为 HH:mm。`, line))
  }

  if (issues.length > start) return null

  // 时间区间校验：结束时刻不得早于开始时刻。
  // 日期与时间均为定宽格式，可直接按字符串比较。
  if (endTime !== null) {
    const startMoment = `${startDate}T${startTime ?? '00:00'}`
    const endMoment = `${endDate ?? startDate}T${endTime}`
    if (endMoment < startMoment) {
      issues.push(
        issue(
          'time-range-invalid',
          `结束时刻早于开始时刻（${endMoment.replace('T', ' ')} < ${startMoment.replace('T', ' ')}）。`,
          line,
        ),
      )
      return null
    }
  }

  return {
    kind: 'schedule',
    done,
    title,
    priority,
    note,
    startDate,
    endDate,
    startTime,
    endTime,
    location,
    line: line.line,
    raw: line.text,
  }
}

/** 定位章节内容行：标题行之后、下一个二级标题之前。 */
function sectionContentLines(lines: readonly RawLine[], headingLine: number): RawLine[] {
  const content: RawLine[] = []
  for (const line of lines) {
    if (line.line <= headingLine) continue
    if (H2_PATTERN.test(line.text)) break
    content.push(line)
  }
  return content
}

function parseSection<T>(
  lines: readonly RawLine[],
  title: string,
  parseItem: (line: RawLine, issues: ParseIssue[]) => T | null,
  sectionIssues: ParseIssue[],
): SectionParse<T> {
  const headings: number[] = []
  for (const line of lines) {
    const match = H2_PATTERN.exec(line.text)
    if (match !== null && (match[1] ?? '') === title) headings.push(line.line)
  }

  const first = headings[0]
  if (first === undefined) {
    sectionIssues.push(issue('section-missing', `未找到章节「## ${title}」。`, null))
    return { found: false, headingLine: null, items: [], issues: [] }
  }
  if (headings.length > 1) {
    sectionIssues.push(
      issue('section-duplicated', `章节「## ${title}」出现 ${headings.length} 次，仅解析第一处。`, null),
    )
  }

  const issues: ParseIssue[] = []
  const items: T[] = []
  for (const line of sectionContentLines(lines, first)) {
    if (line.text.trim().length === 0) continue
    const item = parseItem(line, issues)
    if (item !== null) {
      items.push(item)
      continue
    }
    const reported = issues.some((entry) => entry.line === line.line)
    if (!reported && LIST_LIKE_PATTERN.test(line.text)) {
      issues.push(
        issue(
          'checkbox-missing',
          '以 `- ` 开头但缺少复选框标记（应为 `- [ ]` 或 `- [x]`）。',
          line,
          'warning',
        ),
      )
    }
  }

  return { found: true, headingLine: first, items, issues }
}

/** 取文档的第一个 H1 标题；没有则 `null`。 */
function findTitle(lines: readonly RawLine[]): string | null {
  for (const line of lines) {
    const match = H1_PATTERN.exec(line.text)
    if (match !== null) return (match[1] ?? '').trim()
  }
  return null
}

/** 只读取文档的 H1 标题（不解析章节）。 */
export function parseWorkLogTitle(text: string): string | null {
  return findTitle(splitLines(text))
}

/** 解析「1. 工作日志.md」全文。 */
export function parseWorkLog(text: string): WorkLogParseResult {
  const lines = splitLines(text)
  const issues: ParseIssue[] = []

  const title = findTitle(lines)
  const category = title === null ? null : categoryFromTitle(title)
  if (title === null) {
    issues.push(issue('title-missing', '缺少 H1 标题；应为「# 工作日志_<类别>」。', null))
  } else if (category === null) {
    issues.push(
      issue(
        'title-invalid',
        `H1 标题「${title}」无法识别；应为「# 工作日志_<类别>」（诉讼类如「# 工作日志_民事」）。`,
        null,
      ),
    )
  }

  const todo = parseSection(lines, SECTION_TODO, parseTodoItem, issues)
  const schedule = parseSection(lines, SECTION_SCHEDULE, parseScheduleItem, issues)
  return { title, category, todo, schedule, issues }
}
