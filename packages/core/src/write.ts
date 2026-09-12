/**
 * 外科手术式写回。
 *
 * 铁律（见 AGENTS.md 第 5.2 节）：**只替换目标行，文件其余部分字节不变**。
 * 因此这里不重新序列化整篇文档，只在行数组上做定点增删改，并保留：
 * BOM、换行符（LF / CRLF）、结尾换行与否。
 *
 * 所有操作都先校验"传入条目是否仍与文件当前行一致"（`raw` 比对），
 * 不一致即拒绝写入（`stale-item`），避免把编辑落到错误的行上。
 */

import { SECTION_SCHEDULE, SECTION_TODO } from './convention.js'
import {
  formatScheduleLine,
  formatTodoLine,
  type FormatCode,
  type FormatResult,
  type ScheduleInput,
  type TodoInput,
} from './format.js'
import type { AgendaItem, ScheduleItem, TodoItem } from './model.js'

const H2_PATTERN = /^##(?!#)\s*(.*?)\s*$/
const ITEM_PATTERN = /^-\s+\[([ xX])\]\s*(.*)$/
const CHECKBOX_PATTERN = /^-\s+\[[ xX]\]/

/** 写回错误码。 */
export type WriteCode = FormatCode | 'section-missing' | 'section-duplicated' | 'stale-item'

export type WriteResult =
  | { readonly ok: true; readonly text: string; readonly line: number }
  | { readonly ok: false; readonly code: WriteCode; readonly message: string }

interface Document {
  readonly hasBom: boolean
  readonly eol: string
  readonly lines: string[]
  readonly trailingNewline: boolean
}

interface SectionRange {
  /** 标题行的 0-based 索引。 */
  readonly headingIndex: number
  /** 内容行区间 `[contentStart, contentEnd)`（0-based）。 */
  readonly contentStart: number
  readonly contentEnd: number
}

type ItemLocation =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly message: string }

function readDocument(text: string): Document {
  const hasBom = text.startsWith('\uFEFF')
  const body = hasBom ? text.slice(1) : text
  const trailingNewline = body.endsWith('\n')
  const lines = body.split(/\r?\n/)
  if (trailingNewline) lines.pop()
  return { hasBom, eol: body.includes('\r\n') ? '\r\n' : '\n', lines, trailingNewline }
}

function writeDocument(doc: Document): string {
  const body = doc.lines.join(doc.eol) + (doc.trailingNewline ? doc.eol : '')
  return doc.hasBom ? `\uFEFF${body}` : body
}

function sectionTitleOf(item: AgendaItem): string {
  return item.kind === 'todo' ? SECTION_TODO : SECTION_SCHEDULE
}

function locateSection(lines: readonly string[], title: string): SectionRange | null | 'duplicated' {
  const headings: number[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = H2_PATTERN.exec(lines[index] ?? '')
    if (match !== null && (match[1] ?? '') === title) headings.push(index)
  }
  const headingIndex = headings[0]
  if (headingIndex === undefined) return null
  if (headings.length > 1) return 'duplicated'

  let contentEnd = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (H2_PATTERN.test(lines[index] ?? '')) {
      contentEnd = index
      break
    }
  }
  return { headingIndex, contentStart: headingIndex + 1, contentEnd }
}

/** 插入点：章节内最后一个条目行之后；没有条目时紧接标题行之后。 */
function insertionIndex(lines: readonly string[], range: SectionRange): number {
  let insert = range.contentStart
  for (let index = range.contentStart; index < range.contentEnd; index += 1) {
    if (ITEM_PATTERN.test(lines[index] ?? '')) insert = index + 1
  }
  return insert
}

/** 定位目标条目行，并校验其内容未被外部修改。 */
function locateItem(lines: readonly string[], range: SectionRange, item: AgendaItem): ItemLocation {
  const index = item.line - 1
  if (index < range.contentStart || index >= range.contentEnd) {
    return { ok: false, message: `条目所在行（第 ${item.line} 行）不在目标章节范围内。` }
  }
  if ((lines[index] ?? '') !== item.raw) {
    return {
      ok: false,
      message: `第 ${item.line} 行内容已被外部修改，与传入条目不一致；请重新读取后再试。`,
    }
  }
  return { ok: true, index }
}

function sectionFailure(
  range: SectionRange | null | 'duplicated',
  title: string,
): WriteResult | null {
  if (range === null) {
    return { ok: false, code: 'section-missing', message: `未找到章节「## ${title}」。` }
  }
  if (range === 'duplicated') {
    return {
      ok: false,
      code: 'section-duplicated',
      message: `章节「## ${title}」出现多次，写入目标不明确；请先修正文件。`,
    }
  }
  return null
}

function addItem(text: string, title: string, formatted: FormatResult): WriteResult {
  if (!formatted.ok) return { ok: false, code: formatted.code, message: formatted.message }
  const doc = readDocument(text)
  const range = locateSection(doc.lines, title)
  const failure = sectionFailure(range, title)
  if (failure !== null) return failure
  if (range === null || range === 'duplicated') return { ok: false, code: 'section-missing', message: '' }

  const index = insertionIndex(doc.lines, range)
  doc.lines.splice(index, 0, formatted.line)
  return { ok: true, text: writeDocument(doc), line: index + 1 }
}

function replaceItem(
  text: string,
  item: AgendaItem,
  formatted: FormatResult,
): WriteResult {
  if (!formatted.ok) return { ok: false, code: formatted.code, message: formatted.message }
  const title = sectionTitleOf(item)
  const doc = readDocument(text)
  const range = locateSection(doc.lines, title)
  const failure = sectionFailure(range, title)
  if (failure !== null) return failure
  if (range === null || range === 'duplicated') return { ok: false, code: 'section-missing', message: '' }

  const location = locateItem(doc.lines, range, item)
  if (!location.ok) return { ok: false, code: 'stale-item', message: location.message }

  doc.lines[location.index] = formatted.line
  return { ok: true, text: writeDocument(doc), line: location.index + 1 }
}

/** 在待办章节追加一条待办。 */
export function addTodoItem(text: string, input: TodoInput): WriteResult {
  return addItem(text, SECTION_TODO, formatTodoLine(input))
}

/** 在日程章节追加一条日程。 */
export function addScheduleItem(text: string, input: ScheduleInput): WriteResult {
  return addItem(text, SECTION_SCHEDULE, formatScheduleLine(input))
}

/** 替换一条待办（按行定位）。 */
export function replaceTodoItem(text: string, item: TodoItem, input: TodoInput): WriteResult {
  return replaceItem(text, item, formatTodoLine(input))
}

/** 替换一条日程（按行定位）。 */
export function replaceScheduleItem(
  text: string,
  item: ScheduleItem,
  input: ScheduleInput,
): WriteResult {
  return replaceItem(text, item, formatScheduleLine(input))
}

/** 删除一条条目。 */
export function removeItem(text: string, item: AgendaItem): WriteResult {
  const title = sectionTitleOf(item)
  const doc = readDocument(text)
  const range = locateSection(doc.lines, title)
  const failure = sectionFailure(range, title)
  if (failure !== null) return failure
  if (range === null || range === 'duplicated') return { ok: false, code: 'section-missing', message: '' }

  const location = locateItem(doc.lines, range, item)
  if (!location.ok) return { ok: false, code: 'stale-item', message: location.message }

  doc.lines.splice(location.index, 1)
  return { ok: true, text: writeDocument(doc), line: location.index + 1 }
}

/** 设置完成状态（只改复选框标记，其余字符不动）。 */
export function setItemDone(text: string, item: AgendaItem, done: boolean): WriteResult {
  const title = sectionTitleOf(item)
  const doc = readDocument(text)
  const range = locateSection(doc.lines, title)
  const failure = sectionFailure(range, title)
  if (failure !== null) return failure
  if (range === null || range === 'duplicated') return { ok: false, code: 'section-missing', message: '' }

  const location = locateItem(doc.lines, range, item)
  if (!location.ok) return { ok: false, code: 'stale-item', message: location.message }

  const line = doc.lines[location.index] ?? ''
  doc.lines[location.index] = line.replace(CHECKBOX_PATTERN, done ? '- [x]' : '- [ ]')
  return { ok: true, text: writeDocument(doc), line: location.index + 1 }
}
