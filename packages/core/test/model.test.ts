import { describe, expect, it } from 'vitest'

import {
  HEX_COLOR_PATTERN,
  PRIORITIES,
  PRIORITY_COLORS,
  isHexColor,
  resolvePriorityColors,
} from '../src/model.js'

/**
 * 四象限颜色可被用户自定义；这里是**唯一**一处"用户设置 → 默认色"的兜底逻辑
 * （host 与 client 都走它，不各算一套）。
 *
 * 两条必须守住的性质：
 * 1. **逐键兜底**：某一键写坏只影响它自己，其余照常生效——一个笔误不该把整个界面染坏。
 * 2. **输出一定完整**：四个优先级一定有值，界面可以直接拿去渲染，不必再判空。
 */
describe('颜色写法校验', () => {
  it('只认 #RRGGBB（大小写均可）', () => {
    expect(isHexColor('#E53E3E')).toBe(true)
    expect(isHexColor('#e53e3e')).toBe(true)
    expect(isHexColor('#f3e417')).toBe(true)
    expect(isHexColor('#FFF')).toBe(false)
    expect(isHexColor('E53E3E')).toBe(false)
    expect(isHexColor('#GGGGGG')).toBe(false)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor(0xe53e3e)).toBe(false)
    expect(isHexColor(null)).toBe(false)
    expect(HEX_COLOR_PATTERN.test('#E53E3E')).toBe(true)
  })
})

describe('四象限颜色的解析', () => {
  it('未配置时四个都是默认色，且没有 issue', () => {
    for (const input of [undefined, null, {}, 'nonsense', 42]) {
      const { colors, issues } = resolvePriorityColors(input)
      expect(colors).toEqual(PRIORITY_COLORS)
      expect(issues).toEqual([])
    }
  })

  it('配置了合法颜色时覆盖默认值', () => {
    const { colors, issues } = resolvePriorityColors({ 重要且紧急: '#123ABC' })
    expect(colors['重要且紧急']).toBe('#123ABC')
    // 其余三个仍是默认色。
    expect(colors['紧急不重要']).toBe(PRIORITY_COLORS['紧急不重要'])
    expect(issues).toEqual([])
  })

  it('大小写与首尾空白都按合法处理（保留用户写的大小写）', () => {
    const { colors, issues } = resolvePriorityColors({ 重要且紧急: '  #AbCdEf  ' })
    expect(colors['重要且紧急']).toBe('#AbCdEf')
    expect(issues).toEqual([])
  })

  it('某一键写坏时只兜底那一键，其余照常生效', () => {
    const { colors, issues } = resolvePriorityColors({
      重要且紧急: '#112233',
      紧急不重要: 'ff8800', // 少了 #
      重要不紧急: '', // 空串
      不重要不紧急: null, // 视为未配置
    })
    expect(colors['重要且紧急']).toBe('#112233')
    expect(colors['紧急不重要']).toBe(PRIORITY_COLORS['紧急不重要'])
    expect(colors['重要不紧急']).toBe(PRIORITY_COLORS['重要不紧急'])
    expect(colors['不重要不紧急']).toBe(PRIORITY_COLORS['不重要不紧急'])
    // 写坏的两键如实报出来（原值 + 原因），不静默丢弃。
    expect(issues.map((issue) => issue.priority)).toEqual(['紧急不重要', '重要不紧急'])
    expect(issues[0]?.value).toBe('ff8800')
    expect(issues[0]?.message).toContain('#RRGGBB')
  })

  it('输出永远覆盖全部四个优先级，界面不必判空', () => {
    const { colors } = resolvePriorityColors({ 重要且紧急: '#000000' })
    expect(Object.keys(colors).sort()).toEqual([...PRIORITIES].sort())
    for (const priority of PRIORITIES) expect(isHexColor(colors[priority])).toBe(true)
  })

  it('不修改默认色常量本身', () => {
    const before = { ...PRIORITY_COLORS }
    resolvePriorityColors({ 重要且紧急: '#000000' })
    expect(PRIORITY_COLORS).toEqual(before)
  })
})
