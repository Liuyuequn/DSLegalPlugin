/**
 * DSH shell 的会话区几何与「工作台」启动按钮锚点。
 *
 * `shell.overlay` 槽位挂在 AppFrame 的 overlay 层（`position:absolute; inset:0`，
 * 带语义标记 `data-shell-overlay`）里，而 AppFrame 本身是一个三列 grid：
 *
 * ```
 * grid-template-columns: <侧边栏>px minmax(0, 1fr) <详情栏>px
 * ```
 *
 * 因此"工作台与对话区等宽、只留出左侧会话菜单栏"就等价于读取这三列的实际宽度。
 * 浏览器对 `getComputedStyle(...).gridTemplateColumns` 返回**已解析的像素值**
 * （如 `280px 976px 0px`），无需依赖任何哈希类名——只依赖 `data-shell-overlay` 这个
 * 语义标记与 grid 轨道顺序，二者都是 AppFrame 的公开结构。
 *
 * 启动按钮锚定到侧边栏底部的**设置按钮**：右边缘对齐（部分压在设置按钮上）、
 * 底边对齐。设置按钮由 `sidebar.settings` 槽位渲染在 `*_settingsArea` 容器里，
 * 是侧边栏最底部的一块；取不到时退化为"侧边栏右缘内缩 `SETTINGS_INSET`"。
 */

/** 会话区左右内缩（px）：`left` = 侧边栏宽度，`right` = 详情栏宽度。 */
export interface ShellInsets {
  /** 会话区左边界，即侧边栏宽度。 */
  readonly left: number
  /** 会话区右边界，即详情栏宽度（关闭时为 0）。 */
  readonly right: number
}

/** 启动按钮锚点（视口坐标）：右边缘对齐设置按钮右端，底边对齐设置按钮底端。 */
export interface LauncherAnchor {
  /** 设置按钮右端的绝对 x 坐标。 */
  readonly right: number
  /** 设置按钮底边距视口底部的距离。 */
  readonly bottom: number
}

/** shell 几何 = 会话区左右内缩 + 启动按钮锚点。 */
export interface ShellGeometry extends ShellInsets {
  readonly anchor: LauncherAnchor
}

/** 兜底内缩：取自 AppFrame 的契约默认宽度。 */
export const FALLBACK_INSETS: ShellInsets = { left: 280, right: 0 }

/** 设置按钮右端距侧边栏右缘的内缩（实查：280px 侧边栏时按钮右端在 x=270）。 */
export const SETTINGS_INSET = 10

/** overlay 层的语义标记（AppFrame 写在 div 上的 `data-shell-overlay`，非哈希类名）。 */
export const OVERLAY_SELECTOR = '[data-shell-overlay]'

/** 设置按钮所在容器（DSH 侧边栏 CSS Module 类名后缀 `_settingsArea`）。 */
const SETTINGS_AREA_SELECTOR = '[class*="_settingsArea"]'

/** 启动按钮的实测尺寸。 */
export interface LauncherSize {
  readonly width: number
  readonly height: number
}

/** 启动按钮的落点（视口坐标）：距视口左边 `left`，距视口底边 `bottom`。 */
export interface LauncherSpot {
  readonly left: number
  readonly bottom: number
}

/** 视口尺寸。 */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/** 启动按钮与视口 / 面板之间至少留的空白。 */
export const LAUNCHER_MARGIN = 8

/**
 * 拖回这个距离以内就"重新停靠"回默认位置（并恢复"跟随侧边栏"的行为）。
 *
 * 这样不必再造一个「复位」按钮：拖回原处就复位。阈值比 `LAUNCHER_MARGIN` 大一些，
 * 手抖几个像素不会被判成"想改位置"。
 */
export const LAUNCHER_SNAP = 20

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** 把落点夹进视口内：整个按钮都必须看得见。 */
export function clampLauncherSpot(
  spot: LauncherSpot,
  size: LauncherSize,
  viewport: Viewport,
): LauncherSpot {
  const maxLeft = Math.max(LAUNCHER_MARGIN, viewport.width - size.width - LAUNCHER_MARGIN)
  const maxBottom = Math.max(LAUNCHER_MARGIN, viewport.height - size.height - LAUNCHER_MARGIN)
  return {
    left: clamp(spot.left, LAUNCHER_MARGIN, maxLeft),
    bottom: clamp(spot.bottom, LAUNCHER_MARGIN, maxBottom),
  }
}

/** 两个落点是否近到可以认为"拖回原处了"。 */
export function nearLauncherSpot(a: LauncherSpot, b: LauncherSpot, radius = LAUNCHER_SNAP): boolean {
  return Math.abs(a.left - b.left) <= radius && Math.abs(a.bottom - b.bottom) <= radius
}

/**
 * 启动按钮的默认落点：右缘对齐侧边栏底部的设置按钮、底边对齐（一直以来的位置）。
 *
 * 但必须保证它**任何情况下都看得见**。侧边栏折叠后（实查 `280px → 56px`），会话区
 * 左侧那条带子只剩几十像素，按钮放不进去；旧实现在这种情况下退化成"贴设置按钮右侧"
 * （`anchor.right + 12`），整个人落在面板里，而两者 z-index 相同、`aside` 在 DOM 里
 * 更靠后——**按钮被面板盖住**（实测 `elementFromPoint` 命中 `aside`）。
 *
 * 现在分两种情况：带子里放得下就贴带子右缘（绝不越进面板）；放不下就贴视口左缘，
 * 由 `LAUNCHER_Z`（高于面板）保证浮在面板之上、仍然点得到。
 *
 * 展开态实测：`anchor.right=270 width=61 insets.left=280` → `left=209`，
 * 与原实现完全一致（**不改变默认位置**）。
 */
export function defaultLauncherSpot(
  anchor: LauncherAnchor,
  size: LauncherSize,
  insets: ShellInsets,
  viewport: Viewport,
): LauncherSpot {
  const band = insets.left - LAUNCHER_MARGIN - size.width
  const left = band >= LAUNCHER_MARGIN ? Math.min(anchor.right - size.width, band) : LAUNCHER_MARGIN
  return clampLauncherSpot({ left, bottom: anchor.bottom }, size, viewport)
}

/**
 * 启动按钮最终的落点。
 *
 * 用户拖过就以存下来的为准（仍夹在视口内——窗口变小后旧落点可能已经在屏幕外了）；
 * 没拖过就走 {@link defaultLauncherSpot}。
 */
export function launcherSpot(
  anchor: LauncherAnchor,
  size: LauncherSize,
  insets: ShellInsets,
  viewport: Viewport,
  override?: LauncherSpot | null,
): LauncherSpot {
  if (override === null || override === undefined) {
    return defaultLauncherSpot(anchor, size, insets, viewport)
  }
  return clampLauncherSpot(override, size, viewport)
}

/** 测量失败时的几何：契约默认宽度 + 设置按钮按内缩推定。 */
export function fallbackGeometry(): ShellGeometry {
  return {
    ...FALLBACK_INSETS,
    anchor: { right: FALLBACK_INSETS.left - SETTINGS_INSET, bottom: SETTINGS_INSET },
  }
}

/**
 * 从插件元素向上找到 overlay 层。
 *
 * 注意：插槽框架会在插件根元素与 overlay 层之间再包一层 `display: contents` 的 div，
 * 因此**不能用 `parentElement`**（那是包装层，其 `grid-template-columns` 是 `none`，
 * 会静默退化成兜底值）。
 */
export function overlayLayerOf(
  anchor: { closest(selector: string): Element | null } | null | undefined,
): Element | null {
  if (anchor === null || anchor === undefined) return null
  return anchor.closest(OVERLAY_SELECTOR)
}

/** 解析 `grid-template-columns` 计算值（`"280px 976px 0px"`）为像素宽度。 */
export function parseTracks(value: string): number[] {
  const tracks: number[] = []
  for (const part of value.split(/\s+/)) {
    const px = Number.parseFloat(part)
    if (Number.isFinite(px)) tracks.push(px)
  }
  return tracks
}

/** 由轨道宽度推导会话区左右内缩；缺失或非法值回退。 */
export function insetsFromTracks(tracks: readonly number[]): ShellInsets {
  const sidebar = tracks[0]
  const details = tracks.length > 2 ? tracks[2] : undefined
  return {
    left: sidebar !== undefined && sidebar >= 0 ? sidebar : FALLBACK_INSETS.left,
    right: details !== undefined && details >= 0 ? details : 0,
  }
}

/** 侧边栏列（AppFrame 的第一列）：判断"点击是否落在会话菜单栏里"用。 */
export function sidebarColumnOf(
  frame: { readonly children: ArrayLike<Element> } | null | undefined,
): Element | null {
  if (frame === null || frame === undefined) return null
  return frame.children[0] ?? null
}

/** 侧边栏底部的设置按钮；容器类名变化时退化为侧边栏内最后一个可见按钮。 */
function settingsButtonIn(sidebar: Element): HTMLElement | null {
  const scoped = sidebar.querySelector(`${SETTINGS_AREA_SELECTOR} button`)
  if (scoped instanceof HTMLElement) return scoped
  const visible = Array.from(sidebar.querySelectorAll('button')).filter(
    (button) => button.getBoundingClientRect().height > 0,
  )
  const last = visible[visible.length - 1]
  return last === undefined ? null : last
}

/**
 * 从 overlay 层的父元素（AppFrame 的 grid 容器）读出真实几何与锚点。
 * @param layer - overlay 层元素，取 `parentElement` 作为 frame。
 */
export function readShellGeometry(layer: { parentElement: Element | null }): ShellGeometry {
  const frame = layer.parentElement
  if (frame === null) return fallbackGeometry()

  const insets = insetsFromTracks(parseTracks(getComputedStyle(frame).gridTemplateColumns))
  const sidebar = frame.children[0]
  const button = sidebar === undefined ? null : settingsButtonIn(sidebar)
  if (button === null) {
    return {
      ...insets,
      anchor: { right: Math.max(0, insets.left - SETTINGS_INSET), bottom: SETTINGS_INSET },
    }
  }

  const rect = button.getBoundingClientRect()
  return {
    ...insets,
    anchor: { right: rect.right, bottom: Math.max(0, window.innerHeight - rect.bottom) },
  }
}
