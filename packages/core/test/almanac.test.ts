import { describe, expect, it } from 'vitest'

import {
  almanacFor,
  almanacLabel,
  almanacLabelKind,
  hasHolidayData,
  holidayMark,
  HOLIDAY_DATA_FIRST_YEAR,
  HOLIDAY_DATA_LAST_YEAR,
  type AlmanacEntry,
} from '../src/index.ts'

/** 断言取到了某一天，失败信息里带上键，省得回头猜是哪条。 */
const get = (key: string): AlmanacEntry => {
  const entry = almanacFor(key)
  expect(entry, `almanacFor(${key}) 不该为空`).not.toBeNull()
  return entry!
}

const label = (key: string): string => almanacLabel(get(key))

describe('almanacFor：日期键校验', () => {
  it('格式不合法的键返回 null，而不是抛错', () => {
    for (const key of ['', '2026-9-11', '20260911', '2026/09/11', 'today', '2026-09-11T00:00:00']) {
      expect(almanacFor(key), key).toBeNull()
    }
  })

  it('月号越界返回 null（上游对 13 月会直接抛错）', () => {
    expect(almanacFor('2026-13-01')).toBeNull()
    expect(almanacFor('2026-00-10')).toBeNull()
  })

  it('"格式合法但日子不存在"返回 null（上游会静默顺延到别的一天）', () => {
    // 实测：lunar-javascript 的 Solar.fromYmd(2026, 2, 30) 不报错，给出的是别的一天。
    expect(almanacFor('2026-02-30')).toBeNull()
    expect(almanacFor('2026-04-31')).toBeNull()
    expect(almanacFor('2025-02-29')).toBeNull()
  })

  it('闰年的 2 月 29 日是合法日期', () => {
    expect(get('2024-02-29').month).toBe(2)
  })

  it('同一键重复查询返回同一个对象（走缓存）', () => {
    expect(almanacFor('2026-09-11')).toBe(almanacFor('2026-09-11'))
  })
})

describe('almanacFor：农历换算', () => {
  it('2026-09-11 是农历八月初一', () => {
    const entry = get('2026-09-11')
    expect(entry.lunarMonth).toBe(8)
    expect(entry.lunarDay).toBe(1)
    expect(entry.isLeapMonth).toBe(false)
    expect(entry.lunarMonthLabel).toBe('八月')
    expect(entry.lunarDayLabel).toBe('初一')
  })

  it('2026-09-12 是农历八月初二', () => {
    const entry = get('2026-09-12')
    expect(entry.lunarDay).toBe(2)
    expect(entry.lunarDayLabel).toBe('初二')
  })

  it('闰月拆成"月号 + 是否闰月"，中文名带「闰」', () => {
    // 2025 年闰六月。
    const entry = get('2025-07-25')
    expect(entry.isLeapMonth).toBe(true)
    expect(entry.lunarMonth).toBe(6)
    // 上游的月名自带闰字（getMonthInChinese() 返回「闰六」），不要再拼一个前缀。
    expect(entry.lunarMonthLabel).toBe('闰六月')
    // 月号是正数，渲染方不必再处理负号。
    expect(entry.lunarMonth).toBeGreaterThan(0)
    // 非闰月的普通月名不带闰字。
    expect(get('2026-09-11').lunarMonthLabel).toBe('八月')
  })

  it('农历日中文名覆盖初十 / 二十 / 三十', () => {
    expect(get('2026-09-20').lunarDayLabel).toBe('初十')
    expect(get('2026-10-10').lunarDayLabel).toBe('初一')
    expect(get('2026-09-30').lunarDayLabel).toBe('二十')
    expect(get('2026-01-18').lunarDayLabel).toBe('三十')
  })
})

describe('almanacLabel：三种信息互斥', () => {
  it('传统节日优先于农历日期', () => {
    const entry = get('2026-09-25')
    expect(entry.lunarDay).toBe(15)
    expect(entry.lunarDayLabel).toBe('十五')
    expect(entry.festival).toBe('中秋节')
    expect(almanacLabel(entry)).toBe('中秋节')
    expect(almanacLabelKind(entry)).toBe('festival')
  })

  it('节气优先于农历日期', () => {
    expect(label('2026-09-07')).toBe('白露')
    expect(almanacLabelKind(get('2026-09-07'))).toBe('solar-term')
    expect(label('2026-09-23')).toBe('秋分')
  })

  it('农历初一显示月份名（而不是「初一」）', () => {
    const entry = get('2026-09-11')
    expect(almanacLabelKind(entry)).toBe('lunar-month')
    expect(almanacLabel(entry)).toBe('八月')
  })

  it('节日压过"初一显示月份"——春节当天显示春节', () => {
    const entry = get('2026-02-17')
    expect(entry.lunarDay).toBe(1)
    expect(almanacLabel(entry)).toBe('春节')
  })

  it('普通日显示农历日期', () => {
    expect(label('2026-09-12')).toBe('初二')
    expect(almanacLabelKind(get('2026-09-12'))).toBe('lunar-day')
  })

  it('三类副标题在任何一天都只出一条', () => {
    // 扫一整年：每一天都必须有且仅有一个标签。
    for (let offset = 0; offset < 366; offset += 1) {
      const date = new Date(2026, 0, 1 + offset)
      if (date.getFullYear() !== 2026) break
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const entry = get(key)
      const text = almanacLabel(entry)
      expect(text, key).toBeTruthy()
      expect(text.length, key).toBeLessThanOrEqual(3)
    }
  })

  it('公历节日（元旦 / 国庆节 / 教师节）不进副标题——只要"中国传统"节日', () => {
    expect(get('2026-10-01').festival).toBeNull()
    expect(label('2026-10-01')).not.toBe('国庆节')
    expect(get('2026-09-10').festival).toBeNull()
    expect(get('2026-01-01').festival).toBeNull()
  })

  it('只有节气与农历传统节日会出现在副标题里', () => {
    const allowed = new Set([
      // 二十四节气
      '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
      '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
      '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
      // 农历传统节日
      '除夕', '春节', '元宵节', '龙头节', '上巳节', '端午节',
      '七夕节', '中元节', '中秋节', '重阳节', '寒衣节', '下元节', '腊八节', '小年',
    ])
    for (let offset = 0; offset < 366; offset += 1) {
      const date = new Date(2026, 0, 1 + offset)
      if (date.getFullYear() !== 2026) break
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const entry = get(key)
      if (entry.festival !== null) expect(allowed, `${key} 的节日「${entry.festival}」不在传统节日清单里`).toContain(entry.festival)
      if (entry.solarTerm !== null) expect(allowed, `${key} 的节气「${entry.solarTerm}」不在二十四节气里`).toContain(entry.solarTerm)
    }
  })

  it('2026 年恰有 24 个节气日', () => {
    let count = 0
    for (let offset = 0; offset < 366; offset += 1) {
      const date = new Date(2026, 0, 1 + offset)
      if (date.getFullYear() !== 2026) break
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      if (get(key).solarTerm !== null) count += 1
    }
    expect(count).toBe(24)
  })
})

describe('holidayMark：法定节假日与调休', () => {
  it('国庆假期 10/01–10/07 逐日都是「休」', () => {
    for (let day = 1; day <= 7; day += 1) {
      const key = `2026-10-${String(day).padStart(2, '0')}`
      const entry = get(key)
      expect(entry.holiday, key).toBe('rest')
      expect(holidayMark(entry), key).toBe('休')
      expect(entry.holidayName, key).toBe('国庆节')
    }
  })

  it('假期结束后不再标「休」', () => {
    const entry = get('2026-10-08')
    expect(entry.holiday).toBeNull()
    expect(holidayMark(entry)).toBeNull()
  })

  it('调休上班日标「班」——不能让人把上班日当休息日', () => {
    const entry = get('2026-09-20')
    expect(entry.holiday).toBe('work')
    expect(holidayMark(entry)).toBe('班')
    // 2026-09-20 是星期日。
    expect(new Date(2026, 8, 20).getDay()).toBe(0)
  })

  it('中秋节的放假安排来自公告，与"八月十五"这个农历事实无关地独立成立', () => {
    // 2026 年中秋当天（八月十五）在公告里是放假日。
    const entry = get('2026-09-25')
    expect(entry.festival).toBe('中秋节')
    expect(entry.holiday).toBe('rest')
    // 两者同时存在：副标题与「休」不互斥。
    expect(almanacLabel(entry)).toBe('中秋节')
    expect(holidayMark(entry)).toBe('休')
  })

  it('「休 / 班」与副标题可以并存于同一天', () => {
    const entry = get('2026-10-01')
    expect(almanacLabel(entry)).toBeTruthy()
    expect(holidayMark(entry)).toBe('休')
    expect(almanacLabelKind(entry)).not.toBe('festival')
  })

  it('超出数据覆盖的年份一律不标「休 / 班」，不猜', () => {
    for (const key of ['2027-10-01', '2027-01-01', '2030-05-01']) {
      const entry = get(key)
      expect(entry.holiday, key).toBeNull()
      expect(holidayMark(entry), key).toBeNull()
    }
    // 但农历与节气照常有——它们是可推算的。
    expect(label('2027-10-01')).toBeTruthy()
  })

  it('覆盖年份区间与实际数据一致（上游扩到 2027 时这条会失败，提醒同步常量）', () => {
    expect(hasHolidayData(HOLIDAY_DATA_FIRST_YEAR)).toBe(true)
    expect(hasHolidayData(HOLIDAY_DATA_LAST_YEAR)).toBe(true)
    expect(hasHolidayData(HOLIDAY_DATA_FIRST_YEAR - 1)).toBe(false)
    expect(hasHolidayData(HOLIDAY_DATA_LAST_YEAR + 1)).toBe(false)

    /** 数某一年里有多少天被标了休 / 班。 */
    const records = (year: number): number => {
      let count = 0
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= 31; day += 1) {
          const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          if (almanacFor(key)?.holiday != null) count += 1
        }
      }
      return count
    }

    // 区间内的**整年**必须都有像样的记录量：某年突然空了，说明常量开得太宽。
    for (let year = HOLIDAY_DATA_FIRST_YEAR + 1; year <= HOLIDAY_DATA_LAST_YEAR; year += 1) {
      expect(records(year), `${year} 年没有任何法定节假日记录`).toBeGreaterThan(20)
    }
    // 区间外必须一条都没有。
    expect(records(HOLIDAY_DATA_LAST_YEAR + 1)).toBe(0)
    expect(records(HOLIDAY_DATA_FIRST_YEAR - 1)).toBe(0)
    // 首年（2001）是**残缺年**：上游只收录了 12-29 / 12-30 两条，不是完整安排。
    // 记在这里免得日后有人以为"2001 年一条元旦记录都没有"是 bug。
    expect(records(HOLIDAY_DATA_FIRST_YEAR)).toBeLessThan(5)
  })
})
