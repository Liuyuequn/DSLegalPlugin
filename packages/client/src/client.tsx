/**
 * DSLegalPlugin client 插件：**法程**。
 *
 * ## 信息架构
 *
 * 界面以三条**并列且互斥**的线索组织内容，同一时刻只呈现一条：
 *
 * - **日程**：按时间读。三种形态——日 / 星期 / 月，各自展示对应范围内的**全部**日程安排。
 * - **待办**：按紧急度读。四个优先级各占一个**等面积**象限；每格只显示最近创建且
 *   当前界面能容纳的条目，只显示标题与完成状态。
 * - **项目**：按案件读。先列全部项目，点进某个项目看它的全部待办与日程。
 *
 * 另有「使用说明」入口（盖在面板之上的说明界面，不是第四条线索）与「数据目录」表单。
 *
 * ## 数据
 *
 * `/dslegal/overview` 一次取回完整数据集（全部项目 + 全部待办 + 全部日程），三条线索
 * 都在本地切片——切换线索不发请求、不会闪。写入统一走 `/dslegal/edit`，界面做乐观更新
 * 与失败回滚，`target: { line, title }` 的校验语义由 host 保证。
 *
 * ## 布局
 *
 * 面板铺满会话区（左边界 = 侧边栏宽度，右边界 = 详情栏宽度），几何实查见 `shell.ts`；
 * 「法程」启动按钮常驻在侧边栏底部、与设置按钮部分重叠，点击即开合。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PRIORITY_COLORS, type Priority } from '@dslegal/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import {
  EditError,
  getAgenda,
  getOverview,
  getSettings,
  HOST_OUTDATED_COLORS,
  postEdit,
  postOpenSource,
  postSettings,
  type Agenda,
  type Overview,
  type ScheduleRow,
  type TodoRow,
} from './api.js'
import {
  clampLauncherSpot,
  defaultLauncherSpot,
  fallbackGeometry,
  launcherSpot,
  nearLauncherSpot,
  overlayLayerOf,
  readShellGeometry,
  sidebarColumnOf,
  type LauncherSize,
  type LauncherSpot,
  type ShellGeometry,
  type Viewport,
} from './shell.js'
import * as UI from './styles.js'
import { T } from './styles.js'
import {
  composeDraftOf,
  composeEditBody,
  composeError as validateCompose,
  defaultComposeProject,
  openSourceMessage,
  todayKey,
  type ComposeDraft,
  type ComposeRequest,
  type ProjectRef,
  type Rect,
} from './view.js'
import {
  CreatePopover,
  HelpView,
  ProjectLens,
  ScheduleLens,
  SchedulePopover,
  TodoPopover,
  SetupForm,
  TodoLens,
  type ScheduleForm,
} from './views.js'

export const name = 'dslegal-client'

export const inject: string[] = []

const OVERLAY_SLOT = 'shell.overlay'

/**
 * 悬浮窗允许出现的范围 = **面板主体区**（不是整个面板）。
 *
 * 面板顶端是首行菜单与横幅，悬浮窗盖上去会挡住导航——而它只是"看一眼这条日程"，
 * 不该拥有比导航更高的优先级。
 *
 * 主体区还没布局（首帧就点了，尺寸为 0）时退回整个视口：宁可放宽，也不要算出一个
 * 宽高为 0 的矩形——那会让 `popoverPosition` 把落点夹到一个点上。
 */
function popoverBounds(body: HTMLElement | null, geometry: ShellGeometry): Rect {
  if (body !== null) {
    const rect = body.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }
  }
  return {
    left: geometry.left,
    top: 0,
    right: window.innerWidth - geometry.right,
    bottom: window.innerHeight,
  }
}
const OVERLAY_ID = 'dslegal-workbench'

/** 三条线索。 */
type Lens = 'schedule' | 'todo' | 'project'

const LENSES: readonly { readonly key: Lens; readonly label: string; readonly hint: string }[] = [
  { key: 'schedule', label: '日程', hint: '按时间读：日 / 周 / 月三种形态' },
  { key: 'todo', label: '待办', hint: '按紧急度读：四个优先级等面积四象限' },
  { key: 'project', label: '项目', hint: '按案件读：先列项目，点进去看详情' },
]

/** 项目详情的当前项目。 */
type Scope = { readonly project: string; readonly topLevelDir: string } | null

interface SlotsLike {
  inject(name: string, callback: () => void): void
  register(options: { name: string; id?: string }, component: (props: unknown) => unknown): () => void
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 乐观更新的键。 */
function keyOf(project: string, line: number): string {
  return `${project}#${line}`
}

/** 「使用说明已经看过」的标记；隐私模式下 localStorage 会抛异常，此时按"已看过"处理（不打扰）。 */
const HELP_FLAG = 'dslegal.help.seen.v1'

function helpSeen(): boolean {
  try {
    return window.localStorage.getItem(HELP_FLAG) === '1'
  } catch {
    return true
  }
}

function markHelpSeen(): void {
  try {
    window.localStorage.setItem(HELP_FLAG, '1')
  } catch {
    // 存不了就算了，最多下次再自动展示一遍说明。
  }
}

/** 启动按钮被拖动之后的落点；存起来免得每次刷新都回到默认位置。 */
const LAUNCHER_SPOT_KEY = 'dslegal.launcher.spot.v1'

/**
 * 上次新建条目时写进的那个项目。
 *
 * 待办 / 日程线索都是**跨项目**的，那两处点空白时用户并没有指定案件；记一下上次的选择，
 * 连着录三条时就不必每条都选一次案件。项目改名或删掉之后这个记忆会被忽略
 * （见 `view.ts` 的 `defaultComposeProject`）。
 */
const COMPOSE_PROJECT_KEY = 'dslegal.compose.project.v1'

function readComposeProject(): ProjectRef | null {
  try {
    const raw = window.localStorage.getItem(COMPOSE_PROJECT_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { project, topLevelDir } = parsed as { project?: unknown; topLevelDir?: unknown }
    if (typeof project !== 'string' || typeof topLevelDir !== 'string') return null
    return { project, topLevelDir }
  } catch {
    return null
  }
}

function writeComposeProject(ref: ProjectRef): void {
  try {
    window.localStorage.setItem(COMPOSE_PROJECT_KEY, JSON.stringify(ref))
  } catch {
    // 存不了就只在本次会话里生效。
  }
}

/**
 * 移动超过这么多像素才算"拖动"，否则仍按点击处理。
 *
 * 没有这个阈值，手抖 1px 就会变成一次拖动：面板不开合，位置还偏了一点。
 */
const DRAG_THRESHOLD = 4

function readLauncherSpot(): LauncherSpot | null {
  try {
    const raw = window.localStorage.getItem(LAUNCHER_SPOT_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { left, bottom } = parsed as { left?: unknown; bottom?: unknown }
    // 只接受有限数：写坏了就当作"没拖过"，不要凭空猜一个位置出来。
    if (typeof left !== 'number' || typeof bottom !== 'number') return null
    if (!Number.isFinite(left) || !Number.isFinite(bottom)) return null
    return { left, bottom }
  } catch {
    return null
  }
}

function writeLauncherSpot(spot: LauncherSpot | null): void {
  try {
    if (spot === null) window.localStorage.removeItem(LAUNCHER_SPOT_KEY)
    else window.localStorage.setItem(LAUNCHER_SPOT_KEY, JSON.stringify(spot))
  } catch {
    // 存不了就只在本次会话里生效。
  }
}

/** shell 几何 + 启动按钮实测尺寸。 */
interface ShellState {
  readonly geometry: ShellGeometry
  readonly launcherSize: LauncherSize
}

function sameSize(a: LauncherSize, b: LauncherSize): boolean {
  return a.width === b.width && a.height === b.height
}

function sameGeometry(a: ShellGeometry, b: ShellGeometry): boolean {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.anchor.right === b.anchor.right &&
    a.anchor.bottom === b.anchor.bottom
  )
}

/**
 * 读取会话区几何与启动按钮锚点（设置按钮右端 / 底端），随 shell 布局变化实时更新。
 *
 * `anchor` 指向本插件渲染的元素；插槽框架会在它与 overlay 层之间再包一层
 * `display: contents` 的 div，故必须用 `closest` 找到 `[data-shell-overlay]`，
 * 不能直接取 `parentElement`。
 *
 * 重测触发源有三条，缺一不可：
 * 1. `MutationObserver` 盯 frame 的行内 `style`——侧边栏拖动与详情栏开合都是改这一行；
 *    它是**微任务**，标签页在后台（rAF / ResizeObserver 被浏览器节流）时依然会触发。
 * 2. `ResizeObserver` 盯 frame 与三列——视口变化引起的轨道重排不走行内 style。
 * 3. `resize` / `visibilitychange`——兜底，回到前台立刻重测。
 *
 * 测量是同步的，不做 rAF 合并：ResizeObserver 本身按帧批量回调，再加 rAF 只会在
 * 后台标签页里把更新永久推迟（实测踩过）。
 */
function useShellGeometry(anchor: RefObject<HTMLElement | null>): ShellState {
  const [state, setState] = useState<ShellState>(() => ({
    geometry: fallbackGeometry(),
    launcherSize: { width: 0, height: 0 },
  }))

  useLayoutEffect(() => {
    const layer = overlayLayerOf(anchor.current)
    if (layer === null) return

    const apply = (): void => {
      setState((prev) => {
        const node = anchor.current
        // 拖动后的落点要夹在视口内，所以宽**和**高都得量。
        const rect = node !== null && node.tagName === 'BUTTON' ? node.getBoundingClientRect() : null
        const launcherSize: LauncherSize =
          rect === null ? prev.launcherSize : { width: rect.width, height: rect.height }
        const geometry = readShellGeometry(layer)
        return sameGeometry(prev.geometry, geometry) && sameSize(prev.launcherSize, launcherSize)
          ? prev
          : { geometry, launcherSize }
      })
    }

    apply()

    const frame = layer.parentElement
    const resize = new ResizeObserver(apply)
    resize.observe(layer)
    if (frame !== null) {
      resize.observe(frame)
      for (const column of Array.from(frame.children)) resize.observe(column)
    }
    const styleWatch = new MutationObserver(apply)
    if (frame !== null) styleWatch.observe(frame, { attributes: true, attributeFilter: ['style'] })

    window.addEventListener('resize', apply)
    document.addEventListener('visibilitychange', apply)

    return () => {
      resize.disconnect()
      styleWatch.disconnect()
      window.removeEventListener('resize', apply)
      document.removeEventListener('visibilitychange', apply)
    }
  }, [anchor])

  return state
}

/** 法程面板。 */
function Workbench(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [lens, setLens] = useState<Lens>('schedule')
  const [form, setForm] = useState<ScheduleForm>('day')
  const [cursor, setCursor] = useState(() => todayKey())
  const [scope, setScope] = useState<Scope>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [agenda, setAgenda] = useState<Agenda | null>(null)
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null)
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [hover, setHover] = useState<string | null>(null)
  const [dataRoot, setDataRoot] = useState<string | null>(null)
  /** 数据目录表单：未设定时自动进入；已设定时由「数据目录」按钮进入。 */
  const [setup, setSetup] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * 四象限颜色的草稿。
   *
   * 与数据目录分开保存：两件事互不依赖，合成一个「保存」会让"只想换个颜色"的人
   * 也被路径校验拦住。草稿初值取当前生效值，保存成功后用服务端回的值覆盖
   * （服务端会把非法颜色逐键兜底成默认色，回值才是真相）。
   */
  const [colorDraft, setColorDraft] = useState<Record<Priority, string> | null>(null)
  const [colorError, setColorError] = useState<string | null>(null)
  const [savingColors, setSavingColors] = useState(false)
  const [defaultColors, setDefaultColors] = useState<Record<Priority, string> | null>(null)
  /** 使用说明：首次打开自动展示一次，之后由顶部「使用说明」按钮进入。 */
  const [help, setHelp] = useState(() => !helpSeen())
  /**
   * 日程明细悬浮窗。
   *
   * 存的是**这一条的身份**（`项目 + 行号`，与乐观更新用的是同一个键）而不是 `row` 对象本身：
   * 窗里那个「完成 / 未完成」按钮会触发 `refresh()`，若抱着旧对象，切换完还会显示旧状态。
   * 每次渲染都从最新总览里按身份取回当前值，顺带也就免疫了"文件被外部改动"。
   *
   * `anchor` 是**点击那一刻**条的屏幕位置；位置一变（换线索、窗口尺寸变化）就关掉，
   * 不做跟随重定位——跟随要持续观测，收益不值那份复杂度。
   */
  const [detail, setDetail] = useState<{
    readonly kind: 'schedule' | 'todo'
    readonly project: string
    readonly line: number
    readonly anchor: Rect
  } | null>(null)
  /**
   * 明细窗要显示的那一条：**按身份现取**，不抱着点击那一刻的对象。
   *
   * 两种条目共用同一个 `detail`，靠 `kind` 决定去哪张表里找——待办与日程的行号
   * 在各自章节里各算各的，光看 `project + line` 会取错条目。
   */
  const detailRow =
    detail === null || overview === null
      ? null
      : (() => {
          const from =
            detail.kind === 'todo' ? overview.todos : overview.schedules
          const found = from.find(
            (row) => row.project === detail.project && row.line === detail.line,
          )
          return found === undefined ? null : { kind: detail.kind, row: found }
        })()
  /**
   * 新建条目的悬浮窗。
   *
   * `draft` 是受控表单；`anchor` 是**点击那一刻的鼠标位置**——窗从用户刚点的地方长出来。
   * 项目由"点在哪儿"给一个**默认值**（项目详情里点就是那个案件，象限标题里点就是上次
   * 用过的那个），但窗里的选择器随时能改成别的案件——**默认值不是锁**。用户反馈过
   * "看起来写死了一个案子、改不了"，所以这个字段连"锁死"这个状态都不留。
   */
  const [compose, setCompose] = useState<{
    readonly draft: ComposeDraft
    readonly anchor: Rect
  } | null>(null)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [composeSaving, setComposeSaving] = useState(false)
  /** 上次新建写进的项目。 */
  const composeMemoryRef = useRef<ProjectRef | null>(readComposeProject())
  /**
   * "这一次点击已经被上一次浮层消费掉了"。
   *
   * 悬浮窗的关闭方式是"点别处"。若不给这一道，**关闭的那一次点击会顺手再开一个窗**：
   * 用户点空白想关掉明细窗，结果关掉一个又弹出来一个新建窗。所以文档级 `pointerdown`
   * 在"确实关了东西"时立一个标记，紧跟着的那次 `click` 落到热区上就被吞掉。
   *
   * 标记在**每次按下时先复位**，只对它自己那一次交互有效——否则一次误吞会让下一次
   * 正经的点击也没反应。
   */
  const swallowBlankRef = useRef(false)
  /** 有没有浮层开着（供上面那个文档级监听判断，用 ref 免去反复重装监听）。 */
  const popoverOpenRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  // 这一条没了（文件被外部改过、或用户刚把它删了）：窗自己关掉，别留一个空壳。
  useEffect(() => {
    if (detail !== null && overview !== null && detailRow === null) setDetail(null)
  }, [detail, detailRow, overview])
  const { geometry, launcherSize } = useShellGeometry(anchorRef)
  /**
   * 启动按钮被拖到哪儿了。`null` = 没拖过，用默认位置（贴着侧边栏底部的设置按钮）。
   *
   * 初值从 `localStorage` 读：拖一次就该一直记住，否则每次刷新都弹回去，等于白拖。
   */
  const [launcherMoved, setLauncherMoved] = useState<LauncherSpot | null>(() => readLauncherSpot())
  /** 视口尺寸。窗口一变就要重算落点（旧的拖放位置可能已经在屏幕外了）。 */
  const [viewport, setViewport] = useState<Viewport>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  /** 本次按下是否已经变成"拖动"。用来区分"点一下开合"和"拖到别处"。 */
  const dragRef = useRef<{
    readonly startX: number
    readonly startY: number
    readonly from: LauncherSpot
    moved: boolean
  } | null>(null)
  /** 拖动收尾那一次 `click` 要吞掉，否则松手就等于顺手开合了一次面板。 */
  const swallowClickRef = useRef(false)

  /** 默认位置（贴着侧边栏底部的设置按钮）。 */
  const defaultSpot = defaultLauncherSpot(geometry.anchor, launcherSize, geometry, viewport)
  /** 实际位置：拖过就听用户的，没拖过就用默认。 */
  const launcherBox = launcherSpot(geometry.anchor, launcherSize, geometry, viewport, launcherMoved)

  useEffect(() => {
    const onResize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /**
   * 启动按钮的拖动。
   *
   * 用 Pointer Events + `setPointerCapture`：鼠标移出按钮（甚至移出视口）时事件仍然打在
   * 这个元素上，拖到一半不会断。
   *
   * **开合仍然走 `onClick`**，不是自己处理 `pointerup`——否则键盘 Enter / 空格就失效了。
   * 拖动过的那一次 `click` 由 `swallowClickRef` 吞掉。
   */
  const onLauncherPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    swallowClickRef.current = false
    dragRef.current = { startX: event.clientX, startY: event.clientY, from: launcherBox, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onLauncherPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    // 手抖几个像素不算拖动，否则"点一下"永远会变成一次 1px 的位移。
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    drag.moved = true
    setLauncherMoved(
      clampLauncherSpot(
        { left: drag.from.left + dx, bottom: drag.from.bottom - dy },
        launcherSize,
        viewport,
      ),
    )
  }

  const onLauncherPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag === null || !drag.moved) return
    swallowClickRef.current = true
    // 拖回原处就"重新停靠"：清掉落点、恢复"跟随侧边栏"。这样不必再造一个复位按钮，
    // 也顺着"拖回去 = 回到原位"的直觉。
    const dropped = clampLauncherSpot(
      {
        left: drag.from.left + (event.clientX - drag.startX),
        bottom: drag.from.bottom - (event.clientY - drag.startY),
      },
      launcherSize,
      viewport,
    )
    const next = nearLauncherSpot(dropped, defaultSpot) ? null : dropped
    setLauncherMoved(next)
    writeLauncherSpot(next)
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getOverview()
      setOverview(next)
      setDataRoot(next.dataRoot)
      // 草稿只在"还没草稿"或"草稿与服务端一致"时跟随服务端，不覆盖用户正在编辑的值。
      setColorDraft((draft) => draft ?? next.priorityColors)
      // host 较旧（没下发颜色）：面板照常可用，但要说清楚自定义颜色这次没生效。
      if (next.colorsUnavailable === true) {
        setBanner({ kind: 'warn', text: HOST_OUTDATED_COLORS })
      }
      // 未设定数据目录：界面只显示路径输入框（数据来源未知时其余功能无意义）。
      if (!next.configured) {
        setSetup(true)
        setPathError(null)
      }
    } catch (cause) {
      setBanner({ kind: 'warn', text: messageOf(cause) })
    } finally {
      setLoading(false)
    }
  }, [])

  /** 打开设置页：把草稿对齐到当前生效值，并取一次出厂默认色。 */
  const openSetup = useCallback(async () => {
    setPathError(null)
    setColorError(null)
    setSetup(true)
    // 颜色草稿先落到总览里的那一份（它**一定有值**：`getOverview` 对旧 host 会兜底成
    // 默认色）。别指望 `/dslegal/settings`——旧 host 不返回颜色字段，直接信它会渲染成
    // `undefined[优先级]` 并把整个面板带崩（实测踩过）。
    setColorDraft((draft) => draft ?? overview?.priorityColors ?? null)
    try {
      const settings = await getSettings()
      if (settings.priorityColors !== undefined) setColorDraft(settings.priorityColors)
      setDefaultColors(settings.defaultPriorityColors ?? null)
    } catch {
      // 取不到就沿用上面那一份——设置页不该因为这一路失败而打不开。
    }
  }, [overview])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (help) markHelpSeen()
  }, [help])

  /** 说明界面盖住整个面板，Escape 只收起它，不影响面板开合。 */
  useEffect(() => {
    if (!help) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setHelp(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [help])

  /**
   * 点击左侧会话菜单栏时收起面板。
   *
   * 侧边栏是别的插件的 DOM，面板又不覆盖它，所以只能从外部观察：在**捕获阶段**
   * 监听 `pointerdown`（即使侧边栏内部阻止冒泡也能收到），命中侧边栏列即收起。
   * 会话项、工作区、新建会话、搜索框都算——"离开法程去别处"的意图是一致的。
   */
  useEffect(() => {
    if (!open) return
    const layer = overlayLayerOf(anchorRef.current)
    const sidebar = sidebarColumnOf(layer?.parentElement ?? null)
    if (sidebar === null) return
    const dismiss = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && sidebar.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [open])

  /** 项目详情：只为格式异常清单取一次明细（待办与日程直接用总览切片，切换即可见）。 */
  useEffect(() => {
    if (!open || scope === null) {
      setAgenda(null)
      return
    }
    let cancelled = false
    void getAgenda(scope.project, scope.topLevelDir)
      .then((next) => {
        if (!cancelled) setAgenda(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setBanner({ kind: 'warn', text: messageOf(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [open, scope])

  const saveDataRoot = useCallback(async () => {
    const value = pathDraft.trim()
    if (value.length === 0) return
    setSaving(true)
    setPathError(null)
    try {
      const saved = await postSettings({ dataRoot: value })
      setDataRoot(saved.dataRoot)
      setPathDraft(saved.dataRoot ?? value)
      setSetup(false)
      await refresh()
    } catch (cause) {
      setPathError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }, [pathDraft, refresh])

  /** 保存四象限颜色；服务端回值才是真相（非法值会被逐键兜底成默认色）。 */
  const saveColors = useCallback(async () => {
    if (colorDraft === null) return
    // host 较旧时连请求都不必发：旧 host 的 POST 只认 dataRoot，会回一句
    // 「缺少 dataRoot。」——那个提示对用户毫无意义，直接给可执行的说明。
    if (overview?.colorsUnavailable === true) {
      setColorError(HOST_OUTDATED_COLORS)
      return
    }
    setSavingColors(true)
    setColorError(null)
    try {
      const saved = await postSettings({ priorityColors: colorDraft })
      setColorDraft(saved.priorityColors)
      setDefaultColors(saved.defaultPriorityColors)
      setColorError(saved.colorIssues.map((issue) => issue.message).join(' ') || null)
      await refresh()
    } catch (cause) {
      setColorError(messageOf(cause))
    } finally {
      setSavingColors(false)
    }
  }, [colorDraft, overview, refresh])

  /**
   * 写回：乐观更新 → 失败回滚。
   *
   * host 的 stale 守卫（`target` 与文件不一致）意味着文件被外部改过，此时按"以文件为准"
   * 重新加载并如实提示，不覆盖用户的改动。
   */
  const toggle = useCallback(
    async (input: {
      readonly kind: 'todo' | 'schedule'
      readonly row: { readonly project: string; readonly topLevelDir: string; readonly line: number; readonly title: string; readonly done: boolean }
    }) => {
      const key = keyOf(input.row.project, input.row.line)
      const next = !input.row.done
      setOptimistic((prev) => ({ ...prev, [key]: next }))
      const clear = (): void =>
        setOptimistic((prev) => {
          const copy = { ...prev }
          delete copy[key]
          return copy
        })
      try {
        await postEdit({
          op: input.kind === 'todo' ? 'todo.set' : 'schedule.set',
          project: input.row.project,
          topLevelDir: input.row.topLevelDir,
          target: { line: input.row.line, title: input.row.title },
          input: { done: next },
        })
        clear()
        await refresh()
      } catch (cause) {
        clear()
        if (cause instanceof EditError && cause.code === 'stale') {
          setBanner({ kind: 'info', text: `文件已变更，已重新加载：${cause.message}` })
          await refresh()
        } else {
          setBanner({ kind: 'warn', text: messageOf(cause) })
        }
      }
    },
    [refresh],
  )

  const toggleTodo = useCallback((row: TodoRow) => void toggle({ kind: 'todo', row }), [toggle])
  const toggleSchedule = useCallback(
    (row: ScheduleRow) => void toggle({ kind: 'schedule', row }),
    [toggle],
  )
  const doneOf = useCallback(
    (row: { readonly project: string; readonly line: number; readonly done: boolean }): boolean =>
      optimistic[keyOf(row.project, row.line)] ?? row.done,
    [optimistic],
  )

  /**
   * 打开某一条日程的明细悬浮窗。
   *
   * 只在**点到日程本体**时被调用——月历格子自己不可点。用户的要求是"细化到「日程」
   * 这个维度，而不是「日」这个维度"，所以这里拿到的必须是具体某一条（`project + line`），
   * 而不是"某一天"。
   */
  const openSchedule = useCallback((row: ScheduleRow, anchor: Rect) => {
    setDetail({ kind: 'schedule', project: row.project, line: row.line, anchor })
  }, [])

  /**
   * 打开某一条待办的明细悬浮窗（与 `openSchedule` 对称）。
   *
   * 待办条散布在四个象限与项目详情里，但它们上报的都是"某一条"（`project + line`），
   * 所以这里只有一条路径——**同一个手势，同一张窗**。
   */
  const openTodo = useCallback((row: TodoRow, anchor: Rect) => {
    setDetail({ kind: 'todo', project: row.project, line: row.line, anchor })
  }, [])

  /**
   * 「点日程标题 → 打开原始 markdown」。
   *
   * 三件事：
   *
   * 1. **只送 project + line**，路径由 host 解析（它才知道数据根目录；界面能传路径的话，
   *    这个接口就成了"启动任意本机程序"的后门）。
   * 2. **窗不关**：打开的是外部编辑器，用户回来大概率还要接着看这条日程（或改状态）。
   * 3. **结果如实报**：跳行没跳成、文件已被外部改过，都要在横幅里说出来。
   */
  const openSource = useCallback(async (row: {
    readonly project: string
    readonly topLevelDir: string
    readonly line: number
    readonly kind: 'schedule' | 'todo'
  }) => {
    try {
      const result = await postOpenSource({
        project: row.project,
        topLevelDir: row.topLevelDir,
        kind: row.kind,
        line: row.line,
      })
      setBanner(openSourceMessage(result))
    } catch (cause) {
      setBanner({ kind: 'warn', text: messageOf(cause) })
    }
  }, [])

  /**
   * 点在空白处 → 开新建窗。
   *
   * 两件事在这里定下来：
   *
   * 1. **写到哪个项目**。项目详情里点的，案件已经由点击位置决定（锁死）；
   *    待办 / 日程线索是跨项目的，用"上次写过的那个项目"兜底，没有记忆就用第一个。
   *    一个已就绪的项目都没有时不开窗——那会是一张注定写不进去的表单，不如直说。
   * 2. **预填什么**。优先级来自"点的是哪个象限"，日期来自"点的是哪一格"，
   *    这两件事视图层已经算好，`composeDraftOf` 只负责把它铺成一张草稿。
   */
  const openCompose = (request: ComposeRequest): void => {
    // 这一次点击刚被上一个浮层用掉了（用户是在"关窗"，不是在"新建"）。
    if (swallowBlankRef.current) {
      swallowBlankRef.current = false
      return
    }
    if (overview === null) return
    const fallback = defaultComposeProject(overview.projects, composeMemoryRef.current)
    const draft = composeDraftOf(request, fallback, overview.today)
    if (draft === null) {
      setBanner({
        kind: 'warn',
        text: '没有找到已就绪的项目，无法新建。已就绪 = 存在「<数据根目录>/<顶级目录>/<项目>/0. 协作/1. 工作日志.md」。',
      })
      return
    }
    // 明细窗与新建窗不同时在场：它们锚的是同一个点，叠起来只会互相挡。
    setDetail(null)
    setComposeError(null)
    setCompose({ draft, anchor: request.anchor })
  }

  /** 提交新建。校验用 `@dslegal/core` 的渲染器，与 host 落盘前是同一份规则。 */
  const submitCompose = async (): Promise<void> => {
    if (compose === null || composeSaving) return
    const message = validateCompose(compose.draft)
    if (message !== null) {
      setComposeError(message)
      return
    }
    setComposeSaving(true)
    setComposeError(null)
    try {
      await postEdit(composeEditBody(compose.draft))
      const { kind, project, topLevelDir, title } = compose.draft
      writeComposeProject({ project, topLevelDir })
      composeMemoryRef.current = { project, topLevelDir }
      setCompose(null)
      setBanner({
        kind: 'info',
        text: `已新增${kind === 'todo' ? '待办' : '日程'}：${title.trim()}（${project}）`,
      })
      await refresh()
    } catch (cause) {
      // 窗**不关**：用户刚敲进去的一段话不能因为一次写入失败就丢了。
      setComposeError(messageOf(cause))
    } finally {
      setComposeSaving(false)
    }
  }

  /**
   * 浮层的关闭方式：点别处、按 Esc。窗口尺寸变化只关明细窗。
   *
   * 监听**装一次就够**（用 ref 读当前有没有浮层开着），这样"按下先复位吞掉标记"这件事
   * 每一次点击都会发生，而不是只在浮层开着的时候。
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null
      // 点在浮层自己身上不算"点别处"——表单里点任何一个输入框都不该把窗关掉。
      const inside =
        target !== null &&
        target.closest(
          '[data-fl="schedule-popover"], [data-fl="todo-popover"], [data-fl="create-popover"]',
        ) !== null
      swallowBlankRef.current = false
      if (inside) return
      // 确实关了东西：紧接着那一次 click 落到空白热区上要吞掉，否则"关一个窗"会顺手
      // 再开一个（见 `swallowBlankRef`）。
      if (popoverOpenRef.current) swallowBlankRef.current = true
      setDetail(null)
      setCompose(null)
      setComposeError(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setDetail(null)
      setCompose(null)
      setComposeError(null)
    }
    // 明细窗锚的是"点某一条时它的位置"，窗口一变那条就不在那儿了，关掉。
    // **新建窗不关**：它锚的是鼠标点过的一个点，落点会被重新夹进可视区，而用户可能
    // 已经敲了半行字——为了"锚点略偏"丢掉输入是不划算的。
    const onResize = (): void => setDetail(null)
    // 捕获阶段：面板里其他元素若 stopPropagation，冒泡阶段就收不到了。
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    popoverOpenRef.current = detail !== null || compose !== null
  })

  // 换线索 / 换形态 / 进设置页时收起浮层：明细窗锚定的那个条、新建窗锚定的那块空白，
  // 都已经不在屏幕上了。
  useEffect(() => {
    setDetail(null)
    setCompose(null)
    setComposeError(null)
  }, [lens, form, setup, help])

  const viewProps =
    overview === null
      ? null
      : {
          overview,
          hover,
          setHover,
          doneOf,
          onToggleTodo: toggleTodo,
          onToggleSchedule: toggleSchedule,
          onOpenSchedule: openSchedule,
          onOpenTodo: openTodo,
          onCompose: openCompose,
        }

  /**
   * 主体区是否由它自己滚动。
   *
   * **只有设置表单需要**：它是一张长表单，自己没有滚动容器；主体区不滚就会把底部
   * 「保存颜色 / 全部恢复默认」那一排按钮裁掉且够不着（实测 1440×560 时溢出 121px，
   * 而当时主体区是 `overflow-y: hidden`）。
   *
   * **其余线索各自带滚动容器**（日卡扇、项目列表、项目详情用的都是 `listColumn()`），
   * 主体区再挂一层 `overflow-y: auto` 就是两层嵌套滚动条。实测主体区一直是
   * `clientH == scrollH`（从来没真的滚过），所以那一层是多余的，去掉。
   * 四象限尤其不能滚：它要按主体区实测高度换算"每格放几行"。
   */
  const scrollBody = setup

  return (
    <>
      {/* 常驻开关：面板展开时也不隐藏，再点一次收起整个法程面板。
          可以按住拖到任意位置（落点存 localStorage）；开合仍走 onClick，
          所以键盘 Enter / 空格照常可用，拖动收尾的那一次 click 会被吞掉。 */}
      <button
        type="button"
        data-fl="launcher"
        ref={(node) => {
          anchorRef.current = node
        }}
        style={UI.launcher(launcherBox, open, hover === 'launcher')}
        aria-expanded={open}
        title={
          launcherMoved === null
            ? '法程：点击开合，按住可拖动'
            : '法程：点击开合，按住可拖动（拖回原处即恢复默认位置）'
        }
        onMouseEnter={() => setHover('launcher')}
        onMouseLeave={() => setHover(null)}
        onPointerDown={onLauncherPointerDown}
        onPointerMove={onLauncherPointerMove}
        onPointerUp={onLauncherPointerUp}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onClick={() => {
          if (swallowClickRef.current) {
            swallowClickRef.current = false
            return
          }
          setOpen((value) => !value)
        }}
      >
        法程
      </button>

      {open ? (
        <div style={UI.backdrop(geometry.left, geometry.right)} onClick={() => setOpen(false)} />
      ) : null}

      {open ? (
        <aside style={UI.panel(geometry.left, geometry.right)} role="complementary" aria-label="法程">
          <header style={UI.topBar}>
            {setup ? (
              <>
                {/* 只写「插件设置」：这个子页现在装的是数据目录 + 四象限颜色两块，
                    标题里再缀一个「· 数据目录」会让人以为只有那一件事。 */}
                <span style={UI.sectionTitle}>插件设置</span>
                <span style={{ flex: 1 }} />
                {/* 设置子页只留一个出口。这里原本还有一个「使用说明」，但设置页是
                    一个"改完就走"的表单，右侧堆两个按钮只会让人犹豫点哪个；
                    使用说明在首行菜单上一直有，不必在这儿再来一个。 */}
                <button
                  type="button"
                  style={UI.textButton(hover === 'cancel-setup')}
                  onMouseEnter={() => setHover('cancel-setup')}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    setSetup(false)
                    setPathError(null)
                  }}
                >
                  返回
                </button>
              </>
            ) : (
              <>
                {/* 首行只放三种显示逻辑的按钮，不再放插件名——面板本身已经占满会话区，
                    左上角再写一遍"法程"只是重复占位。 */}
                {LENSES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    style={UI.tab(lens === item.key, hover === `lens-${item.key}`)}
                    title={item.hint}
                    aria-pressed={lens === item.key}
                    onMouseEnter={() => setHover(`lens-${item.key}`)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => {
                      setLens(item.key)
                      // 线索互斥：离开项目线索就回到项目清单，避免下次进来还停在某个案件里。
                      if (item.key !== 'project') setScope(null)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                {/* 三个入口用同一个样式：它们都是"打开某个东西"的同级动作，
                    没有谁比谁更该被画成描边按钮。其中「使用说明」靠文字本身
                    被认出来（一直写着四个字，不是图标）。 */}
                <button
                  type="button"
                  style={UI.textButton(hover === 'help')}
                  onMouseEnter={() => setHover('help')}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHelp(true)}
                >
                  使用说明
                </button>
                <button
                  type="button"
                  style={UI.textButton(hover === 'data-root')}
                  title={dataRoot ?? ''}
                  onMouseEnter={() => setHover('data-root')}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    setPathDraft(dataRoot ?? '')
                    void openSetup()
                  }}
                >
                  插件设置
                </button>
                <button
                  type="button"
                  style={UI.textButton(hover === 'refresh')}
                  onMouseEnter={() => setHover('refresh')}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => void refresh()}
                >
                  {loading ? '数据刷新中…' : '数据刷新'}
                </button>
              </>
            )}
          </header>

          {banner !== null ? (
            <div data-fl="banner" data-fl-kind={banner.kind} style={UI.banner(banner.kind)} role="status">
              <span style={{ flex: 1 }}>{banner.text}</span>
              <button
                type="button"
                style={UI.iconButton(hover === 'banner')}
                onMouseEnter={() => setHover('banner')}
                onMouseLeave={() => setHover(null)}
                onClick={() => setBanner(null)}
                aria-label="关闭提示"
              >
                ×
              </button>
            </div>
          ) : null}

          <div
            ref={(node) => {
              bodyRef.current = node
            }}
            data-fl="panel-body"
            style={UI.body(scrollBody)}
          >
            {setup ? (
              <SetupForm
                value={pathDraft}
                error={pathError}
                saving={saving}
                canCancel={dataRoot !== null}
                hover={hover}
                setHover={setHover}
                onChange={setPathDraft}
                onSave={() => void saveDataRoot()}
                onCancel={() => {
                  setSetup(false)
                  setPathError(null)
                }}
                colors={colorDraft}
                defaultColors={defaultColors}
                colorError={colorError}
                savingColors={savingColors}
                colorsUnavailable={overview?.colorsUnavailable === true}
                onChangeColor={(priority, value) => {
                  setColorDraft((draft) => (draft === null ? draft : { ...draft, [priority]: value }))
                  setColorError(null)
                }}
                onResetColors={() => {
                  if (defaultColors === null) return
                  setColorDraft({ ...defaultColors })
                  setColorError(null)
                }}
                onSaveColors={() => void saveColors()}
              />
            ) : viewProps === null ? (
              <div style={UI.empty}>
                {loading ? '正在读取工作日志…' : '尚未取得数据。请点右上角「数据刷新」，或先在上方提示里处理问题。'}
              </div>
            ) : lens === 'schedule' ? (
              <ScheduleLens
                {...viewProps}
                form={form}
                setForm={setForm}
                cursor={cursor}
                setCursor={setCursor}
              />
            ) : lens === 'todo' ? (
              <TodoLens {...viewProps} />
            ) : (
              <ProjectLens {...viewProps} scope={scope} setScope={setScope} agenda={agenda} />
            )}
          </div>

          {/* 悬浮窗挂在**面板**下、主体区之外：格子里有 `overflow: hidden`，
              挂进去会被裁掉。它渲染在说明层之前，所以说明页打开时会盖住它
              （那条路径上悬浮窗本来也已经关掉了）。 */}
          {detail === null || detailRow === null ? null : detailRow.kind === 'todo' ? (
            <TodoPopover
              row={detailRow.row as TodoRow}
              anchor={detail.anchor}
              bounds={popoverBounds(bodyRef.current, geometry)}
              origin={{ left: geometry.left, top: 0 }}
              color={
                detailRow.row.priority === undefined
                  ? T.unset
                  : (overview?.priorityColors[detailRow.row.priority] ?? T.unset)
              }
              done={doneOf(detailRow.row)}
              hover={hover}
              setHover={setHover}
              onToggle={() => void toggleTodo(detailRow.row as TodoRow)}
              onOpenSource={() => void openSource({ ...(detailRow.row as TodoRow), kind: 'todo' })}
            />
          ) : (
            <SchedulePopover
              row={detailRow.row as ScheduleRow}
              anchor={detail.anchor}
              bounds={popoverBounds(bodyRef.current, geometry)}
              origin={{ left: geometry.left, top: 0 }}
              color={
                detailRow.row.priority === undefined
                  ? T.unset
                  : (overview?.priorityColors[detailRow.row.priority] ?? T.unset)
              }
              done={doneOf(detailRow.row)}
              hover={hover}
              setHover={setHover}
              onToggle={() => void toggleSchedule(detailRow.row as ScheduleRow)}
              onOpenSource={() => void openSource({ ...(detailRow.row as ScheduleRow), kind: 'schedule' })}
            />
          )}

          {/* 新建窗：同样挂在面板下（它比明细窗还宽，挂在格子里必然被裁）。 */}
          {compose === null ? null : (
            <CreatePopover
              draft={compose.draft}
              anchor={compose.anchor}
              bounds={popoverBounds(bodyRef.current, geometry)}
              origin={{ left: geometry.left, top: 0 }}
              projects={overview?.projects ?? []}
              priorityColors={overview?.priorityColors ?? PRIORITY_COLORS}
              hover={hover}
              setHover={setHover}
              error={composeError}
              saving={composeSaving}
              onChange={(patch) => {
                setCompose((prev) => (prev === null ? prev : { ...prev, draft: { ...prev.draft, ...patch } }))
                setComposeError(null)
              }}
              onSubmit={() => void submitCompose()}
              onCancel={() => {
                setCompose(null)
                setComposeError(null)
              }}
            />
          )}

          {help ? <HelpView onClose={() => setHelp(false)} hover={hover} setHover={setHover} /> : null}
        </aside>
      ) : null}
    </>
  )
}

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsLike | undefined
  if (slots === undefined) return
  slots.inject(OVERLAY_SLOT, () => {
    slots.register({ name: OVERLAY_SLOT, id: OVERLAY_ID }, () => <Workbench />)
  })
}
