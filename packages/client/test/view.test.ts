import { describe, expect, it } from 'vitest'

import type { OpenSourceResult, ScheduleRow, TodoRow } from '../src/api.js'
import {
  WEEKDAYS,
  addDays,
  composeDraftOf,
  composeEditBody,
  composeError,
  dateLabel,
  dayHeading,
  dayKey,
  dayLabel,
  defaultComposeProject,
  filterProjects,
  fullDateLabel,
  fitRows,
  issueNotice,
  monthAnchor,
  monthGrid,
  monthLabel,
  monthWeekCount,
  openSourceMessage,
  parseDayKey,
  popoverPosition,
  quadrantBuckets,
  quadrantItems,
  relativeLabel,
  rowCapacity,
  sameSpot,
  scheduleDetail,
  schedulesByDay,
  schedulesInRange,
  schedulesOnDay,
  shiftMonth,
  sortSchedules,
  startOfWeek,
  timeLabel,
  todoDetail,
  todayKey,
  unrankedTodos,
  weekDays,
  weekdayIndex,
  type ComposeDraft,
  type ProjectRef,
} from '../src/view.js'

let seq = 0

function todo(over: Partial<TodoRow> & { readonly title: string }): TodoRow {
  seq += 1
  return { project: '甲案', topLevelDir: '诉讼案件', line: seq, done: false, ...over }
}

function sched(over: Partial<ScheduleRow> & { readonly startDate: string }): ScheduleRow {
  seq += 1
  return {
    project: '甲案',
    topLevelDir: '诉讼案件',
    category: '民事诉讼',
    ongoing: false,
    line: seq,
    done: false,
    title: `日程${seq}`,
    ...over,
  }
}

/**
 * 日程线索的三种形态（日 / 星期 / 月）都在本地按有效时间区间切片，
 * 因此日期运算与区间归属是界面的地基，必须逐条钉死。
 */
describe('日期键运算', () => {
  it('Date ↔ 日期键（本地时区）', () => {
    expect(dayKey(new Date(2026, 8, 11))).toBe('2026-09-11')
    expect(dayKey(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(parseDayKey('2026-09-11').getTime()).toBe(new Date(2026, 8, 11).getTime())
    expect(todayKey(new Date(2026, 8, 11, 23, 59))).toBe('2026-09-11')
  })

  it('星期序号以周一为 0', () => {
    expect(WEEKDAYS).toEqual(['一', '二', '三', '四', '五', '六', '日'])
    expect(weekdayIndex('2026-09-07')).toBe(0) // 周一
    expect(weekdayIndex('2026-09-11')).toBe(4) // 周五
    expect(weekdayIndex('2026-09-13')).toBe(6) // 周日
  })

  it('跨月、跨年偏移按日历运算', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-09-11', 0)).toBe('2026-09-11')
    expect(addDays('2026-09-11', -30)).toBe('2026-08-12')
  })

  it('所在周固定为周一至周日七天', () => {
    expect(startOfWeek('2026-09-11')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
    expect(weekDays('2026-09-11')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ])
  })

  it('月历恒为 42 格、周一起始、标注是否本月', () => {
    const cells = monthGrid('2026-09-01')
    expect(cells).toHaveLength(42)
    expect(cells[0]?.key).toBe('2026-08-31') // 9/1 是周二，故补一天上月
    expect(cells[0]?.inMonth).toBe(false)
    expect(cells[1]?.key).toBe('2026-09-01')
    expect(cells[1]?.inMonth).toBe(true)
    expect(cells[1]?.day).toBe(1)
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(30)
    // 补白到整周即止，不多不少。
    expect(cells[41]?.key).toBe('2026-10-11')
  })

  it('月份锚点与按偏移（跨年进位、保留日号、日号溢出夹到月末）', () => {
    expect(monthAnchor('2026-09-11')).toBe('2026-09-01')
    // 保留日号：顶部中间那一格恒显焦点日，翻一次页就摔到 1 号会让它失去意义。
    expect(shiftMonth('2026-09-11', 1)).toBe('2026-10-11')
    expect(shiftMonth('2026-09-11', -1)).toBe('2026-08-11')
    // 跨年进位。
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-15')
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-15')
    // 目标月天数不够时夹到月末，而不是溢出到下个月（JS Date 的经典陷阱：
    // `new Date(2026, 1, 31)` 会得到 3 月 3 日，"翻到 2 月"就变成了"翻到 3 月"）。
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-28')
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonth('2028-01-31', 1)).toBe('2028-02-29') // 闰年
    expect(shiftMonth('2026-05-31', -1)).toBe('2026-04-30')
    // 跨两个月一次到位时，夹取按**目标月**算，不会先夹一次再漂。
    expect(shiftMonth('2026-03-31', -2)).toBe('2026-01-31')
  })

  it('月历行数按真实周数取 5 或 6（照 6 行铺会把每格压矮六分之一）', () => {
    // 2026-09-01 是周二，31 天 → 1 + 30 = 31 天格，跨 5 周。
    expect(monthWeekCount('2026-09-11')).toBe(5)
    // 2026-08-01 是周六，31 天 → 6 + 31 = 37 天格，跨 6 周。
    expect(monthWeekCount('2026-08-01')).toBe(6)
    // 闰年 2 月：2028-02-01 是周二，29 天 → 1 + 28 = 29 天格，正好 5 周。
    expect(monthWeekCount('2028-02-10')).toBe(5)
    // 平年 2 月且 1 号恰好是周一：2027-02-01 → 0 + 28 = 28 天格，正好 4 周。
    expect(monthWeekCount('2027-02-15')).toBe(4)
    // 行数必须真能装下本月：裁剪后的格子覆盖整月。
    const cells = monthGrid('2026-08-01').slice(0, monthWeekCount('2026-08-01') * 7)
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31)
  })

  it('标题文案', () => {
    expect(monthLabel('2026-09-11')).toBe('2026 年 9 月')
    expect(dayLabel('2026-09-11')).toBe('9-11 周五')
    expect(dayLabel('2026-01-04')).toBe('1-04 周日')
    expect(relativeLabel('2026-09-11', '2026-09-11')).toBe('今天')
    expect(relativeLabel('2026-09-12', '2026-09-11')).toBe('明天')
    expect(relativeLabel('2026-09-10', '2026-09-11')).toBe('昨天')
    expect(relativeLabel('2026-09-30', '2026-09-11')).toBe('')
    expect(dayHeading('2026-09-11', '2026-09-11')).toBe('今天 · 9-11 周五')
    expect(dayHeading('2026-09-30', '2026-09-11')).toBe('9-30 周三')
  })

  it('焦点日期：三种形态共用 YYYY 年 MM 月 DD 日，且月日补零', () => {
    expect(fullDateLabel('2026-09-11')).toBe('2026 年 09 月 11 日')
    // 补零是刻意的：位数固定，翻页时中间那一段不会左右抽动。
    expect(fullDateLabel('2026-01-04')).toBe('2026 年 01 月 04 日')
    expect(fullDateLabel('2026-12-31')).toBe('2026 年 12 月 31 日')
  })
})

/**
 * 「一条日程属于哪天」由有效时间区间决定（数据约定规范 4.4），
 * 而不是"开始日期"——跨日与跨月事项必须在它覆盖的每一天都出现。
 */
describe('日程切片', () => {
  it('日形态：只取与当天有交集的日程', () => {
    const items = [
      sched({ startDate: '2026-09-11', startTime: '09:00', endTime: '11:00', title: '开庭' }),
      sched({ startDate: '2026-09-11', title: '阅卷（全天）' }),
      sched({ startDate: '2026-09-12', title: '会见' }),
    ]
    expect(schedulesOnDay(items, '2026-09-11').map((row) => row.title)).toEqual([
      '阅卷（全天）',
      '开庭',
    ])
  })

  it('全天事项默认占满当日 00:00–次日 00:00', () => {
    const allDay = [sched({ startDate: '2026-09-11', title: '全天' })]
    expect(schedulesOnDay(allDay, '2026-09-11')).toHaveLength(1)
    expect(schedulesOnDay(allDay, '2026-09-12')).toHaveLength(0)
    // 边界：次日 00:00 已不属于当日（半开区间）。
    expect(schedulesInRange(allDay, '2026-09-12', '2026-09-13')).toHaveLength(0)
  })

  it('有开始时间无结束时间 = 持续到当日结束', () => {
    const row = [sched({ startDate: '2026-09-11', startTime: '13:30', title: '下午谈' })]
    expect(schedulesOnDay(row, '2026-09-11')).toHaveLength(1)
    expect(schedulesOnDay(row, '2026-09-12')).toHaveLength(0)
  })

  it('跨日事项在覆盖的每一天都出现', () => {
    const spanning = [
      sched({
        startDate: '2026-09-11',
        endDate: '2026-09-13',
        startTime: '09:00',
        endTime: '17:00',
        title: '三日庭审',
      }),
    ]
    expect(schedulesOnDay(spanning, '2026-09-11')).toHaveLength(1)
    expect(schedulesOnDay(spanning, '2026-09-12')).toHaveLength(1)
    expect(schedulesOnDay(spanning, '2026-09-13')).toHaveLength(1)
    expect(schedulesOnDay(spanning, '2026-09-14')).toHaveLength(0)
  })

  it('跨月事项在月形态的当月各天也出现', () => {
    const spanning = [
      sched({
        startDate: '2026-08-31',
        endDate: '2026-09-02',
        startTime: '08:00',
        endTime: '18:00',
        title: '跨月出差',
      }),
    ]
    const inMonth = schedulesInRange(spanning, '2026-09-01', '2026-10-01')
    expect(inMonth).toHaveLength(1)
    // 按"区间与哪天相交"归属，故 9/1、9/2 都算；8/31 在 9 月清单里不出现。
    expect(schedulesOnDay(spanning, '2026-09-01')).toHaveLength(1)
    expect(schedulesOnDay(spanning, '2026-09-02')).toHaveLength(1)
  })

  it('区间为半开区间 [from, to)', () => {
    const items = [
      sched({ startDate: '2026-09-06', title: '上周日' }),
      sched({ startDate: '2026-09-07', title: '本周一' }),
      sched({ startDate: '2026-09-13', title: '本周日' }),
      sched({ startDate: '2026-09-14', title: '下周一' }),
    ]
    expect(schedulesInRange(items, '2026-09-07', '2026-09-14').map((row) => row.title)).toEqual([
      '本周一',
      '本周日',
    ])
  })

  it('星期形态：七天各自成组，空天保留占位', () => {
    const items = [
      sched({ startDate: '2026-09-07', title: '周一事' }),
      sched({ startDate: '2026-09-11', startTime: '09:00', endTime: '10:00', title: '周五事' }),
    ]
    const groups = schedulesByDay(items, weekDays('2026-09-11'))
    expect(groups).toHaveLength(7)
    expect(groups.map((group) => group.key)).toEqual(weekDays('2026-09-11'))
    expect(groups.map((group) => group.items.length)).toEqual([1, 0, 0, 0, 1, 0, 0])
  })

  it('同一时刻按行号兜底，顺序稳定', () => {
    const items = [
      sched({ startDate: '2026-09-11', startTime: '09:00', endTime: '10:00', line: 9, title: '后写' }),
      sched({ startDate: '2026-09-11', startTime: '09:00', endTime: '10:00', line: 3, title: '先写' }),
    ]
    expect(sortSchedules(items).map((row) => row.title)).toEqual(['先写', '后写'])
  })

  it('全天事项排在有具体时刻的事项之前（开始时刻 00:00）', () => {
    const items = [
      sched({ startDate: '2026-09-11', startTime: '09:00', endTime: '10:00', title: '有时刻' }),
      sched({ startDate: '2026-09-11', title: '全天' }),
    ]
    expect(schedulesOnDay(items, '2026-09-11').map((row) => row.title)).toEqual(['全天', '有时刻'])
  })
})

/**
 * 待办线索的排序是用户明确指定过的规则：
 * **未完成在前**（各自按创建时间倒序），**已完成一律排在所有未完成之后**。
 */
describe('待办四象限', () => {
  it('恒定四个象限，顺序即领域顺序，空象限也占位', () => {
    const buckets = quadrantBuckets([todo({ title: '只有这一条', priority: '紧急不重要' })])
    expect(buckets.map((bucket) => bucket.quadrant)).toEqual([
      '重要且紧急',
      '紧急不重要',
      '重要不紧急',
      '不重要不紧急',
    ])
    expect(buckets.map((bucket) => bucket.total)).toEqual([0, 1, 0, 0])
  })

  it('未完成在前、已完成在后；两组内部都按创建时间（行号）倒序', () => {
    const rows = [
      todo({ title: '旧未完成', priority: '重要且紧急', line: 5 }),
      todo({ title: '新已完成', priority: '重要且紧急', line: 9, done: true }),
      todo({ title: '新未完成', priority: '重要且紧急', line: 8 }),
      todo({ title: '旧已完成', priority: '重要且紧急', line: 6, done: true }),
    ]
    const bucket = quadrantBuckets(rows)[0]
    expect(bucket?.pending.map((row) => row.title)).toEqual(['新未完成', '旧未完成'])
    expect(bucket?.done.map((row) => row.title)).toEqual(['新已完成', '旧已完成'])
    // 已完成绝不排在任何一个未完成之前——即使它的行号更大（更晚创建）。
    expect(quadrantItems(bucket!).map((row) => row.title)).toEqual([
      '新未完成',
      '旧未完成',
      '新已完成',
      '旧已完成',
    ])
  })

  it('行号相同时按项目名兜底，顺序稳定', () => {
    const rows = [
      todo({ title: '乙案的事', project: '乙案', line: 7, priority: '重要且紧急' }),
      todo({ title: '甲案的事', project: '甲案', line: 7, priority: '重要且紧急' }),
    ]
    const bucket = quadrantBuckets(rows)[0]
    expect(bucket?.pending.map((row) => row.title)).toEqual(['甲案的事', '乙案的事'])
  })

  it('未设优先级的待办不进入任何象限，单独统计', () => {
    const rows = [todo({ title: '有优先级', priority: '不重要不紧急' }), todo({ title: '没写优先级' })]
    expect(unrankedTodos(rows).map((row) => row.title)).toEqual(['没写优先级'])
    expect(quadrantBuckets(rows).reduce((sum, bucket) => sum + bucket.total, 0)).toBe(1)
  })
})

/** "每个区域最多只显示最近创建、当前界面能容纳的内容" —— 像素到条数的换算。 */
describe('四象限容量裁剪', () => {
  it('按固定行高把可用高度换算成行数', () => {
    expect(rowCapacity(100, 26)).toBe(3)
    expect(rowCapacity(78, 26)).toBe(3)
    expect(rowCapacity(77, 26)).toBe(2)
    expect(rowCapacity(25, 26)).toBe(0)
  })

  it('高度未知或非法时返回 0，不臆测', () => {
    expect(rowCapacity(0, 26)).toBe(0)
    expect(rowCapacity(Number.NaN, 26)).toBe(0)
    expect(rowCapacity(100, 0)).toBe(0)
    expect(rowCapacity(-10, 26)).toBe(0)
  })

  it('放得下就全显示，放不下取最近的若干条并如实报告剩余', () => {
    const rows = ['a', 'b', 'c', 'd']
    expect(fitRows(rows, 10)).toEqual({ shown: rows, hidden: 0 })
    expect(fitRows(rows, 4)).toEqual({ shown: rows, hidden: 0 })
    expect(fitRows(rows, 2)).toEqual({ shown: ['a', 'b'], hidden: 2 })
    expect(fitRows(rows, 0)).toEqual({ shown: [], hidden: 4 })
    expect(fitRows([], 3)).toEqual({ shown: [], hidden: 0 })
  })
})

describe('文案', () => {
  it('时间标签遵循默认持续时间语义', () => {
    expect(timeLabel({ startTime: undefined, endTime: undefined })).toBe('全天')
    expect(timeLabel({ startTime: '09:00', endTime: '11:00' })).toBe('09:00–11:00')
    expect(timeLabel({ startTime: '09:00', endTime: undefined })).toBe('09:00 起')
  })

  it('日期标签跨日显示区间', () => {
    expect(dateLabel({ startDate: '2026-09-01', endDate: undefined })).toBe('9-01')
    expect(dateLabel({ startDate: '2026-09-01', endDate: '2026-09-01' })).toBe('9-01')
    expect(dateLabel({ startDate: '2026-09-01', endDate: '2026-09-03' })).toBe('9-01 → 9-03')
  })

  /**
   * 格式异常的行不进模型，因而不出现在日程 / 待办线索里。
   * 不说明就等于"条目凭空消失"——对任务清单而言这是最危险的假象。
   */
  it('格式异常必须如实报出条数，没有异常时不出现', () => {
    expect(issueNotice([])).toBe('')
    expect(issueNotice([{ issueCount: 0 }, { issueCount: 0 }])).toBe('')
    const notice = issueNotice([{ issueCount: 2 }, { issueCount: 1 }])
    expect(notice).toContain('3 行')
    expect(notice).toContain('未进入列表')
  })
})

/**
 * 日程明细悬浮窗。
 *
 * 用户的要求是"细化到「日程」这个维度"：点到某一条就把**那一条**的信息弹出来，
 * 而不是跳到那一天的日视图。所以两件事必须钉死——弹出来的是不是那一条（内容），
 * 以及弹在哪儿（不跑出可视区、不盖住首行菜单）。
 */
describe('日程明细：内容', () => {
  it('列全且只列有值的字段', () => {
    const detail = scheduleDetail(
      sched({
        title: '开庭',
        priority: '重要且紧急',
        startDate: '2026-09-11',
        startTime: '09:00',
        endTime: '11:30',
        location: '苏州市中级人民法院',
        note: '带上原件',
      }),
    )
    expect(detail.title).toBe('开庭')
    expect(detail.priority).toBe('重要且紧急')
    expect(detail.done).toBe(false)
    expect(detail.fields).toEqual([
      { label: '日期', value: '9-11' },
      { label: '时间', value: '09:00–11:30' },
      { label: '地点', value: '苏州市中级人民法院' },
      { label: '项目', value: '甲案' },
      { label: '备注', value: '带上原件' },
    ])
  })

  it('空字段不占行：一条"全天、无地点、无备注"的日程只有三行', () => {
    const detail = scheduleDetail(sched({ title: '阅卷', startDate: '2026-09-11' }))
    expect(detail.fields.map((f) => f.label)).toEqual(['日期', '时间', '项目'])
    expect(detail.fields.find((f) => f.label === '时间')?.value).toBe('全天')
  })

  it('跨日事项显示日期区间（"哪一天"由区间决定，不只写开始日）', () => {
    const detail = scheduleDetail(
      sched({ title: '出差', startDate: '2026-09-11', endDate: '2026-09-13' }),
    )
    expect(detail.fields.find((f) => f.label === '日期')?.value).toBe('9-11 → 9-13')
  })

  it('未设优先级时给 null，由调用方决定显示什么（不在这里编一个默认优先级）', () => {
    expect(scheduleDetail(sched({ title: 'x', startDate: '2026-09-11' })).priority).toBeNull()
  })

  it('已完成如实反映', () => {
    expect(scheduleDetail(sched({ title: 'x', startDate: '2026-09-11', done: true })).done).toBe(true)
  })
})

describe('日程明细：落点', () => {
  /** 一块 1000×800 的可视区，左上有 280px 的侧边栏挡着。 */
  const bounds = { left: 280, top: 50, right: 1000, bottom: 800 }
  const size = { width: 260, height: 160 }
  /** 某个起点 + 宽 120、高 22 的小条。 */
  const chip = (left: number, top: number) => ({
    left,
    top,
    right: left + 120,
    bottom: top + 22,
  })

  it('默认贴在条的**下方**、左对齐', () => {
    const spot = popoverPosition(chip(400, 300), size, bounds)
    expect(spot.left).toBe(400)
    expect(spot.top).toBe(300 + 22 + 6)
  })

  it('下方放不下时翻到条的**上方**（不是压住条、也不是溢出）', () => {
    // 条的下缘离底只剩 40px，容不下 160 高的窗。
    const spot = popoverPosition(chip(400, 750), size, bounds)
    expect(spot.top).toBe(750 - 6 - 160)
    expect(spot.top + size.height).toBeLessThanOrEqual(bounds.bottom)
  })

  it('靠右越界时往左夹回来', () => {
    const spot = popoverPosition(chip(960, 300), size, bounds)
    expect(spot.left).toBe(bounds.right - 8 - size.width)
    expect(spot.left + size.width).toBeLessThanOrEqual(bounds.right)
  })

  it('靠左越界时往右夹回来（不会被侧边栏盖住）', () => {
    const spot = popoverPosition(chip(200, 300), size, bounds)
    expect(spot.left).toBe(bounds.left + 8)
  })

  it('窗比可视区还高时也留在可视区内（宁可压住条，也不溢出去被裁掉）', () => {
    const tall = { width: 260, height: 1200 }
    const spot = popoverPosition(chip(400, 300), tall, bounds)
    expect(spot.top).toBe(bounds.top + 8)
  })

  it('任何时候都整个落在 bounds 里（扫一遍边界值）', () => {
    for (let left = bounds.left - 200; left <= bounds.right + 200; left += 37) {
      for (let top = bounds.top - 200; top <= bounds.bottom + 200; top += 53) {
        const spot = popoverPosition(chip(left, top), size, bounds)
        expect(spot.left, `left@${left},${top}`).toBeGreaterThanOrEqual(bounds.left)
        expect(spot.left + size.width, `right@${left},${top}`).toBeLessThanOrEqual(bounds.right)
        expect(spot.top, `top@${left},${top}`).toBeGreaterThanOrEqual(bounds.top)
        expect(spot.top + size.height, `bottom@${left},${top}`).toBeLessThanOrEqual(bounds.bottom)
      }
    }
  })

  /**
   * 死循环防线。
   *
   * 悬浮窗的定位写在**没有依赖数组**的 `useLayoutEffect` 里（内容一变就得重量），
   * 而 `popoverPosition` 每次都返回新对象。少了这一比，就是
   * "渲染 → 测量 → 写状态 → 再渲染"的自激，React 抛 Maximum update depth exceeded，
   * 面板整个消失（实测踩过：点一条日程 → 面板没了，连 `aside` 都不剩）。
   */
  it('同一个落点要判为"没变"，且首次（null）必须判为"变了"', () => {
    expect(sameSpot({ left: 10, top: 20 }, { left: 10, top: 20 })).toBe(true)
    // 亚像素抖动不算变化——浏览器给的小数位会飘。
    expect(sameSpot({ left: 10.2, top: 20.4 }, { left: 10, top: 20 })).toBe(true)
    expect(sameSpot({ left: 11, top: 20 }, { left: 10, top: 20 })).toBe(false)
    expect(sameSpot({ left: 10, top: 21 }, { left: 10, top: 20 })).toBe(false)
    // null（还没量过）必须为 false，否则就永远摆不出来了。
    expect(sameSpot(null, { left: 10, top: 20 })).toBe(false)
  })
})

/**
 * 「点空白 → 新建」。
 *
 * 这条手势的全部规则就是一句话：**点在哪儿，决定了新建什么、预填什么**。所以这里逐个
 * 钉住"点在某个位置"到"窗里预填了什么"的映射，以及草稿到请求体的翻译。
 *
 * 校验那一条尤其重要：`composeError` 用的必须是 `@dslegal/core` 的渲染器（host 落盘前
 * 用的是同一份）。若哪天有人在这里手写一套"够用"的正则，两边就会开始漂——
 * 界面说没问题、写下去被打回来，而这种错位在没有网络延迟的本地环境里最难发现。
 */
describe('新建条目：点在哪儿决定预填什么', () => {
  const 甲案: ProjectRef = { project: '甲案', topLevelDir: '诉讼案件' }
  const 乙案: ProjectRef = { project: '乙案', topLevelDir: '法律顾问' }
  const anchor = { left: 100, top: 200, right: 100, bottom: 200 }

  it('项目记忆优先，但记忆里的项目没了就退回第一个（文件是唯一真相）', () => {
    expect(defaultComposeProject([甲案, 乙案], 乙案)).toEqual(乙案)
    expect(defaultComposeProject([甲案, 乙案], null)).toEqual(甲案)
    // 记忆指向一个已经改名 / 删除的项目：不能抱着它不放，否则新建必然失败。
    expect(
      defaultComposeProject([甲案], { project: '已删除的案件', topLevelDir: '诉讼案件' }),
    ).toEqual(甲案)
    // 同名不同顶级目录也要认准（重名项目靠 topLevelDir 消歧）。
    expect(
      defaultComposeProject([甲案, { project: '甲案', topLevelDir: '法律顾问' }], {
        project: '甲案',
        topLevelDir: '法律顾问',
      }),
    ).toEqual({ project: '甲案', topLevelDir: '法律顾问' })
    expect(defaultComposeProject([], 乙案)).toBeNull()
  })

  it('点象限标题 → 优先级已填好；点日卡表头 → 日期已填好', () => {
    const fromQuadrant = composeDraftOf(
      { kind: 'todo', priority: '重要且紧急', anchor },
      甲案,
      '2026-09-12',
    )
    expect(fromQuadrant).toMatchObject({
      kind: 'todo',
      project: '甲案',
      topLevelDir: '诉讼案件',
      priority: '重要且紧急',
      title: '',
      note: '',
    })
    // 待办没有日期这回事，草稿里不许塞一个"今天"进去（那会让人以为它排在某天）。
    expect(fromQuadrant?.startDate).toBe('')

    const fromCard = composeDraftOf({ kind: 'schedule', startDate: '2026-09-12', anchor }, 甲案, '2026-09-01')
    expect(fromCard).toMatchObject({ kind: 'schedule', startDate: '2026-09-12' })
    expect(fromCard?.endDate).toBe('')
    expect(fromCard?.startTime).toBe('')
  })

  it('没给优先级的空白（卡片空白、泳道空白）就是"未设优先级"，不是"还没选"', () => {
    const draft = composeDraftOf({ kind: 'todo', anchor }, 甲案, '2026-09-12')
    expect(draft?.priority).toBeNull()
  })

  it('日程没给日期时落在今天（项目详情里的「日程安排」区块就是从这儿点的）', () => {
    expect(composeDraftOf({ kind: 'schedule', anchor }, 甲案, '2026-09-12')?.startDate).toBe(
      '2026-09-12',
    )
  })

  it('项目详情里点的：案件锁死，不落到"上次用过的项目"上', () => {
    const draft = composeDraftOf(
      { kind: 'todo', project: '乙案', topLevelDir: '法律顾问', anchor },
      甲案,
      '2026-09-12',
    )
    expect(draft).toMatchObject({ project: '乙案', topLevelDir: '法律顾问' })
  })

  it('一个项目都没有时不给草稿（绝不摆一张注定写不进去的表单）', () => {
    expect(composeDraftOf({ kind: 'todo', anchor }, null, '2026-09-12')).toBeNull()
  })
})

/**
 * 项目选择器的候选筛选。
 *
 * 用户原话："应当允许用户灵活选择当前存在的真实项目，比如下拉备选，又或者输入部分
 * 关键字后列出命中的项目。"案件名很长（通常是「办理中_日期 + 当事人 + 案由」那种写法），
 * 所以关键字筛选是主要入口，这里把它钉死。
 *
 * ⚠ **样例一律用合成案名**（某某公司 / 王五 / 赵六）。这里曾经用过一份真实案件清单，
 * 而这个仓库是公开的——真实案名与当事人姓名不能进测试数据，哪怕只是"看起来像样例"。
 */
describe('新建窗：项目候选的筛选', () => {
  const 案件 = [
    { project: '办理中_20260101 某某公司 诉 某某某 侵害著作权、不正当竞争 案', topLevelDir: '诉讼案件' },
    { project: '王五诉赵六房屋租赁合同纠纷案', topLevelDir: '诉讼案件' },
    { project: '某某公司常年法律顾问', topLevelDir: '法律顾问' },
  ]

  it('关键字为空 = 全部候选（打开列表就该看到所有项目，不是一片空白）', () => {
    expect(filterProjects(案件, '')).toHaveLength(3)
    expect(filterProjects(案件, '   ')).toHaveLength(3)
  })

  it('按**片段**匹配项目名，不必打全称', () => {
    expect(filterProjects(案件, '赵六').map((r) => r.project)).toEqual([
      '王五诉赵六房屋租赁合同纠纷案',
    ])
    expect(filterProjects(案件, '常年法律顾问')).toHaveLength(1)
    // 多个命中时保持原有顺序（候选顺序由调用方给，这里不重排）。
    expect(filterProjects(案件, '某某公司').map((r) => r.project)).toEqual([
      '办理中_20260101 某某公司 诉 某某某 侵害著作权、不正当竞争 案',
      '某某公司常年法律顾问',
    ])
  })

  it('顶级目录名也能筛（用户可能只记得"法律顾问"这一层）', () => {
    expect(filterProjects(案件, '诉讼案件')).toHaveLength(2)
    expect(filterProjects(案件, '法律顾问').map((r) => r.project)).toEqual(['某某公司常年法律顾问'])
  })

  it('前后空白忽略（从别处粘一个名字进来时常带空格）', () => {
    expect(filterProjects(案件, '  赵六  ')).toHaveLength(1)
  })

  it('没命中时给空数组，由界面写「没有匹配的项目」', () => {
    expect(filterProjects(案件, '不存在的案子')).toEqual([])
  })

  it('不改动入参', () => {
    const snapshot = JSON.stringify(案件)
    filterProjects(案件, '赵六')
    expect(JSON.stringify(案件)).toBe(snapshot)
  })
})

describe('新建条目：草稿 → 请求体', () => {
  const base: ComposeDraft = {
    kind: 'todo',
    project: '甲案',
    topLevelDir: '诉讼案件',
    title: '  整理开庭提纲  ',
    priority: null,
    note: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    location: '',
  }

  it('待办走 todo.add，标题去空白，空字段整个省略', () => {
    expect(composeEditBody(base)).toEqual({
      op: 'todo.add',
      project: '甲案',
      topLevelDir: '诉讼案件',
      input: { title: '整理开庭提纲' },
    })
  })

  it('未设优先级时不许送一个空 priority 下去（host 会当成非法取值）', () => {
    expect(composeEditBody({ ...base, priority: null }).input).not.toHaveProperty('priority')
    expect(composeEditBody({ ...base, priority: '重要不紧急' }).input).toMatchObject({
      priority: '重要不紧急',
    })
  })

  it('日程走 schedule.add，带开始日期；空格子里的时间就是"没填"', () => {
    const body = composeEditBody({
      ...base,
      kind: 'schedule',
      startDate: '2026-09-12',
      endDate: '',
      startTime: '09:00',
      endTime: '',
      location: '  苏州市中级人民法院 ',
      note: '带上原件',
    })
    expect(body).toEqual({
      op: 'schedule.add',
      project: '甲案',
      topLevelDir: '诉讼案件',
      input: {
        title: '整理开庭提纲',
        startDate: '2026-09-12',
        startTime: '09:00',
        location: '苏州市中级人民法院',
        note: '带上原件',
      },
    })
  })
})

describe('新建条目：校验与 host 用的是同一份规则', () => {
  const draft = (over: Partial<ComposeDraft>): ComposeDraft => ({
    kind: 'todo',
    project: '甲案',
    topLevelDir: '诉讼案件',
    title: '整理开庭提纲',
    priority: null,
    note: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    location: '',
    ...over,
  })

  it('标题必填（刚开窗时草稿本来就是空的，所以调用方要等点过「创建」再显示）', () => {
    expect(composeError(draft({ title: '   ' }))).toContain('标题不能为空')
    expect(composeError(draft({ title: '整理开庭提纲' }))).toBeNull()
  })

  it('标题里的半角方括号会被挡下——这条琐碎规则只有 core 记得住，所以必须共用', () => {
    const message = composeError(draft({ title: '处理[2026]民初1号' }))
    expect(message).toContain('方括号')
    // 全角是允许的（数据契约就是这么规定的出口）。
    expect(composeError(draft({ title: '处理【2026】民初1号' }))).toBeNull()
  })

  it('日程必须有合法的开始日期', () => {
    expect(
      composeError(draft({ kind: 'schedule', startDate: '' })),
    ).toContain('开始日期')
    expect(
      composeError(draft({ kind: 'schedule', startDate: '2026-9-12' })),
    ).toContain('开始日期')
    expect(composeError(draft({ kind: 'schedule', startDate: '2026-09-12' }))).toBeNull()
  })

  it('结束时刻早于开始时刻会被挡下（跨日不算错：结束日期在那之后）', () => {
    const bad = draft({
      kind: 'schedule',
      startDate: '2026-09-12',
      startTime: '10:00',
      endTime: '09:00',
    })
    expect(composeError(bad)).toContain('早于开始时刻')
    // 跨日不算错：结束日期在开始日期之后时，09:00 完全合法（口径见核心的渲染器）。
    // 注意**必须显式填结束日期**——留空就等于"当天结束"，还是同一天里的倒挂。
    expect(composeError({ ...bad, endDate: '2026-09-13' })).toBeNull()
  })

  it('时间格式不合法时给的是 core 的原话，不是自己编的一句', () => {
    expect(
      composeError(draft({ kind: 'schedule', startDate: '2026-09-12', startTime: '9:00' })),
    ).toContain('HH:mm')
  })
})

/**
 * 「点待办条 → 弹明细窗」要显示什么。
 *
 * 与 `scheduleDetail` 同构是**刻意**的：两种条目共用同一个明细窗组件，字段结构不一致
 * 就会长出两套渲染。待办的字段本来就少（没有日期 / 时间 / 地点），所以只有「项目」与
 * 有值的「备注」；完成状态交给窗底部那个切换按钮，不在这里重复一遍。
 */
describe('todoDetail：待办的明细内容', () => {
  const todo = (over: Partial<TodoRow> = {}): TodoRow => ({
    project: '甲诉乙',
    topLevelDir: '诉讼案件',
    line: 7,
    done: false,
    title: '整理证据',
    ...over,
  })

  it('只列「项目」，没备注就不给空字段', () => {
    const detail = todoDetail(todo())
    expect(detail.fields.map((field) => field.label)).toEqual(['项目'])
    expect(detail.fields[0]!.value).toBe('甲诉乙')
  })

  it('有备注才多一行', () => {
    expect(todoDetail(todo({ note: '先联系承办法官' })).fields).toHaveLength(2)
    // 空串也算"没有"：数据契约里空字段写 `[]`，解析回来可能是空串。
    expect(todoDetail(todo({ note: '' })).fields).toHaveLength(1)
  })

  it('未设优先级给 null（明细窗据此显示"未设优先级"，不拿主色兜底）', () => {
    expect(todoDetail(todo()).priority).toBeNull()
    expect(todoDetail(todo({ priority: '重要且紧急' })).priority).toBe('重要且紧急')
  })

  it('完成状态原样带出（窗里那个按钮要显示对）', () => {
    expect(todoDetail(todo({ done: true })).done).toBe(true)
    expect(todoDetail(todo()).done).toBe(false)
  })

  it('标题原样带出，不做省略——明细窗的任务就是把整条读全', () => {
    const long = '阅卷并整理三份证据材料清单（含银行流水与微信聊天记录）'
    expect(todoDetail(todo({ title: long })).title).toBe(long)
  })
})

/**
 * 「点标题 → 打开原始 markdown」之后要报什么。
 *
 * 这里钉的不是文案好看，而是**三件必须说出口的事**：跳行没跳成、文件被外部改过、
 * 根本没能打开。少说任何一件，用户都会得到一个错误的心智模型（"它跳过去了"）。
 */
describe('openSourceMessage：打开原文的结果怎么说', () => {
  const result = (over: Partial<OpenSourceResult> = {}): OpenSourceResult => ({
    path: 'L:\\数据\\诉讼案件\\甲诉乙\\0. 协作\\1. 工作日志.md',
    project: '甲诉乙',
    topLevelDir: '诉讼案件',
    kind: 'schedule',
    line: 42,
    exact: true,
    launched: true,
    dryRun: false,
    app: 'VS Code',
    lineCapable: true,
    ...over,
  })

  it('能跳行时就说跳到了哪一行', () => {
    const message = openSourceMessage(result())
    expect(message.kind).toBe('info')
    expect(message.text).toContain('VS Code')
    expect(message.text).toContain('第 42 行')
  })

  it('关联程序不支持跳行时**必须明说**，并把行号告诉用户', () => {
    const message = openSourceMessage(result({ app: 'Typora', lineCapable: false }))
    expect(message.kind).toBe('warn')
    expect(message.text).toContain('不支持跳到指定行')
    expect(message.text).toContain('第 42 行')
  })

  it('文件被外部改过（exact=false）要提示行号可能不准', () => {
    expect(openSourceMessage(result({ exact: false })).text).toContain('行号可能不准')
    expect(openSourceMessage(result()).text).not.toContain('行号可能不准')
  })

  it('没打开成 / 演练模式：不许说成"已打开"', () => {
    const failed = openSourceMessage(result({ launched: false }))
    expect(failed.kind).toBe('warn')
    expect(failed.text).toContain('未能打开')

    const dry = openSourceMessage(result({ launched: false, dryRun: true }))
    expect(dry.text).toContain('演练')
  })

  it('横幅里不出现本机绝对路径（那是编辑器标题栏该干的事）', () => {
    for (const over of [{}, { lineCapable: false }, { exact: false }, { launched: false, dryRun: true }]) {
      expect(openSourceMessage(result(over)).text).not.toContain('L:\\')
    }
  })
})

