import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PRIORITIES, PRIORITY_COLORS, parseWorkLog, parseWorkLogTitle, type ParseIssue } from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, 'fixtures', '1. 工作日志.md'), 'utf8')

function codes(issues: readonly ParseIssue[]): string[] {
  return issues.map((entry) => entry.code)
}

const TITLE = '# 工作日志_民事\n'

function parseTodo(body: string) {
  return parseWorkLog(`${TITLE}## 1. 待办事项\n${body}`).todo
}

function parseSchedule(body: string) {
  return parseWorkLog(`${TITLE}## 2. 日程安排\n${body}`).schedule
}

describe('parseWorkLog：fixture 正常路径', () => {
  const result = parseWorkLog(fixture)

  it('定位到两个章节且无章节级问题', () => {
    expect(result.todo.found).toBe(true)
    expect(result.schedule.found).toBe(true)
    expect(result.todo.headingLine).toBe(5)
    expect(result.schedule.headingLine).toBe(12)
    expect(result.issues).toEqual([])
  })

  it('待办条目全部解析、无问题', () => {
    expect(result.todo.issues).toEqual([])
    expect(result.todo.items).toHaveLength(4)
    const [first, second, third, fourth] = result.todo.items
    expect(first).toMatchObject({
      kind: 'todo',
      done: false,
      title: '起草民事起诉状',
      priority: '重要且紧急',
      note: '需当事人提供证据清单，含身份证复印件',
    })
    expect(second).toMatchObject({ title: '整理证据材料', priority: '重要不紧急', note: null })
    expect(third).toMatchObject({ title: '联系承办法官查询案件进展', priority: null, note: null })
    expect(fourth).toMatchObject({ done: true, title: '与当事人确认诉讼请求' })
  })

  it('备注中的全角逗号不影响字段解析', () => {
    expect(result.todo.items[0]?.note).toBe('需当事人提供证据清单，含身份证复印件')
  })

  it('日程条目全部解析、无问题', () => {
    expect(result.schedule.issues).toEqual([])
    expect(result.schedule.items).toHaveLength(5)
  })

  it('日程字段与空字段占位解析正确', () => {
    const [hearing, meeting, allDay, trip, pretrial] = result.schedule.items
    expect(hearing).toMatchObject({
      kind: 'schedule',
      title: '开庭',
      priority: '重要且紧急',
      note: '一审第一次开庭，需携带证据原件',
      startDate: '2026-09-01',
      endDate: null,
      startTime: '09:00',
      endTime: '11:00',
      location: '第一法庭',
    })
    expect(meeting).toMatchObject({
      title: '与当事人会面',
      note: null,
      startDate: '2026-09-03',
      startTime: '14:00',
      endTime: null,
      location: null,
    })
    expect(allDay).toMatchObject({
      title: '全天整理卷宗',
      startDate: '2026-09-04',
      startTime: null,
      endTime: null,
    })
    expect(trip).toMatchObject({
      title: '外地出差办案',
      startDate: '2026-09-08',
      endDate: '2026-09-10',
      startTime: '09:00',
      endTime: '17:00',
      location: '中院',
    })
    expect(pretrial).toMatchObject({ done: true, title: '参加庭前会议' })
  })

  it('保留原始行号与原始行文本（供外科手术式写回）', () => {
    expect(result.todo.items[0]?.line).toBe(7)
    expect(result.todo.items[0]?.raw).toContain('[起草民事起诉状]')
    expect(result.schedule.items[0]?.line).toBe(14)
  })

  it('不解析两个章节之外的内容', () => {
    const titles = [...result.todo.items, ...result.schedule.items].map((item) => item.title)
    expect(titles).not.toContain('本章节的条目不应被解析')
  })
})

describe('章节定位', () => {
  it('章节缺失 → section-missing', () => {
    const result = parseWorkLog(`${TITLE}## 1. 待办事项\n`)
    expect(result.schedule.found).toBe(false)
    expect(codes(result.issues)).toEqual(['section-missing'])
  })

  it('章节重复 → section-duplicated，且仅解析第一处', () => {
    const text = [
      '# 工作日志_民事',
      '## 1. 待办事项',
      '- [ ] [甲]',
      '## 1. 待办事项',
      '- [ ] [乙]',
      '## 2. 日程安排',
    ].join('\n')
    const result = parseWorkLog(text)
    expect(codes(result.issues)).toEqual(['section-duplicated'])
    expect(result.todo.items.map((item) => item.title)).toEqual(['甲'])
  })

  it('三级标题不作为章节边界', () => {
    const text = [`${TITLE}## 1. 待办事项`, '- [ ] [甲]', '### 子标题', '- [ ] [乙]'].join('\n')
    const result = parseWorkLog(text)
    expect(result.todo.items.map((item) => item.title)).toEqual(['甲', '乙'])
  })
})

describe('H1 标题与服务类别', () => {
  it('从标准标题解析类别', () => {
    const result = parseWorkLog(`${TITLE}## 1. 待办事项\n## 2. 日程安排\n`)
    expect(result.title).toBe('工作日志_民事')
    expect(result.category).toBe('民事诉讼')
    expect(result.issues).toEqual([])
  })

  it('各类别的标准标题', () => {
    for (const [category, suffix] of [
      ['刑事诉讼', '刑事'],
      ['行政诉讼', '行政'],
      ['法律顾问', '法律顾问'],
      ['专利代理', '专利代理'],
    ] as const) {
      const result = parseWorkLog(`# 工作日志_${suffix}\n## 1. 待办事项\n## 2. 日程安排\n`)
      expect(result.category).toBe(category)
      expect(result.issues).toEqual([])
    }
  })

  it('缺少 H1 → title-missing', () => {
    const result = parseWorkLog('## 1. 待办事项\n## 2. 日程安排\n')
    expect(result.title).toBeNull()
    expect(result.category).toBeNull()
    expect(codes(result.issues)).toEqual(['title-missing'])
  })

  it('标题无法识别 → title-invalid，且类别为 null', () => {
    const result = parseWorkLog('# 张三诉李四\n## 1. 待办事项\n## 2. 日程安排\n')
    expect(result.title).toBe('张三诉李四')
    expect(result.category).toBeNull()
    expect(codes(result.issues)).toEqual(['title-invalid'])
  })

  it('parseWorkLogTitle 只取标题', () => {
    expect(parseWorkLogTitle(`${TITLE}## 1. 待办事项\n`)).toBe('工作日志_民事')
    expect(parseWorkLogTitle('没有标题\n')).toBeNull()
  })

  it('带 UTF-8 BOM 时仍能识别标题、类别与章节', () => {
    const result = parseWorkLog(`\uFEFF${TITLE}## 1. 待办事项\n- [ ] [甲]\n## 2. 日程安排\n`)
    expect(result.title).toBe('工作日志_民事')
    expect(result.category).toBe('民事诉讼')
    expect(result.issues).toEqual([])
    expect(result.todo.items.map((item) => item.title)).toEqual(['甲'])
    expect(result.schedule.found).toBe(true)
  })

  it('BOM 不影响"首行即章节"的文档', () => {
    const result = parseWorkLog('\uFEFF## 1. 待办事项\n- [ ] [甲]\n## 2. 日程安排\n')
    expect(result.todo.found).toBe(true)
    expect(result.todo.items.map((item) => item.title)).toEqual(['甲'])
  })
})

describe('待办条目校验', () => {
  it('字段数超出 → field-count，且该行不作为条目', () => {
    const section = parseTodo('- [ ] [甲]，[重要且紧急]，[备注]，[多余]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['field-count'])
  })

  it('标题为空 → title-empty', () => {
    const section = parseTodo('- [ ] []，[重要且紧急]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['title-empty'])
  })

  it('缺少任何字段 → title-empty', () => {
    const section = parseTodo('- [ ]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['title-empty'])
  })

  it('优先级非法 → priority-invalid', () => {
    const section = parseTodo('- [ ] [甲]，[紧急]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['priority-invalid'])
  })

  it('方括号之外出现多余文本 → stray-text', () => {
    const section = parseTodo('- [ ] [甲] 多余文本')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['stray-text'])
  })

  it('缺少复选框 → checkbox-missing（warning）', () => {
    const section = parseTodo('- 甲')
    expect(section.items).toEqual([])
    expect(section.issues).toHaveLength(1)
    expect(section.issues[0]).toMatchObject({
      code: 'checkbox-missing',
      severity: 'warning',
      line: 3,
    })
  })

  it('分隔符可用全角逗号、半角逗号或空白', () => {
    expect(parseTodo('- [ ] [甲]，[重要且紧急]，[备注]').items).toHaveLength(1)
    expect(parseTodo('- [ ] [甲],[重要且紧急] [备注]').items).toHaveLength(1)
    expect(parseTodo('- [ ] [甲]').items).toHaveLength(1)
  })

  it('复选框支持大写 X', () => {
    const section = parseTodo('- [X] [甲]')
    expect(section.items[0]?.done).toBe(true)
  })
})

describe('日程条目校验', () => {
  it('开始日期必填 → date-invalid', () => {
    const section = parseSchedule('- [ ] [开庭]，[重要且紧急]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['date-invalid'])
  })

  it('日期格式非法 → date-invalid', () => {
    const section = parseSchedule('- [ ] [开庭]，[]，[]，[2026-9-1]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['date-invalid'])
  })

  it('日期不存在（2026-02-30）→ date-invalid', () => {
    const section = parseSchedule('- [ ] [开庭]，[]，[]，[2026-02-30]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['date-invalid'])
  })

  it('时间格式非法 → time-invalid', () => {
    const section = parseSchedule('- [ ] [开庭]，[]，[]，[2026-09-01]，[]，[9:00]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['time-invalid'])
  })

  it('同日结束时间早于开始时间 → time-range-invalid', () => {
    const section = parseSchedule('- [ ] [开庭]，[]，[]，[2026-09-01]，[]，[14:00]，[09:00]')
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['time-range-invalid'])
  })

  it('跨日的“结束时间早于开始时间”合法（隔夜事项）', () => {
    const section = parseSchedule(
      '- [ ] [开庭]，[]，[]，[2026-09-01]，[2026-09-02]，[22:00]，[06:00]',
    )
    expect(section.issues).toEqual([])
    expect(section.items).toHaveLength(1)
    expect(section.items[0]).toMatchObject({ endDate: '2026-09-02', endTime: '06:00' })
  })

  it('结束日期早于开始日期 → time-range-invalid', () => {
    const section = parseSchedule(
      '- [ ] [开庭]，[]，[]，[2026-09-05]，[2026-09-01]，[09:00]，[11:00]',
    )
    expect(section.items).toEqual([])
    expect(codes(section.issues)).toEqual(['time-range-invalid'])
  })

  it('无开始时间时按 00:00 参与区间比较', () => {
    const section = parseSchedule('- [ ] [开庭]，[]，[]，[2026-09-01]，[]，[]，[11:00]')
    expect(section.issues).toEqual([])
    expect(section.items).toHaveLength(1)
  })
})

describe('模型常量', () => {
  it('优先级与默认颜色一一对应', () => {
    expect(Object.keys(PRIORITY_COLORS)).toEqual([...PRIORITIES])
    expect(PRIORITY_COLORS['重要且紧急']).toBe('#E53E3E')
    expect(PRIORITY_COLORS['紧急不重要']).toBe('#ED8936')
    expect(PRIORITY_COLORS['重要不紧急']).toBe('#f3e417')
    expect(PRIORITY_COLORS['不重要不紧急']).toBe('#98c51e')
  })
})
