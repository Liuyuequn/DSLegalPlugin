import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { CSSProperties } from 'react'

import { PRIORITY_COLORS } from '@dslegal/core'

import * as UI from '../src/styles.js'
import {
  MONTH_CHIP_GAP,
  MONTH_CHIP_HEIGHT,
  T,
  TODO_ROW_HEIGHT,
  WEEK_BAR_HEIGHT,
  body,
  caseRow,
  chip,
  dayRow,
  ellipsisTitle,
  helpOverlay,
  iconButton,
  itemBody,
  itemMeta,
  itemMetaOneLine,
  launcher,
  monthCell,
  monthChip,
  monthChips,
  monthDayAlmanac,
  monthDayMark,
  monthDayNum,
  monthGrid,
  navStep,
  onColor,
  popoverAction,
  primaryButton,
  quadrantCell,
  quadrantGrid,
  quadrantList,
  tab,
  textButton,
  todayButton,
  todoRow,
  todoTitle,
  topBar,
  weekBar,
  weekColumn,
} from '../src/styles.js'
/**
 * 布局不变量。
 *
 * 这几条一旦破掉，用户要的功能就静默失效（而且看截图很像"样式没调好"）：
 *
 * 1. **四象限面积恒等**：靠网格 `1fr 1fr` 撑开，四个区域的高度与各自条数无关。
 * 2. **象限内容区高度只由网格决定**：`flex:1 + minHeight:0 + overflow:hidden`。
 *    少了 `minHeight:0`，条目会把容器顶高，"能容纳几条"就随内容变化自激。
 * 3. **标题省略号**：`overflow:hidden + textOverflow:ellipsis + whiteSpace:nowrap`，
 *    且外层 `minWidth:0`——flex 子项默认 `min-width:auto`，会被长标题顶住不缩。
 * 4. **固定高度与换算常量一致**：裁剪用的是 `rowCapacity(像素, 常量)`，
 *    样式里的高度和常量对不上就会露出半行 / 半条。
 */
describe('四象限布局不变量', () => {
  it('四个区域等面积：两行两列都是 1fr，并铺满主体区', () => {
    expect(quadrantGrid.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(quadrantGrid.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))')
    expect(quadrantGrid.flex).toBe('1 1 auto')
    expect(quadrantGrid.minHeight).toBe(0)
  })

  it('象限内容区高度只由网格决定，不随条目数量增长', () => {
    expect(quadrantList.flex).toBe('1 1 auto')
    expect(quadrantList.minHeight).toBe(0)
    expect(quadrantList.overflow).toBe('hidden')
    expect(quadrantCell('重要且紧急').minHeight).toBe(0)
    expect(quadrantCell('重要且紧急').display).toBe('flex')
    expect(quadrantCell('重要且紧急').flexDirection).toBe('column')
  })

  it('待办行高固定，与换算条数用的常量一致（否则会露出半行）', () => {
    const row = todoRow(false, false)
    expect(row.height).toBe(TODO_ROW_HEIGHT)
    expect(row.flex).toBe('0 0 auto')
    expect(row.overflow).toBeUndefined()
  })

  it('已完成条目划线置灰，且不靠降低透明度（透明度会连带把标题也淡化到读不清）', () => {
    expect(todoTitle(true).textDecoration).toBe('line-through')
    expect(todoTitle(false).textDecoration).toBeUndefined()
    expect(todoRow(false, true).opacity).toBeUndefined()
  })

  it('标题过长自动省略后续文字，且 flex 子项允许收缩', () => {
    const title = ellipsisTitle(false)
    expect(title.overflow).toBe('hidden')
    expect(title.textOverflow).toBe('ellipsis')
    expect(title.whiteSpace).toBe('nowrap')
    expect(title.minWidth).toBe(0)
    expect(itemBody.minWidth).toBe(0)
  })
})

describe('主体区滚动', () => {
  it('待办线索不滚动（否则"当前界面能容纳"就不再等于可视区能容纳）', () => {
    expect(body(false).overflowY).toBe('hidden')
    expect(body(false).minHeight).toBe(0)
    expect(body(false).flex).toBe('1 1 auto')
  })

  it('日程与项目线索可滚动', () => {
    expect(body(true).overflowY).toBe('auto')
  })

  /**
   * 主体区必须自成层叠上下文。
   *
   * 实测的 bug：日视图下点「使用说明」，说明层盖不住日视图——日卡用 `zIndex: 8–10`
   * 叠前后关系，而主体区没有 `position`/`z-index`，不构成层叠上下文，于是那些卡片
   * 直接参与面板那一层的比较，`zIndex: 10` 压过了说明层的 `zIndex: 2`。
   * 只要主体区隔离，线索内部用多大的 z-index 都越不出来。
   */
  it('主体区隔离成一个层叠上下文，线索内部的 z-index 越不过说明层', () => {
    for (const scroll of [true, false]) {
      expect(body(scroll).position).toBe('relative')
      expect(body(scroll).zIndex).toBe(0)
    }
    // 说明层只要是个正的 z-index 就能盖住（前提是上面那条成立）。
    expect(Number(helpOverlay.zIndex)).toBeGreaterThan(0)
    expect(helpOverlay.position).toBe('absolute')
  })
})

/**
 * 盒模型。
 *
 * 面板**没有全局 `box-sizing: border-box` 重置**（DSH 的样式表管不到我们的内联样式），
 * 于是 CSS 的默认值 `content-box` 生效：写了 `height: 30` + 上下 padding 8px 的元素，
 * 实测外高是 46px 而不是 30px。
 *
 * 实测踩过：`topBar` 写 `minHeight: 50` + `padding: 8px 16px` + 1px 下边框，量出来
 * **67px**（50 + 16 + 1），比它要替代的旧头栏（53px）还高——单看每个数字都对，所以
 * 很难一眼找出原因。
 *
 * 所以凡是"写死高度"又要"上下内边距 / 边框"的样式，必须自己声明 `border-box`。
 */
describe('盒模型：写死高度的样式必须自带 border-box', () => {
  const verticalPadding = (style: CSSProperties): number => {
    const pad = style.padding
    if (typeof pad !== 'string') return 0
    // 简写 1/2/3/4 值的**第一个**都是上边距，够用了。
    return Number.parseFloat(pad.split(/\s+/)[0] ?? '0') || 0
  }
  const hasVerticalBorder = (style: CSSProperties): boolean =>
    [style.border, style.borderTop, style.borderBottom].some(
      (value) => typeof value === 'string' && /^\s*[\d.]+px/.test(value),
    )

  it('凡是 height/minHeight 与上下 padding 或边框并存的导出样式，都必须是 border-box', () => {
    const offenders: string[] = []
    for (const [name, value] of Object.entries(UI)) {
      // 函数式样式（需要参数）跳过，只看常量对象。
      if (typeof value !== 'object' || value === null) continue
      const style = value as CSSProperties
      const declared = [style.height, style.minHeight].filter(
        (v): v is number => typeof v === 'number',
      )
      // `minHeight: 0` 是 flex/grid 子项的惯用写法（"不设下限"），不是尺寸声明，
      // 它跟 padding 相加得到的 20px 无害，不该算作违规。
      if (declared.length === 0 || Math.max(...declared) <= 0) continue
      if (verticalPadding(style) === 0 && !hasVerticalBorder(style)) continue
      if (style.boxSizing === 'border-box') continue
      offenders.push(name)
    }
    // 把名单放进断言消息里：失败时直接告诉你该给哪几个样式补 boxSizing。
    expect(offenders, `缺 border-box 的样式：${offenders.join(', ')}`).toEqual([])
  })

  it('首行菜单：50px 就是 50px（67px 是 content-box 叠出来的）', () => {
    expect(topBar.boxSizing).toBe('border-box')
    expect(topBar.minHeight).toBe(50)
  })
})

/**
 * 固定高度的行里不能放会换行的文本。
 *
 * 实测踩过：日卡的行写死 56px，元信息一旦折成两行，两行加起来正好等于内容区高度——
 * "差 1px 就顶穿"，而折行与否取决于字体回退的度量，不取决于我们写了什么。
 * 修法是两头都堵：行高由内容自然决定 + 元信息强制单行省略。
 */
describe('固定高度的行不得包含会换行的文本', () => {
  it('日卡的行不写死高度，元信息走单行省略', () => {
    expect(dayRow(false, false, false).height).toBeUndefined()
    expect(dayRow(false, false, false).minHeight).toBeUndefined()
    expect(itemMetaOneLine.whiteSpace).toBe('nowrap')
    expect(itemMetaOneLine.textOverflow).toBe('ellipsis')
    expect(itemMetaOneLine.minWidth).toBe(0)
  })

  it('会换行的元信息只用于高度自然增长的容器（项目列表 / 项目详情）', () => {
    expect(itemMeta.whiteSpace).toBeUndefined()
    expect(itemMeta.wordBreak).toBe('break-word')
  })
})

describe('周形态：斑马泳道 + 实心条', () => {
  it('七列恒等宽，列底色是斑马（靠明度分区，不画竖线）', () => {
    expect(String(weekColumn(false, false).background)).not.toBe(String(weekColumn(false, true).background))
    // 今天那条蓝线是内阴影，不占布局宽度（占宽度会把这一列挤出等宽网格）。
    expect(String(weekColumn(true, false).boxShadow)).toContain('#4A8CF1')
    expect(weekColumn(false, false).width).toBeUndefined()
  })

  it('实心条高度固定且与常量一致（高度决定一列里能码几条）', () => {
    expect(weekBar('#E53E3E', false, false).height).toBe(WEEK_BAR_HEIGHT)
    expect(weekBar('#E53E3E', false, false).flex).toBe('0 0 auto')
  })

  it('已完成退成浅底并置灰，未完成是实心色', () => {
    const open = weekBar('#E53E3E', false, false)
    const done = weekBar('#E53E3E', true, false)
    expect(String(open.background)).toBe('#E53E3E')
    expect(String(done.background)).not.toBe('#E53E3E')
    expect(String(done.background)).toContain('rgba(')
  })
})

describe('实心条上的文字色', () => {
  it('黄条用深色字、红条用白字（一律白字会让「重要不紧急」读不了）', () => {
    expect(onColor('#f3e417')).not.toBe('#FFFFFF')
    expect(onColor('#E53E3E')).toBe('#FFFFFF')
    expect(onColor('#98c51e')).not.toBe('#FFFFFF')
  })

  it('四个优先级色都取对比度更高的那一侧（橙色曾因拍阈值而错留白字）', () => {
    // 回归：按"亮度大于 0.42 才换深色"的写法，#ED8936 亮度 0.36 会留住白字，
    // 实测对比度只有 2.55:1；按对比度择优必须给深色。
    expect(onColor('#ED8936')).not.toBe('#FFFFFF')
    for (const hex of ['#E53E3E', '#ED8936', '#f3e417', '#98c51e']) {
      expect(onColor(hex)).toBe(hex === '#E53E3E' ? '#FFFFFF' : '#2A2600')
    }
  })
})

describe('月形态：格子与条', () => {
  /** 一个"中间格"（不贴边），按需覆盖字段。 */
  const cell = (over: Partial<Parameters<typeof monthCell>[0]> = {}) =>
    monthCell({ selected: false, hovered: false, today: false, lastCol: false, lastRow: false, ...over })

  it('网格行数可变（5 行月不按 6 行铺，否则每格白矮六分之一）', () => {
    expect(String(monthGrid(5).gridTemplateRows)).toBe('repeat(5, minmax(0, 1fr))')
    expect(String(monthGrid(6).gridTemplateRows)).toBe('repeat(6, minmax(0, 1fr))')
    expect(String(monthGrid(5).gridTemplateColumns)).toBe('repeat(7, minmax(0, 1fr))')
  })

  it('格子内容区可收缩，条目才不会把格子顶高', () => {
    expect(cell().overflow).toBe('hidden')
    expect(cell().minHeight).toBe(0)
  })

  it('小条高度固定且与换算条数用的常量一致', () => {
    expect(monthChip('#E53E3E', false, false).height).toBe(MONTH_CHIP_HEIGHT)
    expect(MONTH_CHIP_HEIGHT + MONTH_CHIP_GAP).toBeGreaterThan(MONTH_CHIP_HEIGHT)
  })

  it('今天用浅主色底标注', () => {
    expect(String(cell({ today: true }).background)).toContain('rgba(')
    expect(cell({ today: true }).background).not.toBe(cell().background)
  })
})

/**
 * 月历格线。
 *
 * 实测踩过两次，两层原因叠在一起（用户原话："当前月份实际包含的日期全部用黑色边框
 * 标注起来了，很丑"）：
 *
 * 1. **`<button>` 的 UA 边框**：UA 给的是 `border: 2px outset`，面板里没有全局 button
 *    重置，所以哪条边不显式写，哪条边就留 2px 立体边框。只写右、下两条时，上、左留下
 *    2px 的中灰（实测像素 `#a8a8a8`）——这是最刺眼的那一层。
 * 2. **接缝叠了两遍**：外层画四边 1px、格子又画上、左两条 1px，上沿与左沿叠成 2px。
 *
 * 修法：外层不描边、格子四条边一律显式写全（只画右 / 下）、最后一列与最后一行不画，
 * 且"本月之外"改由文字颜色表达，不再整格降透明度。
 *
 * **注意断言写的是 `'none'` 而不是 `undefined`**：`undefined` 的含义是"交给 UA 决定"，
 * 正是它让第一版守卫测试在 bug 存在时照样通过。凡"这几条边不许有线"的断言，都必须
 * 断言显式的 `none`。
 */
describe('月形态：格线只画一遍，且不整格降透明度', () => {
  const cell = (over: Partial<Parameters<typeof monthCell>[0]> = {}) =>
    monthCell({ selected: false, hovered: false, today: false, lastCol: false, lastRow: false, ...over })

  it('外层网格不描边——描了边本月那一块就成了一只盒子', () => {
    const grid = monthGrid(5)
    expect(grid.border).toBe('none')
    // 四条边也不能是 undefined（那会退回 UA 的值）。
    expect(grid.borderTop).toBeUndefined()
    expect(grid.borderLeft).toBeUndefined()
  })

  it('格子四条边都显式声明，不留一条给 UA 的 2px outset', () => {
    const sides = [cell().borderTop, cell().borderRight, cell().borderBottom, cell().borderLeft]
    for (const side of sides) expect(side, '有一条边没写，会退回 <button> 的 UA 边框').toBeDefined()
  })

  it('格子只画右、下两条线，上、左显式为 none', () => {
    expect(cell().borderTop).toBe('none')
    expect(cell().borderLeft).toBe('none')
    expect(String(cell().borderRight)).toMatch(/^1px solid /)
    expect(String(cell().borderBottom)).toMatch(/^1px solid /)
  })

  it('格线走更浅的 hairline 档，而不是 border1', () => {
    expect(String(cell().borderRight)).toContain(T.hairline)
    expect(String(cell().borderRight)).not.toContain(T.border1)
  })

  it('最后一列不画右边线、最后一行不画下边线（否则网格外沿多一条边）', () => {
    expect(cell({ lastCol: true }).borderRight).toBe('none')
    expect(cell({ lastRow: true }).borderBottom).toBe('none')
    // 只是缺一条边，另一条照常。
    expect(String(cell({ lastCol: true }).borderBottom)).toMatch(/^1px solid /)
    expect(String(cell({ lastRow: true }).borderRight)).toMatch(/^1px solid /)
  })

  it('不再靠整格降透明度表示"本月之外"（那会把格线一起淡化）', () => {
    expect(cell().opacity).toBeUndefined()
    expect(cell({ selected: true, hovered: true, today: true }).opacity).toBeUndefined()
  })

  it('"本月之外"改由文字与条目表达：日号、农历、条区都分档', () => {
    expect(monthDayNum(false, true).color).not.toBe(monthDayNum(false, false).color)
    expect(monthDayAlmanac(true).color).not.toBe(monthDayAlmanac(false).color)
    expect(monthChips(true).opacity).toBe(1)
    expect(monthChips(false).opacity).toBeLessThan(1)
  })
})

/**
 * `<button>` 的 UA 边框守卫。
 *
 * 上一条是针对月历的具体断言；这一条是**通用防线**：从 `views.tsx` / `client.tsx` 里
 * 扫出所有用在 `<button>` 上的样式名，要求每个都把边框说全（`border` 简写，或四条
 * longhand 都写）。名单从源码里现扫，不用手工维护——加了新按钮就自动纳入。
 *
 * 这些样式几乎都是函数（都要一个 `hovered` 之类的参数），所以得给一组样参才能拿到
 * 返回值去检查。样参表是**故意显式**的：签名一改，TypeScript 立刻在这里报错。
 */
describe('用在 <button> 上的样式必须把边框说全（UA 是 2px outset）', () => {
  const SOURCES = ['src/views.tsx', 'src/client.tsx']

  const buttonStyleNames = (): string[] => {
    const names = new Set<string>()
    for (const file of SOURCES) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      const open = /<button/g
      let match = open.exec(text)
      while (match !== null) {
        // 取**这一个开标签**的文本（到它的 `>` 为止），而不是"往后若干字符"。
        // 松窗口会抓到下一个元素身上的样式：上一版就把不可点的 `monthCell` 误判成按钮样式。
        // 跳过 `=>` 里的 `>`，否则属性里一个箭头函数就把标签切断了。
        let i = match.index + match[0].length
        let end = -1
        while (i < text.length) {
          if (text[i] === '>' && text[i - 1] !== '=') {
            end = i
            break
          }
          i += 1
        }
        if (end >= 0) {
          const style = /style=\{(?:UI\.)?([A-Za-z0-9_]+)/.exec(text.slice(match.index, end))
          if (style !== null) names.add(style[1]!)
        }
        match = open.exec(text)
      }
    }
    return [...names].sort()
  }

  /** 每个按钮样式一组样参。参数名一并记下来，失败信息里能看出是怎么调的。 */
  const SAMPLES: Record<string, () => CSSProperties> = {
    launcher: () => launcher({ left: 0, bottom: 0 }, false, false),
    textButton: () => textButton(false),
    tab: () => tab(false, false),
    iconButton: () => iconButton(false),
    chip: () => chip(false, false),
    navStep: () => navStep(false),
    todayButton: () => todayButton(false),
    weekBar: () => weekBar('#E53E3E', false, false),
    caseRow: () => caseRow(false, false),
    primaryButton: () => primaryButton(false, false),
    monthChip: () => monthChip('#E53E3E', false, false),
    popoverAction: () => popoverAction(false, false),
    popoverTitleButton: () => UI.popoverTitleButton(false),
    composeChip: () => UI.composeChip(false, false, '#E53E3E'),
    composeSubmit: () => UI.composeSubmit(false, false),
    composeProjectTrigger: () => UI.composeProjectTrigger(false, false),
    composeProjectOption: () => UI.composeProjectOption(false, false),
    helpToggle: () => UI.helpToggle(false, false),
  }

  /** 缺哪几条边（空数组 = 边框说全了）。 */
  const missingSides = (style: CSSProperties): string[] => {
    if (style.border !== undefined) return []
    const sides: Array<[string, unknown]> = [
      ['borderTop', style.borderTop],
      ['borderRight', style.borderRight],
      ['borderBottom', style.borderBottom],
      ['borderLeft', style.borderLeft],
    ]
    return sides.filter(([, value]) => value === undefined).map(([name]) => name)
  }

  it('扫得到的按钮样式数量正常（守卫本身没失效）', () => {
    expect(buttonStyleNames().length).toBeGreaterThan(8)
  })

  it('每个按钮样式都声明了完整边框', () => {
    const offenders: string[] = []
    for (const name of buttonStyleNames()) {
      const sample = SAMPLES[name]
      if (!sample) continue // 由下一条断言点名
      const missing = missingSides(sample())
      if (missing.length > 0) offenders.push(`${name} 缺 ${missing.join('/')}`)
    }
    expect(offenders, `这些样式用在 <button> 上却没写全边框：${offenders.join('，')}`).toEqual([])
  })

  it('每个按钮样式都在样参表里登记了（新按钮不会漏检）', () => {
    const unregistered = buttonStyleNames().filter((name) => !SAMPLES[name])
    expect(
      unregistered,
      `这些样式用在 <button> 上但没登记样参，请补进 SAMPLES：${unregistered.join('，')}`,
    ).toEqual([])
  })

  it('样参表里没有多余的、已经用不到的条目', () => {
    const known = new Set(buttonStyleNames())
    const stale = Object.keys(SAMPLES).filter((name) => !known.has(name))
    expect(stale, `这些样式已不在 <button> 上使用，请从 SAMPLES 删掉：${stale.join('，')}`).toEqual([])
  })

  /**
   * 月视图里两个动作必须分得开：**点小条 = 看这一条明细**，**点格子空白 = 在那天新建**。
   *
   * 小条是 `<button>`（真按钮语义，也是月历里唯一的一个），格子是 `<div>`。
   * 格子写回 `<button>` 会立刻出两件事：UA 那圈 2px `#a8a8a8` 边框跟着回来
   * （见「月形态：格线只画一遍」那一段），而且"点空白新建"压根不是一个按钮语义的动作。
   */
  it('月历格子是 div、日程小条是 button（两个动作分得开）', () => {
    const buttons = buttonStyleNames()
    expect(buttons, '月历格子又被写回 <button> 了——它会带回 UA 边框，语义也不对').not.toContain(
      'monthCell',
    )
    expect(buttons, '日程小条不可点的话，用户就没法点开某一条日程的明细').toContain('monthChip')
  })
})

/**
 * 月历格子的日期行：`[日号] [休/班] ……… [农历/节日]`。
 *
 * 用户的规则：农历日期 / 农历月份 / 传统节日节气**三者互斥**，按"节日 → 节气 →
 * 初一显示月份 → 否则显示日期"择一；「休」**可以和它们同时存在**，位置夹在
 * 左上角的阿拉伯数字与右上角那条信息中间。
 */
describe('月形态：日期行三格', () => {
  it('农历那一条靠右（推到行尾），日号留在左边', () => {
    expect(monthDayAlmanac(true).marginLeft).toBe('auto')
    expect(monthDayAlmanac(true).minWidth).toBe(0)
  })

  it('农历那一条挤不下时省略，而不是把日号挤走', () => {
    expect(monthDayAlmanac(true).whiteSpace).toBe('nowrap')
    expect(monthDayAlmanac(true).textOverflow).toBe('ellipsis')
    expect(monthDayAlmanac(true).overflow).toBe('hidden')
  })

  it('「休」用专用色，不复用任何优先级色（同格里的条色不该被读成同一件事）', () => {
    expect(monthDayMark(true, true).color).toBe(T.rest)
    for (const color of Object.values(PRIORITY_COLORS)) {
      expect(monthDayMark(true, true).color).not.toBe(color)
    }
    // 「班」（调休上班）比「休」弱一档，不是红色的。
    expect(monthDayMark(false, true).color).not.toBe(T.rest)
  })
})

/**
 * 点击粒度：**周形态与月形态都是"点条目 → 弹明细"，不是点一下就直接改状态**。
 *
 * 用户的要求是"点击具体某个日程条以后弹出悬浮窗……增加一个点击改变其完成状态的按钮，
 * 并且这种悬浮窗要复用在周视图"。所以两个形态点条目必须走同一个手势（弹窗），
 * 改状态只发生在窗里那个按钮上。
 *
 * 用**扫源码**来钉：函数体就在同一个文件里，扫得动，不必为它搭一套渲染环境。
 * 早先周形态是"点整条直接切换完成状态"，所以这条守卫同时防止它被改回去。
 */
describe('点击粒度：周 / 月都走"点条目 → 弹明细"', () => {
  const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')

  /** 抠出一个函数体（到下一个顶层 `function` 或块注释为止）。 */
  const bodyOf = (name: string): string => {
    const start = VIEWS.indexOf(`function ${name}(`)
    expect(start, `找不到 ${name}，说明结构变了，请同步这个守卫`).toBeGreaterThan(-1)
    const rest = VIEWS.slice(start + 1)
    const end = rest.search(/\n(function |\/\*\*)/)
    return end < 0 ? rest : rest.slice(0, end)
  }

  it('周形态点条 → 弹明细，不直接切换完成状态', () => {
    const body = bodyOf('WeekBar')
    expect(body, '周形态点条应当打开明细悬浮窗').toContain('onOpenSchedule')
    expect(body, '周形态点条不该再直接切换完成状态（改状态要在弹窗里做）').not.toContain(
      'onToggleSchedule',
    )
  })

  it('月形态点条 → 弹明细（早先已定，一并钉住）', () => {
    const body = bodyOf('MonthGrid')
    expect(body).toContain('onOpenSchedule')
    expect(body, '月历格子不该勾选也不能切状态').not.toContain('onToggleSchedule')
  })

  it('明细窗里确实有一个改状态的按钮', () => {
    const body = bodyOf('DetailPopover')
    expect(body).toContain('data-fl="popover-toggle"')
    expect(body).toContain('onToggle')
  })

  it('明细窗的标题是"打开原始 markdown"的入口', () => {
    const body = bodyOf('DetailPopover')
    expect(body, '标题要能点开原始 markdown').toContain('data-fl="popover-source"')
    expect(body, '点了标题要真的发请求，而不是只改个样式').toContain('onOpenSource')
    expect(body, '标题按钮要用登记过的样式（它有 UA 边框与 UA 字号两个坑）').toContain(
      'UI.popoverTitleButton',
    )
  })

  it('日程与待办共用同一个明细窗（不是两份会长歪的实现）', () => {
    // 两个包装各自只做一件事：把数据映射成 DetailView + 报上自己的标记。
    for (const [wrapper, marker, detailOf] of [
      ['SchedulePopover', 'schedule-popover', 'scheduleDetail'],
      ['TodoPopover', 'todo-popover', 'todoDetail'],
    ] as const) {
      const body = bodyOf(wrapper)
      expect(body, `${wrapper} 要用共用的 DetailPopover`).toContain('<DetailPopover')
      expect(body, `${wrapper} 要报上自己的标记 ${marker}`).toContain(`marker="${marker}"`)
      expect(body, `${wrapper} 要把行号传下去（点标题要定位到行）`).toContain('line={props.row.line}')
      expect(body, `${wrapper} 要用自己的取数函数`).toContain(detailOf)
    }
  })
})

/**
 * 待办条：**点条目弹明细窗**（与点日程条同一个手势），而**点复选框仍然只是勾选**。
 *
 * 这两个动作必须在同一行上分得开：复选框是用户心里"打勾"的那个小方框，行是"这一条"。
 * 复选框不挡 click 冒泡的话，勾一下会同时弹出一个窗——那是最烦人的那种界面行为。
 */
describe('待办条：点条目弹明细，点复选框只勾选', () => {
  const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')

  const bodyOf = (name: string): string => {
    const start = VIEWS.indexOf(`function ${name}(`)
    expect(start, `找不到 ${name}，说明结构变了，请同步这个守卫`).toBeGreaterThan(-1)
    const rest = VIEWS.slice(start + 1)
    const end = rest.search(/\n(function |\/\* )/)
    return end < 0 ? rest : rest.slice(0, end)
  }

  it('待办线索的条目点了要弹明细窗', () => {
    const body = bodyOf('TodoLineCompact')
    expect(body, '点待办条要弹明细窗').toContain('onOpenTodo')
    expect(body, '落点用条目自己的矩形（窗要贴着那一条）').toContain('getBoundingClientRect')
  })

  it('项目详情里的待办行同样能点开', () => {
    const body = bodyOf('TodoLineDetail')
    expect(body).toContain('onOpenTodo')
    expect(body, '点标题开原文的手势要在两种视图里都成立').toContain('data-fl-item')
  })

  it('复选框把 click 挡在行内（勾选不该顺手弹窗）', () => {
    for (const name of ['TodoLineCompact', 'TodoLineDetail']) {
      const body = bodyOf(name)
      expect(body, `${name} 的复选框要 stopPropagation`).toContain(
        'onClick={(event) => event.stopPropagation()}',
      )
      expect(body, `${name} 的复选框仍然能勾选`).toContain('onToggleTodo')
    }
  })

  it('两个线索都把 onOpenTodo 发下去（编排层只认这一个入口）', () => {
    const client = readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8')
    expect(client, '编排层要提供 onOpenTodo').toContain('onOpenTodo: openTodo')
    expect(client, '待办明细窗要真的被渲染').toContain('<TodoPopover')
    expect(client, '两种明细窗都要能按 kind 找到对应条目').toMatch(
      /detail\.kind === 'todo' \? overview\.todos : overview\.schedules/,
    )
  })
})

/**
 * 「点日程标题 → 用系统默认程序打开工作日志」。
 *
 * 这条链路上最容易犯的错是**把路径从界面传下去**：一旦接口接受调用方给的路径，
 * 它就从"打开我的工作日志"变成"启动本机任意程序"，而页面里任何一段脚本都能调它。
 * 所以路径只能由 host 从"项目名"解析出来——下面两条断言从源码层面钉住这一点。
 */
describe('打开原始 markdown：只送项目与行号，不送路径', () => {
  const API = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
  const CLIENT = readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8')

  /** 抠出 `postOpenSource` 的函数体。 */
  const openBody = (): string => {
    const start = API.indexOf('export async function postOpenSource(')
    expect(start, '找不到 postOpenSource，说明结构变了，请同步这个守卫').toBeGreaterThan(-1)
    const rest = API.slice(start)
    const end = rest.indexOf('\n}')
    return end < 0 ? rest : rest.slice(0, end)
  }

  it('请求体只带 project / topLevelDir / kind / line', () => {
    const body = openBody()
    for (const field of ['project', 'topLevelDir', 'kind', 'line']) {
      expect(body, `请求体应当带上 ${field}`).toContain(field)
    }
    expect(body, '**绝不接受调用方给的路径**：能开任意文件的接口等于启动任意程序的后门').not.toMatch(
      /\bpath\b/,
    )
  })

  it('编排层调用时也只给项目与行号', () => {
    const start = CLIENT.indexOf('const openSource = useCallback(')
    expect(start, '找不到 openSource，说明结构变了，请同步这个守卫').toBeGreaterThan(-1)
    const rest = CLIENT.slice(start)
    const end = rest.indexOf('\n  }, [')
    const body = end < 0 ? rest : rest.slice(0, end)
    expect(body).toContain('postOpenSource')
    expect(body, '要按 identity 送行号').toContain('line: row.line')
    expect(body, '不许把路径塞进请求').not.toMatch(/\bpath\b/)
  })

  it('不借浏览器的手开文件（打开本机文件只能走 host）', () => {
    const body = ((): string => {
      const views = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')
      const start = views.indexOf('function SchedulePopover(')
      const rest = views.slice(start + 1)
      const end = rest.search(/\n(function |\/\*\*)/)
      return end < 0 ? rest : rest.slice(0, end)
    })()
    expect(body, '不能写成 <a href>：那是浏览器导航，开不了本机文件').not.toContain('href')
    expect(body, '不能借 window.open 打开本机文件').not.toContain('window.open')
  })
})

/**
 * 项目详情：**待办按四象限铺开，而且一条都不许被裁掉**。
 *
 * 用户报的原话是"点击具体的项目后，待办事项没有按照四象限的排版规则显示，日程安排也浮在
 * 了界面中，和'不重要不紧急'的待办事项重叠了"。这是**两个**问题叠在一起，下面分别钉住：
 *
 * 1. 排版：待办要按四象限铺 2×2，而不是一条一条往下堆四个分组。
 * 2. 压扁：区块卡片被压到容器高度之下，内容从卡片底部溢出去，被下一张卡片盖住。
 *    （根因见 `styles.ts` 的 `detailCard()`：`card()` 的 `minHeight: 0` 取消了 flex 子项
 *    默认的 `min-height: auto` 保护，而容器是个 `overflow-y: auto` 的 flex 列。）
 */
describe('项目详情：四象限网格', () => {
  const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')
  const DETAIL = ((): string => {
    const start = VIEWS.indexOf('function ProjectDetail(')
    expect(start, '找不到 ProjectDetail，说明结构变了，请同步这个守卫').toBeGreaterThan(-1)
    const rest = VIEWS.slice(start + 1)
    const end = rest.search(/\n(function |\/\*\*)/)
    return end < 0 ? rest : rest.slice(0, end)
  })()

  it('列宽平均分，且允许被压缩（长标题不能把列顶宽、把省略号顶没）', () => {
    expect(UI.detailQuadrantGrid.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
  })

  it('行高按内容：不写 gridTemplateRows（写了 1fr 就退回"定高裁剪"）', () => {
    expect(UI.detailQuadrantGrid.gridTemplateRows).toBeUndefined()
    // 同行两格等高（高的那格拉平矮的那格），这是"象限"读起来是象限的前提。
    expect(UI.detailQuadrantGrid.alignItems).toBe('stretch')
  })

  it('格内容区不滚动、不裁剪：滚动只由项目详情那一个外层容器负责', () => {
    expect(UI.detailQuadrantList.overflow).toBeUndefined()
    expect(UI.detailQuadrantList.overflowY).toBeUndefined()
    // `minHeight: 0` 在这里是会出事的：格子高度按内容定，配 `overflow: hidden` 就能裁掉待办。
    expect(UI.detailQuadrantList.minHeight).toBeUndefined()
  })

  it('四格恒定铺满，不按"有没有条目"过滤', () => {
    expect(DETAIL).toContain('buckets.map')
    expect(DETAIL, '过滤掉空格会让 2×2 缺一角，读起来像渲染失败').not.toContain('buckets.filter')
  })

  it('空格写「暂无」，让"这格确实是空的"成为可读到的信息', () => {
    expect(DETAIL).toContain('UI.detailQuadrantEmpty')
  })

  it('未设优先级不进象限，单独列在网格下面', () => {
    expect(DETAIL).toContain('unrankedTodos')
    // 比的是**两个区块的渲染顺序**，不是字符串先出现在哪——"未设优先级"这几个字在卡片的
    // 提示文案里也有一份，拿 `indexOf('未设优先级')` 去比量到的是那句话（踩过）。
    const grid = DETAIL.indexOf('data-fl="detail-quadrants"')
    const unranked = DETAIL.indexOf('data-fl-quadrant="未设优先级"')
    expect(grid, '找不到四象限网格').toBeGreaterThan(-1)
    expect(unranked, '找不到未设优先级区块').toBeGreaterThan(-1)
    expect(grid).toBeLessThan(unranked)
  })

  it('格标题的计数省略而不顶宽格子', () => {
    expect(UI.detailQuadrantCount.whiteSpace).toBe('nowrap')
    expect(UI.detailQuadrantCount.minWidth).toBe(0)
    expect(UI.detailQuadrantCount.textOverflow).toBe('ellipsis')
  })

  it('四格色线取用户设置里的颜色，不写死', () => {
    for (const [priority, color] of Object.entries(PRIORITY_COLORS)) {
      expect(UI.detailQuadrantHead(color).boxShadow, `${priority} 的色线没自己给颜色`).toContain(
        color,
      )
    }
    // 两个不同优先级拿到的色线必须不同，否则"传了但没用出去"也测不出来。
    // `Object.values` 在 `noUncheckedIndexedAccess` 下带 `undefined`，而上面那一段已经
    // 逐个断言过四色齐全——这里只是把这件事告诉类型系统（这个 `!` 之前一直缺，
    // 于是 `tsc --noEmit` 在这两行上一直是红的）。
    const [a, b] = Object.values(PRIORITY_COLORS)
    expect(UI.detailQuadrantHead(a!).boxShadow).not.toBe(UI.detailQuadrantHead(b!).boxShadow)
  })
})

describe('项目详情的区块不许被压扁（否则内容溢出、盖住下一张卡片）', () => {
  const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')

  it('卡片不参与收缩', () => {
    expect(UI.detailCard().flex).toBe('0 0 auto')
    // 对照组：区分"给谁用的"。`card()` 是给定高布局的，它带 `minHeight: 0`。
    expect(UI.card().minHeight).toBe(0)
    expect(UI.card().flexShrink).toBeUndefined()
  })

  it('容器靠滚动消化溢出，不靠压缩子项', () => {
    expect(UI.listColumn().overflowY).toBe('auto')
  })

  it('详情里的每张卡片都用 detailCard()，没有漏网的 card()', () => {
    const cards = VIEWS.match(/data-fl-card=/g) ?? []
    const uses = VIEWS.match(/UI\.detailCard\(\)/g) ?? []
    expect(cards.length, '卡片数量变了，请同步这个守卫').toBeGreaterThanOrEqual(2)
    expect(
      uses.length,
      '有卡片没用 detailCard()：它会被压扁、内容溢出去盖住下一张卡片（用户报过）',
    ).toBe(cards.length)
  })
})

/**
 * 「点空白 → 新建」。
 *
 * 用户的要求："点击日程安排和待办事项中的空白区域（包括顶部空白位置，比如「重要且紧急」
 * 几个字这一行，又比如「09/12 今天」这个区域）的时候，弹出悬浮窗口，用于用户输入信息
 * 创建新的日程或者待办事项。"
 *
 * 这条手势靠三件事成立，缺一样就静默失效：
 *
 * 1. **热区铺到用户点得到的每一块空白上**，包括各容器的标题行——用户点名的两个例子
 *    恰好都是标题行。只挂"内容区"是不够的。
 * 2. **条目不能被当成空白**。热区是整块的（象限、卡内容区、泳道、月格），里面摆着条目；
 *    判定靠 `data-fl-item` 标记，所以**每个条目元素都必须带上它**，漏一个就会出现
 *    "点这条待办的文字 → 弹出新建窗"这种荒唐事。
 * 3. **校验与 host 共用一份实现**（`@dslegal/core` 的渲染器），否则界面说没问题、
 *    写下去被打回来。
 */
describe('点空白 → 新建：热区、条目判定、校验来源', () => {
  const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')
  const CLIENT = readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const VIEW = readFileSync(new URL('../src/view.ts', import.meta.url), 'utf8')

  /** 抠出一个函数体（`function x(` 或 `const x = (` 两种写法都认）。 */
  const bodyOf = (source: string, name: string): string => {
    const start = Math.max(
      source.indexOf(`function ${name}(`),
      source.indexOf(`const ${name} = (`),
      source.indexOf(`const ${name} = async (`),
    )
    expect(start, `找不到 ${name}，说明结构变了，请同步这个守卫`).toBeGreaterThan(-1)
    const rest = source.slice(start + 1)
    const end = rest.search(/\n(function |export function |\/\*\*)/)
    return end < 0 ? rest : rest.slice(0, end)
  }

  it('用户点名的每一块空白都接了新建：象限标题行、象限空白、日卡、周列、月格、项目详情', () => {
    for (const name of ['QuadrantArea', 'DayFan', 'WeekLanes', 'MonthGrid', 'ProjectDetail']) {
      expect(bodyOf(VIEWS, name), `${name} 里没有任何新建热区`).toContain('onCompose')
    }
    // 标题行不是"顺带"覆盖到的：它们各自有自己的处理器（用户点名的两个例子都是标题行）。
    const quadrant = bodyOf(VIEWS, 'QuadrantArea')
    expect(quadrant, '象限标题行没有接新建').toContain('onClick={compose}')
    expect(quadrant, '标题行右侧那个 ＋ 是这套手势唯一的可见线索').toContain('UI.blankAdd')
    // 日卡只有中间那一张能新建：两侧的卡整张已经是"点它即居中"，再叠一层会让同一个手势
    // 有两种后果。所以热区必须挂在 `isCenter` 上。
    const fan = bodyOf(VIEWS, 'DayFan')
    expect(fan, '日卡的热区必须只挂在中间那一张上').toContain("isCenter ? blankClick(")
  })

  it('每一条条目都带 data-fl-item，不会被当成"点空白"', () => {
    // 六处条目元素：日卡行、周条、月历小条、象限待办行、项目详情待办行、项目详情日程行。
    const marks = VIEWS.match(/data-fl-item/g) ?? []
    expect(marks.length, '条目带标记的数量变了，请同步这个守卫').toBeGreaterThanOrEqual(6)
    for (const name of ['day-row', 'week-bar', 'month-chip', 'todo-row', 'detail-row', 'schedule-row']) {
      expect(VIEWS, `${name} 少了 data-fl-item`).toContain(`data-fl="${name}"`)
    }
    // 判定本身：只有这一种写法，加一处新的热区不必再想一遍"什么算条目"。
    expect(bodyOf(VIEWS, 'blankClick')).toContain("closest('[data-fl-item]')")
  })

  it('嵌套热区不许把预填的优先级冲掉（内层必须挡住冒泡）', () => {
    // 项目详情里象限格嵌在卡片里：不 stopPropagation 就会连着触发两次 onCompose，
    // 后一次（外层那个没有优先级的）把内层刚填好的优先级盖掉。
    expect(bodyOf(VIEWS, 'blankClick')).toContain('stopPropagation')
  })

  it('新建窗该有的东西都在：标题框、优先级小片、提交按钮、项目', () => {
    const popover = bodyOf(VIEWS, 'CreatePopover')
    for (const marker of [
      'data-fl="create-popover"',
      'data-fl="compose-title"',
      'data-fl="compose-priority"',
      'data-fl="compose-submit"',
      'data-fl="compose-project-trigger"',
      'data-fl="compose-project-filter"',
      'data-fl="compose-project-list"',
      'data-fl="compose-project-option"',
      'data-fl="compose-start-date"',
    ]) {
      expect(popover, `新建窗少了 ${marker}`).toContain(marker)
    }
    // 标题框要自动聚焦，而且**不能在 `autoFocus` 上给**：React 在提交阶段就 focus，
    // 那一刻窗还挂着 `visibility: hidden`，隐藏元素接不到焦点（实测踩过：界面上一切
    // 正常，只是光标没落进标题框）。所以聚焦要排在"已经量到尺寸"之后，并且只做一次。
    expect(popover, '标题框没有自动聚焦').toContain('titleRef.current?.focus()')
    expect(popover, '自动聚焦不能交给 autoFocus（那时窗还是隐藏的）').not.toContain('autoFocus')
    expect(popover, '聚焦必须等窗可见（spot 非空）再做').toContain('spot !== null && !focusedRef.current')
  })

  /**
   * 项目选择器。
   *
   * 用户原话："当前新建日程的时候，默认绑定的项目是某一个案件，但实际上这是不一定的，
   * 应当允许用户灵活选择当前存在的真实项目，比如下拉备选，又或者输入部分关键字后列出
   * 命中的项目。"
   *
   * 早先的实现有两条正好相反的毛病：**只有一个项目时渲染成静态文本**（看起来就是
   * "写死了一个案子"，改不了），**项目详情里点出来的窗把项目锁死**（`projectLocked`）。
   * 现在只有一条规则：**"点在哪儿"只给默认值，项目永远可改**。
   */
  it('项目永远可改：选择器无条件渲染，没有"锁死"这条分支', () => {
    const popover = bodyOf(VIEWS, 'CreatePopover')
    expect(popover, '项目选择器被条件渲染藏起来了').toContain('data-fl="compose-project-trigger"')
    // 反面证据：那两个把项目"定死"的旧写法不许回来。
    expect(popover, '又出现了"只有一个项目就显示静态文本"的分支').not.toContain('projectLocked')
    expect(popover, '又出现了"只有一个项目就显示静态文本"的分支').not.toContain(
      'compose-project-fixed',
    )
    expect(popover, '又变回了原生 <select>（长案件名在它里面认不出来）').not.toContain('<select')
  })

  it('筛选关键字**不改变写入目标**：只有 pick() 才动 draft.project', () => {
    const popover = bodyOf(VIEWS, 'CreatePopover')
    const pick = bodyOf(VIEWS, 'pick')
    expect(pick, 'pick 才是唯一改项目的地方').toContain('props.onChange({ project:')
    // 筛选框的 onChange 只动关键字与光标，绝不碰 draft —— "筛了一下没点"必须什么都不改。
    const filterBlock = popover.slice(
      popover.indexOf('data-fl="compose-project-filter"'),
      popover.indexOf('data-fl="compose-project-list"'),
    )
    expect(filterBlock.length, '找不到筛选框那一段').toBeGreaterThan(0)
    expect(filterBlock, '筛选框顺手把项目改掉了').not.toContain('props.onChange')
    expect(filterBlock, '筛选框没有走 filterProjects').not.toContain('props.onChange({ project')
  })

  it('候选列表走 filterProjects，没命中时如实说"没有匹配的项目"', () => {
    const popover = bodyOf(VIEWS, 'CreatePopover')
    expect(popover, '候选没有经过关键词筛选').toContain('filterProjects(props.projects, keyword)')
    expect(popover, '筛空了却什么都不写，用户会以为界面坏了').toContain('没有匹配的项目')
    // 列表自己限高滚动：项目一多不能把整张表单顶长。
    expect(UI.composeProjectList.maxHeight, '候选列表没有限高').toBeGreaterThan(0)
    expect(UI.composeProjectList.overflowY).toBe('auto')
  })

  it('筛选框里的回车是"选这一项"，不是"提交表单"', () => {
    const popover = bodyOf(VIEWS, 'CreatePopover')
    const handler = bodyOf(VIEWS, 'onFilterKey')
    expect(handler, '回车没有被本地处理').toContain("event.key === 'Enter'")
    expect(handler, '回车会冒泡到窗级处理器，选完项目顺手把窗提交了').toContain('stopPropagation')
    expect(handler, '方向键要能上下选（preventDefault 免得移动光标）').toContain('ArrowDown')
    expect(handler, 'Esc 只该收起候选列表，不该关掉整张窗').toContain('Escape')
    expect(popover, '筛选框没接上 onFilterKey').toContain('onKeyDown={onFilterKey}')
  })

  it('窗再长也不会把「创建」按钮顶出去：自己限高 + 中段滚动', () => {
    // maxHeight 由主体区实测高度算出来（bounds 高度减留白），展开候选列表后仍然装得下。
    expect(VIEWS, '没有把主体区高度传进 composePopover').toContain(
      'UI.composePopover(maxHeight)',
    )
    expect(VIEWS, 'maxHeight 不是按 bounds 算的').toContain(
      'props.bounds.bottom - props.bounds.top - 16',
    )
    expect(UI.composeFields.overflowY, '字段区不是滚动区，长表单会顶穿窗').toBe('auto')
    expect(UI.composeFields.minHeight, '少了 minHeight: 0，字段区会被内容顶高').toBe(0)
  })

  it('校验抄的是 host 落盘前用的那份渲染器，不是自己另写一套', () => {
    const check = bodyOf(VIEW, 'composeError')
    expect(check, 'composeError 必须调 core 的渲染器').toContain('formatTodoLine')
    expect(check, '日程那条同理').toContain('formatScheduleLine')
    // 一旦有人在这里写正则"顺手校验一下"，两边就开始漂——这条把它挡住。
    expect(check, 'composeError 里不该出现自己写的格式校验').not.toContain('.test(')
    expect(check, 'composeError 里不该出现自己写的格式校验').not.toContain('RegExp')
  })

  it('"点别处关窗"的那一次点击不许顺手再开一个窗', () => {
    // 关闭方式就是点别处：不吞掉紧跟的那次 click，用户点一下空白会"关掉明细窗、
    // 同时弹出新建窗"。
    expect(CLIENT, '关窗时没有立吞掉标记').toContain(
      'if (popoverOpenRef.current) swallowBlankRef.current = true',
    )
    expect(
      bodyOf(CLIENT, 'openCompose'),
      'openCompose 没有读那个标记',
    ).toContain('if (swallowBlankRef.current)')
  })
})

/**
 * 使用说明：**折叠式 + 按用户动作排序**。
 *
 * 用户原话："不要一股脑堆在一起，除了最基础的介绍说明之外，其他内容默认折叠，用户点击
 * 问题标题后再展开，而且要归并整理一下这些说明内容，把重要的介绍放在前面，比如「数据放在哪」
 * 这部分……还有一些内容并不重要，根本不需要专门介绍，比如「五张日卡叠成一扇，当天居中」
 * 这些事，用户一看就知道了……各个问题的顺序也要用心调整一下，比如「怎么打开这个工作台」
 * 按道理要放在前面。"
 *
 * 这里把三件事都钉住：**默认折叠**、**顺序**、**不写"一看就知道"的废话**。
 */
describe('使用说明：折叠式与排序', () => {
  const VIEWS = readFileSync(new URL('../src/views.tsx', import.meta.url), 'utf8')

  /** 抠出一个组件体（`function x(` 或 `const x = (` 两种写法都认）。 */
  const bodyOf = (source: string, name: string): string => {
    const start = Math.max(
      source.indexOf(`function ${name}(`),
      source.indexOf(`const ${name} = (`),
    )
    expect(start, `找不到 ${name}，说明结构变了，请同步这个守卫`).toBeGreaterThan(-1)
    const rest = source.slice(start + 1)
    const end = rest.search(/\n(function |export function |\/\*\*)/)
    return end < 0 ? rest : rest.slice(0, end)
  }

  /** HELP_SECTIONS 那一整块（到 `richLine` 的块注释为止）。 */
  const BLOCK = ((): string => {
    const start = VIEWS.indexOf('const HELP_SECTIONS')
    expect(start, '找不到 HELP_SECTIONS').toBeGreaterThan(-1)
    const rest = VIEWS.slice(start)
    const end = rest.indexOf('/**\n * 说明文案里的')
    return end < 0 ? rest : rest.slice(0, end)
  })()

  /** 各节标题，保持源码顺序。 */
  const TITLES = [...BLOCK.matchAll(/^\s{4}title: '([^']+)',/gm)].map((m) => m[1]!)

  it('找得到分节（守卫本身没失效）', () => {
    expect(TITLES.length, `解析到的标题：${TITLES.join(' / ')}`).toBeGreaterThanOrEqual(8)
  })

  it('顺序按用户的实际动作排：先打开工作台，再讲数据放在哪', () => {
    expect(TITLES[0]).toBe('怎么打开这个工作台')
    expect(TITLES[1], '「数据放在哪」是本项目最该先讲、用户又最难自己猜出来的一条').toBe(
      '数据放在哪：文件就是数据库',
    )
    // 先"是什么 / 怎么进"，再"怎么建"，最后才是细节与设置。
    const at = (t: string): number => TITLES.findIndex((x) => x.startsWith(t))
    expect(at('三条线索')).toBeLessThan(at('怎么新增'))
    expect(at('怎么新增')).toBeLessThan(at('日程线索'))
    expect(at('插件设置')).toBe(TITLES.length - 1)
  })

  it('归并过的两节不再单独存在（它们已并入「数据放在哪」与「三条线索」）', () => {
    expect(TITLES, '「在哪里可以勾选」已经并进「三条线索」').not.toContain('在哪里可以勾选')
    expect(TITLES, '「数据安全边界」已经并进「数据放在哪」').not.toContain('数据安全边界')
  })

  it('不写"一看就知道"的废话（用户点名删掉的那类描述）', () => {
    expect(BLOCK, '又把"五张日卡叠成一扇"这类自明的描述写回来了').not.toContain('五张日卡')
    expect(BLOCK, '又把日周月的造型当知识讲了').not.toContain('斑马底色区分列')
  })

  it('每一节都有 hint：折叠状态下它就是索引', () => {
    const titles = TITLES.length
    const hints = [...BLOCK.matchAll(/^\s{4}hint: '/gm)].length
    expect(hints, '有节缺 hint，折叠时那一行就只剩标题').toBe(titles)
  })

  it('默认全部折叠：正文只在展开时才渲染', () => {
    const view = bodyOf(VIEWS, 'HelpView')
    expect(view, '初始状态不是"一条都没展开"').toContain('useState<Record<string, boolean>>({})')
    expect(view, '正文没有按展开状态渲染').toContain('expanded[section.title] === true')
    // 反面：不许又把 lines / more 无条件铺出来。
    expect(view, '又把正文无条件铺出来了').toContain('{open ? (')
  })

  it('开场说明恒定可见，不在折叠列表里（用户要的就是"最基础的介绍"留在外面）', () => {
    const view = bodyOf(VIEWS, 'HelpView')
    const intro = view.indexOf('data-fl="help-intro"')
    const map = view.indexOf('HELP_SECTIONS.map')
    expect(intro, '找不到开场说明').toBeGreaterThan(-1)
    expect(map, '找不到分节列表').toBeGreaterThan(-1)
    expect(intro, '开场说明被塞进折叠列表里了').toBeLessThan(map)
  })

  it('标题行是可点的按钮：卡片在外层，按钮自己不画边框', () => {
    const view = bodyOf(VIEWS, 'HelpView')
    expect(view, '标题不是按钮，用户点不开').toContain('data-fl="help-toggle"')
    expect(view, '没有 aria-expanded').toContain('aria-expanded={open}')
    // 一层框就够：按钮再画一圈会读成"框里套框"。这条同时满足"用在 <button> 上的样式
    // 必须把边框说全"那条守卫（写 'none'，不是省略）。
    expect(UI.helpToggle(false, false).border).toBe('none')
    expect(UI.helpSection.border, '卡片的框在外层').toBe(`1px solid ${T.border1}`)
  })
})
