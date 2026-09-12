/**
 * 农历 / 节气 / 中国传统节日 / 法定节假日。
 *
 * 数据来自 `lunar-javascript`（MIT）：农历换算、二十四节气、农历传统节日都是**可推算**的，
 * 而**法定节假日（含调休）不可推算**——它是国务院逐年公布的安排，上游只收录到
 * {@link HOLIDAY_DATA_LAST_YEAR}。超出这个范围的年份**一律不给「休 / 班」标记**，
 * 而不是按"周末即休息"猜一个：猜错会让律师把调休上班日当成休息日。
 */

import { HolidayUtil, Solar } from 'lunar-javascript'

/**
 * 格子右上角那一格要显示的副标题——三种信息**互斥**，按此优先级择一：
 * 传统节日 → 节气 → 农历初一显示月份名 → 其余显示农历日期。
 *
 * `festival` / `solarTerm` 同时命中的情况实测不存在（清明、冬至、立春都只算节气），
 * 这里仍然按序取，是为了让规则本身自洽，而不是依赖上游数据的巧合。
 */
export type AlmanacLabelKind = 'festival' | 'solar-term' | 'lunar-month' | 'lunar-day'

/** 法定节假日状态：放假 / 调休上班。 */
export type HolidayKind = 'rest' | 'work'

/** 某一天的农历、节气节日与法定节假日信息。 */
export interface AlmanacEntry {
  /** 公历日期，`YYYY-MM-DD`（即查询键）。 */
  readonly key: string
  readonly year: number
  /** 公历月，1–12。 */
  readonly month: number
  /** 公历日，1–31。 */
  readonly day: number
  /** 农历月，1–12（**不含闰月符号**，闰月由 {@link isLeapMonth} 表示）。 */
  readonly lunarMonth: number
  /** 农历日，1–30（1 = 初一）。 */
  readonly lunarDay: number
  /** 是否为闰月。 */
  readonly isLeapMonth: boolean
  /** 农历月的中文名，如「八月」「闰六月」（闰字由上游给出）。 */
  readonly lunarMonthLabel: string
  /** 农历日的中文名，如「初一」「廿三」。 */
  readonly lunarDayLabel: string
  /** **农历**传统节日（春节 / 中秋节 …）；没有则为 `null`。 */
  readonly festival: string | null
  /** 二十四节气（白露 / 秋分 …）；不是节气日则为 `null`。 */
  readonly solarTerm: string | null
  /** 法定节假日名称（国庆节 …）；无数据或普通日为 `null`。 */
  readonly holidayName: string | null
  /** 放假 / 调休上班；普通日、以及超出数据覆盖的年份为 `null`。 */
  readonly holiday: HolidayKind | null
}

/**
 * 法定节假日数据覆盖的**首个**年份。
 *
 * 上游 `HolidayUtil` 收录 2001 年起，之前的年份没有记录。
 */
export const HOLIDAY_DATA_FIRST_YEAR = 2001

/**
 * 法定节假日数据覆盖的**最后**年份（上游 `lunar-javascript@1.7.7` 实测：2027 起为空）。
 *
 * 这是**数据缺口不是逻辑缺口**：国务院每年 10 月前后公布下一年安排，上游随版本跟进。
 * 升级依赖后这个常量要跟着改——`packages/core/test/almanac.test.ts` 有一条用例
 * 会在上游数据超出该常量时失败，提醒维护者同步。
 */
export const HOLIDAY_DATA_LAST_YEAR = 2026

/** 该年份是否在法定节假日数据覆盖范围内。 */
export function hasHolidayData(year: number): boolean {
  return year >= HOLIDAY_DATA_FIRST_YEAR && year <= HOLIDAY_DATA_LAST_YEAR
}

/** 日期键：严格 `YYYY-MM-DD`。 */
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 解析缓存。
 *
 * 月视图一次要算 35–42 天，而每次 hover / 光标移动都会整块重渲染——React 重渲染
 * 不会带上"这一天算过了"的记忆。缓存键是日期字符串，容量上限就是用户翻过的天数，
 * 不设淘汰也不会涨到哪去。
 */
const cache = new Map<string, AlmanacEntry | null>()

/**
 * 取某一天的农历信息。
 *
 * @param key - 公历日期，`YYYY-MM-DD`。
 * @returns 该日的信息；键不是合法日期时返回 `null`（**不抛错**，调用方只需判空）。
 */
export function almanacFor(key: string): AlmanacEntry | null {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const entry = compute(key)
  cache.set(key, entry)
  return entry
}

/** 算一天，并**自行校验日期**——上游对 `2026-02-30` 会静默顺延成别的一天。 */
function compute(key: string): AlmanacEntry | null {
  const matched = DATE_KEY_PATTERN.exec(key)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // 用本地时间做一次往返校验，挡掉 2 月 30 日这类"格式合法但日子不存在"的键。
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null
  }

  const solar = Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  // 闰月的月号在上游是负数（-6 = 闰六月），这里拆成"月号 + 是否闰月"两个字段。
  const rawMonth = lunar.getMonth()
  const isLeapMonth = rawMonth < 0
  const festivals = lunar.getFestivals()
  const solarTerm = lunar.getJieQi()
  // 超出数据覆盖的年份连问都不问：上游对没收录的年份同样返回 null，
  // 但显式判一下年份，语义上"我们不声称知道"比"上游说没有"更准确。
  const holiday = hasHolidayData(year) ? HolidayUtil.getHoliday(year, month, day) : null

  return {
    key,
    year,
    month,
    day,
    lunarMonth: Math.abs(rawMonth),
    lunarDay: lunar.getDay(),
    isLeapMonth,
    // 上游的月名**自带闰字**（闰六月时返回「闰六」），不要再自己拼一个前缀。
    lunarMonthLabel: `${lunar.getMonthInChinese()}月`,
    lunarDayLabel: lunar.getDayInChinese(),
    festival: festivals.length > 0 ? festivals[0]! : null,
    solarTerm: solarTerm.length > 0 ? solarTerm : null,
    holidayName: holiday ? holiday.getName() : null,
    holiday: holiday ? (holiday.isWork() ? 'work' : 'rest') : null,
  }
}

/** 该日副标题属于哪一类（用于测试与样式分档，渲染时不必判）。 */
export function almanacLabelKind(entry: AlmanacEntry): AlmanacLabelKind {
  if (entry.festival !== null) return 'festival'
  if (entry.solarTerm !== null) return 'solar-term'
  return entry.lunarDay === 1 ? 'lunar-month' : 'lunar-day'
}

/**
 * 格子右上角那一条副标题：**三种信息互斥**，按"传统节日 → 节气 → 初一显示月份名 →
 * 其余显示农历日期"择一。
 */
export function almanacLabel(entry: AlmanacEntry): string {
  switch (almanacLabelKind(entry)) {
    case 'festival':
      return entry.festival!
    case 'solar-term':
      return entry.solarTerm!
    case 'lunar-month':
      return entry.lunarMonthLabel
    default:
      return entry.lunarDayLabel
  }
}

/**
 * 「休 / 班」标记。
 *
 * 与副标题**不是互斥关系**——它可以和传统节日 / 节气 / 农历日期同时出现，
 * 所以单独出一个函数，而不是并进 {@link almanacLabel}。
 */
export function holidayMark(entry: AlmanacEntry): string | null {
  if (entry.holiday === 'rest') return '休'
  if (entry.holiday === 'work') return '班'
  return null
}
