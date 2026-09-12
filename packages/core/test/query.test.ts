import { describe, expect, it } from 'vitest'

import {
  comparePriority,
  filterDone,
  filterOngoing,
  filterPending,
  filterScheduleByRange,
  groupByDone,
  groupByPriority,
  groupScheduleByDate,
  isOngoing,
  localDateKey,
  scheduleInterval,
  schedulePhase,
  sortSchedule,
  sortTodos,
  summarize,
  type ScheduleItem,
  type TodoItem,
} from '../src/index.ts'

const at = (year: number, month: number, day: number, hour = 0, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute, 0, 0)

let counter = 0

function event(
  overrides: Omit<Partial<ScheduleItem>, 'kind'> & { startDate: string },
): ScheduleItem {
  counter += 1
  return {
    kind: 'schedule',
    done: false,
    title: `日程${counter}`,
    priority: null,
    note: null,
    endDate: null,
    startTime: null,
    endTime: null,
    location: null,
    line: counter,
    raw: '',
    ...overrides,
  }
}

function todo(overrides: Omit<Partial<TodoItem>, 'kind'> & { title: string }): TodoItem {
  counter += 1
  return {
    kind: 'todo',
    done: false,
    priority: null,
    note: null,
    line: counter,
    raw: '',
    ...overrides,
  }
}

/**
 * 区间语义必须能直接吃 host JSON 化后的行（省略 null 字段、无 kind / raw），
 * 否则 client 只能自己再实现一套时间计算，host 与 client 迟早算出两个答案。
 */
describe('ScheduleTiming 结构契约', () => {
  it('接受只有时间字段的普通对象', () => {
    const json = { startDate: '2026-09-01', startTime: '09:00', endTime: '11:00' }
    const interval = scheduleInterval(json)
    expect(interval.allDay).toBe(false)
    expect(interval.start.getTime()).toBe(at(2026, 9, 1, 9, 0).getTime())
    expect(interval.end.getTime()).toBe(at(2026, 9, 1, 11, 0).getTime())
  })

  it('缺省 endDate / startTime / endTime 时按契约推导', () => {
    // 只有开始日期 = 全天事项，区间为当日 00:00 至次日 00:00。
    const allDay = scheduleInterval({ startDate: '2026-09-01' })
    expect(allDay.allDay).toBe(true)
    expect(allDay.start.getTime()).toBe(at(2026, 9, 1).getTime())
    expect(allDay.end.getTime()).toBe(at(2026, 9, 2).getTime())

    // 有开始时间无结束时间 = 持续到当日结束。
    const openEnded = scheduleInterval({ startDate: '2026-09-01', startTime: '13:30' })
    expect(openEnded.start.getTime()).toBe(at(2026, 9, 1, 13, 30).getTime())
    expect(openEnded.end.getTime()).toBe(at(2026, 9, 2).getTime())
  })

  it('跨日区间同时被两端日期命中（"属于哪天"就是区间与哪天相交）', () => {
    const spanning = { startDate: '2026-09-01', endDate: '2026-09-03', endTime: '17:00' }
    expect(isOngoing(spanning, at(2026, 9, 2, 10, 0))).toBe(true)
    expect(isOngoing(spanning, at(2026, 9, 4, 10, 0))).toBe(false)
    expect(schedulePhase(spanning, at(2026, 9, 3, 17, 0))).toBe('已结束')
  })
})

describe('有效时间区间', () => {
  it('全天事项：当日 00:00 – 次日 00:00', () => {
    const interval = scheduleInterval(event({ startDate: '2026-09-01' }))
    expect(interval.allDay).toBe(true)
    expect(interval.start.getTime()).toBe(at(2026, 9, 1).getTime())
    expect(interval.end.getTime()).toBe(at(2026, 9, 2).getTime())
  })

  it('有开始时间、无结束时间：到当日结束', () => {
    const interval = scheduleInterval(event({ startDate: '2026-09-01', startTime: '14:00' }))
    expect(interval.allDay).toBe(false)
    expect(interval.start.getTime()).toBe(at(2026, 9, 1, 14).getTime())
    expect(interval.end.getTime()).toBe(at(2026, 9, 2).getTime())
  })

  it('有起止时间：到结束时刻', () => {
    const interval = scheduleInterval(
      event({ startDate: '2026-09-01', startTime: '09:00', endTime: '11:00' }),
    )
    expect(interval.start.getTime()).toBe(at(2026, 9, 1, 9).getTime())
    expect(interval.end.getTime()).toBe(at(2026, 9, 1, 11).getTime())
  })

  it('跨日事项：到结束日期的结束时刻', () => {
    const interval = scheduleInterval(
      event({
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        startTime: '09:00',
        endTime: '17:00',
      }),
    )
    expect(interval.start.getTime()).toBe(at(2026, 9, 1, 9).getTime())
    expect(interval.end.getTime()).toBe(at(2026, 9, 3, 17).getTime())
  })

  it('跨日且只有结束日期时，默认到结束日期的当日结束', () => {
    const interval = scheduleInterval(event({ startDate: '2026-09-01', endDate: '2026-09-02' }))
    expect(interval.end.getTime()).toBe(at(2026, 9, 3).getTime())
  })

  it('月末跨日正确进位', () => {
    const interval = scheduleInterval(event({ startDate: '2026-01-31', startTime: '10:00' }))
    expect(interval.end.getTime()).toBe(at(2026, 2, 1).getTime())
  })
})

describe('进行中与阶段', () => {
  const item = event({ startDate: '2026-09-01', startTime: '09:00', endTime: '11:00' })

  it('半开区间 [start, end)', () => {
    expect(isOngoing(item, at(2026, 9, 1, 8, 59))).toBe(false)
    expect(isOngoing(item, at(2026, 9, 1, 9, 0))).toBe(true)
    expect(isOngoing(item, at(2026, 9, 1, 10, 30))).toBe(true)
    expect(isOngoing(item, at(2026, 9, 1, 11, 0))).toBe(false)
  })

  it('全天事项当日全天进行中', () => {
    const allDay = event({ startDate: '2026-09-01' })
    expect(isOngoing(allDay, at(2026, 9, 1, 0, 0))).toBe(true)
    expect(isOngoing(allDay, at(2026, 9, 1, 23, 59))).toBe(true)
    expect(isOngoing(allDay, at(2026, 9, 2, 0, 0))).toBe(false)
  })

  it('阶段：未开始 / 进行中 / 已结束', () => {
    expect(schedulePhase(item, at(2026, 9, 1, 8))).toBe('未开始')
    expect(schedulePhase(item, at(2026, 9, 1, 10))).toBe('进行中')
    expect(schedulePhase(item, at(2026, 9, 1, 12))).toBe('已结束')
  })
})

describe('分组', () => {
  it('按开始日期分组', () => {
    const items = [
      event({ startDate: '2026-09-01' }),
      event({ startDate: '2026-09-01' }),
      event({ startDate: '2026-09-02' }),
    ]
    const groups = groupScheduleByDate(items)
    expect([...groups.keys()]).toEqual(['2026-09-01', '2026-09-02'])
    expect(groups.get('2026-09-01')).toHaveLength(2)
    expect(groups.get('2026-09-02')).toHaveLength(1)
  })

  it('按优先级分组（跳过无优先级）', () => {
    const items = [
      todo({ title: 'A', priority: '重要且紧急' }),
      todo({ title: 'B' }),
      todo({ title: 'C', priority: '不重要不紧急' }),
    ]
    const groups = groupByPriority(items)
    expect([...groups.keys()]).toEqual(['重要且紧急', '不重要不紧急'])
    expect(groups.get('重要且紧急')?.map((item) => item.title)).toEqual(['A'])
  })

  it('按完成状态拆分', () => {
    const items = [todo({ title: 'A' }), todo({ title: 'B', done: true })]
    const groups = groupByDone(items)
    expect(groups.pending.map((item) => item.title)).toEqual(['A'])
    expect(groups.done.map((item) => item.title)).toEqual(['B'])
    expect(filterPending(items).map((item) => item.title)).toEqual(['A'])
    expect(filterDone(items).map((item) => item.title)).toEqual(['B'])
  })

  it('localDateKey 使用本地日期', () => {
    expect(localDateKey(at(2026, 9, 1, 23, 59))).toBe('2026-09-01')
    expect(localDateKey(at(2026, 12, 31, 0, 0))).toBe('2026-12-31')
  })
})

describe('排序', () => {
  it('待办：未完成在前 → 优先级 → 原文顺序', () => {
    const items = [
      todo({ title: '无优先级', line: 1 }),
      todo({ title: '不重要不紧急', priority: '不重要不紧急', line: 2 }),
      todo({ title: '重要且紧急', priority: '重要且紧急', line: 3 }),
      todo({ title: '已完成但最高优先级', priority: '重要且紧急', done: true, line: 4 }),
      todo({ title: '重要不紧急', priority: '重要不紧急', line: 5 }),
    ]
    expect(sortTodos(items).map((item) => item.title)).toEqual([
      '重要且紧急',
      '重要不紧急',
      '不重要不紧急',
      '无优先级',
      '已完成但最高优先级',
    ])
  })

  it('日程：开始时刻升序', () => {
    const items = [
      event({ title: '晚', startDate: '2026-09-02', startTime: '09:00', line: 1 }),
      event({ title: '早', startDate: '2026-09-01', startTime: '14:00', line: 2 }),
      event({ title: '更早', startDate: '2026-09-01', startTime: '09:00', line: 3 }),
    ]
    expect(sortSchedule(items).map((item) => item.title)).toEqual(['更早', '早', '晚'])
  })

  it('优先级比较：四象限顺序，null 最后', () => {
    expect(comparePriority('重要且紧急', '不重要不紧急')).toBeLessThan(0)
    expect(comparePriority(null, '不重要不紧急')).toBeGreaterThan(0)
    expect(comparePriority(null, null)).toBe(0)
  })
})

describe('筛选与汇总', () => {
  const items = [
    event({ title: '跨日', startDate: '2026-09-01', endDate: '2026-09-03', line: 1 }),
    event({ title: '当日', startDate: '2026-09-02', startTime: '10:00', line: 2 }),
    event({ title: '更晚', startDate: '2026-09-10', line: 3 }),
  ]

  it('按时间范围筛选（相交即命中）', () => {
    const hits = filterScheduleByRange(items, at(2026, 9, 2), at(2026, 9, 3))
    expect(hits.map((item) => item.title)).toEqual(['跨日', '当日'])
  })

  it('筛选进行中', () => {
    const hits = filterOngoing(items, at(2026, 9, 2, 12))
    expect(hits.map((item) => item.title)).toEqual(['跨日', '当日'])
  })

  it('汇总统计', () => {
    const todos = [
      todo({ title: 'A' }),
      todo({ title: 'B' }),
      todo({ title: 'C', done: true }),
    ]
    const summary = summarize(todos, items, at(2026, 9, 2, 12))
    expect(summary).toEqual({
      todoTotal: 3,
      todoPending: 2,
      todoDone: 1,
      scheduleTotal: 3,
      schedulePending: 3,
      scheduleDone: 0,
      ongoing: 2,
    })
  })
})
