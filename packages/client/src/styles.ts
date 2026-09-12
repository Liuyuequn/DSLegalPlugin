/**
 * 工作台样式令牌与复用样式。
 *
 * ## 造型依据
 *
 * 三张参考图（日 / 周 / 月各一张，**图已于 2026-09-12 删除**：上面是真实日程数据，
 * 而本仓库是公开的；取值记在 AGENTS.md 8.2 的两张表里）实测出的共同语言：
 *
 * - **层次靠明度差，不靠描边堆叠**：页面底 `#FAFAFB`、卡片与格子 `#FFFFFF`、
 *   泳道 `#F1F1F2`。三者都是无彩中性色，唯一的饱和色留给「今天」与条目本身。
 * - **一条主色**：`#4A8CF1`。参考图里它只出现在"今天"标记、实心条与浮标上，
 *   占比不到屏幕的 4%——克制正是这套界面不显廉价的原因。
 * - **细发丝分隔**：`#E8E8E8` / `#EEEEEE`，1px，不做重边框、不做大圆角卡片墙。
 * - **字号小、层级靠字重**：正文 13px，元信息 11–12px，标题 14–15px/600。
 *
 * ## 主题适配
 *
 * 结构性颜色一律**叠在 DSH 主题的中性色上**（`rgba(0,0,0,.055)` 之类），
 * 所以浅色主题得到参考图的 `#F1F1F2`，暗色主题自动变成"比底色略深一档"，
 * 不必维护两套值。文字色直接取 `--dsw-alias-label-*`。
 * 只有主色 `#4A8CF1` 与四个优先级色是**固定值**——它们是品牌与领域语义，不随主题走。
 *
 * ## 布局要点（三条线索的骨架都靠这几条撑着）
 *
 * - 面板本身 `position: fixed` 铺满会话区、`top:0/bottom:0`，故"待办四象限等高铺满"
 *   只是 `body` 里一个 `1fr 1fr` 的 grid；
 * - 会随内容长高的容器必须显式写 `minHeight: 0`，否则 flex/grid 子项会撑破父级，
 *   测量出的"可容纳行数"就会随内容变化而自激（详见 `view.ts` 的 `rowCapacity`）；
 * - 标题截断靠 `overflow:hidden + textOverflow:ellipsis + whiteSpace:nowrap`，
 *   且**外层必须 `minWidth: 0`**，否则 flex 子项的最小内容宽度会顶住不缩。
 */

import type { Priority } from '@dslegal/core'
import type { CSSProperties } from 'react'

import type { LauncherSpot } from './shell.js'

export const T = {
  // ---- 结构面（叠在主题中性色上，自动适配明暗） ----
  /** 页面底：卡片浮在它上面。参考图实测 `#FAFAFB`。 */
  canvas: 'rgba(0, 0, 0, 0.022)',
  /** 卡片 / 格子 / 单元格：参考图实测 `#FFFFFF`。 */
  bgLayer1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  /** 凹槽：周形态的泳道、说明里的代码块。参考图实测 `#F1F1F2`。 */
  bgLayer2: 'rgba(0, 0, 0, 0.055)',
  bgBase: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  /** 更深的凹槽（悬停 / 选中）。 */
  laneStrong: 'rgba(0, 0, 0, 0.085)',
  /**
   * 发丝线。
   *
   * 取 DSH 的 `border-l2`（浅色 10% / 暗色 12%）。参考图的格线实测是 `#E8E8E8`，
   * 即 9% 黑；l2 既够深，又仍随主题自适应。
   *
   * **月历的内部分隔线不用这一档**，用下面的 `hairline`（l1）——见那里的说明。
   */
  border1: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))',
  /**
   * 格线：比 `border1` 再浅一档，取 DSH 的 `border-l1`（浅色 4%）。
   *
   * 专门给月历的**内部分隔线**用。月历格子密到 7×5，用 10% 会让整块格子看起来被描了边。
   * 实测像素：10% 黑渲染成 `#e6e6e6`，4% 黑渲染成 `#f4f4f4`。用户原话是
   * "月视角全局都改用更细更浅的灰色线条划分日期即可"。
   */
  hairline: 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))',
  /** 强调线（悬停 / 选中），比发丝线明显一档。 */
  border2: 'rgba(0, 0, 0, 0.20)',

  // ---- 文字 ----
  labelPrimary: 'var(--dsw-alias-label-primary, #232323)',
  labelSecondary: 'var(--dsw-alias-label-secondary, #55555c)',
  labelTertiary: 'var(--dsw-alias-label-tertiary, #8a8a92)',
  labelCaption: 'var(--dsw-alias-label-caption, #9d9da1)',

  // ---- 交互 ----
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
  active: 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.09))',
  buttonGhostFill: 'rgba(0, 0, 0, 0.04)',
  buttonGhostBorder: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14))',
  buttonBarFill: 'transparent',
  buttonBarHover: 'rgba(0, 0, 0, 0.06)',

  // ---- 品牌与状态（固定值：品牌/领域语义，不随主题走） ----
  /** 主色：参考图实测 `#4A8CF1`。 */
  brand: '#4A8CF1',
  brandHover: '#3B7DE0',
  /** 主色的浅底 / 描边，用于"今天"与选中态。 */
  brandSoft: 'rgba(74, 140, 241, 0.10)',
  brandLine: 'rgba(74, 140, 241, 0.34)',
  /** 次强调色：参考图实测 `#7E7BEA`。 */
  violet: '#7E7BEA',
  /**
   * 未设优先级条目的颜色。
   *
   * 不能拿主色当兜底：主色在这个界面里专表"今天"，一条没有优先级的日程染成主色，
   * 用户会把它读成"今天"，而且完全读不出紧急度（实测踩过）。用中性石板灰，
   * 与四个优先级色都拉得开。
   */
  unset: '#6B7280',
  /**
   * 法定节假日「休」。
   *
   * 不复用任何一个优先级色（尤其不复用"重要且紧急"的赤）：同一个格子里既有条目的
   * 优先级色、又有这个标记，两者同色会被读成同一件事。
   */
  rest: '#D64545',
  buttonPrimary: '#4A8CF1',
  buttonPrimaryHover: '#3B7DE0',
  error: 'var(--dsw-alias-state-error-primary, #E53E3E)',
  warn: 'var(--dsw-alias-state-warn-primary, #B45309)',
  success: 'var(--dsw-alias-state-success-primary, #15803D)',

  font: 'var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif)',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',

  // ---- 阴影：参考图是"大范围、低透明度"的柔和投影，不是硬描边 ----
  shadowCard: '0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 18px rgba(15, 23, 42, 0.06)',
  shadowLift: '0 2px 6px rgba(15, 23, 42, 0.07), 0 14px 34px rgba(15, 23, 42, 0.10)',
  shadowFan: '0 2px 8px rgba(15, 23, 42, 0.05), 0 18px 44px rgba(15, 23, 42, 0.11)',
  shadowPanel: 'var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.24))',
} as const

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

/**
 * 字号：**一律取自 DSH 自己的字体刻度**，不再自造 11/13/15/19 这类数字。
 *
 * DSH 主题暴露了一整套 `--dsw-font-*` 变量（`xxxs-11` / `xxs-12` / `xs-13` /
 * `s-14` / `base-16` / `l-20` / `xl-24`），其中 `base-16` 就是 DSH 正文那一档，
 * `body` 用的也是它。插件只要用同一套刻度，字号就与宿主天然一致：宿主将来调整
 * 刻度，插件跟着走，不必回来改数字。
 *
 * 本插件的刻度只保留四档，跨度尽量小（16 / 14 / 12 / 20），并**以 16 为默认**
 * （见 `panel()` 的 `fontSize`）——没有显式声明字号的地方，拿到的就是 DSH 正文大小。
 */
export const FS = {
  /** = DSH 正文（`--dsw-font-base-16`）。面板的默认字号就是它。 */
  base: 'var(--dsw-font-base-16-font-size, 16px)',
  /** 次要信息（元信息行、提示、副标题）。 */
  secondary: 'var(--dsw-font-s-14-font-size, 14px)',
  /** 极小的徽标与条内文字（标签、月历小条、计数药丸）。 */
  caption: 'var(--dsw-font-xxs-12-font-size, 12px)',
  /** 周历日号这一档（`--dsw-font-l-20`）。 */
  large: 'var(--dsw-font-l-20-font-size, 20px)',
} as const

/**
 * 固定尺寸常量。
 *
 * 这几个数字不只是"好看"：**"当前界面能容纳几条"是把像素除以它们算出来的**，
 * 样式里改了高度却忘了改这里，裁剪就会露出半行（见 `view.ts` 的 `rowCapacity`）。
 *
 * 数值随字号一起调：正文从 13px 提到 DSH 的 16px（行高 24px）之后，26px 的待办行
 * 只剩 2px 余量，会挤；故行高一并提到 30px。
 */
export const TODO_ROW_HEIGHT = 30
/** 周形态：实心条高度（条内是 12px 小字，30px 够用）。 */
export const WEEK_BAR_HEIGHT = 30
/** 周形态：相邻实心条的间隙。 */
export const WEEK_BAR_GAP = 4
/** 月形态：格子里一条小条的高度与间隙。 */
export const MONTH_CHIP_HEIGHT = 22
export const MONTH_CHIP_GAP = 4
/** 月形态：日期数字区（数字 + 副标题）占用的高度。 */
export const MONTH_HEAD_ZONE = 32

export const FONT = {
  /** 面板标题 / 区块标题。 */
  panelTitle: { fontSize: FS.base, fontWeight: 600 },
  /** 数字型标题（周历日号）：等宽数字，列间才对得齐。 */
  display: { fontSize: FS.large, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  /** 条目标题：与正文同档，只靠字重区分。 */
  itemTitle: { fontSize: FS.base, fontWeight: 500 },
  body: { fontSize: FS.base, fontWeight: 400 },
  secondary: { fontSize: FS.secondary, fontWeight: 400 },
  caption: { fontSize: FS.caption, fontWeight: 400 },
  /** 条内文字：实心条上的白字，比正文小一档半。 */
  chip: { fontSize: FS.caption, fontWeight: 500 },
} as const satisfies Record<string, CSSProperties>

/** 数字一律等宽，否则周历 / 月历的列宽会随数字跳动。 */
export const TABULAR: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

const TRANSITION = 'background-color 120ms ease, border-color 120ms ease, color 120ms ease'

/** `#RRGGBB` → `rgba(r, g, b, alpha)`。 */
export function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  return `rgba(${Number.parseInt(full.slice(0, 2), 16)}, ${Number.parseInt(
    full.slice(2, 4),
    16,
  )}, ${Number.parseInt(full.slice(4, 6), 16)}, ${alpha})`
}

/** 相对亮度（sRGB，WCAG 口径）。 */
function luminance(hex: string): number {
  const raw = hex.replace('#', '')
  const channel = (offset: number): number => {
    const value = Number.parseInt(raw.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** 对比度（WCAG 相对亮度口径）。 */
function contrast(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 实心条上的文字色：按**对比度**择优，不按亮度拍阈值。
 *
 * 四个优先级色横跨黄绿到赤红，一律白字会让「重要不紧急」的对比度掉到 1.3:1、
 * 「紧急不重要」掉到 2.6:1，都读不了。比"大于某个亮度就换色"更可靠的写法是
 * 直接把白字的对比度和深字的对比度都算出来取大的那个——阈值由公式决定，
 * 不会因为换了优先级色而失准（实测：拍阈值 0.42 就会让橙色条留住白字）。
 */
export function onColor(hex: string): string {
  const ink = '#2A2600'
  const lum = luminance(hex)
  return contrast(lum, 1) >= contrast(lum, luminance(ink)) ? '#FFFFFF' : ink
}

// ---------------------------------------------------------------------------
// 面板骨架
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 层叠顺序
// ---------------------------------------------------------------------------

/**
 * 面板、遮罩、启动按钮的 z-index。
 *
 * 三者**必须成套改**，所以放在一起并写成常量：
 *
 * - `LAUNCHER_Z` **必须大于** `PANEL_Z`。侧边栏折叠后（实查 `280px → 56px`）会话区
 *   左侧只剩几十像素，启动按钮放不进那条带子，只能浮在面板之上；两者同为 60 时
 *   `aside` 因为在 DOM 里更靠后而胜出，**按钮被面板盖住、点不到**（实测踩过）。
 * - `BACKDROP_Z` 小于 `PANEL_Z`：遮罩只压住会话区，面板压在遮罩上。
 *
 * **防复发守卫**：`packages/client/test/shell.test.ts` 的「启动按钮恒在面板之上」。
 */
export const BACKDROP_Z = 55
export const PANEL_Z = 60
export const LAUNCHER_Z = 61

// ---------------------------------------------------------------------------

/**
 * 工作台启动按钮：**常驻**（面板打开时也不隐藏），点击即开合，`active` 为真时用实心
 * 主色表示"工作台已展开"，用户不必去找关闭按钮。
 *
 * **位置由 `shell.ts` 的 `launcherSpot()` 算好后传进来**，样式层不再自己推导：
 * "贴在哪儿"是几何问题（要跟侧边栏、设置按钮、面板边界一起算），不是外观问题。
 *
 * **`zIndex` 必须高于面板**（见 `LAUNCHER_Z`）：侧边栏折叠后会话区左侧只剩几十像素，
 * 按钮放不进那条带子，只能浮在面板之上；同层的话 `aside` 在 DOM 里更靠后，会把按钮
 * 盖掉（实测踩过——`elementFromPoint` 命中的是 `aside`）。
 *
 * `touchAction: none` 与 `userSelect: none` 是为拖动服务：前者避免触摸设备把按住拖动
 * 当成滚动，后者避免拖动时把"法程"两个字选中。
 */
export function launcher(spot: LauncherSpot, active = false, hovered = false): CSSProperties {
  return {
    position: 'fixed',
    left: spot.left,
    bottom: spot.bottom,
    padding: `${S.sm}px ${S.lg}px`,
    borderRadius: 999,
    border: 'none',
    background: active ? T.brand : hovered ? '#1F2937' : '#2B3440',
    color: '#ffffff',
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: 600,
    letterSpacing: '0.04em',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
    boxShadow: active
      ? `0 2px 8px ${withAlpha(T.brand, 0.4)}, 0 10px 24px rgba(15, 23, 42, 0.24)`
      : '0 2px 8px rgba(15, 23, 42, 0.22), 0 10px 24px rgba(15, 23, 42, 0.18)',
    transition: TRANSITION,
    zIndex: LAUNCHER_Z,
  }
}

/** 遮罩只盖住会话区，侧边栏保持原样可见可用。 */
export function backdrop(left: number, right: number): CSSProperties {
  return {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left,
    right,
    background: 'rgba(24, 28, 36, 0.28)',
    zIndex: BACKDROP_Z,
  }
}

/**
 * 工作台面板：**铺满会话区**（左边界 = 侧边栏宽度，右边界 = 详情栏宽度），
 * 只留出左侧的会话纵向菜单栏。
 *
 * 底色用 `canvas`（比卡片暗一档）而不是纯白——参考图里所有白色卡片都浮在
 * `#FAFAFB` 上，没有这一档明度差，卡片就只剩描边可依靠，界面立刻变"表格"。
 */
export function panel(left: number, right: number): CSSProperties {
  return {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left,
    right,
    display: 'flex',
    flexDirection: 'column',
    background: T.bgLayer1,
    boxShadow: T.shadowPanel,
    fontFamily: T.font,
    // 默认字号 = DSH 正文那一档；插件里没有单独声明字号的地方就是它。
    fontSize: FS.base,
    color: T.labelPrimary,
    zIndex: PANEL_Z,
    overflow: 'hidden',
  }
}

export const topBar: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: S.sm,
  // 面板没有全局 box-sizing 重置，声明值必须自己包住 padding 与边框，
  // 否则 minHeight 50 + 8px 上下内边距 + 1px 下边框会render 成 67px。
  boxSizing: 'border-box',
  minHeight: 50,
  padding: `${S.sm}px ${S.lg}px`,
  background: T.bgLayer1,
  borderBottom: `1px solid ${T.border1}`,
}

/** 线索切换（日程 / 待办 / 项目）——三条并列且互斥，选中项即当前线索。 */
export function tab(active: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    padding: `5px ${S.lg}px`,
    borderRadius: 8,
    border: 'none',
    background: active ? T.brandSoft : hovered ? T.hover : 'transparent',
    color: active ? T.brand : T.labelSecondary,
    fontFamily: T.font,
    fontSize: FS.base,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 次级切换（日程的日 / 星期 / 月），比线索切换轻一档。 */
export function chip(active: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    padding: `3px ${S.md}px`,
    borderRadius: 6,
    border: 'none',
    background: active ? T.laneStrong : hovered ? T.hover : 'transparent',
    color: active ? T.labelPrimary : T.labelTertiary,
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/**
 * 首行菜单右侧那三个入口（使用说明 / 插件设置 / 数据刷新）**共用 `textButton`**。
 *
 * 早先「使用说明」单独做成带描边的主色按钮，为的是"显眼、别被当成图标漏掉"；
 * 但三个同级动作里只把其中一个画成按钮，反而让人以为另外两个不可点。
 * 现在一律用同一个样式，靠**文字**被认出来（一直写着四个字，不是图标）。
 */

/** 方形图标按钮（翻页 ‹ ›、关闭 ×）。 */
export function iconButton(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    border: 'none',
    background: hovered ? T.laneStrong : 'transparent',
    color: T.labelSecondary,
    fontFamily: T.font,
    fontSize: FS.base,
    lineHeight: 1,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 朴素文字按钮（数据目录 / 刷新）。 */
export function textButton(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    padding: `5px ${S.md}px`,
    borderRadius: 7,
    border: 'none',
    background: hovered ? T.laneStrong : 'transparent',
    color: T.labelSecondary,
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: 500,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/**
 * 翻页组：把 `‹ 焦点日期 ›` 包成一个整体。
 *
 * 三个裸按钮并排时，中间的日期看着像标签而不是控件的一部分（默认没有底色，悬停才
 * 出现，而用户不会去悬停一个他不认为是按钮的东西）。给这一组一个凹槽底，
 * 左右箭头与日期就是同一件控件的三段。
 */
export const navGroup: CSSProperties = {
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 9,
  background: T.bgLayer2,
}

/** 翻页组里的箭头：底色交给组，自己只在悬停时提亮。 */
export function navStep(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    minWidth: 26,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `0 ${S.sm}px`,
    borderRadius: 7,
    border: 'none',
    background: hovered ? T.bgLayer1 : 'transparent',
    color: T.labelSecondary,
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: 500,
    lineHeight: 1,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 翻页组中央的焦点日期：三种形态下都停在同一位置、同一字号。 */
export const navDate: CSSProperties = {
  flex: '0 0 auto',
  padding: `0 ${S.sm}px`,
  fontSize: FS.base,
  fontWeight: 600,
  color: T.labelPrimary,
  whiteSpace: 'nowrap',
  ...TABULAR,
}

/**
 * 日程线索的第二行：**三区网格**（形态切换 | 焦点日期 | 统计与「今天」）。
 *
 * 用 `1fr auto 1fr` 而不是 flex：flex 里的"居中"要靠两侧等宽，而左边三个形态按钮与
 * 右边统计的宽度天然不等，日期就会被推得偏左。网格的 `auto` 中列永远落在真正的正中，
 * 与两侧内容多宽无关。
 */
export const scheduleHead: CSSProperties = {
  flex: '0 0 auto',
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  gap: S.md,
  padding: `${S.sm}px ${S.lg}px`,
  background: T.bgLayer1,
  borderBottom: `1px solid ${T.border1}`,
}

export const scheduleHeadLeft: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
  justifySelf: 'start',
}

export const scheduleHeadRight: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: S.sm,
  minWidth: 0,
  justifySelf: 'end',
}

/**
 * 「今天」：固定在这一行的**最右端**，不再和翻页箭头挤在左侧。
 *
 * 它现在独自承担"跳回今天"，所以给一个常驻的浅底（而不是只靠悬停）——默认看起来像
 * 纯文本的东西，用户不会去点它。
 */
export function todayButton(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    padding: `5px ${S.md}px`,
    borderRadius: 8,
    border: 'none',
    background: hovered ? T.laneStrong : T.bgLayer2,
    color: T.labelSecondary,
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: 600,
    lineHeight: 1.4,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/**
 * 主体区。
 *
 * `scroll` 为假时**整屏不滚动**：待办线索要求四个象限等面积铺满可视区，一旦父级能
 * 滚动，子项的"能容纳多少条"就不再等于"当前界面能容纳多少条"。
 *
 * **`position: relative` + `zIndex: 0` 是必需的，不是装饰**：这两条让主体区成为一个
 * **层叠上下文**，把线索里的内容全部关在里面。日形态的卡片用 `zIndex: 8–10` 叠出
 * 前后关系；若主体区不隔离，那些卡片就直接参与面板那一层的比较，压过盖在其上的
 * 「使用说明」（`zIndex: 2`）——症状正是"点开说明，日视图浮在说明上方"（实测踩过）。
 * 隔离之后，线索内部用多大的 z-index 都越不出主体区，说明层永远在最上面。
 */
export function body(scroll: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: T.canvas,
    position: 'relative',
    zIndex: 0,
    overflowY: scroll ? 'auto' : 'hidden',
    overflowX: 'hidden',
  }
}

/** 顶部横幅（外部变更 / 写入失败 / 接口版本过旧）。 */
export function banner(kind: 'info' | 'warn'): CSSProperties {
  const color = kind === 'warn' ? T.warn : T.brand
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: S.sm,
    padding: `${S.sm}px ${S.lg}px`,
    borderBottom: `1px solid ${kind === 'warn' ? withAlpha('#B45309', 0.28) : T.brandLine}`,
    background: withAlpha(kind === 'warn' ? '#B45309' : T.brand, 0.07),
    color,
    fontFamily: T.font,
    ...FONT.secondary,
  }
}

// ---------------------------------------------------------------------------
// 区块与条目
// ---------------------------------------------------------------------------

/**
 * 线索头部：左标题、右统计。
 *
 * 参考图的头部是**一列无边框信息**（标题 + 计数 + 控件同处一行），做成白底 + 发丝线
 * 分隔即可，不做有阴影的工具条——那条会很重。
 */
export const lensHead: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: S.sm,
  flexWrap: 'wrap',
  padding: `${S.md}px ${S.lg}px`,
  background: T.bgLayer1,
  borderBottom: `1px solid ${T.border1}`,
}

export const sectionHead: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: S.sm,
  flexWrap: 'wrap',
  marginBottom: S.sm,
}

export const sectionTitle: CSSProperties = {
  ...FONT.panelTitle,
  color: T.labelPrimary,
}

export const sectionHint: CSSProperties = {
  ...FONT.secondary,
  color: T.labelTertiary,
}

/** 一块白色面板（卡片 / 象限 / 说明页分区）。 */
export function card(gap: number = S.sm): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    gap,
    borderRadius: 10,
    border: `1px solid ${T.border1}`,
    background: T.bgLayer1,
  }
}

/**
 * 竖排列表容器（日程、项目详情等可滚动的长列表）。 */
export function listColumn(scroll = true): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflowY: scroll ? 'auto' : 'hidden',
  }
}

/**
 * 「项目详情」里的区块卡片。
 *
 * **必须有 `flex: '0 0 auto'`**，不能直接用 {@link card}。原因是两者要一起看：
 *
 * - `card()` 带 `minHeight: 0`（那是给"卡片本身是定高布局里的 flex 子项、允许被压缩"
 *   的场景用的），而 `minHeight: 0` **同时取消了 flex 子项默认的
 *   `min-height: auto` 保护**——即"不许缩到比内容还矮"这条保护没了；
 * - 项目详情的容器是 {@link listColumn}，一个 `overflow-y: auto` 的 flex 列。
 *
 * 两条合起来：**卡片会被压扁到容器高度，内容从卡片底部溢出去**，而后面那张卡片
 * 紧接着压在上面 → 视觉上就是"日程安排浮在界面上、盖住'不重要不紧急'那一组待办"
 * （实测踩过，用户报的就是这个）。给 `flex: '0 0 auto'` 让卡片撑到自然高度，
 * 溢出交给容器滚动。
 *
 * 代价是这些区块**必须自己长长**，所以卡内不能再用 `1fr` 之类的按高度分配——
 * 需要等面积四象限的场景请用 {@link quadrantGrid}（那里容器是定高的，不滚动）。
 */
export function detailCard(): CSSProperties {
  return { ...card(), flex: '0 0 auto' }
}

export const itemBody: CSSProperties = {
  flex: '1 1 auto',
  // 标题省略号的前提：flex 子项默认 min-width:auto，会被内容顶住不缩。
  minWidth: 0,
}

/**
 * 已完成条目的置灰方式（用户明确要求：已完成要展示、要划线置灰，
 * 且一律排在所有未完成之后——排序在 `view.ts` 的 `rankTodos`）。
 */
export const DONE_DECORATION: CSSProperties = {
  textDecoration: 'line-through',
  textDecorationThickness: '1px',
}

export function itemTitle(done: boolean): CSSProperties {
  return {
    ...FONT.itemTitle,
    color: done ? T.labelTertiary : T.labelPrimary,
    wordBreak: 'break-word',
    ...(done ? DONE_DECORATION : null),
  }
}

/** 单行标题：过长自动省略后续文字（完整内容由所在行的 `title` 悬浮提示补足）。 */
export function ellipsisTitle(done: boolean): CSSProperties {
  return {
    ...FONT.itemTitle,
    color: done ? T.labelTertiary : T.labelPrimary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    ...(done ? DONE_DECORATION : null),
  }
}

export const itemMeta: CSSProperties = {
  ...FONT.caption,
  color: T.labelTertiary,
  marginTop: 2,
  wordBreak: 'break-word',
}

/**
 * 单行元信息：固定高度的行里**必须**用它，不能用会换行的 `itemMeta`。
 *
 * 完整内容由所在行的 `title` 悬浮提示补足。
 */
export const itemMetaOneLine: CSSProperties = {
  ...FONT.caption,
  color: T.labelTertiary,
  marginTop: 2,
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
}

/** 标签（项目徽章 / 类别 / 进行中）。 */
export function tag(color: string): CSSProperties {
  const neutral = color === T.border2
  const ink = neutral ? T.labelSecondary : color
  return {
    flex: '0 0 auto',
    display: 'inline-block',
    padding: '0 5px',
    borderRadius: 4,
    background: neutral ? T.bgLayer2 : withAlpha(color, 0.12),
    color: ink,
    fontFamily: 'inherit',
    fontSize: FS.caption,
    fontWeight: 500,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
  }
}

/** 真实复选框：四象限与日形态都用它（原生控件，键盘与读屏都免费拿到）。 */
export function checkbox(accent: string = T.brand): CSSProperties {
  return {
    flex: '0 0 auto',
    margin: 0,
    width: 14,
    height: 14,
    cursor: 'pointer',
    accentColor: accent,
  }
}

// ---------------------------------------------------------------------------
// 线索一：日程 —— 日形态（重叠卡片扇）
// ---------------------------------------------------------------------------

/** 卡片扇的几何：卡片宽度、相邻卡片的水平错位量。 */
export interface FanMetrics {
  readonly cardWidth: number
  readonly step: number
}

/**
 * 重叠卡片扇的几何。
 *
 * 参考图里当天那张卡最大、居中压在其余卡片上，左右各露出一条边。桌面面板宽度会变，
 * 故按容器宽度算：卡片占约六成宽（夹在 240–440 之间），错位量取剩余空间的一半
 * （夹在 30–62 之间），正好让 ±2 共五张卡铺满而不溢出。
 */
export function fanMetrics(containerWidth: number): FanMetrics {
  const usable = Math.max(0, containerWidth - S.lg * 2)
  const cardWidth = Math.max(240, Math.min(usable * 0.6, 440))
  const step = Math.max(28, Math.min((usable - cardWidth) / 4, 62))
  return { cardWidth, step }
}

export function fanStage(): CSSProperties {
  return {
    position: 'relative',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden',
  }
}

/**
 * 一张日卡。
 *
 * `depth` = 距中心多少张（0 = 当天）。中心卡最高、最满不透明；两侧依次下沉、变淡——
 * 参考图的纵深感就是这么来的，**不用旋转、不用模糊**。变淡要足够明显（0.82 / 0.5），
 * 否则五张白卡挤在一起就是一片白，读不出前后。
 */
export function fanCard(
  depth: number,
  x: number,
  y: number,
  width: number,
  today: boolean,
): CSSProperties {
  const abs = Math.abs(depth)
  return {
    position: 'absolute',
    top: y,
    bottom: 0,
    left: x,
    width,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 14,
    border: `1px solid ${today && abs === 0 ? T.brandLine : T.border1}`,
    background: T.bgLayer1,
    boxShadow: abs === 0 ? T.shadowFan : T.shadowCard,
    opacity: abs === 0 ? 1 : abs === 1 ? 0.82 : 0.5,
    overflow: 'hidden',
    transition: 'left 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 220ms ease',
  }
}

/**
 * 日卡头部：日期 + 星期（今天带「今」圆标）。
 *
 * `hovered` 时底色变一档并点亮右侧那个 `＋`：**这一行是"在那天新建一条日程"的热区**
 * （用户指定的两个例子之一就是它——「09/12 今天」这个区域）。两侧的卡也吃这套样式，
 * 但它们整张卡本来就是"点它即居中"的可点元素，底色变化在这一侧读起来同样通顺。
 */
export function fanHead(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: S.sm,
    boxSizing: 'border-box',
    height: 58,
    padding: `0 ${S.md}px`,
    borderBottom: `1px solid ${T.border1}`,
    background: hovered ? T.hover : 'transparent',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/**
 * 日卡头部的文字块：**竖排两行**。
 *
 * 参考图的卡头是「09/10 周四」一行；但扇子里两侧的卡只露出 62px 宽的一条边，
 * 单行横排的日期会被拦腰截断成半个字。改成竖排后，露出的那一条正好装下 `09/10`，
 * 日期始终可读——这是重叠扇布局下唯一能让邻居卡"有信息量"的排法。
 */
export function fanHeadText(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    // 两侧的卡只露出 62px，日期必须能被裁掉而不是把卡片撑宽。
    overflow: 'hidden',
  }
}

/** 「今」圆标：参考图里卡片区唯一的饱和色块，26px 实心圆。 */
export const todayBadge: CSSProperties = {
  flex: '0 0 auto',
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 999,
  background: T.brand,
  color: '#ffffff',
  fontSize: FS.caption,
  fontWeight: 600,
  lineHeight: 1,
}

export function fanDateText(today: boolean): CSSProperties {
  return {
    fontSize: FS.base,
    fontWeight: 600,
    color: today ? T.labelPrimary : T.labelSecondary,
    ...TABULAR,
    whiteSpace: 'nowrap',
  }
}

export function fanHeadSub(today: boolean): CSSProperties {
  return {
    ...FONT.caption,
    color: today ? T.brand : T.labelCaption,
    whiteSpace: 'nowrap',
  }
}

/** 卡片右上角的条数：小药丸，两侧的卡被遮住后只会露出它，所以要有形状。 */
export function fanCount(today: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    padding: '0 6px',
    borderRadius: 999,
    background: today ? T.brandSoft : T.bgLayer2,
    color: today ? T.brand : T.labelTertiary,
    fontSize: FS.caption,
    fontWeight: 600,
    lineHeight: '20px',
    ...TABULAR,
  }
}

export const fanBody: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: `${S.sm}px ${S.sm}px ${S.md}px`,
  // 卡片里的空白（含空态的「暂无事项」）是"在那天新建一条日程"的热区。
  // 条目行自己写了 `cursor: default`，所以指针移到条目上不会误以为是可点的。
  cursor: 'pointer',
}

/** 日形态的一条日程：**固定行高**，卡片内的节奏才不会随标题长短晃动。 */
/**
 * 日形态的一条日程：标题（一行，省略号）+ 元信息（一行，省略号）。
 *
 * **不写死高度**。写死 56px 的时候，元信息一旦换行成两行，两行加起来正好等于
 * 内容区高度——等于"差 1px 就顶穿"，而换行取决于字体回退的度量，不取决于我写了
 * 什么。固定高度的行里放会换行的文本就是这类隐患的根源，所以这里两头都改：
 * 元信息强制单行省略（见 `itemMetaOneLine`），行高由内容自然决定（各行仍然等高，
 * 因为每行都是"一个标题行 + 一个元信息行"）。
 */
export function dayRow(hovered: boolean, done: boolean, ongoing: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'flex-start',
    gap: S.sm,
    padding: `8px ${S.sm}px`,
    borderRadius: 8,
    // 进行中用一条主色左标，不做整行淡蓝底——那会和"今天"的强调打架。
    boxShadow: ongoing ? `inset 3px 0 0 ${T.brand}` : 'none',
    background: hovered ? T.hover : 'transparent',
    opacity: done ? 0.6 : 1,
    // `cursor` 是继承属性：卡片内容区整块是"点空白新建"的热区（手型），
    // 条目行必须自己收回默认指针，否则"指着一行"和"指着一片空白"看起来是一回事。
    cursor: 'default',
    transition: TRANSITION,
  }
}

/** 条目的时间列。 */
export const timeCell: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 62,
  ...FONT.caption,
  color: T.labelSecondary,
  ...TABULAR,
  paddingTop: 2,
}

// ---------------------------------------------------------------------------
// 线索一：日程 —— 周形态（斑马泳道 + 实心条）
// ---------------------------------------------------------------------------

/** 七日泳道的容器：列宽恒等，靠斑马底色分区，不画竖线。 */
export const weekGrid: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  background: T.bgLayer1,
  // 只画下边：上边紧接 `lensHead` 的 borderBottom，两条叠起来就是一条 2px 灰线。
  borderBottom: `1px solid ${T.border1}`,
}

/** 一列（含日头与泳道）。`zebra` 为真时整列铺一层凹槽色——这就是参考图的分区方式。 */
export function weekColumn(today: boolean, zebra: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    borderLeft: `1px solid ${T.border1}`,
    background: zebra ? T.bgLayer2 : 'transparent',
    boxShadow: today ? `inset 0 2px 0 ${T.brand}` : 'none',
  }
}

/** 日头：日号 + 星期，今天整条用主色。**整条是"在那天新建"的热区**。 */
export function weekHead(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    boxSizing: 'border-box',
    height: 46,
    padding: `0 ${S.md}px`,
    borderBottom: `1px solid ${T.border1}`,
    background: hovered ? T.hover : 'transparent',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

export function weekHeadNum(today: boolean): CSSProperties {
  return {
    ...FONT.display,
    color: today ? T.brand : T.labelPrimary,
  }
}

export function weekHeadDay(today: boolean): CSSProperties {
  return {
    fontSize: FS.secondary,
    fontWeight: 400,
    color: today ? T.brand : T.labelTertiary,
    whiteSpace: 'nowrap',
  }
}

/** 列头的条数药丸：裸数字会被读成渲染噪点，给个形状才认得出是计数。 */
export function weekHeadCount(today: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    alignSelf: 'center',
    padding: '0 5px',
    borderRadius: 999,
    // 斑马列（#F1F1F1）上 6% 的黑底几乎看不出形状，给到 9% 才在两种底色上都成形。
    background: today ? T.brandSoft : 'rgba(0, 0, 0, 0.09)',
    color: today ? T.brand : T.labelSecondary,
    fontSize: FS.caption,
    fontWeight: 600,
    lineHeight: '20px',
    ...TABULAR,
  }
}

export const weekLane: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: WEEK_BAR_GAP,
  padding: `${S.sm}px 6px`,
  overflow: 'hidden',
  // 条下方的空白 = "在那天新建一条日程"。条自己有手型，语义不冲突。
  cursor: 'pointer',
}

/**
 * 周形态的一条日程：**实心色条**。
 *
 * 参考图里条目不是描边事件块，而是实心彩条 + 白字 + 省略号——这是它"密而不乱"的关键。
 * 颜色即优先级（`PRIORITY_COLORS`），文字色按亮度择白或择深（见 `onColor`）；
 * 已完成退成浅底 + 置灰划线，既满足"已完成也要看得见"，又不跟未完成抢注意力。
 */
export function weekBar(color: string, done: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    height: WEEK_BAR_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    width: '100%',
    minWidth: 0,
    padding: `0 ${S.sm}px`,
    borderRadius: 6,
    border: 'none',
    background: done ? withAlpha(color, 0.16) : color,
    color: done ? T.labelTertiary : onColor(color),
    fontFamily: 'inherit',
    // 显式写死字号：`<button>` 有 UA 默认的 13.33px，不写死就会漏下来。
    fontSize: FS.caption,
    fontWeight: 500,
    textAlign: 'left',
    cursor: 'pointer',
    filter: hovered ? 'brightness(0.96)' : 'none',
    transition: TRANSITION,
  }
}

/**
 * 条内的完成标记：未完成是空心圆（参考图条目左侧那个 ○），已完成是勾。
 *
 * 描边用 `currentColor`，于是它会跟着条内文字色走——黄条上是深色圈、红条上是白圈，
 * 不必为四个优先级各写一套。
 */
export function barMark(done: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 11,
    height: 11,
    borderRadius: 999,
    border: done ? 'none' : '1.5px solid currentColor',
    opacity: 0.78,
    color: 'inherit',
    fontSize: FS.caption,
    lineHeight: '11px',
    textAlign: 'center',
  }
}

export const barText: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: FS.caption,
  fontWeight: 500,
}

/**
 * 条内右端的时间。
 *
 * 周形态没有时间轴（参考图也没有），于是"这条是几点"在整屏上完全不可见——而
 * 日程的价值一半在时间。把 `HH:MM` 压在条的右端，用略淡的同色字，既不抢标题，
 * 又让一列扫下来就能排出先后（参考图的月历小条也是"标题 + 时间"的写法）。
 */
export const barTime: CSSProperties = {
  flex: '0 0 auto',
  fontSize: FS.caption,
  fontWeight: 500,
  opacity: 0.8,
  ...TABULAR,
}

// ---------------------------------------------------------------------------
// 线索一：日程 —— 月形态（发丝格 + 小条）
// ---------------------------------------------------------------------------

export const monthWrap: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: `0 ${S.lg}px ${S.lg}px`,
}

/** 星期表头：七个等宽格，居中。**与下面的网格同宽同列**，否则表头会和列错位。 */
export const monthWeekHead: CSSProperties = {
  flex: '0 0 auto',
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  padding: `0 0 ${S.xs}px`,
}

export const weekday: CSSProperties = {
  textAlign: 'center',
  ...FONT.caption,
  fontWeight: 500,
  color: T.labelTertiary,
}

/**
 * 月历网格：`rows × 7`，只有**内部分隔线**，外面不描边。
 *
 * 外框一旦描边，加上"本月之外的格子降透明度"，本月那一块就看起来被圈了起来
 * （用户原话："当前月份实际包含的日期全部用黑色边框标注起来了，很丑，这没有必要"）。
 * 所以外层既没有 `border` 也不设底色，格子自己画右、下两条 4% 的格线；最后一列 /
 * 最后一行不画，网格外沿就不会多出一条边——**每条缝只画一遍**，不会叠成 2px。
 */
export function monthGrid(rows: number): CSSProperties {
  return {
    flex: '1 1 auto',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
    border: 'none',
    background: T.bgLayer1,
    borderRadius: 10,
    overflow: 'hidden',
  }
}

export interface MonthCellOptions {
  /** 是否为当前焦点日（画一圈主色内阴影）。 */
  selected: boolean
  hovered: boolean
  today: boolean
  /** 是否网格的最后一列——不画右边线。 */
  lastCol: boolean
  /** 是否网格的最后一行——不画下边线。 */
  lastRow: boolean
}

/**
 * 一个日期格。
 *
 * **格子本身不是 `<button>`**——它没有 UA 边框、也不参与"按钮"的语义；它可以点，
 * 但点下去做的是**在格子里那块空白上新建一条日程**（`onClick` 挂在 `<div>` 上）。
 * 这一点与"点某一条日程"是两个不同的动作，所以格内小条仍是独立的 `<button>`，
 * 并且带 `data-fl-item` 标记，让格子的点击处理器知道"这次点的是条目、不是我"。
 *
 * 悬停底色留着：它既是"我现在指着哪一格"的扫描辅助，也正好是"点这里新建"的反馈。
 * 手型指针由 `cursor` 给出——`monthCell` 曾经两者都没有（那时候点空白确实什么都不做）。
 *
 * 刻意**不整格降透明度**来表示"本月之外"：那会把格线一起淡化，反而让本月的格线
 * 相对突出成一圈边框。"本月之外"改由文字颜色与条目条的透明度表达（见
 * `monthDayNum` / `monthDayAlmanac` / `monthChips`）。
 *
 * 四条边仍然全部显式写出来。它现在是 `<div>`（没有 UA 边框），但留着的理由是：
 * 万一以后又变回按钮，漏掉的那条边会立刻变成 2px 的 `#a8a8a8`（见 AGENTS.md 里
 * 那条 UA 边框的教训）。四条 longhand 写全，就不必依赖简写与 longhand 的顺序。
 */
export function monthCell(options: MonthCellOptions): CSSProperties {
  const { selected, hovered, today, lastCol, lastRow } = options
  return {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    padding: `${S.xs}px 5px 3px`,
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: lastCol ? 'none' : `1px solid ${T.hairline}`,
    borderBottom: lastRow ? 'none' : `1px solid ${T.hairline}`,
    background: today ? T.brandSoft : hovered ? T.hover : 'transparent',
    boxShadow: selected ? `inset 0 0 0 1.5px ${T.brand}` : 'none',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/**
 * 格子里的日期行，三格从左到右固定：`[阿拉伯数字日号] [休/班] ……… [农历/节日]`。
 *
 * 日号贴左、农历贴右，「休 / 班」紧跟日号——就夹在两者中间（用户指定的位置）。
 */
export const monthDayRow: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'baseline',
  gap: 4,
  marginBottom: 3,
}

export function monthDayNum(today: boolean, inMonth: boolean): CSSProperties {
  return {
    fontSize: FS.base,
    fontWeight: today ? 700 : inMonth ? 600 : 500,
    color: today ? T.brand : inMonth ? T.labelPrimary : T.labelCaption,
    ...TABULAR,
  }
}

/**
 * 「休」（法定节假日放假）/「班」（调休上班）标记。
 *
 * 与右上角那条农历信息**不是互斥关系**，两者可以同时出现。
 */
export function monthDayMark(rest: boolean, inMonth: boolean): CSSProperties {
  return {
    fontSize: FS.caption,
    fontWeight: 600,
    color: rest ? T.rest : T.labelTertiary,
    opacity: inMonth ? 1 : 0.6,
  }
}

/**
 * 格子右上角那一条：农历日期 / 农历月份 / 传统节日节气，**三者互斥、只出一条**。
 *
 * 挤不下时省略的是它而不是日号（`marginLeft: auto` + 可收缩），因为日号才是定位信息。
 */
export function monthDayAlmanac(inMonth: boolean): CSSProperties {
  return {
    marginLeft: 'auto',
    minWidth: 0,
    fontSize: FS.caption,
    color: inMonth ? T.labelTertiary : T.labelCaption,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
}

export function monthChips(inMonth: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: MONTH_CHIP_GAP,
    overflow: 'hidden',
    // "本月之外"由这里和日期行表达，格子本身不动透明度。
    opacity: inMonth ? 1 : 0.55,
  }
}

/**
 * 月历格子里的一条日程：实心小条，比周形态更矮更小。
 *
 * 它是**整个月历里唯一可点的东西**（点它弹日程悬浮窗）。因此这里必须把 `<button>` 的
 * UA 样式写死：`border: 'none'`（UA 是 `2px outset`，不写就漏出来）、
 * `fontFamily: 'inherit'`（不写就落回 UA 的按钮字体，条内文字会跟着变），
 * 以及 `cursor: 'pointer'` 把"这里能点"讲清楚——格子本身已经不显示手型了。
 */
export function monthChip(color: string, done: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    height: MONTH_CHIP_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
    padding: '0 5px',
    borderRadius: 4,
    border: 'none',
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: done ? withAlpha(color, 0.16) : color,
    color: done ? T.labelTertiary : onColor(color),
    filter: hovered ? 'brightness(0.96)' : 'none',
    transition: TRANSITION,
  }
}

export const monthChipText: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: FS.caption,
  fontWeight: 500,
}

/** 「+N」溢出提示：参考图用一条极淡的灰字表示还有多少条没画出来。 */
export const monthMore: CSSProperties = {
  flex: '0 0 auto',
  fontSize: FS.caption,
  fontWeight: 600,
  color: T.labelSecondary,
  paddingLeft: 5,
  ...TABULAR,
}

// ---------------------------------------------------------------------------
// 线索二：待办（四个等面积象限）
// ---------------------------------------------------------------------------

/**
 * 四象限：`1fr 1fr` × `1fr 1fr` 铺满主体区，故四个区域**面积恒等**，
 * 与各自条数无关（这正是"能容纳多少条"必须先量高度再裁剪的原因）。
 */
export const quadrantGrid: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
  gap: S.md,
  padding: S.lg,
}

/**
 * 单个象限：标题条 + 内容区，内容区高度由网格决定、绝不随条目数量变化。
 *
 * 优先级色只出现在标题左侧的**小方块**上，不做 3px 通栏色条——参考图里颜色从来
 * 只是标记，不是版面结构；通栏色条会把四个象限变成四块色卡。
 */
export function quadrantCell(quadrant: Priority): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    borderRadius: 10,
    border: `1px solid ${T.border1}`,
    background: T.bgLayer1,
    overflow: 'hidden',
  }
}

/** 象限标题左侧的优先级色方块。颜色由调用方给（用户可自定义）。 */
export function quadrantDot(color: string): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
    alignSelf: 'center',
  }
}

/**
 * 象限标题条。
 *
 * **整条是"新建一条这个优先级的待办"的热区**（用户点名的例子之一就是它——
 * "「重要且紧急」几个字这一行"），所以写了手型与悬停底色。`hovered` 时右侧那个 `＋`
 * 会亮起来：光靠"这几行能点"是看不出来的，得有个东西告诉用户点下去会发生什么。
 */
export function quadrantHead(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'baseline',
    gap: S.sm,
    padding: `9px ${S.md}px`,
    borderBottom: `1px solid ${T.border1}`,
    background: hovered ? T.hover : T.canvas,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

export const quadrantName: CSSProperties = {
  ...FONT.itemTitle,
  fontWeight: 600,
  color: T.labelPrimary,
  whiteSpace: 'nowrap',
}

/**
 * 象限内容区：`flex:1 + minHeight:0 + overflow:hidden` = 高度只由网格决定。
 *
 * 条目下方的空白同样是"新建"热区（点某一条是勾选/看明细，点空白是新建）。
 * 条目行自己写了 `cursor: default` 把指针收回去。
 */
export const quadrantList: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  padding: `${S.xs}px 6px`,
  cursor: 'pointer',
}

/** 固定行高的待办行：高度必须与 `TODO_ROW_HEIGHT` 一致，否则裁剪会露出半行。 */
export function todoRow(hovered: boolean, done: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    height: TODO_ROW_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: S.sm,
    padding: `0 ${S.xs}px`,
    borderRadius: 6,
    background: hovered ? T.hover : 'transparent',
    // 见 `dayRow`：内容区整块是"点空白新建"的热区，条目行要收回默认指针。
    cursor: 'default',
    transition: TRANSITION,
  }
}

/** 象限里的待办标题：已完成置灰划线（用户明确要求），未完成用主文字色。 */
export function todoTitle(done: boolean): CSSProperties {
  return {
    ...FONT.itemTitle,
    color: done ? T.labelCaption : T.labelPrimary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: '1 1 auto',
    ...(done ? DONE_DECORATION : null),
  }
}

// ---------------------------------------------------------------------------
// 线索三：项目
// ---------------------------------------------------------------------------

/** 项目列表的一行：白底 + 发丝线分隔，做成"清单"而不是"卡片墙"。 */
export function caseRow(hovered: boolean, hasIssue: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: S.md,
    width: '100%',
    padding: `${S.md}px ${S.lg}px`,
    borderRadius: 8,
    border: `1px solid ${hasIssue ? withAlpha('#B45309', 0.34) : hovered ? T.border2 : T.border1}`,
    background: T.bgLayer1,
    color: T.labelPrimary,
    fontFamily: T.font,
    textAlign: 'left',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 卡片右侧的数字栏。 */
export const metric: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
  ...FONT.caption,
  color: T.labelTertiary,
  ...TABULAR,
}

/**
 * 完成进度细线：168px 宽、6px 高，凹槽底 + 主色填充。
 *
 * 比再写一遍「已完成 3 / 共 9」更快读出"这案子还剩多少"，又不占版面。
 * 6px 是下限——4px 在 900px 高的面板里细到读不出比例（实测被评"像装饰噪点"）。
 * `ratio` 会被夹在 0–1，避免脏数据把填充撑出轨道。
 */
export function progress(ratio: number): CSSProperties {
  const ratio01 = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
  return {
    flex: '0 0 auto',
    width: 168,
    height: 6,
    borderRadius: 999,
    background: T.bgLayer2,
    backgroundImage: `linear-gradient(to right, ${T.brand} ${ratio01 * 100}%, transparent ${
      ratio01 * 100
    }%)`,
    opacity: ratio01 === 0 ? 0.6 : 1,
  }
}

/** 项目详情里的待办行（可多行，展示备注，与象限里的单行不同）。 */
export function detailRow(hovered: boolean, done: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: S.sm,
    padding: `7px ${S.md}px`,
    borderRadius: 8,
    background: hovered ? T.hover : 'transparent',
    // 见 `dayRow`：卡片里的空白是"新建"热区，条目行收回默认指针。
    cursor: 'default',
    transition: TRANSITION,
  }
}

/**
 * 项目详情的待办用 **2×2 四象限网格**铺开：同行等高、行高按内容。
 *
 * 与 {@link quadrantGrid}（待办线索）刻意不同，两条规则都别互相靠拢：
 *
 * - 待办线索：一屏四个**等面积**象限，放不下就裁剪（`1fr` + `overflow: hidden`）。
 *   那条线索的职责是"扫一眼今天该做什么"，版面恒定比穷尽更重要。
 * - 项目详情：格子**跟着内容长**，整页滚动。这里是"把这件事从头到尾读一遍"，
 *   少显示一条就是漏一条待办——律师漏一条的代价远大于版面不齐。
 *
 * `minmax(0, 1fr)` 里的 `0` 不能省：网格子项默认 `min-width: auto`，一个长
 * 标题就能把整列顶宽（标题的省略号也就永远不出现），与 {@link itemBody} 是同一类坑。
 */
export const detailQuadrantGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  // 网格子项默认就是 stretch；写出来是为了钉住"同行两格等高"这条要求。
  alignItems: 'stretch',
  gap: S.md,
}

/** 四象限网格里的一格：标题条 + 内容区，**没有内滚动**。 */
export const detailQuadrant: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  borderRadius: 10,
  border: `1px solid ${T.border1}`,
  background: T.bgLayer1,
  // 圆角要靠它裁掉标题条那圈底色（标题条是方的）。
  overflow: 'hidden',
}

/**
 * 格标题：底部一条**优先级色线**（与 {@link quadrantHead} 的色方块是同一套"颜色只做
 * 标记、不做版面结构"的语言，这里用线是因为格子已经有边框收边了）。
 *
 * 颜色由调用方给（用户可自定义四象限配色），**不在这里兜底**——写死一个色等于绕过用户的设置。
 *
 * 整条也是"在这个项目里新建一条这个优先级的待办"的热区，见 {@link quadrantHead}。
 */
export function detailQuadrantHead(color: string, hovered = false): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'baseline',
    gap: S.sm,
    padding: `9px ${S.md}px 7px`,
    borderBottom: `1px solid ${T.border1}`,
    boxShadow: `inset 0 -2px 0 ${color}`,
    background: hovered ? T.hover : T.canvas,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 格标题里的计数：位置不够就省略，绝不把格子顶宽。 */
export const detailQuadrantCount: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 格内容区：跟着内容长、不滚动（滚动只由项目详情那一个外层容器负责）。**空白处可点新建**。 */
export const detailQuadrantList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: `${S.xs}px ${S.xs}px ${S.sm}px`,
  cursor: 'pointer',
}

/**
 * 空象限的占位。
 *
 * 四格**恒定铺满** 2×2，哪怕某格一条都没有："这个象限是空的"本身就是要读到的信息
 * （一个案子一件紧急的事都没有，和"我没看见紧急那格"完全是两回事）。藏掉空格会让
 * 版面缺角，读起来像渲染失败。
 */
export const detailQuadrantEmpty: CSSProperties = {
  ...FONT.caption,
  color: T.labelCaption,
  padding: `${S.sm}px ${S.md}px`,
}

// ---------------------------------------------------------------------------
// 使用说明
// ---------------------------------------------------------------------------

/**
 * 说明界面：盖在面板之上（是一个入口，不是第四条线索）。
 *
 * 底色必须是**不透明**的：`canvas` 是 `rgba(0,0,0,0.022)`，拿它当说明页的底，
 * 背后的日程条会整片透上来，看起来像渲染错乱（实测踩过）。
 */
export const helpOverlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: T.bgLayer1,
  // 只要大于 0 就能盖住线索内容——因为主体区已经把自己隔离成了一个层叠上下文
  // （见 `body()`），线索内部再大的 z-index 也越不出来。
  zIndex: 2,
}

/**
 * 说明正文的滚动区。
 *
 * 底色用 `canvas`（比卡片浅一档），让"一张张可展开的卡片"浮在上面——这是这套界面
 * 一贯的分层方式：靠明度差分区，不靠描边堆叠。
 */
export const helpBody: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: `${S.xl}px ${S.xl}px ${S.xxl}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: S.lg,
  background: T.canvas,
}

/**
 * 顶部那段开场说明。**不需要展开**（用户要的就是"除了最基础的介绍，其他默认折叠"），
 * 所以它不套卡片、只给一段浅灰底，与下面那摞可点的标题明显区分开。
 */
export const helpIntro: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: S.sm,
  maxWidth: 720,
  padding: `${S.lg}px`,
  borderRadius: 10,
  background: T.bgLayer1,
  border: `1px solid ${T.border1}`,
}

/** 可展开条目的那一列。 */
export const helpList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: S.sm,
  maxWidth: 720,
}

/**
 * 一条说明（标题 + 展开后的正文）。
 *
 * 卡片外框在这里，**标题按钮自己不画边框**（`border: 'none'`）——一层框就够，
 * 按钮再加一圈会读成"框里套框"。注意那条 UA 边框的教训：用在 `<button>` 上的样式
 * 必须把边框说全，所以这里显式写 `'none'` 而不是省略。
 */
export const helpSection: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 10,
  border: `1px solid ${T.border1}`,
  background: T.bgLayer1,
  overflow: 'hidden',
}

/**
 * 说明条目的标题行：整行可点，展开 / 收起。
 *
 * 展开时底色下沉一档（`bgLayer2`），配合右侧翻转的箭头，让"这一条是开着的"一眼可见。
 */
export function helpToggle(open: boolean, hovered: boolean): CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    alignItems: 'baseline',
    gap: S.sm,
    padding: `${S.md}px ${S.lg}px`,
    border: 'none',
    background: open ? T.bgLayer2 : hovered ? T.hover : 'transparent',
    color: T.labelPrimary,
    fontFamily: 'inherit',
    fontSize: FS.base,
    fontWeight: 600,
    textAlign: 'left',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 标题文字：挤不下时省略，不要把右侧的提示与箭头顶出去。 */
export const helpTitle: CSSProperties = {
  flex: '0 0 auto',
  ...FONT.panelTitle,
  color: T.labelPrimary,
}

/**
 * 标题右侧那句"这一条讲什么"。
 *
 * **靠右**（`textAlign: 'right'` + 撑满剩余宽度）：折叠状态下十行摞在一起，提示靠右才读成
 * "一行一条索引"；紧跟标题后面会连成一长句，又变回"堆在一起"的观感。
 */
export const helpHint: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  ...FONT.caption,
  color: T.labelTertiary,
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export function helpChevron(open: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    alignSelf: 'center',
    color: open ? T.brand : T.labelCaption,
    fontSize: FS.caption,
    transform: open ? 'rotate(180deg)' : 'none',
    transition: TRANSITION,
  }
}

/** 展开后的正文。左内边距 = 标题行内边距 + 编号格宽 + 间距，让正文与标题左对齐。 */
export const helpPanel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: S.xs,
  padding: `0 ${S.lg}px ${S.lg}px ${S.lg + 30}px`,
}

export const helpText: CSSProperties = {
  ...FONT.body,
  color: T.labelSecondary,
  lineHeight: 1.68,
}

/**
 * 说明里的重点（`**这样就加粗**`）。
 *
 * 说明正文是 `labelSecondary` 的次要灰，重点只加字重不够跳出来，所以**同时提一档颜色**
 * 到 `labelPrimary`——两者一起用才读得出层次，单加字重在灰度正文里几乎看不出来。
 */
export const helpStrong: CSSProperties = {
  fontWeight: 600,
  color: T.labelPrimary,
}

// ---------------------------------------------------------------------------
// 日程悬浮窗
// ---------------------------------------------------------------------------

/**
 * 点到某一条日程时弹出的明细窗。
 *
 * 挂在**面板**（`aside`）下而不是格子里：格子有 `overflow: hidden`，挂在里面会被裁掉。
 * `position: absolute` 相对 `aside`（它是 `position: fixed`，构成包含块），落点由
 * `view.ts` 的 `popoverPosition()` 算好后传进来。
 *
 * 宽度写死 260px：量自己的高度要在 `useLayoutEffect` 里做，宽度若也跟着内容变，
 * 定位会依赖"先量后摆"一轮；固定宽度就只需量高度，短备注与长备注都不会横着跳。
 */
export const schedulePopover: CSSProperties = {
  position: 'absolute',
  width: 260,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: S.sm,
  padding: `${S.md}px ${S.md}px`,
  borderRadius: 10,
  border: `1px solid ${T.border1}`,
  background: T.bgLayer1,
  boxShadow: T.shadowLift,
  // 高于主体区（0）与说明层（2）：它是最后打开的一层。
  zIndex: 3,
}

/** 悬浮窗顶部：优先级色点 + 优先级文字（未设优先级时给中性灰点）。 */
export const popoverHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: S.xs,
}

export const popoverDot: CSSProperties = {
  flex: '0 0 auto',
  width: 8,
  height: 8,
  borderRadius: 999,
}

export const popoverPriority: CSSProperties = {
  ...FONT.caption,
  fontWeight: 500,
}

/**
 * 明细窗里那个**可点的标题**：点它用系统默认程序打开这条日程所在的原始 markdown。
 *
 * 做成标题本身而不是旁边加个「打开原文」按钮，是用户明确要的手势——"通过点击日程标题
 * 的方式打开"。所以它必须长得**像标题、又看得出能点**：平时就是标题的样子（不加下划线、
 * 不染主色，否则明细窗里最显眼的元素会变成"一个链接"），悬停才出现下划线 + 主色。
 *
 * 三条必须显式写死的：`border` 四条边（它是 `<button>`，UA 的 2px outset 会漏出来）、
 * `fontSize`（UA 默认 13.33px 会漏进来）、`padding: 0` + `textAlign: 'left'`
 * （按钮的 UA 内边距与居中会让标题错位）。
 */
export function popoverTitleButton(hovered: boolean): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: FS.base,
    fontWeight: 600,
    lineHeight: 1.45,
    textAlign: 'left',
    color: hovered ? T.brand : T.labelPrimary,
    textDecoration: hovered ? 'underline' : 'none',
    textUnderlineOffset: 3,
    cursor: 'pointer',
    overflowWrap: 'anywhere',
    transition: TRANSITION,
  }
}

/** 明细窗标题右侧那个 `↗`：告诉用户"这里通向文件"。 */
export const popoverSourceMark: CSSProperties = {
  ...FONT.caption,
  flex: '0 0 auto',
  color: T.labelTertiary,
}

/** 标题那一行：标题 + `↗`（`↗` 跟着标题走，不单独占一行）。 */
export const popoverTitleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: S.xs,
}

/** 明细行：标签定宽左列 + 值右列，值可折行。 */
export const popoverFields: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

export const popoverRow: CSSProperties = {
  display: 'flex',
  gap: S.sm,
  alignItems: 'flex-start',
}

export const popoverLabel: CSSProperties = {
  ...FONT.caption,
  flex: '0 0 auto',
  width: 32,
  color: T.labelTertiary,
}

export const popoverValue: CSSProperties = {
  ...FONT.caption,
  flex: '1 1 auto',
  minWidth: 0,
  color: T.labelSecondary,
  overflowWrap: 'anywhere',
}

export const popoverFoot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: S.sm,
  paddingTop: S.sm,
  borderTop: `1px solid ${T.hairline}`,
}

/**
 * 悬浮窗底部的「完成 / 未完成」切换按钮。
 *
 * 做成整行按钮而不是再来一个复选框：日视图与项目视图的复选框就在条目左侧，
 * 一眼能看见；悬浮窗是浮层，用户需要一个明确的落点，而且这也是用户要的"按钮"。
 * 左侧的圆点 / 对勾沿用条上的 `barMark`，标记语言保持一致。
 *
 * `border` 用**简写**写全：它是 `<button>`，只写某几条边会让 UA 的 2px outset 漏出来
 * （见 AGENTS.md 里那条教训）。
 */
export function popoverAction(done: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: S.sm,
    padding: `${S.xs}px ${S.sm}px`,
    borderRadius: 6,
    border: `1px solid ${hovered ? T.border2 : T.border1}`,
    background: hovered ? T.hover : 'transparent',
    color: done ? T.labelSecondary : T.labelPrimary,
    fontFamily: 'inherit',
    fontSize: FS.caption,
    fontWeight: 500,
    textAlign: 'left',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 按钮右侧那句「点击取消」。 */
export const popoverHint: CSSProperties = {
  ...FONT.caption,
  flex: '0 0 auto',
  color: T.labelTertiary,
}

// ---------------------------------------------------------------------------
// 新建悬浮窗（空白处点一下 → 填表）
// ---------------------------------------------------------------------------

/**
 * 可点空白区右侧那个「＋」。
 *
 * 它是这套手势**唯一的可见线索**：底色变化只在指着的时候才出现，而"指着才知道能点"
 * 等于没告诉用户。常态下压到半透明（不抢标题与计数的位置），指到哪一块哪一块亮起来。
 */
export function blankAdd(hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    alignSelf: 'center',
    fontSize: FS.caption,
    fontWeight: 600,
    lineHeight: '18px',
    color: hovered ? T.brand : T.labelCaption,
    opacity: hovered ? 1 : 0.45,
    transition: TRANSITION,
  }
}

/**
 * 新建条目的悬浮窗。
 *
 * 与明细窗（{@link schedulePopover}）分开写而不是复用：这一个要装表单（多个输入框、
 * 一行四个优先级小片、两列日期时间），宽度与内边距都不是一回事；混用一个样式，
 * 改明细窗的宽度就会把表单挤变形。
 *
 * 宽度写死 340px 的理由与明细窗相同：量自己的高度要在 `useLayoutEffect` 里做，
 * 宽度若也跟着内容变，定位就得"先量后摆"两轮；固定宽度只量高度，短标题与长备注
 * 都不会横着跳。用 340 而不是 320，是因为案件名很长，项目选择器那一行要多些余量。
 *
 * `maxHeight` 由调用方按**主体区实测高度**给（`bounds` 的高度减一圈留白）：
 * 表单会随"项目候选列表展开"变高，短窗口下必须**自己截住**，否则「创建」按钮会被
 * 顶到主体区外面——够不着的提交按钮等于没有。截住之后由 {@link composeFields}
 * 内部滚动消化，标题与页脚恒定可见。
 */
export function composePopover(maxHeight: number): CSSProperties {
  return {
    position: 'absolute',
    width: 340,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: S.sm,
    padding: S.md,
    borderRadius: 10,
    border: `1px solid ${T.border1}`,
    background: T.bgLayer1,
    boxShadow: T.shadowLift,
    // 比明细窗（3）再高一档：两者不会同时出现，但万一同时在场，表单必须在上面。
    zIndex: 4,
    maxHeight: Math.max(220, maxHeight),
  }
}

/** 表单的字段区：唯一可滚动的部分（见 `composePopover` 的 maxHeight）。 */
export const composeFields: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: S.sm,
  overflowY: 'auto',
  overflowX: 'hidden',
}

export const composeHead: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: S.sm,
}

export const composeTitle: CSSProperties = {
  ...FONT.itemTitle,
  fontWeight: 600,
  color: T.labelPrimary,
  whiteSpace: 'nowrap',
}

/** 标题右侧那句"这次会写成什么"（优先级 / 日期 / 项目）。挤不下就省略。 */
export const composeContext: CSSProperties = {
  ...FONT.caption,
  marginLeft: 'auto',
  minWidth: 0,
  color: T.labelTertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 一行表单：定宽标签 + 控件。 */
export const composeField: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: S.sm,
}

export const composeLabel: CSSProperties = {
  flex: '0 0 auto',
  width: 40,
  ...FONT.caption,
  color: T.labelTertiary,
}

/** 并排两列（开始 / 结束）。`minmax(0, 1fr)` 不能省：日期控件有自己的最小宽度。 */
export const composePair: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: S.sm,
}

/**
 * 表单里的输入框：与 {@link input} 同一套外观，只是更紧凑（窗里要塞下 6–8 行）。
 * 原生 `date` / `time` 控件也走它——它们的 UA 外观本来就带边框与内边距，
 * 不覆盖就会和旁边的文本框高矮不一。
 */
export function composeInput(hovered: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: `5px ${S.sm}px`,
    borderRadius: 6,
    border: `1px solid ${hovered ? T.border2 : T.border1}`,
    background: T.bgLayer1,
    color: T.labelPrimary,
    fontFamily: T.font,
    ...FONT.secondary,
    transition: TRANSITION,
  }
}

export const composeChips: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: S.xs,
  flex: '1 1 auto',
  minWidth: 0,
}

/** 优先级小片左侧的色点。与象限标题上的方块同一套标记语言。 */
export function composeChipDot(color: string): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 7,
    height: 7,
    borderRadius: 2,
    background: color,
  }
}

/**
 * 优先级小片（`<button>`）。
 *
 * `border` 用**简写**写全：它是按钮，只写某几条边会让 UA 那圈 2px outset 漏出来
 * （见 AGENTS.md 里那条教训）。选中态用"色点色描边 + 极浅同色底"，
 * 不填成实心色块——四个小片并排铺满实心色会把这一行读成调色板。
 */
export function composeChip(active: boolean, hovered: boolean, color: string): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: `3px ${S.sm}px`,
    borderRadius: 999,
    border: `1px solid ${active ? color : T.border1}`,
    background: active ? withAlpha(color, 0.12) : hovered ? T.hover : 'transparent',
    color: active ? T.labelPrimary : T.labelSecondary,
    fontFamily: 'inherit',
    // `<button>` 有 UA 默认字号（13.33px），不写死就会漏下来。
    fontSize: FS.caption,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

export const composeFoot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: S.sm,
  paddingTop: S.sm,
  borderTop: `1px solid ${T.hairline}`,
}

/** 提交按钮。与 {@link primaryButton} 同色，只是小一号、撑满剩余宽度。 */
export function composeSubmit(hovered: boolean, disabled: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    padding: `6px ${S.md}px`,
    borderRadius: 8,
    border: 'none',
    background: disabled ? T.border2 : hovered ? T.buttonPrimaryHover : T.buttonPrimary,
    color: '#ffffff',
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: TRANSITION,
  }
}

/** 校验失败的说明（文案由 `@dslegal/core` 的渲染器给出，与 host 逐字一致）。 */
export const composeError: CSSProperties = {
  ...FONT.caption,
  color: T.error,
  whiteSpace: 'normal',
}

/** 表单里的补充说明（「时间留空 = 全天事项」这类）。 */
export const composeNote: CSSProperties = {
  ...FONT.caption,
  color: T.labelTertiary,
}

/** 目录约定的写法：路径不能折行——折一次就断成两个看起来都不对的路径。 */
export const helpCode: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  overflowX: 'auto',
  whiteSpace: 'nowrap',
  fontSize: FS.secondary,
  fontFamily: T.mono,
  color: T.labelPrimary,
  background: T.bgLayer2,
  borderRadius: 6,
  padding: `7px ${S.md}px`,
}

/** 说明里的编号：做成主色小方块，比「一、二、三」更有层级感，也不占版面。 */
export const helpIndex: CSSProperties = {
  flex: '0 0 auto',
  boxSizing: 'border-box',
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 5,
  background: T.brandSoft,
  color: T.brand,
  fontSize: FS.caption,
  fontWeight: 700,
  ...TABULAR,
}

// ---------------------------------------------------------------------------
// 新建条目：项目选择器（搜索式下拉）
// ---------------------------------------------------------------------------

/**
 * 项目选择器。
 *
 * 用户原话："应当允许用户灵活选择当前存在的真实项目，比如下拉备选，又或者输入部分
 * 关键字后列出命中的项目。"案件名很长（通常是「办理中_日期 + 当事人 + 案由」那种写法），
 * 纯下拉在这种名单里认不出来，所以做成"触发器 + 关键字筛选 + 候选列表"。
 *
 * **只有一个项目时也照样给这个控件**：早先是一个静态的项目名文本，用户看到的是
 * "这里写着一个案件、改不了"——恰恰就是他反馈的问题。看得见、点得动，比省一行更重要。
 */
export const composePicker: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
}

/**
 * 选择器的触发器（`<button>`）。当前选中的项目名 + 顶级目录名 + 一个翻转的箭头。
 *
 * `border` 用简写写全：它是按钮，只写某几条边会让 UA 那圈 2px outset 漏出来。
 */
export function composeProjectTrigger(open: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: S.sm,
    padding: `5px ${S.sm}px`,
    borderRadius: 6,
    border: `1px solid ${open || hovered ? T.border2 : T.border1}`,
    background: open ? T.hover : T.bgLayer1,
    color: T.labelPrimary,
    fontFamily: 'inherit',
    // `<button>` 有 UA 默认字号，必须显式写死。
    fontSize: FS.secondary,
    fontWeight: 400,
    textAlign: 'left',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 触发器里的项目名：长了就省略，完整名字走 `title`。 */
export const composeProjectName: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 顶级目录名：同名项目在不同目录里就靠它区分。 */
export const composeProjectDir: CSSProperties = {
  flex: '0 0 auto',
  ...FONT.caption,
  color: T.labelTertiary,
}

export function composeCaret(open: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    color: T.labelTertiary,
    fontSize: FS.caption,
    transform: open ? 'rotate(180deg)' : 'none',
    transition: TRANSITION,
  }
}

/** 展开后的候选面板：关键字框 + 列表。 */
export const composePickerPanel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: S.xs,
  marginTop: S.xs,
  padding: S.xs,
  borderRadius: 8,
  border: `1px solid ${T.border1}`,
  background: T.canvas,
}

/**
 * 候选列表。**自己滚动、限高四行**：项目一多不能把整张表单顶长，
 * 否则在矮窗口里「创建」按钮会被推到主体区外面。
 */
export const composeProjectList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 140,
  overflowY: 'auto',
  overflowX: 'hidden',
}

/** 一个候选（`<button>`）。选中态用主色浅底 + 描边，不用实心色块——那太抢眼。 */
export function composeProjectOption(selected: boolean, hovered: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: S.xs,
    width: '100%',
    padding: `5px ${S.sm}px`,
    borderRadius: 6,
    border: `1px solid ${selected ? T.brandLine : 'transparent'}`,
    background: selected ? T.brandSoft : hovered ? T.hover : 'transparent',
    color: T.labelPrimary,
    fontFamily: 'inherit',
    fontSize: FS.secondary,
    fontWeight: selected ? 600 : 400,
    textAlign: 'left',
    cursor: 'pointer',
    transition: TRANSITION,
  }
}

/** 候选左侧的勾：没选中的那条留空占位，名字才能左对齐成一条线。 */
export function composeProjectMark(selected: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 14,
    color: selected ? T.brand : 'transparent',
    fontSize: FS.caption,
    fontWeight: 700,
  }
}

/** 关键字没命中任何项目时的提示（不是错误，只是没匹配上）。 */
export const composePickerEmpty: CSSProperties = {
  ...FONT.caption,
  color: T.labelTertiary,
  padding: `6px ${S.sm}px`,
}

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

export const issueList: CSSProperties = {
  ...FONT.secondary,
  color: T.labelSecondary,
  paddingLeft: S.lg,
}

export const empty: CSSProperties = {
  padding: `${S.md}px 0`,
  ...FONT.secondary,
  color: T.labelTertiary,
}

/**
 * 空态。
 *
 * 参考图的空态是一枚极淡的插画 + 一行灰字；我们不做插画（那会引入一套要维护的图形
 * 资产），改为**一个弱化的圆环 + 一行灰字**，保持同样的"安静"。
 */
export const emptyState: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: S.sm,
  padding: S.xl,
  textAlign: 'center',
}

export const emptyRing: CSSProperties = {
  boxSizing: 'border-box',
  width: 34,
  height: 34,
  borderRadius: 999,
  border: `2px solid ${T.border2}`,
  opacity: 0.55,
}

export function primaryButton(hovered: boolean, disabled: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    padding: `7px ${S.lg}px`,
    borderRadius: 8,
    border: 'none',
    background: disabled ? T.border2 : hovered ? T.buttonPrimaryHover : T.buttonPrimary,
    color: '#ffffff',
    fontFamily: T.font,
    fontSize: FS.secondary,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: TRANSITION,
  }
}

export function input(hovered: boolean): CSSProperties {
  return {
    flex: '1 1 auto',
    minWidth: 0,
    padding: `${S.sm}px ${S.md}px`,
    borderRadius: 8,
    border: `1px solid ${hovered ? T.border2 : T.border1}`,
    background: T.bgLayer1,
    color: T.labelPrimary,
    fontFamily: T.font,
    ...FONT.body,
    transition: TRANSITION,
  }
}

// ---------------------------------------------------------------------------
// 插件设置：四象限颜色
// ---------------------------------------------------------------------------

/** 颜色设置的一行：优先级名 + 取色器 + 十六进制文本框 + 「默认」。 */
export function colorRow(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: S.sm,
  }
}

export function colorRowLabel(): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 104,
    ...FONT.itemTitle,
    color: T.labelPrimary,
  }
}

/**
 * 原生取色器。
 *
 * `input[type=color]` 在浏览器里自带一圈内边距与边框，直接用会与旁边的文本框对不齐；
 * 这里把它压成 32×32 的小方块，并显式 `border-box`（面板没有全局 box-sizing 重置，
 * 见 AGENTS.md 的盒模型那一条）。
 */
export function colorSwatch(): CSSProperties {
  return {
    flex: '0 0 auto',
    boxSizing: 'border-box',
    width: 32,
    height: 32,
    padding: 2,
    border: `1px solid ${T.border1}`,
    borderRadius: 8,
    background: T.bgLayer1,
    cursor: 'pointer',
  }
}

/** 预览里的一条实心色块：直接用真实条目的样式渲染，所见即所得。 */
export function colorPreview(color: string): CSSProperties {
  return {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    maxWidth: 150,
    height: WEEK_BAR_HEIGHT,
    padding: `0 ${S.sm}px`,
    borderRadius: 6,
    background: color,
    color: onColor(color),
    fontSize: FS.caption,
    fontWeight: 500,
  }
}
