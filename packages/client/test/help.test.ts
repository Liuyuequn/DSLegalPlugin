import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 使用说明的行内标记。
 *
 * 实测踩过：说明文案里写了 `**重点**`，但渲染时是 `{line}` 直接落文本，界面上就原样
 * 显示成 `**择一**`——四个星号明晃晃挂在说明页上。文案是**数据**（字符串数组）不是 JSX，
 * 所以重点只能靠渲染时还原（`views.tsx` 的 `richLine`）。
 *
 * 这里不去 import 组件（要 jsdom、要 React 渲染器），而是**扫源码**——
 * 说明文案与它的渲染方式都在同一个文件里，扫得动，也就没必要为它搭一套渲染环境。
 */
const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')

/** 抠出 `HELP_SECTIONS` 这一整块（到下一个顶层 `export` 或文件末尾）。 */
const helpBlock = (): string => {
  const start = VIEWS.indexOf('const HELP_SECTIONS')
  expect(start, '找不到 HELP_SECTIONS，说明结构变了，请同步这个守卫').toBeGreaterThan(-1)
  const rest = VIEWS.slice(start)
  const end = rest.indexOf('\n// ---')
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * 说明文案里所有"整行就是一条文案"的字符串字面量。
 *
 * 按**行**取而不是按引号配对取：文案是一行一条（`'……',` 或反引号模板 + 逗号），
 * 而块里还有类型标注与注释，用引号配对的正则会连注释里的星号一起捞进来。
 */
const helpStrings = (): string[] =>
  helpBlock()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[`']/.test(line))
    .map((line) => line.replace(/^[`']/, '').replace(/[`'],$/, ''))

describe('使用说明的行内标记', () => {
  it('找得到说明文案（守卫本身没失效）', () => {
    expect(helpStrings().length).toBeGreaterThan(40)
  })

  it('每一行的 `**` 都成对，否则加粗会串到下一行去', () => {
    const unbalanced = helpStrings().filter((text) => (text.split('**').length - 1) % 2 !== 0)
    expect(unbalanced, `这些说明行的 ** 没有配对：${unbalanced.join(' | ')}`).toEqual([])
  })

  it('说明文案确实经过 richLine 渲染，而不是直接落文本', () => {
    // 两组都要：lines 与 more。
    const rendered = VIEWS.match(/richLine\(line\)/g) ?? []
    expect(rendered.length, '说明行的渲染没有走 richLine，`**` 会原样显示').toBeGreaterThanOrEqual(2)
    // 反面：`{line}` 直接作为文本子节点出现（旧写法）。
    expect(
      /\n\s*\{line\}\n/.test(VIEWS),
      '还有地方把说明行直接当文本渲染，`**` 会原样漏到界面上',
    ).toBe(false)
  })

  it('richLine 只认一对 `**`', () => {
    expect(VIEWS).toContain("line.split('**')")
    expect(VIEWS).toContain('helpStrong')
  })
})
