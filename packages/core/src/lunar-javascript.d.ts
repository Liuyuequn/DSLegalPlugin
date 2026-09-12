/**
 * `lunar-javascript` 自带实现但没有类型声明（见其 package.json：无 `types` 字段）。
 * 这里只声明本项目实际用到的那一小部分 API，够用且能挡住拼错的方法名。
 *
 * 上游是 CommonJS，Node ESM 侧按默认导出互操作；tsdown 会把它内联进产物。
 */
declare module 'lunar-javascript' {
  /** 农历日期。 */
  export interface LunarDate {
    /** 农历月，1–12；**闰月为负数**（-6 表示闰六月）。 */
    getMonth(): number
    /** 农历日，1–30（1 = 初一）。 */
    getDay(): number
    /** 农历月的中文名，如「八月」。闰月由 `getMonth()` 的负号体现，名字仍是「八月」。 */
    getMonthInChinese(): string
    /** 农历日的中文名，如「初二」「廿三」。 */
    getDayInChinese(): string
    /** 当天的二十四节气名（如「白露」）；不是节气日则为空串。 */
    getJieQi(): string
    /** 当天的**农历**传统节日，如 `['中秋节']`；没有则为空数组。 */
    getFestivals(): string[]
  }

  /** 公历日期。 */
  export interface SolarDate {
    getLunar(): LunarDate
    /** 当天的**公历**节日，如 `['元旦']`；没有则为空数组。 */
    getFestivals(): string[]
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarDate
  }

  /** 一个法定节假日（含调休）记录。 */
  export interface HolidayDate {
    /** 节假日名，如「国庆节」。 */
    getName(): string
    /** `true` = 调休**上班**日，`false` = 放假日。 */
    isWork(): boolean
  }

  export const HolidayUtil: {
    /** 该日不属于任何法定节假日安排时返回 `null`。 */
    getHoliday(year: number, month: number, day: number): HolidayDate | null
  }
}
