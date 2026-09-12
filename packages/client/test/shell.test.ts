import { describe, expect, it } from 'vitest'

import {
  FALLBACK_INSETS,
  LAUNCHER_MARGIN,
  OVERLAY_SELECTOR,
  SETTINGS_INSET,
  clampLauncherSpot,
  defaultLauncherSpot,
  fallbackGeometry,
  insetsFromTracks,
  launcherSpot,
  nearLauncherSpot,
  overlayLayerOf,
  parseTracks,
  sidebarColumnOf,
} from '../src/shell.js'
import { BACKDROP_Z, LAUNCHER_Z, PANEL_Z, backdrop, launcher, panel } from '../src/styles.js'

/**
 * 会话区几何：AppFrame 是三列 grid（侧边栏 | 会话区 | 详情栏），
 * 工作台要"与对话区等宽、只留出左侧会话菜单栏"，就必须读这三列的实时宽度。
 */
describe('会话区几何', () => {
  it('解析 grid-template-columns 的像素轨道', () => {
    expect(parseTracks('280px 976px 0px')).toEqual([280, 976, 0])
    expect(parseTracks('0px')).toEqual([0])
    expect(parseTracks('')).toEqual([])
  })

  it('三列轨道 → 左右内缩', () => {
    expect(insetsFromTracks([280, 976, 0])).toEqual({ left: 280, right: 0 })
    expect(insetsFromTracks([320, 936, 0])).toEqual({ left: 320, right: 0 })
    expect(insetsFromTracks([56, 1200, 0])).toEqual({ left: 56, right: 0 })
  })

  it('详情栏打开时右侧也让开', () => {
    expect(insetsFromTracks([280, 656, 320])).toEqual({ left: 280, right: 320 })
  })

  it('轨道缺失或非法时回退到 AppFrame 契约默认值', () => {
    expect(insetsFromTracks([])).toEqual(FALLBACK_INSETS)
    expect(insetsFromTracks([-1, 976, 0])).toEqual(FALLBACK_INSETS)
    expect(insetsFromTracks([280, 976])).toEqual({ left: 280, right: 0 })
  })

  it('兜底几何按侧边栏内缩推定设置按钮右端（实查 280 → 270）', () => {
    expect(fallbackGeometry()).toEqual({
      left: 280,
      right: 0,
      anchor: { right: 280 - SETTINGS_INSET, bottom: SETTINGS_INSET },
    })
  })

  it('用 closest 找 overlay 层，不用 parentElement（插槽会包一层 display:contents）', () => {
    const layer = { tag: 'overlay' }
    const anchor = {
      closest: (selector: string): Element | null =>
        selector === OVERLAY_SELECTOR ? (layer as unknown as Element) : null,
    }
    expect(overlayLayerOf(anchor)).toBe(layer)
    expect(overlayLayerOf(null)).toBeNull()
    expect(overlayLayerOf(undefined)).toBeNull()
  })

  it('侧边栏列 = frame 的第一个子元素（点侧边栏收起面板的命中判断）', () => {
    const sidebar = { tag: 'sidebar' } as unknown as Element
    const center = { tag: 'center' } as unknown as Element
    expect(sidebarColumnOf({ children: [sidebar, center] })).toBe(sidebar)
    expect(sidebarColumnOf({ children: [] })).toBeNull()
    expect(sidebarColumnOf(null)).toBeNull()
    expect(sidebarColumnOf(undefined)).toBeNull()
  })
})

describe('工作台定位', () => {
  /** 启动按钮实测尺寸（61×35 是实查值）。 */
  const SIZE = { width: 61, height: 35 }
  const VIEW = { width: 1440, height: 900 }
  /** 展开态：280px 侧边栏，设置按钮 x 10..270、底边距视口 10px。 */
  const EXPANDED = { left: 280, right: 0 }
  const EXPANDED_ANCHOR = { right: 270, bottom: 10 }
  /** 折叠态：56px 导轨，设置按钮右端实测 46。 */
  const COLLAPSED = { left: 56, right: 0 }
  const COLLAPSED_ANCHOR = { right: 46, bottom: 16 }

  it('默认（展开态）与设置按钮部分重叠：右边缘对齐、底边对齐', () => {
    const spot = defaultLauncherSpot(EXPANDED_ANCHOR, SIZE, EXPANDED, VIEW)
    expect(spot.left).toBe(270 - 61)
    expect(spot.bottom).toBe(10)
    // 部分重叠：左边缘落在设置按钮内部（10..270），不是完全盖住
    expect(spot.left).toBeGreaterThan(10)
    expect(spot.left).toBeLessThan(270)
  })

  /**
   * 这一条是本轮修的 bug。
   *
   * 旧实现在"右对齐放不下"时退化为 `anchor.right + S.md`（46 + 12 = 58），而折叠后的面板
   * 从 x=56 起——**按钮整个人落在面板里**。两者 z-index 又同为 60、`aside` 在 DOM 里更靠后，
   * 于是 `elementFromPoint` 命中的是面板：按钮看不见也点不到。
   *
   * 现在：会话区左侧那条带子放不下就贴视口左缘，靠 `LAUNCHER_Z` 浮在面板之上。
   * **旧测试正好断言了错误的位置**（`expect(style.left).toBe(46 + 12)`），所以没拦住。
   */
  it('侧边栏折叠（56px 导轨）时贴视口左缘，不钻进面板底下', () => {
    const spot = defaultLauncherSpot(COLLAPSED_ANCHOR, SIZE, COLLAPSED, VIEW)
    expect(spot.left).toBe(LAUNCHER_MARGIN)
    // 关键：不再是"贴设置按钮右侧"（那会落在面板里）
    expect(spot.left).not.toBe(COLLAPSED_ANCHOR.right + 12)
    // 但仍然整个在视口内
    expect(spot.left).toBeGreaterThanOrEqual(LAUNCHER_MARGIN)
    expect(spot.left + SIZE.width).toBeLessThanOrEqual(VIEW.width)
  })

  it('会话区放得下就绝不越进面板（左缘不越过 left 边界）', () => {
    for (const left of [56, 120, 200, 280, 360]) {
      const spot = defaultLauncherSpot({ right: left - 10, bottom: 10 }, SIZE, { left, right: 0 }, VIEW)
      if (spot.left > LAUNCHER_MARGIN) {
        expect(spot.left + SIZE.width, `left=${left} 时按钮越进了面板`).toBeLessThanOrEqual(left)
      }
    }
  })

  it('尚未测得尺寸时也不越出视口', () => {
    const spot = defaultLauncherSpot(EXPANDED_ANCHOR, { width: 0, height: 0 }, EXPANDED, VIEW)
    expect(spot.left).toBeGreaterThanOrEqual(LAUNCHER_MARGIN)
    expect(spot.left).toBeLessThanOrEqual(VIEW.width - LAUNCHER_MARGIN)
  })

  it('落点夹取：整个按钮都要留在视口内', () => {
    expect(clampLauncherSpot({ left: -50, bottom: -50 }, SIZE, VIEW)).toEqual({
      left: LAUNCHER_MARGIN,
      bottom: LAUNCHER_MARGIN,
    })
    expect(clampLauncherSpot({ left: 9999, bottom: 9999 }, SIZE, VIEW)).toEqual({
      left: VIEW.width - SIZE.width - LAUNCHER_MARGIN,
      bottom: VIEW.height - SIZE.height - LAUNCHER_MARGIN,
    })
  })

  it('拖过的落点优先，且永远夹在视口内（窗口变小后旧落点也不会丢到屏幕外）', () => {
    // 用户把它拖到了右下角
    const moved = launcherSpot(EXPANDED_ANCHOR, SIZE, EXPANDED, VIEW, { left: 1300, bottom: 800 })
    expect(moved).toEqual({ left: 1300, bottom: 800 })
    // 窗口缩小到装不下原落点：仍然整个可见
    const small = { width: 400, height: 300 }
    const clamped = launcherSpot(EXPANDED_ANCHOR, SIZE, EXPANDED, small, { left: 1300, bottom: 800 })
    expect(clamped.left).toBe(small.width - SIZE.width - LAUNCHER_MARGIN)
    expect(clamped.bottom).toBe(small.height - SIZE.height - LAUNCHER_MARGIN)
    // 没拖过时不受 override 影响
    expect(launcherSpot(EXPANDED_ANCHOR, SIZE, EXPANDED, VIEW, null)).toEqual(
      defaultLauncherSpot(EXPANDED_ANCHOR, SIZE, EXPANDED, VIEW),
    )
  })

  it('拖回原处算"重新停靠"（阈值内为真、推远了为假）', () => {
    const dock = defaultLauncherSpot(EXPANDED_ANCHOR, SIZE, EXPANDED, VIEW)
    expect(nearLauncherSpot(dock, dock)).toBe(true)
    expect(nearLauncherSpot({ left: dock.left + 10, bottom: dock.bottom - 8 }, dock)).toBe(true)
    expect(nearLauncherSpot({ left: dock.left + 120, bottom: dock.bottom }, dock)).toBe(false)
    expect(nearLauncherSpot({ left: dock.left, bottom: dock.bottom - 200 }, dock)).toBe(false)
  })

  /** 层叠顺序：折叠后按钮只能浮在面板之上，所以 z-index 必须真的更高。 */
  it('启动按钮恒在面板之上，遮罩恒在面板之下', () => {
    expect(LAUNCHER_Z).toBeGreaterThan(PANEL_Z)
    expect(BACKDROP_Z).toBeLessThan(PANEL_Z)
    const idle = launcher({ left: 209, bottom: 10 })
    const active = launcher({ left: 209, bottom: 10 }, true)
    expect(idle.zIndex).toBe(LAUNCHER_Z)
    expect(active.zIndex).toBe(LAUNCHER_Z)
    expect(backdrop(0, 0).zIndex).toBe(BACKDROP_Z)
    expect(panel(280, 0).zIndex).toBe(PANEL_Z)
    // 拖动要用指针事件，触摸设备上不能让浏览器把按住拖动当成滚动
    expect(idle.touchAction).toBe('none')
    expect(idle.cursor).toBe('grab')
  })

  it('展开态用实心主色，表示工作台已打开（按钮常驻做开合开关）', () => {
    const idle = launcher({ left: 209, bottom: 10 })
    const active = launcher({ left: 209, bottom: 10 }, true)
    expect(idle.background).not.toBe(active.background)
    // 展开 = 主色实心块；收起 = 深色底。两者的字都是白的，故不能靠字色区分。
    expect(String(active.background)).toContain('#4A8CF1')
    expect(String(active.color)).toBe('#ffffff')
    expect(String(idle.color)).toBe('#ffffff')
    // 位置不受开合状态影响
    expect(active.left).toBe(idle.left)
    expect(active.bottom).toBe(idle.bottom)
  })

  it('面板铺满会话区：左右由几何决定，不再写死宽度', () => {
    const style = panel(280, 0)
    expect(style.left).toBe(280)
    expect(style.right).toBe(0)
    expect(style.width).toBeUndefined()
  })
})
