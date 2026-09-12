import { describe, expect, it } from 'vitest'

import {
  addScheduleItem,
  addTodoItem,
  parseWorkLog,
  removeItem,
  replaceScheduleItem,
  replaceTodoItem,
  setItemDone,
  type WriteResult,
} from '../src/index.ts'

const BASE = [
  '# 标题',
  '',
  '## 1. 待办事项',
  '',
  '- [ ] [甲]，[重要且紧急]',
  '- [x] [乙]',
  '',
  '## 2. 日程安排',
  '',
  '- [ ] [开庭]，[]，[]，[2026-09-01]，[]，[09:00]，[11:00]，[第一法庭]',
  '',
  '## 3. 其他',
  '',
  '- 保留我',
  '',
].join('\n')

function unwrap(result: WriteResult): { readonly text: string; readonly line: number } {
  if (!result.ok) throw new Error(`写入失败：${result.code} — ${result.message}`)
  return { text: result.text, line: result.line }
}

/** 返回 1-based 的差异行号。 */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const indexes: number[] = []
  const max = Math.max(a.length, b.length)
  for (let index = 0; index < max; index += 1) {
    if (a[index] !== b[index]) indexes.push(index + 1)
  }
  return indexes
}

const parsed = parseWorkLog(BASE)
const todoItem = parsed.todo.items[0]!
const scheduleItem = parsed.schedule.items[0]!

describe('追加条目', () => {
  it('待办追加到章节内最后一个条目之后', () => {
    const { text, line } = unwrap(addTodoItem(BASE, { title: '丙', priority: '不重要不紧急' }))
    expect(line).toBe(7)
    expect(text.split('\n')[6]).toBe('- [ ] [丙]，[不重要不紧急]')
    expect(parseWorkLog(text).todo.items.map((item) => item.title)).toEqual(['甲', '乙', '丙'])
  })

  it('日程追加到日程章节内最后一个条目之后', () => {
    const { text, line } = unwrap(
      addScheduleItem(BASE, { title: '会面', startDate: '2026-09-03', startTime: '14:00' }),
    )
    expect(line).toBe(11)
    expect(text.split('\n')[10]).toBe('- [ ] [会面]，[]，[]，[2026-09-03]，[]，[14:00]')
    const reparsed = parseWorkLog(text)
    expect(reparsed.schedule.items.map((item) => item.title)).toEqual(['开庭', '会面'])
    expect(reparsed.schedule.issues).toEqual([])
  })

  it('空章节时插入到标题行之后', () => {
    const text = ['## 1. 待办事项', '', '## 2. 日程安排', ''].join('\n')
    const result = unwrap(addTodoItem(text, { title: '甲' }))
    expect(result.line).toBe(2)
    expect(result.text.split('\n')[1]).toBe('- [ ] [甲]')
  })

  it('章节缺失 → section-missing', () => {
    expect(addTodoItem('## 2. 日程安排\n', { title: '甲' })).toMatchObject({
      ok: false,
      code: 'section-missing',
    })
  })

  it('章节重复 → section-duplicated（拒绝写入）', () => {
    const text = ['## 1. 待办事项', '- [ ] [甲]', '## 1. 待办事项', '## 2. 日程安排'].join('\n')
    expect(addTodoItem(text, { title: '乙' })).toMatchObject({
      ok: false,
      code: 'section-duplicated',
    })
  })

  it('输入非法 → 透传格式错误码', () => {
    expect(addTodoItem(BASE, { title: '   ' })).toMatchObject({ ok: false, code: 'title-empty' })
    expect(addTodoItem(BASE, { title: '甲[乙]' })).toMatchObject({
      ok: false,
      code: 'bracket-in-field',
    })
    expect(
      addScheduleItem(BASE, { title: '开庭', startDate: '2026-09-01', startTime: '9:00' }),
    ).toMatchObject({ ok: false, code: 'time-invalid' })
    expect(
      addScheduleItem(BASE, {
        title: '开庭',
        startDate: '2026-09-01',
        startTime: '14:00',
        endTime: '09:00',
      }),
    ).toMatchObject({ ok: false, code: 'time-range-invalid' })
  })
})

describe('定点替换 / 删除 / 切换完成', () => {
  it('待办替换只改动目标行', () => {
    const { text } = unwrap(
      replaceTodoItem(BASE, todoItem, { title: '甲改', priority: '重要不紧急', note: '新备注' }),
    )
    expect(changedLines(BASE, text)).toEqual([5])
    expect(text.split('\n')[4]).toBe('- [ ] [甲改]，[重要不紧急]，[新备注]')
  })

  it('日程替换只改动目标行', () => {
    const { text } = unwrap(
      replaceScheduleItem(BASE, scheduleItem, {
        title: '开庭',
        startDate: '2026-09-01',
        startTime: '09:00',
        endTime: '12:00',
        location: '第一法庭',
      }),
    )
    expect(changedLines(BASE, text)).toEqual([10])
    expect(text.split('\n')[9]).toBe(
      '- [ ] [开庭]，[]，[]，[2026-09-01]，[]，[09:00]，[12:00]，[第一法庭]',
    )
  })

  it('删除只移除目标行', () => {
    const { text } = unwrap(removeItem(BASE, todoItem))
    expect(BASE.split('\n').length - text.split('\n').length).toBe(1)
    expect(parseWorkLog(text).todo.items.map((item) => item.title)).toEqual(['乙'])
  })

  it('删除日程只移除目标行', () => {
    const { text } = unwrap(removeItem(BASE, scheduleItem))
    expect(parseWorkLog(text).schedule.items).toEqual([])
    expect(parseWorkLog(text).todo.items).toHaveLength(2)
  })

  it('切换完成状态只改复选框', () => {
    const { text } = unwrap(setItemDone(BASE, todoItem, true))
    expect(changedLines(BASE, text)).toEqual([5])
    expect(text.split('\n')[4]).toBe('- [x] [甲]，[重要且紧急]')

    const back = unwrap(setItemDone(text, parseWorkLog(text).todo.items[0]!, false))
    expect(back.text.split('\n')[4]).toBe('- [ ] [甲]，[重要且紧急]')
  })

  it('传入条目的原始行与文件不一致 → stale-item（拒绝写入）', () => {
    const stale = { ...todoItem, raw: '- [ ] [已被外部改掉]' }
    expect(removeItem(BASE, stale)).toMatchObject({ ok: false, code: 'stale-item' })
    expect(setItemDone(BASE, stale, true)).toMatchObject({ ok: false, code: 'stale-item' })
    expect(replaceTodoItem(BASE, stale, { title: '甲' })).toMatchObject({
      ok: false,
      code: 'stale-item',
    })
  })

  it('条目行号不在目标章节内 → stale-item', () => {
    expect(removeItem(BASE, { ...todoItem, line: 14 })).toMatchObject({
      ok: false,
      code: 'stale-item',
    })
  })
})

describe('字节保真', () => {
  it('保留 CRLF 换行符', () => {
    const crlf = BASE.replace(/\n/g, '\r\n')
    const { text } = unwrap(addTodoItem(crlf, { title: '丙' }))
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(text.split('\r\n').length).toBe(crlf.split('\r\n').length + 1)
  })

  it('保留 BOM', () => {
    const withBom = `\uFEFF${BASE}`
    const { text } = unwrap(addTodoItem(withBom, { title: '丙' }))
    expect(text.startsWith('\uFEFF')).toBe(true)
  })

  it('保留"无结尾换行"的形态', () => {
    const noTrailing = BASE.replace(/\n$/, '')
    const { text } = unwrap(addTodoItem(noTrailing, { title: '丙' }))
    expect(text.endsWith('\n')).toBe(false)
  })

  it('保留章节之外的任何内容', () => {
    const { text } = unwrap(addTodoItem(BASE, { title: '丙' }))
    expect(text).toContain('# 标题')
    expect(text).toContain('## 3. 其他')
    expect(text).toContain('- 保留我')
  })

  it('写入结果可被解析器无损读回', () => {
    let text = BASE
    text = unwrap(addTodoItem(text, { title: '丙', priority: '紧急不重要', note: '含，逗号' })).text
    text = unwrap(addScheduleItem(text, { title: '会面', startDate: '2026-09-03' })).text
    const reparsed = parseWorkLog(text)
    expect(reparsed.todo.issues).toEqual([])
    expect(reparsed.schedule.issues).toEqual([])
    expect(reparsed.todo.items.map((item) => item.title)).toEqual(['甲', '乙', '丙'])
    expect(reparsed.schedule.items.map((item) => item.title)).toEqual(['开庭', '会面'])
    expect(reparsed.todo.items[2]?.note).toBe('含，逗号')
  })
})
