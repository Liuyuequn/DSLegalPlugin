/**
 * 三条线索的呈现层。
 *
 * 「日程 / 待办 / 项目」是**并列且互斥**的三条阅读线索：同一时刻只呈现一条。本文件只
 * 负责把 `view.ts` 切好的数据画出来，不含数据获取、不含日期运算（那两件事分别在
 * `client.tsx` 与 `view.ts`）。
 *
 * ## 三种形态的造型（依据 P7 的三张参考图实测，图已删）
 *
 * - **日**：一叠**重叠的日卡**，当天居中压在其余卡片上，左右各露出前后两天。卡片是
 *   纵向列表，条目为「○ + 标题 / 元信息」两行。点旁边的卡把它移到中间。
 * - **周**：七列**斑马泳道**（白 / 浅灰交替，不画竖线），列头是日号 + 星期，今天用主色。
 *   列里排**实心色条**，颜色即优先级；跨日事项在它覆盖的每一天都出现。
 * - **月**：`rows × 7` 的**格线格**，格内是「日号 + 休/班 + 农历」一行加实心小条，
 *   放不下时给「+N」。**格子本身不可点**——只有小条可点，点了弹这一条的明细悬浮窗
 *   （见 `SchedulePopover`）。识别的粒度是**日程**，不是"日"：没点到具体某一条就什么
 *   都不发生，不跳转、不反馈（用户明确要求；月历里也**不做**勾选，格子太密）。
 *   格线只有**内部**的分隔线（4% 灰），外面不描边——见 `styles.ts`。
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'

import { HOST_OUTDATED_COLORS, type Agenda, type Overview, type ProjectRow, type ScheduleRow, type TodoRow } from './api.js'
import * as UI from './styles.js'
import {
  FONT,
  MONTH_CHIP_GAP,
  MONTH_CHIP_HEIGHT,
  MONTH_HEAD_ZONE,
  S,
  T,
  TODO_ROW_HEIGHT,
} from './styles.js'
import {
  HOLIDAY_DATA_LAST_YEAR,
  PRIORITIES,
  almanacFor,
  almanacLabel,
  hasHolidayData,
  holidayMark,
  type AlmanacEntry,
  type Priority,
} from '@dslegal/core'
import {
  WEEKDAYS,
  addDays,
  composeError,
  dateLabel,
  dayHeading,
  dayLabel,
  filterProjects,
  fitRows,
  fullDateLabel,
  issueNotice,
  monthAnchor,
  monthGrid,
  monthLabel,
  monthWeekCount,
  popoverPosition,
  quadrantBuckets,
  quadrantItems,
  rowCapacity,
  sameSpot,
  scheduleDetail,
  schedulesByDay,
  schedulesInRange,
  schedulesOnDay,
  shiftMonth,
  sortSchedules,
  timeLabel,
  unrankedTodos,
  weekdayIndex,
  weekDays,
  type ComposeDraft,
  type ComposeRequest,
  type PopoverSpot,
  type QuadrantBucket,
  type Rect,
} from './view.js'

/** 日程线索的三种形态（互斥切换）。 */
export type ScheduleForm = 'day' | 'week' | 'month'

/** 三个线索视图共用的依赖。 */
export interface ViewProps {
  readonly overview: Overview
  readonly hover: string | null
  readonly setHover: (key: string | null) => void
  /** 完成状态（已被界面的乐观更新覆盖）。 */
  readonly doneOf: (row: { readonly project: string; readonly line: number; readonly done: boolean }) => boolean
  readonly onToggleTodo: (row: TodoRow) => void
  readonly onToggleSchedule: (row: ScheduleRow) => void
  /**
   * 点到**某一条日程本体**（月视图里的小条）。第二个参数是它在屏幕上的位置，
   * 供悬浮窗定位——传数值快照而不是 `DOMRect` 本身，免得把一个活对象存进 state。
   */
  readonly onOpenSchedule: (row: ScheduleRow, anchor: Rect) => void
  /**
   * 点到**一块空白**（含各容器的标题行）：在那儿新建。
   *
   * 「新建什么、预填什么」完全由调用方给的 `kind` / `priority` / `startDate` 决定，
   * 视图层只负责回答"用户点的是哪一块空白"。
   */
  readonly onCompose: (request: ComposeRequest) => void
}

/** 量取元素尺寸（像素），随布局变化实时更新；高度未知时返回 0。 */
export interface BoxSize {
  readonly width: number
  readonly height: number
}

/**
 * 量取元素尺寸。
 *
 * 与 shell 几何同一条教训：**不能用 rAF 合并**——被遮挡的标签页里 rAF 不触发，
 * 尺寸会永久停在旧值。这里同步测量 + `ResizeObserver` + `resize`/`visibilitychange` 兜底。
 * 被测量的元素（象限内容区、卡片扇、月历网格）尺寸由网格决定、与内容无关，
 * 故不存在"越量越大"的自激。
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize {
  const [size, setSize] = useState<BoxSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const apply = (): void => {
      const rect = node.getBoundingClientRect()
      setSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    window.addEventListener('resize', apply)
    document.addEventListener('visibilitychange', apply)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', apply)
      document.removeEventListener('visibilitychange', apply)
    }
  }, [ref])

  return size
}

/** 只要高度时的便捷包装（四象限按行高换算条数）。 */
export function useBoxHeight(ref: RefObject<HTMLElement | null>): number {
  return useBoxSize(ref).height
}

/** 悬停绑定：三处以上复用，抽出来避免每行都写两遍。 */
function hoverProps(
  key: string,
  props: Pick<ViewProps, 'hover' | 'setHover'>,
): { onMouseEnter: () => void; onMouseLeave: () => void } {
  return {
    onMouseEnter: () => props.setHover(key),
    onMouseLeave: () => props.setHover(null),
  }
}

/**
 * "这一块空白被点了" → 新建。
 *
 * 两条硬规则：
 *
 * 1. **落在条目身上的一律不算点空白**。区域是整块的（象限、卡内容区、泳道、月格），
 *    里面又摆着一条条待办与日程；靠 `closest('[data-fl-item]')` 就能一次判掉——
 *    所有条目元素都带这个标记，不必给每种条目各写一条判断。
 * 2. **`stopPropagation`**：热区是**嵌套**的（项目详情里，象限格嵌在卡片里），
 *    不挡住冒泡就会出现两次 `onCompose`，后一次（外层的、没有优先级的那个）会把
 *    内层刚预填好的优先级冲掉——用户点「重要且紧急」那一行，窗里却是"未设优先级"。
 */
function blankClick(
  seed: Omit<ComposeRequest, 'anchor'>,
  onCompose: (request: ComposeRequest) => void,
): (event: ReactMouseEvent<HTMLElement>) => void {
  return (event) => {
    const target = event.target
    event.stopPropagation()
    if (target instanceof Element && target.closest('[data-fl-item]') !== null) return
    // 落点就是鼠标处：窗从用户刚刚点的地方弹出来，而不是从容器某个角。
    const { clientX: x, clientY: y } = event
    onCompose({ ...seed, anchor: { left: x, top: y, right: x, bottom: y } })
  }
}

function CategoryTag({ row }: { readonly row: ProjectRow }): JSX.Element {
  const issue = row.categoryIssue !== undefined
  return (
    <span style={UI.tag(issue ? '#B45309' : T.brand)} title={row.categoryIssue ?? row.category ?? ''}>
      {row.category ?? '类别未知'}
    </span>
  )
}

/** 条目的悬浮提示：条内只放得下标题，完整信息走这里。 */
function scheduleTip(row: ScheduleRow, showDate: boolean): string {
  const parts = [showDate ? dateLabel(row) : timeLabel(row)]
  parts.push(row.project)
  if (row.location !== undefined) parts.push(row.location)
  if (row.note !== undefined) parts.push(row.note)
  return `${row.title}\n${parts.join(' · ')}`
}

// ---------------------------------------------------------------------------
// 线索一：日程（日 / 周 / 月）
// ---------------------------------------------------------------------------

export interface ScheduleLensProps extends ViewProps {
  readonly form: ScheduleForm
  readonly setForm: (form: ScheduleForm) => void
  readonly cursor: string
  readonly setCursor: (key: string) => void
}

/** 日程线索：三种形态各自展示对应范围内**所有**日程安排。 */
export function ScheduleLens(props: ScheduleLensProps): JSX.Element {
  const { form, setForm, cursor, setCursor, overview } = props
  const today = overview.today

  const shift = (delta: number): void => {
    if (form === 'day') setCursor(addDays(cursor, delta))
    else if (form === 'week') setCursor(addDays(cursor, delta * 7))
    else setCursor(shiftMonth(cursor, delta))
  }

  const week = weekDays(cursor)
  const weekFrom = week[0] ?? cursor
  const weekGroups = form === 'week' ? schedulesByDay(overview.schedules, week) : []
  const total =
    form === 'day'
      ? schedulesOnDay(overview.schedules, cursor).length
      : form === 'week'
        ? // 报"屏幕上能看到几条"，不是"涉及几件事"：跨日事项在覆盖的每一天各出现一次，
          // 用去重后的条数会让列里明明有 8 条、标题却写 7 条。
          weekGroups.reduce((sum, group) => sum + group.items.length, 0)
        : schedulesInRange(
            overview.schedules,
            monthAnchor(cursor),
            monthAnchor(shiftMonth(cursor, 1)),
          ).length

  // 中间那一格恒显**当前聚焦的那一天**，三种形态一致。`cursor` 就是焦点本身，
  // 不换算成"区间起点"——换算之后翻页会让这一格的含义跟着变（月视图翻一次就成
  // 1 号），用户就没法靠它判断自己在哪了。`shiftMonth` 相应地保留日号。
  const focusHint =
    form === 'day'
      ? dayHeading(cursor, today)
      : form === 'week'
        ? `本周 ${dayLabel(weekFrom)} 至 ${dayLabel(week[6] ?? weekFrom)}`
        : monthLabel(cursor)

  return (
    <>
      <div data-fl="schedule-head" style={UI.scheduleHead}>
        {/* 左区：形态切换 */}
        <div data-fl="head-left" style={UI.scheduleHeadLeft}>
          {(['day', 'week', 'month'] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-fl="form-chip"
              style={UI.chip(form === item, props.hover === `form-${item}`)}
              aria-pressed={form === item}
              {...hoverProps(`form-${item}`, props)}
              onClick={() => setForm(item)}
            >
              {item === 'day' ? '日' : item === 'week' ? '周' : '月'}
            </button>
          ))}
        </div>

        {/* 中区：焦点日期（前面是小一圈的上一段 / 下一段） */}
        <span data-fl="head-center" style={UI.navGroup}>
          <button
            type="button"
            style={UI.navStep(props.hover === 'nav-prev')}
            aria-label="上一段"
            {...hoverProps('nav-prev', props)}
            onClick={() => shift(-1)}
          >
            ‹
          </button>
          <span data-fl="nav-date" style={UI.navDate} title={focusHint}>
            {fullDateLabel(cursor)}
          </span>
          <button
            type="button"
            style={UI.navStep(props.hover === 'nav-next')}
            aria-label="下一段"
            {...hoverProps('nav-next', props)}
            onClick={() => shift(1)}
          >
            ›
          </button>
        </span>

        {/* 右区：统计 + 「今天」固定在右端 */}
        <div data-fl="head-right" style={UI.scheduleHeadRight}>
          {issueNotice(overview.projects) === '' ? null : (
            <span style={{ ...UI.sectionHint, color: T.warn }}>{issueNotice(overview.projects)}</span>
          )}
          <span style={UI.sectionHint}>共 {total} 条</span>
          <button
            type="button"
            data-fl="today-button"
            style={UI.todayButton(props.hover === 'nav-today')}
            {...hoverProps('nav-today', props)}
            onClick={() => setCursor(today)}
          >
            今天
          </button>
        </div>
      </div>

      {form === 'day' ? <DayFan {...props} /> : null}
      {form === 'week' ? <WeekLanes {...props} /> : null}
      {form === 'month' ? <MonthGrid {...props} /> : null}
    </>
  )
}

/** 日卡里的一条日程：○ 复选框 + 标题，下行是时间与出处。 */
function DayRow(props: ViewProps & { readonly row: ScheduleRow }): JSX.Element {
  const { row } = props
  const key = `d-${row.project}#${row.line}`
  const done = props.doneOf(row)
  const meta = [timeLabel(row), row.project, row.location].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  return (
    <div
      data-fl="day-row"
      data-fl-item
      style={UI.dayRow(props.hover === key, done, row.ongoing)}
      title={scheduleTip(row, false)}
      {...hoverProps(key, props)}
    >
      <input
        type="checkbox"
        style={{ ...UI.checkbox(row.priority === undefined ? T.unset : props.overview.priorityColors[row.priority]), marginTop: 3 }}
        checked={done}
        aria-label={row.title}
        onChange={() => props.onToggleSchedule(row)}
      />
      <span style={UI.itemBody}>
        <span style={{ display: 'flex', gap: S.sm, alignItems: 'baseline' }}>
          <span style={{ ...UI.ellipsisTitle(done), flex: '1 1 auto' }}>{row.title}</span>
          {row.ongoing ? <span style={UI.tag(T.brand)}>进行中</span> : null}
        </span>
        {/* 单行省略：日卡的行高要整齐，元信息换行会把行撑成两倍高并顶穿
            固定高度的行（实测踩过）。完整内容在整行的 title 里。 */}
        <span style={UI.itemMetaOneLine}>
          {meta.join(' · ')}
          {row.note === undefined ? '' : ` · ${row.note}`}
        </span>
      </span>
    </div>
  )
}

/**
 * 形态一「日」：**重叠的日卡扇**。
 *
 * 五张卡（前二 / 前一 / 当天 / 后一 / 后二）横向叠放，当天那张最大、最高、满不透明，
 * 两侧依次下沉并变淡——直接照搬参考图的纵深感。点两侧的卡把它移到中间。
 * 只有当天那张的内部可滚动；两侧的卡只露出边缘，作为"前后还有事"的提示。
 */
function DayFan(props: ScheduleLensProps): JSX.Element {
  const { cursor, setCursor, overview } = props
  const stageRef = useRef<HTMLDivElement | null>(null)
  const size = useBoxSize(stageRef)
  const { cardWidth, step } = UI.fanMetrics(size.width)
  const depths = [0, -1, 1, -2, 2]
  const centerX = Math.max(S.lg, (size.width - cardWidth) / 2)

  return (
    <div ref={stageRef} data-fl="fan-stage" style={UI.fanStage()}>
      {depths.map((depth) => {
        const key = addDays(cursor, depth)
        const isToday = key === overview.today
        const rows = schedulesOnDay(overview.schedules, key)
        const isCenter = depth === 0
        const headKey = `fh-${key}`
        return (
          <section
            key={key}
            data-fl="fan-card"
            data-fl-depth={depth}
            aria-label={key}
            style={{
              ...UI.fanCard(depth, centerX + depth * step, Math.abs(depth) * 15, cardWidth, isToday),
              zIndex: 10 - Math.abs(depth),
              cursor: isCenter ? 'default' : 'pointer',
            }}
            title={isCenter ? undefined : `切到 ${dayHeading(key, overview.today)}`}
            onClick={isCenter ? undefined : () => setCursor(key)}
          >
            {/* 表头与内容区的空白都是"在那天新建一条日程"的热区——**只有中间那一张**。
                两侧的卡整张已经是"点它即居中"的可点元素，再叠一层新建会让同一个手势
                有两种后果（先居中、再点一次才新建），所以它们保持原样。 */}
            <header
              style={UI.fanHead(isCenter && props.hover === headKey)}
              title={isCenter ? `点击新建一条 ${dayHeading(key, overview.today)} 的日程` : undefined}
              {...(isCenter ? hoverProps(headKey, props) : null)}
              onClick={isCenter ? blankClick({ kind: 'schedule', startDate: key }, props.onCompose) : undefined}
            >
              {isToday && isCenter ? <span style={UI.todayBadge}>今</span> : null}
              <span style={UI.fanHeadText()}>
                <span style={UI.fanDateText(isToday)}>
                  {String(Number(key.slice(5, 7))).padStart(2, '0')}/{key.slice(8)}
                </span>
                <span style={UI.fanHeadSub(isToday)}>
                  {isCenter && isToday ? '今天' : `周${WEEKDAYS[weekdayIndex(key)]}`}
                </span>
              </span>
              <span style={{ flex: 1 }} />
              {rows.length === 0 ? null : (
                <span style={UI.fanCount(isToday)}>{rows.length}</span>
              )}
              {isCenter ? <span style={UI.blankAdd(props.hover === headKey)}>＋</span> : null}
            </header>
            <div
              style={UI.fanBody}
              onClick={isCenter ? blankClick({ kind: 'schedule', startDate: key }, props.onCompose) : undefined}
            >
              {rows.length === 0 ? (
                <div style={UI.emptyState}>
                  <span style={UI.emptyRing} />
                  <span style={{ ...FONT.secondary, color: T.labelCaption }}>暂无事项</span>
                </div>
              ) : (
                rows.map((row) => (
                  <DayRow key={`${row.project}#${row.line}`} {...props} row={row} />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/**
 * 周形态里的一条日程：实心色条。
 *
 * 点它**弹出明细悬浮窗**（与月形态同一套），改完成状态在窗里那个按钮上做。
 * 早先是"点整条直接切换完成状态"，但同一个动作在两个形态里必须是同一个手势——
 * 而且直接切换没有"看清楚再改"的机会（条上只放得下标题与时间）。
 */
function WeekBar(props: ViewProps & { readonly row: ScheduleRow }): JSX.Element {
  const { row } = props
  const key = `w-${row.project}#${row.line}`
  const done = props.doneOf(row)
  const color = row.priority === undefined ? T.unset : props.overview.priorityColors[row.priority]
  return (
    <button
      type="button"
      data-fl="week-bar"
      data-fl-item
      data-fl-done={done ? "y" : "n"}
      data-fl-project={row.project}
      data-fl-line={row.line}
      style={UI.weekBar(color, done, props.hover === key)}
      title={`${scheduleTip(row, false)}\n点击查看详情（可在弹窗里改完成状态）`}
      aria-label={`${row.title}，${done ? '已完成' : '未完成'}`}
      {...hoverProps(key, props)}
      onClick={(event) => props.onOpenSchedule(row, event.currentTarget.getBoundingClientRect())}
    >
      <span style={UI.barMark(done)}>{done ? '✓' : ''}</span>
      <span style={UI.barText}>{row.title}</span>
      {row.startTime === undefined ? null : <span style={UI.barTime}>{row.startTime}</span>}
    </button>
  )
}

/**
 * 形态二「周」：七列斑马泳道 + 实心条。
 *
 * 参考图**没有时间轴**——每一列就是当天的条目清单，从顶往下码。跨日事项在它覆盖的
 * 每一天都出现（由 `view.ts` 的区间归属决定），故同一条可能出现在相邻两列里。
 *
 * 列头与条下方的空白都是"在那天新建一条日程"的热区；点条仍然是看明细。
 */
function WeekLanes(props: ScheduleLensProps): JSX.Element {
  const { cursor, overview } = props
  const days = weekDays(cursor)
  const groups = schedulesByDay(overview.schedules, days)
  return (
    <div data-fl="week-grid" style={UI.weekGrid}>
      {groups.map((group, index) => {
        const isToday = group.key === overview.today
        const headKey = `wh-${group.key}`
        const compose = blankClick({ kind: 'schedule', startDate: group.key }, props.onCompose)
        return (
          <div
            key={group.key}
            data-fl="week-col"
            data-fl-zebra={index % 2 === 1 ? "y" : "n"}
            style={UI.weekColumn(isToday, index % 2 === 1)}
          >
            <div
              style={UI.weekHead(props.hover === headKey)}
              title={`点击新建一条 ${dayHeading(group.key, overview.today)} 的日程`}
              {...hoverProps(headKey, props)}
              onClick={compose}
            >
              <span style={UI.weekHeadNum(isToday)}>{Number(group.key.slice(8))}</span>
              <span style={UI.weekHeadDay(isToday)}>
                {isToday ? '今天' : `周${WEEKDAYS[index] ?? ''}`}
              </span>
              <span style={{ flex: 1 }} />
              {group.items.length === 0 ? null : (
                <span style={UI.weekHeadCount(isToday)}>{group.items.length}</span>
              )}
              <span style={UI.blankAdd(props.hover === headKey)}>＋</span>
            </div>
            <div data-fl="week-lane" style={UI.weekLane} onClick={compose}>
              {group.items.map((row) => (
                <WeekBar key={`${row.project}#${row.line}`} {...props} row={row} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 形态三「月」：格线格子里直接画条目。
 *
 * 格子放不下的条目数如实写成「+N」，不静默丢弃。能放几条由**实测格高**换算
 * （与四象限同一套办法：先把像素除以固定条高，再裁剪），所以窗口一变、行数一换
 * （5 行月 / 6 行月），数量都跟着变。
 *
 * 格子右上角那一条是**农历 / 农历月份 / 传统节日节气三选一**（互斥，见
 * `almanacLabel`）；「休 / 班」另占一格，夹在日号与它中间，可与三者并存。
 *
 * **点谁不点谁**：格子不可点，只有格内的日程小条可点；点了上报"哪一条 + 它在屏幕上的
 * 位置"，由编排层弹出明细窗。没点到具体某一条日程就什么都不发生——用户明确要求
 * "细化到「日程」这个维度，而不是「日」这个维度"。
 */
function MonthGrid(props: ScheduleLensProps): JSX.Element {
  const { cursor, overview } = props
  const anchor = monthAnchor(cursor)
  const rowCount = monthWeekCount(anchor)
  const cells = monthGrid(anchor).slice(0, rowCount * 7)
  // 按"有效区间与哪天相交"归属，而不是按开始日期：
  // 8/31 → 9/2 的跨月事项同样要出现在 9/1、9/2 两天，也要出现在上月的补白格里。
  const groups = schedulesByDay(overview.schedules, cells.map((cell) => cell.key))
  const byDay = new Map(groups.map((group) => [group.key, group.items]))

  const gridRef = useRef<HTMLDivElement | null>(null)
  const size = useBoxSize(gridRef)
  const cellHeight = size.height === 0 ? 0 : size.height / rowCount
  const capacity = rowCapacity(
    cellHeight - MONTH_HEAD_ZONE - S.xs,
    MONTH_CHIP_HEIGHT + MONTH_CHIP_GAP,
  )

  // 法定节假日是国务院逐年公布的，数据只到 HOLIDAY_DATA_LAST_YEAR；
  // 之后的日期不显示休 / 班。如实说明，而不是让人以为"这些天不放假"。
  const holidayDataCovered = cells.every((cell) => hasHolidayData(Number(cell.key.slice(0, 4))))

  return (
    <div style={UI.monthWrap}>
      <div style={UI.monthWeekHead}>
        {WEEKDAYS.map((label) => (
          <div key={label} style={UI.weekday}>
            {label}
          </div>
        ))}
      </div>
      <div
        ref={gridRef}
        data-fl="month-grid"
        style={UI.monthGrid(rowCount)}
        title={
          holidayDataCovered
            ? undefined
            : `本视图含 ${HOLIDAY_DATA_LAST_YEAR} 年之后的日期：法定节假日安排由国家逐年公布，暂无数据的年份不显示休 / 班标记（农历与节气照常显示）。`
        }
      >
        {cells.map((cell, index) => {
          const items = byDay.get(cell.key) ?? []
          const isToday = cell.key === overview.today
          const almanac = almanacFor(cell.key)
          const mark = almanac === null ? null : holidayMark(almanac)
          const over = items.length > capacity
          const shown =
            !over ? items : capacity >= 2 ? items.slice(0, capacity - 1) : items.slice(0, capacity)
          const hidden = items.length - shown.length
          const hovered = props.hover === `m-${cell.key}`
          const tip = almanac === null ? cell.key : almanacTip(almanac)
          return (
            // 格子是 `<div>` 而**不是** `<button>`：它可点，但点下去做的是"在格子里那块
            // 空白上新建一条日程"（`onClick` 挂在 div 上），而不是一个按钮语义的动作。
            // 格内的日程小条各自是 `<button>`，并且带 `data-fl-item`——格子据此知道
            // "这次点的是某一条日程，不是我"（点条走弹明细，见上面的小条）。
            <div
              key={cell.key}
              data-fl="month-cell"
              data-fl-inmonth={cell.inMonth ? "y" : "n"}
              data-fl-mark={mark ?? "none"}
              style={UI.monthCell({
                selected: cursor === cell.key,
                hovered,
                today: isToday,
                // 网格外沿由"最后一列 / 最后一行不画线"决定，不是靠外层描边。
                lastCol: index % 7 === 6,
                lastRow: index >= rowCount * 7 - 7,
              })}
              title={`${tip}\n点击空白处新建一条日程`}
              {...hoverProps(`m-${cell.key}`, props)}
              onClick={blankClick({ kind: 'schedule', startDate: cell.key }, props.onCompose)}
            >
              <span style={UI.monthDayRow}>
                <span style={UI.monthDayNum(isToday, cell.inMonth)} data-fl="month-num">
                  {cell.day}
                </span>
                {mark === null ? null : (
                  <span
                    style={UI.monthDayMark(almanac!.holiday === 'rest', cell.inMonth)}
                    data-fl="month-mark"
                  >
                    {mark}
                  </span>
                )}
                <span style={UI.monthDayAlmanac(cell.inMonth)} data-fl="month-almanac">
                  {almanac === null ? '' : almanacLabel(almanac)}
                </span>
              </span>
              <span style={UI.monthChips(cell.inMonth)}>
                {shown.map((row) => {
                  const done = props.doneOf(row)
                  const key = `mc-${row.project}#${row.line}`
                  return (
                    // 条是全月历里唯一可点的东西。点它**不跳日视图、也不勾选**，
                    // 只把这一条的明细弹出来（哪一条由 `row.line` + `row.project` 精确定位）。
                    <button
                      key={`${row.project}#${row.line}`}
                      type="button"
                      data-fl="month-chip"
                      data-fl-item
                      data-fl-done={done ? "y" : "n"}
                      data-fl-project={row.project}
                      data-fl-line={row.line}
                      style={UI.monthChip(
                        row.priority === undefined ? T.unset : props.overview.priorityColors[row.priority],
                        done,
                        props.hover === key,
                      )}
                      title={scheduleTip(row, false)}
                      aria-label={`${row.title}，${row.project}`}
                      onMouseEnter={() => props.setHover(key)}
                      onMouseLeave={() => props.setHover(null)}
                      onClick={(event) => {
                        // 只上报"这一条 + 它在屏幕上的位置"，怎么弹由编排层决定。
                        props.onOpenSchedule(row, event.currentTarget.getBoundingClientRect())
                      }}
                    >
                      <span style={UI.monthChipText}>
                        {row.startTime === undefined ? '' : `${row.startTime} `}
                        {done ? '✓ ' : ''}
                        {row.title}
                      </span>
                    </button>
                  )
                })}
                {hidden > 0 ? <span style={UI.monthMore}>+{hidden}</span> : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 月历格子的悬浮说明：公历 + 农历全称 + 节日 / 节气 + 放假安排。 */
function almanacTip(entry: AlmanacEntry): string {
  const parts = [`${entry.key}，农历${entry.lunarMonthLabel}${entry.lunarDayLabel}`]
  if (entry.festival !== null) parts.push(entry.festival)
  if (entry.solarTerm !== null) parts.push(entry.solarTerm)
  if (entry.holiday !== null) {
    parts.push(`${entry.holidayName ?? '法定节假日'}${entry.holiday === 'rest' ? '放假' : '调休上班'}`)
  }
  return parts.join(' · ')
}

/**
 * 点到某一条日程时弹出的明细窗。
 *
 * 三件事刻意这么做：
 *
 * 1. **挂在面板下、不挂在格子里**：格子有 `overflow: hidden`，挂进去会被裁掉。
 *    组件本身是 `position: absolute`，由编排层放在 `aside` 的直接子节点位置。
 * 2. **`useLayoutEffect` 里"先量自己、再定位"**：高度取决于标题与备注长度，没法预先
 *    写死。`useLayoutEffect` 在绘制前跑完，所以不会出现"先闪现在左上角再跳到条旁边"。
 *    量到之前用 `visibility: hidden` 兜住那一帧。
 * 3. **落点算法在 `view.ts` 的 `popoverPosition()` 里**（纯函数、可单测）：
 *    默认贴条下方左对齐，下方放不下翻到上方，左右越界夹回来。
 */
export function SchedulePopover(props: {
  readonly row: ScheduleRow
  readonly anchor: Rect
  /** 允许出现的范围（面板主体区的视口矩形）。 */
  readonly bounds: Rect
  /** 面板左上角的视口坐标，用来把视口坐标换算成 `aside` 内的绝对定位坐标。 */
  readonly origin: { readonly left: number; readonly top: number }
  readonly color: string
  /** 完成状态（已含界面的乐观更新）。 */
  readonly done: boolean
  readonly hover: string | null
  readonly setHover: (key: string | null) => void
  readonly onToggle: () => void
  /** 「点标题 → 用系统默认程序打开原始 markdown」（由编排层发请求并报结果）。 */
  readonly onOpenSource: () => void
}): JSX.Element {
  const detail = scheduleDetail(props.row)
  const ref = useRef<HTMLDivElement | null>(null)
  const [spot, setSpot] = useState<PopoverSpot | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const rect = node.getBoundingClientRect()
    const next = popoverPosition(props.anchor, { width: rect.width, height: rect.height }, props.bounds)
    // **必须比一比再写回**：这个 effect 没有依赖数组（每次渲染都要按最新内容重量一次），
    // 而 `popoverPosition` 每次都返回新对象——直接 `setSpot(next)` 会形成
    // "渲染 → 测量 → 写状态 → 再渲染"的死循环，React 抛 Maximum update depth exceeded，
    // 整块面板连 `aside` 一起消失（实测踩过；见 `sameSpot` 的说明）。
    setSpot((prev) => (sameSpot(prev, next) ? prev : next))
  })

  const toggleKey = 'popover-toggle'
  const sourceKey = 'popover-source'

  return (
    <div
      ref={ref}
      data-fl="schedule-popover"
      role="dialog"
      aria-label={`日程明细：${detail.title}`}
      style={{
        ...UI.schedulePopover,
        left: spot === null ? 0 : spot.left - props.origin.left,
        top: spot === null ? 0 : spot.top - props.origin.top,
        visibility: spot === null ? 'hidden' : 'visible',
      }}
    >
      {/* 第一行：优先级。未设优先级时用中性石板灰的点与文字——**不能拿主色兜底**，
          主色在这套界面里专表"今天"。 */}
      <span style={UI.popoverHead}>
        <span style={{ ...UI.popoverDot, background: props.color }} />
        <span style={{ ...UI.popoverPriority, color: props.color }}>
          {detail.priority ?? '未设优先级'}
        </span>
      </span>

      {/* **标题就是"打开原始 markdown"的入口**（用户指定的手势）：点它用系统默认程序
          打开这条日程所在的工作日志，并尽量跳到第 `line` 行。做成标题本身、而不是旁边
          再加一个按钮——一个浮层里两个按钮，用户得先想"我该点哪个"。
          右侧那个 `↗` 是唯一的提示：不加它，谁也不会想到标题能点。 */}
      <span style={UI.popoverTitleRow}>
        <button
          type="button"
          data-fl="popover-source"
          data-fl-line={props.row.line}
          style={UI.popoverTitleButton(props.hover === sourceKey)}
          aria-label={`用系统默认程序打开这份工作日志（第 ${props.row.line} 行）：${detail.title}`}
          title={`用系统默认程序打开工作日志，并定位到第 ${props.row.line} 行`}
          {...hoverProps(sourceKey, props)}
          onClick={props.onOpenSource}
        >
          {detail.title}
        </button>
        <span style={UI.popoverSourceMark} aria-hidden="true">
          ↗
        </span>
      </span>

      <span style={UI.popoverFields}>
        {detail.fields.map((field) => (
          <span key={field.label} style={UI.popoverRow}>
            <span style={UI.popoverLabel}>{field.label}</span>
            <span style={UI.popoverValue}>{field.value}</span>
          </span>
        ))}
      </span>

      <span style={UI.popoverFoot}>
        {/* 这一条是改状态的唯一入口——按用户要求做成按钮，点一下在完成 / 未完成之间切换。
            它就在悬浮窗内部，所以不会被"点别处关窗"的捕获监听误伤。 */}
        <button
          type="button"
          data-fl="popover-toggle"
          data-fl-done={props.done ? 'y' : 'n'}
          style={UI.popoverAction(props.done, props.hover === toggleKey)}
          aria-pressed={props.done}
          aria-label={`${detail.title}：标记为${props.done ? '未完成' : '已完成'}`}
          {...hoverProps(toggleKey, props)}
          onClick={props.onToggle}
        >
          <span style={UI.barMark(props.done)}>{props.done ? '✓' : ''}</span>
          <span style={{ flex: '1 1 auto' }}>{props.done ? '已完成' : '标记为已完成'}</span>
          {props.done ? <span style={UI.popoverHint}>点击取消</span> : null}
        </button>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 新建条目：悬浮窗表单
// ---------------------------------------------------------------------------

/** 新建窗能选的项目（重名项目靠 `topLevelDir` 消歧）。 */
export interface ComposeProjectOption {
  readonly project: string
  readonly topLevelDir: string
}

/**
 * 「点空白 → 新建」的那个悬浮窗。
 *
 * 几处刻意的地方：
 *
 * 1. **落点用鼠标位置**（`anchor` 是一个零高度的矩形），不是容器的边角——窗从用户刚
 *    点的那个地方长出来，"我点的是这儿"这条因果才是看得见的。
 * 2. **高度靠量、宽度写死**：理由与明细窗相同（见 `composePopover` 的说明）。
 *    量到的位置**要先比再写回**，否则就是 `sameSpot` 注释里那个 React #185 死循环。
 * 3. **标题框自动聚焦，但焦点在"摆好之后"给**：窗在量到自己的尺寸之前挂着
 *    `visibility: hidden`，而**隐藏元素接不了焦点**（`focus()` 静默失败，实测踩过：
 *    界面上一切正常，只是光标没落进标题框）。所以聚焦写在同一个 layout effect 里、
 *    并且以 `spot !== null` 为条件——那一次渲染出来的 DOM 才是可见的。
 *    用 `focusedRef` 只做一次：每次渲染都 focus 会变成"用户刚点到备注框就被拽回标题"。
 *    也**不能用 `autoFocus`**：React 在提交阶段就调 `focus()`，那一刻窗还是隐藏的。
 * 4. **错误只在点过「创建」之后显示**：草稿一开窗就是空的，`composeError` 立刻会返回
 *    「标题不能为空」——那不是用户犯了错，摆一条红字只会让人以为坏了。
 * 5. **校验文案来自 `@dslegal/core`**（`composeError`），与 host 落盘前用的是同一个
 *    渲染器，所以窗里说什么、host 就打回什么，逐字一致。
 * 6. **项目永远可改**（`compose-project-trigger` + 关键字筛选的候选列表）。"点在哪儿"
 *    只给一个**默认值**，不把字段锁死：项目详情里点出来的窗同样允许改成别的案件。
 *    早先是"只有一个项目就渲染成静态文本"，用户反馈恰恰是"看起来写死了一个案子、改不了"。
 */
export function CreatePopover(props: {
  readonly draft: ComposeDraft
  readonly anchor: Rect
  readonly bounds: Rect
  readonly origin: { readonly left: number; readonly top: number }
  /** 可选的全部已就绪项目（顺序即展示顺序，由 host 给，已稳定）。 */
  readonly projects: readonly ComposeProjectOption[]
  readonly priorityColors: Record<Priority, string>
  readonly hover: string | null
  readonly setHover: (key: string | null) => void
  readonly error: string | null
  readonly saving: boolean
  readonly onChange: (patch: Partial<ComposeDraft>) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}): JSX.Element {
  const { draft } = props
  const isTodo = draft.kind === 'todo'
  const ref = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const focusedRef = useRef(false)
  const [spot, setSpot] = useState<PopoverSpot | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const rect = node.getBoundingClientRect()
    const next = popoverPosition(props.anchor, { width: rect.width, height: rect.height }, props.bounds)
    setSpot((prev) => (sameSpot(prev, next) ? prev : next))
    // 只在这一轮 DOM 已经可见时聚焦（`spot` 非空 = 这次渲染不是"还没量到"那一帧）。
    // 见上面第 3 条：隐藏元素上的 `focus()` 是静默失败的。
    if (spot !== null && !focusedRef.current) {
      focusedRef.current = true
      titleRef.current?.focus()
    }
  })

  const field = (key: string): string | null => (props.hover === key ? key : null)
  const input = (key: string): ReturnType<typeof UI.composeInput> =>
    UI.composeInput(field(key) !== null)

  /**
   * 项目选择器的展开状态与关键字。
   *
   * 两条都是**纯界面状态**，不进 `draft`：`draft.project` 只在用户真的点了某个候选时才变，
   * 所以"筛了一下没点"绝不会把条目写进别的案件——这类"看着改了其实没改"的错位在
   * 写入型界面上代价最大。
   */
  const [pickerOpen, setPickerOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [cursor, setCursor] = useState(0)
  const filterRef = useRef<HTMLInputElement | null>(null)
  const matches = filterProjects(props.projects, keyword)
  const highlight = matches.length === 0 ? -1 : Math.min(cursor, matches.length - 1)

  const pick = (row: ComposeProjectOption): void => {
    props.onChange({ project: row.project, topLevelDir: row.topLevelDir })
    setPickerOpen(false)
    setKeyword('')
    setCursor(0)
  }

  // 展开就把光标放进关键字框：这个控件的用法是"点开 → 打字 → 选"。
  // 这里可以直接 `focus()`——窗此时早已量到尺寸、不处于 `visibility: hidden` 那一帧
  // （与标题框的首次自动聚焦不同，那个必须等到可见）。
  useEffect(() => {
    if (pickerOpen) filterRef.current?.focus()
  }, [pickerOpen])

  const onFilterKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setCursor((prev) => (Math.min(prev, matches.length - 1) + delta + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter') {
      // 这里的回车是"选这一项"，不是"提交表单"：挡住冒泡，免得选完项目顺手把窗也提交了。
      event.preventDefault()
      event.stopPropagation()
      const picked = matches[highlight]
      if (picked !== undefined) pick(picked)
      return
    }
    if (event.key === 'Escape') {
      // 只收起候选列表，不关整张窗——整张窗的 Esc 由文档级监听负责，这里挡掉它。
      event.stopPropagation()
      setPickerOpen(false)
    }
  }

  const context = isTodo
    ? (draft.priority ?? '未设优先级')
    : dayHeading(draft.startDate, draft.startDate)

  /** 主体区装不下时把窗截住，中段滚动（见 `composePopover` 的说明）。 */
  const maxHeight = props.bounds.bottom - props.bounds.top - 16

  return (
    <div
      ref={ref}
      data-fl="create-popover"
      data-fl-kind={draft.kind}
      role="dialog"
      aria-label={isTodo ? '新建待办' : '新建日程'}
      style={{
        ...UI.composePopover(maxHeight),
        left: spot === null ? 0 : spot.left - props.origin.left,
        top: spot === null ? 0 : spot.top - props.origin.top,
        visibility: spot === null ? 'hidden' : 'visible',
      }}
      onKeyDown={(event) => {
        // 只在输入框里回车才提交：焦点在优先级小片上时回车是"点这一下"，
        // 顺手再提交一次会让人莫名其妙地关掉窗。项目筛选框自己处理回车并挡住冒泡。
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          props.onSubmit()
        }
      }}
    >
      <span style={UI.composeHead}>
        <span style={UI.composeTitle}>{isTodo ? '＋ 新建待办' : '＋ 新建日程'}</span>
        <span style={UI.composeContext} title={context}>
          {context}
        </span>
      </span>

      <div style={UI.composeFields}>
        {/* 项目：**搜索式下拉**。案件名很长，纯下拉认不出来，所以给关键字筛选；
            只有一个项目时也保留这个控件——早先写成静态文本，看起来就是"改不了"，
            而那正是用户反馈的问题。 */}
        <div style={UI.composeField}>
          <span style={UI.composeLabel}>项目</span>
          <div style={UI.composePicker}>
            <button
              type="button"
              data-fl="compose-project-trigger"
              data-fl-open={pickerOpen ? 'y' : 'n'}
              data-fl-project={draft.project}
              style={UI.composeProjectTrigger(pickerOpen, field('compose-project') !== null)}
              aria-expanded={pickerOpen}
              aria-label={`项目：${draft.project}`}
              title={`${draft.project}（点击可换别的项目）`}
              onMouseEnter={() => props.setHover('compose-project')}
              onMouseLeave={() => props.setHover(null)}
              onClick={() => {
                setPickerOpen((open) => !open)
                setKeyword('')
                setCursor(0)
              }}
            >
              <span style={UI.composeProjectName}>{draft.project}</span>
              <span style={UI.composeProjectDir}>{draft.topLevelDir}</span>
              <span style={UI.composeCaret(pickerOpen)}>▾</span>
            </button>

            {pickerOpen ? (
              <div style={UI.composePickerPanel}>
                <input
                  ref={filterRef}
                  data-fl="compose-project-filter"
                  style={input('compose-project-filter')}
                  value={keyword}
                  placeholder="输入关键字筛选项目"
                  aria-label="筛选项目"
                  spellCheck={false}
                  onMouseEnter={() => props.setHover('compose-project-filter')}
                  onMouseLeave={() => props.setHover(null)}
                  onChange={(event) => {
                    setKeyword(event.target.value)
                    setCursor(0)
                  }}
                  onKeyDown={onFilterKey}
                />
                <div data-fl="compose-project-list" style={UI.composeProjectList} role="listbox">
                  {matches.length === 0 ? (
                    <div style={UI.composePickerEmpty}>没有匹配的项目</div>
                  ) : (
                    matches.map((row, index) => {
                      const current =
                        row.project === draft.project && row.topLevelDir === draft.topLevelDir
                      const key = `cpo-${row.topLevelDir}/${row.project}`
                      return (
                        <button
                          key={`${row.topLevelDir}/${row.project}`}
                          type="button"
                          data-fl="compose-project-option"
                          data-fl-selected={current ? 'y' : 'n'}
                          data-fl-project={row.project}
                          role="option"
                          aria-selected={current}
                          style={UI.composeProjectOption(current, props.hover === key || index === highlight)}
                          title={`${row.project}（${row.topLevelDir}）`}
                          {...hoverProps(key, props)}
                          onClick={() => pick(row)}
                        >
                          <span style={UI.composeProjectMark(current)}>✓</span>
                          <span style={UI.composeProjectName}>{row.project}</span>
                          <span style={UI.composeProjectDir}>{row.topLevelDir}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <label style={UI.composeField}>
          <span style={UI.composeLabel}>标题</span>
          <input
            ref={titleRef}
            data-fl="compose-title"
            style={input('compose-title')}
            value={draft.title}
            placeholder={isTodo ? '例如：整理开庭提纲' : '例如：与对方律师会谈'}
            aria-label="标题"
            onMouseEnter={() => props.setHover('compose-title')}
            onMouseLeave={() => props.setHover(null)}
            onChange={(event) => props.onChange({ title: event.target.value })}
          />
        </label>

        {isTodo ? null : (
          <>
            <div style={UI.composeField}>
              <span style={UI.composeLabel}>日期</span>
              <div style={UI.composePair}>
                <input
                  type="date"
                  data-fl="compose-start-date"
                  style={input('compose-start-date')}
                  value={draft.startDate}
                  aria-label="开始日期"
                  title="开始日期（必填）"
                  onMouseEnter={() => props.setHover('compose-start-date')}
                  onMouseLeave={() => props.setHover(null)}
                  onChange={(event) => props.onChange({ startDate: event.target.value })}
                />
                <input
                  type="date"
                  data-fl="compose-end-date"
                  style={input('compose-end-date')}
                  value={draft.endDate}
                  aria-label="结束日期"
                  title="结束日期（留空 = 当天结束）"
                  onMouseEnter={() => props.setHover('compose-end-date')}
                  onMouseLeave={() => props.setHover(null)}
                  onChange={(event) => props.onChange({ endDate: event.target.value })}
                />
              </div>
            </div>

            <div style={UI.composeField}>
              <span style={UI.composeLabel}>时间</span>
              <div
                style={UI.composePair}
                title="两项都留空 = 全天事项；只填开始时间 = 持续到当日结束。"
              >
                <input
                  type="time"
                  data-fl="compose-start-time"
                  style={input('compose-start-time')}
                  value={draft.startTime}
                  aria-label="开始时间"
                  title="开始时间（留空 = 全天）"
                  onMouseEnter={() => props.setHover('compose-start-time')}
                  onMouseLeave={() => props.setHover(null)}
                  onChange={(event) => props.onChange({ startTime: event.target.value })}
                />
                <input
                  type="time"
                  data-fl="compose-end-time"
                  style={input('compose-end-time')}
                  value={draft.endTime}
                  aria-label="结束时间"
                  title="结束时间（留空 = 持续到当日结束）"
                  onMouseEnter={() => props.setHover('compose-end-time')}
                  onMouseLeave={() => props.setHover(null)}
                  onChange={(event) => props.onChange({ endTime: event.target.value })}
                />
              </div>
            </div>

            <label style={UI.composeField}>
              <span style={UI.composeLabel}>地点</span>
              <input
                data-fl="compose-location"
                style={input('compose-location')}
                value={draft.location}
                placeholder="可留空"
                aria-label="地点"
                onMouseEnter={() => props.setHover('compose-location')}
                onMouseLeave={() => props.setHover(null)}
                onChange={(event) => props.onChange({ location: event.target.value })}
              />
            </label>
          </>
        )}

        <div style={UI.composeField}>
          <span style={UI.composeLabel}>优先级</span>
          <div style={UI.composeChips}>
            {PRIORITIES.map((priority) => {
              const active = draft.priority === priority
              const key = `cp-${priority}`
              return (
                <button
                  key={priority}
                  type="button"
                  data-fl="compose-priority"
                  data-fl-priority={priority}
                  data-fl-active={active ? 'y' : 'n'}
                  style={UI.composeChip(active, props.hover === key, props.priorityColors[priority])}
                  aria-pressed={active}
                  title={active ? `再点一次取消「${priority}」` : `设为「${priority}」`}
                  {...hoverProps(key, props)}
                  onClick={() => props.onChange({ priority: active ? null : priority })}
                >
                  <span style={UI.composeChipDot(props.priorityColors[priority])} />
                  <span>{priority}</span>
                </button>
              )
            })}
            <button
              type="button"
              data-fl="compose-priority"
              data-fl-priority="未设优先级"
              data-fl-active={draft.priority === null ? 'y' : 'n'}
              style={UI.composeChip(draft.priority === null, props.hover === 'cp-none', T.unset)}
              aria-pressed={draft.priority === null}
              title="不设优先级（不属于任何象限）"
              {...hoverProps('cp-none', props)}
              onClick={() => props.onChange({ priority: null })}
            >
              <span style={UI.composeChipDot(T.unset)} />
              <span>未设</span>
            </button>
          </div>
        </div>

        <label style={UI.composeField}>
          <span style={UI.composeLabel}>备注</span>
          <input
            data-fl="compose-note"
            style={input('compose-note')}
            value={draft.note}
            placeholder="可留空"
            aria-label="备注"
            onMouseEnter={() => props.setHover('compose-note')}
            onMouseLeave={() => props.setHover(null)}
            onChange={(event) => props.onChange({ note: event.target.value })}
          />
        </label>
      </div>

      {/* 错误文案来自 `@dslegal/core`，与 host 落盘前的校验是同一份，逐字一致。 */}
      {props.error === null ? null : (
        <div data-fl="compose-error" style={UI.composeError} role="alert">
          {props.error}
        </div>
      )}

      <span style={UI.composeFoot}>
        <span style={UI.composeNote}>
          写入 {isTodo ? '「## 1. 待办事项」' : '「## 2. 日程安排」'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-fl="compose-cancel"
          style={UI.textButton(props.hover === 'compose-cancel')}
          {...hoverProps('compose-cancel', props)}
          onClick={props.onCancel}
        >
          取消
        </button>
        <button
          type="button"
          data-fl="compose-submit"
          disabled={props.saving}
          style={UI.composeSubmit(props.hover === 'compose-submit', props.saving)}
          {...hoverProps('compose-submit', props)}
          onClick={props.onSubmit}
        >
          {props.saving ? '添加中…' : '创建'}
        </button>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 线索二：待办（四个等面积象限）
// ---------------------------------------------------------------------------

/** 待办线索：按四个优先级分成等面积四象限，每格只放"最近创建且放得下"的条目。 */
export function TodoLens(props: ViewProps): JSX.Element {
  const buckets = quadrantBuckets(props.overview.todos)
  const unranked = unrankedTodos(props.overview.todos)
  const total = props.overview.todos.length
  const pending = props.overview.todos.filter((row) => !row.done).length

  return (
    <>
      <div style={UI.lensHead}>
        <span style={UI.sectionTitle}>待办四象限</span>
        <span style={UI.sectionHint}>
          未完成 {pending} · 已完成 {total - pending} · 每格按「最近创建」倒序，只显示当前界面能容纳的条目
          {unranked.length === 0 ? '' : ` · 另有 ${unranked.length} 条未设优先级，不进入象限`}
        </span>
        <span style={{ flex: 1 }} />
        {issueNotice(props.overview.projects) === '' ? null : (
          <span style={{ ...UI.sectionHint, color: T.warn }}>{issueNotice(props.overview.projects)}</span>
        )}
      </div>
      <div style={UI.quadrantGrid}>
        {buckets.map((bucket) => (
          <QuadrantArea key={bucket.quadrant} bucket={bucket} {...props} />
        ))}
      </div>
    </>
  )
}

/**
 * 象限里的一条待办：**只显示标题与完成状态**（不显示备注、也不缀项目标签）。
 *
 * 不缀项目标签是刻意的：条目行高固定 26px，一格宽度也就 550px，再塞一个
 * 8–15 字的案件名会把标题挤成省略号——而标题才是这一格要回答的问题。
 * 所属项目走悬浮提示（`title` 里已经带了）。
 */
function TodoLineCompact(
  props: ViewProps & { readonly row: TodoRow },
): JSX.Element {
  const { row } = props
  const key = `t-${row.project}#${row.line}`
  const done = props.doneOf(row)
  return (
    <div
      data-fl="todo-row"
      data-fl-item
      data-fl-done={done ? "y" : "n"}
      style={UI.todoRow(props.hover === key, done)}
      title={`${row.title}（${row.project}）`}
      {...hoverProps(key, props)}
    >
      <input
        type="checkbox"
        style={UI.checkbox(row.priority === undefined ? T.unset : props.overview.priorityColors[row.priority])}
        checked={done}
        aria-label={row.title}
        onChange={() => props.onToggleTodo(row)}
      />
      <span style={UI.todoTitle(done)}>{row.title}</span>
    </div>
  )
}

/**
 * 一个象限。
 *
 * 内容区高度由四象限网格决定（与条目数量无关），据此换算出能放几行；超出部分按时序
 * 截断，并在标题条上如实告知"未显示 N 条"——静默隐藏会让人以为待办就这些。
 *
 * 标题条与条目下方的空白都是"新建一条这个优先级的待办"的热区：点标题上那几个字，
 * 开出来的窗里优先级已经填好，用户不必再选一次。点条目本身仍然是勾选（条目带
 * `data-fl-item`，被 `blankClick` 排除了）。
 */
function QuadrantArea(props: ViewProps & { readonly bucket: QuadrantBucket<TodoRow> }): JSX.Element {
  const { bucket } = props
  const listRef = useRef<HTMLDivElement | null>(null)
  const height = useBoxHeight(listRef)
  const items = quadrantItems(bucket)
  const { shown, hidden } = fitRows(items, rowCapacity(height, TODO_ROW_HEIGHT))
  const headKey = `qh-${bucket.quadrant}`
  const compose = blankClick({ kind: 'todo', priority: bucket.quadrant }, props.onCompose)

  return (
    <section data-fl="quadrant" style={UI.quadrantCell(bucket.quadrant)} aria-label={bucket.quadrant}>
      <div
        style={UI.quadrantHead(props.hover === headKey)}
        title={`点击新建一条「${bucket.quadrant}」待办`}
        {...hoverProps(headKey, props)}
        onClick={compose}
      >
        <span style={UI.quadrantDot(props.overview.priorityColors[bucket.quadrant])} />
        <span style={UI.quadrantName}>{bucket.quadrant}</span>
        <span style={{ flex: 1 }} />
        <span style={UI.sectionHint}>
          未完成 {bucket.pending.length} · 已完成 {bucket.done.length}
        </span>
        {hidden > 0 ? (
          <span style={{ ...UI.sectionHint, color: T.warn }}>未显示 {hidden}</span>
        ) : null}
        <span style={UI.blankAdd(props.hover === headKey)}>＋</span>
      </div>
      <div
        ref={listRef}
        data-fl="quadrant-list"
        style={UI.quadrantList}
        title={`点击空白处新建一条「${bucket.quadrant}」待办`}
        onClick={compose}
      >
        {items.length === 0 ? (
          <div style={{ ...UI.empty, padding: `${S.sm}px ${S.xs}px` }}>无</div>
        ) : (
          shown.map((row) => (
            <TodoLineCompact key={`${row.project}#${row.line}`} {...props} row={row} />
          ))
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 线索三：项目
// ---------------------------------------------------------------------------

export interface ProjectLensProps extends ViewProps {
  readonly scope: { readonly project: string; readonly topLevelDir: string } | null
  readonly setScope: (scope: { readonly project: string; readonly topLevelDir: string } | null) => void
  readonly agenda: Agenda | null
}

/** 项目线索：先列全部项目，点进去看该项目的全部待办与日程。 */
export function ProjectLens(props: ProjectLensProps): JSX.Element {
  return props.scope === null ? <ProjectList {...props} /> : <ProjectDetail {...props} scope={props.scope} />
}

function ProjectList(props: ProjectLensProps): JSX.Element {
  const projects = props.overview.projects
  const issueTotal = projects.reduce((sum, row) => sum + row.issueCount, 0)
  return (
    <>
      <div style={UI.lensHead}>
        <span style={UI.sectionTitle}>全部项目</span>
        <span style={UI.sectionHint}>
          {projects.length} 个 · 未完成待办{' '}
          {projects.reduce((sum, row) => sum + row.todoPending, 0)} 条
          {/* 0 条异常是可喜的默认态，写成"格式异常合计 0"只是噪音；有异常才报。 */}
          {issueTotal === 0 ? '' : ` · ⚠ 格式异常 ${issueTotal} 行`}
        </span>
      </div>
      <div style={{ ...UI.listColumn(), padding: S.lg, gap: S.sm }}>
        {projects.length === 0 ? (
          <div style={UI.empty}>
            没有找到已就绪的项目。已就绪 = 存在「&lt;顶级目录&gt;/&lt;项目&gt;/0. 协作/1. 工作日志.md」。
          </div>
        ) : (
          projects.map((row) => {
            const key = `p-${row.topLevelDir}/${row.project}`
            const total = row.todoPending + row.todoDone
            return (
              <button
                key={key}
                type="button"
                data-fl="project-row"
                style={UI.caseRow(props.hover === key, row.issueCount > 0)}
                {...hoverProps(key, props)}
                onClick={() =>
                  props.setScope({ project: row.project, topLevelDir: row.topLevelDir })
                }
              >
                <span style={UI.itemBody}>
                  <span style={{ display: 'flex', gap: S.sm, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ ...FONT.itemTitle, fontWeight: 600, color: T.labelPrimary }}>
                      {row.project}
                    </span>
                    <CategoryTag row={row} />
                    {/*
                      顶级目录与 H1 类别经常同名（「法律顾问」目录里放「# 工作日志_法律顾问」），
                      并排显示就是同一个词写两遍。只在两者不同时才补第二个标签。
                    */}
                    {row.topLevelDir === row.category ? null : (
                      <span style={UI.tag(T.border2)}>{row.topLevelDir}</span>
                    )}
                  </span>
                  <span style={{ ...UI.itemMeta, display: 'block' }}>
                    未完成 {row.todoPending} · 已完成 {row.todoDone} · 日程 {row.scheduleTotal}
                    {row.ongoing > 0 ? ` · 进行中 ${row.ongoing}` : ''}
                  </span>
                </span>
                {/* 完成进度：一条 6px 的细线，比再写一遍数字更快读出"这个案子还剩多少"。 */}
                <span style={UI.progress(total === 0 ? 0 : row.todoDone / total)} />
                <span style={UI.metric}>
                  {/*
                    只在真有问题时报错，不报"正常"：一个恒为"正常"的绿灯不携带信息，
                    却占掉了右侧最显眼的位置——未完成条数才是这个列表要回答的问题。
                  */}
                  {row.issueCount > 0 ? <span style={{ color: T.warn }}>⚠ 异常 {row.issueCount}</span> : null}
                  <span style={{ ...FONT.itemTitle, fontWeight: 600, color: T.labelPrimary }}>
                    {row.todoPending}
                  </span>
                  <span>未完成 / 共 {total}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </>
  )
}

/** 项目详情里的一条待办：展示备注（详情页不受"只显示标题"的约束）。 */
function TodoLineDetail(props: ViewProps & { readonly row: TodoRow }): JSX.Element {
  const { row } = props
  const key = `td-${row.project}#${row.line}`
  const done = props.doneOf(row)
  return (
    <div data-fl="detail-row" data-fl-item style={UI.detailRow(props.hover === key, done)} {...hoverProps(key, props)}>
      <input
        type="checkbox"
        style={{
          ...UI.checkbox(row.priority === undefined ? T.unset : props.overview.priorityColors[row.priority]),
          marginTop: 3,
        }}
        checked={done}
        aria-label={row.title}
        onChange={() => props.onToggleTodo(row)}
      />
      <span style={UI.itemBody}>
        <span style={UI.itemTitle(done)}>{row.title}</span>
        {row.note === undefined ? null : <span style={{ ...UI.itemMeta, display: 'block' }}>{row.note}</span>}
      </span>
    </div>
  )
}

/** 项目详情里的一条日程（带日期，按时间升序）。 */
function ScheduleLine(props: ViewProps & { readonly row: ScheduleRow }): JSX.Element {
  const { row } = props
  const key = `s-${row.project}#${row.line}`
  const done = props.doneOf(row)
  return (
    <div data-fl="schedule-row" data-fl-item style={UI.detailRow(props.hover === key, done)} {...hoverProps(key, props)}>
      <input
        type="checkbox"
        style={{
          ...UI.checkbox(row.priority === undefined ? T.unset : props.overview.priorityColors[row.priority]),
          marginTop: 3,
        }}
        checked={done}
        aria-label={row.title}
        onChange={() => props.onToggleSchedule(row)}
      />
      <span style={UI.timeCell}>{timeLabel(row)}</span>
      <span style={UI.itemBody}>
        <span style={{ display: 'flex', gap: S.sm, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={UI.itemTitle(done)}>{row.title}</span>
          {row.ongoing ? <span style={UI.tag(T.brand)}>进行中</span> : null}
        </span>
        <span style={{ ...UI.itemMeta, display: 'block' }}>
          {dateLabel(row)}
          {row.location === undefined ? '' : ` · ${row.location}`}
          {row.note === undefined ? '' : ` · ${row.note}`}
        </span>
      </span>
    </div>
  )
}

/** 单项目详情：该项目的**全部**待办事项与日程安排。 */
function ProjectDetail(
  props: ProjectLensProps & { readonly scope: { readonly project: string; readonly topLevelDir: string } },
): JSX.Element {
  const { scope } = props
  const row = props.overview.projects.find(
    (item) => item.project === scope.project && item.topLevelDir === scope.topLevelDir,
  )
  const todos = props.overview.todos.filter(
    (item) => item.project === scope.project && item.topLevelDir === scope.topLevelDir,
  )
  const schedules = sortSchedules(
    props.overview.schedules.filter(
      (item) => item.project === scope.project && item.topLevelDir === scope.topLevelDir,
    ),
  )
  const buckets = quadrantBuckets(todos)
  const unranked = unrankedTodos(todos)
  const issues = props.agenda?.project === scope.project ? props.agenda.issues : []

  return (
    <>
      <div style={UI.lensHead}>
        <button
          type="button"
          style={UI.textButton(props.hover === 'back')}
          {...hoverProps('back', props)}
          onClick={() => props.setScope(null)}
        >
          ‹ 全部项目
        </button>
        <span style={UI.sectionTitle}>{scope.project}</span>
        {row === undefined ? null : <CategoryTag row={row} />}
        {row !== undefined && row.topLevelDir === row.category ? null : (
          <span style={UI.tag(T.border2)}>{scope.topLevelDir}</span>
        )}
        <span style={UI.sectionHint}>
          待办 {todos.length} 条（未完成 {todos.filter((item) => !item.done).length}）· 日程{' '}
          {schedules.length} 条
        </span>
      </div>

      <div
        data-fl="project-detail"
        style={{ ...UI.listColumn(), padding: S.lg, gap: S.xl }}
      >
        <section data-fl="detail-card" data-fl-card="todo" style={UI.detailCard()}>
          {/* 卡片标题与卡片内的空白都是"在这个案件里新建一条待办"的热区——项目已经定死，
              窗里不必再选案件，这是"给某个案子记一件事"最顺手的一条路。 */}
          <div
            style={{
              ...UI.lensHead,
              padding: `${S.md}px ${S.lg}px`,
              borderBottom: `1px solid ${T.border1}`,
              background: props.hover === 'dc-todo' ? T.hover : T.bgLayer1,
              cursor: 'pointer',
            }}
            title={`点击新建一条「${scope.project}」的待办`}
            {...hoverProps('dc-todo', props)}
            onClick={blankClick(
              { kind: 'todo', project: scope.project, topLevelDir: scope.topLevelDir },
              props.onCompose,
            )}
          >
            <span style={UI.sectionTitle}>待办事项</span>
            <span style={UI.sectionHint}>
              四象限铺开，未完成在前、已完成在后；未设优先级的另列在下方
            </span>
            <span style={{ flex: 1 }} />
            <span style={UI.blankAdd(props.hover === 'dc-todo')}>＋</span>
          </div>
          <div
            style={{ padding: `${S.md}px ${S.lg}px ${S.lg}px`, cursor: 'pointer' }}
            title={`点击空白处新建一条「${scope.project}」的待办`}
            onClick={blankClick(
              { kind: 'todo', project: scope.project, topLevelDir: scope.topLevelDir },
              props.onCompose,
            )}
          >
            {todos.length === 0 ? (
              <div style={UI.empty}>该项目没有待办事项。</div>
            ) : (
              <>
                {/* 四格恒定铺满（含空格），见 `detailQuadrantEmpty` 的说明。 */}
                <div data-fl="detail-quadrants" style={UI.detailQuadrantGrid}>
                  {buckets.map((bucket) => {
                    const items = quadrantItems(bucket)
                    const headKey = `dq-${bucket.quadrant}`
                    const compose = blankClick(
                      {
                        kind: 'todo',
                        project: scope.project,
                        topLevelDir: scope.topLevelDir,
                        priority: bucket.quadrant,
                      },
                      props.onCompose,
                    )
                    return (
                      <section
                        key={bucket.quadrant}
                        data-fl="detail-group"
                        data-fl-quadrant={bucket.quadrant}
                        style={UI.detailQuadrant}
                      >
                        <div
                          style={UI.detailQuadrantHead(
                            props.overview.priorityColors[bucket.quadrant],
                            props.hover === headKey,
                          )}
                          title={`点击新建一条「${bucket.quadrant}」待办`}
                          {...hoverProps(headKey, props)}
                          onClick={compose}
                        >
                          <span style={{ ...FONT.itemTitle, fontWeight: 600, color: T.labelPrimary }}>
                            {bucket.quadrant}
                          </span>
                          <span style={{ ...UI.sectionHint, ...UI.detailQuadrantCount }}>
                            未完成 {bucket.pending.length} · 已完成 {bucket.done.length}
                          </span>
                          <span style={{ flex: 1 }} />
                          <span style={UI.blankAdd(props.hover === headKey)}>＋</span>
                        </div>
                        <div
                          style={UI.detailQuadrantList}
                          title={`点击空白处新建一条「${bucket.quadrant}」待办`}
                          onClick={compose}
                        >
                          {items.length === 0 ? (
                            <div style={UI.detailQuadrantEmpty}>暂无</div>
                          ) : (
                            items.map((item) => (
                              <TodoLineDetail key={`${item.project}#${item.line}`} {...props} row={item} />
                            ))
                          )}
                        </div>
                      </section>
                    )
                  })}
                </div>
                {/* 「未设优先级」不是第五个象限——硬塞进「不重要不紧急」是对数据的曲解，
                    所以它不进网格，单独占一行跟在网格下面。 */}
                {unranked.length === 0 ? null : (
                  <div
                    data-fl="detail-group"
                    data-fl-quadrant="未设优先级"
                    style={{ ...UI.detailQuadrant, marginTop: S.md }}
                  >
                    <div style={UI.detailQuadrantHead(T.border2)}>
                      <span style={{ ...FONT.itemTitle, fontWeight: 600, color: T.labelPrimary }}>
                        未设优先级
                      </span>
                      <span style={{ ...UI.sectionHint, ...UI.detailQuadrantCount }}>
                        {unranked.length} 条 · 不入象限
                      </span>
                    </div>
                    <div style={UI.detailQuadrantList}>
                      {unranked.map((item) => (
                        <TodoLineDetail key={`${item.project}#${item.line}`} {...props} row={item} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section data-fl="detail-card" data-fl-card="schedule" style={UI.detailCard()}>
          <div
            style={{
              ...UI.lensHead,
              padding: `${S.md}px ${S.lg}px`,
              borderBottom: `1px solid ${T.border1}`,
              background: props.hover === 'dc-schedule' ? T.hover : T.bgLayer1,
              cursor: 'pointer',
            }}
            title={`点击新建一条「${scope.project}」的日程（默认今天）`}
            {...hoverProps('dc-schedule', props)}
            onClick={blankClick(
              { kind: 'schedule', project: scope.project, topLevelDir: scope.topLevelDir },
              props.onCompose,
            )}
          >
            <span style={UI.sectionTitle}>日程安排</span>
            <span style={UI.sectionHint}>按开始时刻升序</span>
            <span style={{ flex: 1 }} />
            <span style={UI.blankAdd(props.hover === 'dc-schedule')}>＋</span>
          </div>
          <div
            style={{ padding: `${S.sm}px ${S.md}px ${S.lg}px`, cursor: 'pointer' }}
            title={`点击空白处新建一条「${scope.project}」的日程`}
            onClick={blankClick(
              { kind: 'schedule', project: scope.project, topLevelDir: scope.topLevelDir },
              props.onCompose,
            )}
          >
            {schedules.length === 0 ? (
              <div style={UI.empty}>该项目没有日程安排。</div>
            ) : (
              schedules.map((item) => (
                <ScheduleLine key={`${item.project}#${item.line}`} {...props} row={item} />
              ))
            )}
          </div>
        </section>

        {issues.length === 0 ? null : (
          <section data-fl="detail-card" data-fl-card="issues" style={UI.detailCard()}>
            <div style={{ ...UI.lensHead, padding: `${S.md}px ${S.lg}px`, borderBottom: `1px solid ${T.border1}` }}>
              <span style={{ ...UI.sectionTitle, color: T.warn }}>⚠ {issues.length} 条格式异常</span>
              <span style={UI.sectionHint}>原样保留，未擅自改写</span>
            </div>
            <div style={{ ...UI.issueList, padding: `${S.md}px ${S.lg}px` }}>
              {issues.map((issue, index) => (
                <div key={index}>
                  第 {issue.line ?? '-'} 行：{issue.message}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 使用说明
// ---------------------------------------------------------------------------

/**
 * 使用说明的分节数据。
 *
 * **顺序按用户的实际动作排**（用户明确要求："怎么打开这个工作台按道理要放在前面，
 * 因为用户是先打开工作台，然后才有其他具体操作的"）：打开面板 → 数据在哪 →
 * 界面上有哪三条线索 → 怎么新增 → 各线索的细节 → 颜色 → 设置。
 *
 * **「数据放在哪」排在第二**，因为它是本项目最该先知道、也最难自己猜出来的一条：
 * 数据不是存在插件里，而是磁盘上你自己写的 markdown；哪些目录名与章节名是固定的、
 * 能认到哪些项目、插件会不会替你改文件——这些不先讲清楚，后面所有操作都容易理解错。
 *
 * 每条都有 `hint`：折叠状态下它就是索引（"这一条讲什么"）。
 */
const HELP_SECTIONS: readonly {
  readonly title: string
  /** 标题右侧一句短语，说明这一条讲什么。 */
  readonly hint: string
  readonly lines: readonly string[]
  readonly code?: string
  readonly more?: readonly string[]
}[] = [
  {
    title: '怎么打开这个工作台',
    hint: '侧边栏底部那个「法程」按钮',
    lines: [
      '左侧会话菜单栏底部有一个**「法程」**按钮，点它开合工作台面板；面板打开时按钮变成实心蓝色（再点一次收起）。',
      '**这个按钮可以拖动**：按住它拖到任意位置，松手就停在那儿，位置会记住（下次打开还在那儿）；拖回左下角原处即恢复默认位置。屏幕变小后如果它跑到了看不见的地方，也会自动被拉回可视区内。',
      '点左侧会话菜单栏里的任意位置、或按 `Esc`，都会收起面板。',
    ],
  },
  {
    title: '数据放在哪：文件就是数据库',
    hint: '最该先知道的一条',
    lines: [
      '法程**不建数据库**，你的数据就是磁盘上的工作日志 markdown 文件，一个项目一份：',
    ],
    code: '<数据根目录>/<顶级目录>/<项目>/0. 协作/1. 工作日志.md',
    more: [
      '数据根目录在顶部「插件设置」里填，就是包含各案件文件夹的那一层。**「0. 协作」与「1. 工作日志.md」这两个名字是固定的**——插件按这条路径找项目，所以放在别处（例如「0. 工作」「.0. 数据」，或叫「0. 工作日志.md」）的工作日志**认不出来，插件也不会去猜**：猜错就会把条目写进你没想到的文件里。',
      '文件里只有两个二级章节：**「## 1. 待办事项」与「## 2. 日程安排」**，名字同样是固定的。章节缺失或条目格式异常时，插件**原样保留、只如实提示**，不替你重建、也不静默丢弃。',
      'H1 标题即服务类别，例如「# 工作日志_民事」；缺了或认不出来只是类别显示"未知"，功能不受影响。',
      '待办条目：- [ ] [标题]，[优先级]，[备注]',
      '日程条目：- [ ] [标题]，[优先级]，[备注]，[开始日期]，[结束日期]，[开始时间]，[结束时间]，[地点]',
      '字段由半角方括号界定；全角逗号只作书写分隔，可以自由出现在字段内容里。空字段写 []，字段里不能出现半角方括号（改用全角【】）。',
      '开始日期必填；只有开始日期就是全天事项；有开始时间无结束时间表示持续到当日结束。「进行中」是按当前时刻算出来的，不会写进文件。',
      '**你随时可以自己改这些文件**：勾选与新增都是"外科手术式"写回，只改被编辑的那一行，文件其余部分字节不变，不会打乱你写的排版。反过来，你在编辑器里改了文件，界面会重新加载并以**文件**为准。',
      '插件只读写「1. 工作日志.md」的两个章节，不碰其它文件；也不会替你创建目录或文件。',
    ],
  },
  {
    title: '三条线索：日程 / 待办 / 项目',
    hint: '同一时刻只看一条',
    lines: [
      '顶部的「日程 / 待办 / 项目」是三种阅读线索，同一时刻只用一种，切换线索不会改动任何数据。',
      '「日程」按时间读：日、周、月三种形态，各自展示对应范围内的全部日程安排。',
      '「待办」按紧急度读：四个优先级各占一个等面积象限。',
      '「项目」按案件读：先看全部项目，点进某个项目看它的全部待办与日程。',
      '**在哪儿勾选**：「日」形态点每条左侧的方框；「周」「月」点某一条日程弹出明细，在窗底那一个按钮上切换；待办与项目里每行左侧都有方框。已完成的条目划线置灰，并一律排在所有未完成之后。',
    ],
  },
  {
    title: '怎么新增待办与日程',
    hint: '点空白处就会弹窗',
    lines: [
      '**点任何一块空白就会弹出新建窗**：待办的四象限里点标题行或条目下方的空地、日程里点日卡的表头（「09/12 今天」那一行）、周列的列头、月历某一格里的空地，都会弹出一张填表的小窗。这些热区的标题行右侧有一个淡淡的 `＋`，鼠标移上去会亮起来——那就是"这儿能点"的暗号。',
      '**点在哪儿，决定了新建什么、预填什么**：点「重要且紧急」那一行，开出来的待办优先级已经填好了；点「09/12 今天」那一行，开出来的日程就是 9 月 12 日；在项目详情里点，新建的就写在这个案件上。预填只是默认值，窗里都能改。',
      '窗里的「项目」点开可以选别的案件，**输入两三个关键字就能筛**（案件名很长，不必打全），默认选中上次新建时用过的那个。能选的只有**已就绪**的项目，也就是上面那条路径上确实存在工作日志的那些。',
      '日程的时间两项**都留空 = 全天事项**；只填开始时间 = 持续到当日结束；结束日期留空 = 当天结束。',
      '窗里的校验与插件落盘用的是**同一份规则**（标题不能为空、日期要合法、结束时刻不能早于开始时刻、字段里不能出现半角方括号），所以窗里说没问题就一定写得进去。',
      '点「取消」、按 `Esc`、或点窗外的任何位置都能关掉，**不会写入任何东西**；写入失败时窗不会关，敲了一半的标题不会丢。新建的条目排在所属章节末尾，也就是"最近创建"的那一头。',
    ],
  },
  {
    title: '日程线索：日 / 周 / 月',
    hint: '怎么看、怎么翻页',
    lines: [
      '顶部第二行：左边切形态（日 / 周 / 月），中间恒显**当前聚焦的那一天**（三种形态写法一致，翻页时跟着焦点走），右侧是这一范围内的条数，最右端的「今天」一键跳回今天；两侧的 ‹ › 一次翻一天 / 一周 / 一个月。',
      '「周」「月」里点某一条日程会弹出它的明细（时间、地点、项目、备注），**窗里有一个按钮可以切换完成状态**；识别的是"哪一条日程"而不是"哪一天"，所以点条**不会跳去日视图**。',
      '一条日程"属于哪天"由它的有效时间区间决定：跨日事项在它覆盖的每一天都会出现（周形态里会同时出现在相邻两列）。',
      '条的颜色就是它的优先级；已完成退成浅底并划线置灰。月历格子里放不下的条目写成「+N」，不静默丢弃。',
      '把鼠标停在月历格子上能看到当天的完整说明：公历、农历全称、节日 / 节气、放假安排。',
    ],
  },
  {
    title: '月历上的农历与法定节假日',
    hint: '哪些能推算、哪些是公告',
    lines: [
      '格子右上角那一条按「传统节日 → 节气 → 农历初一显示月份 → 其余显示农历日期」**择一**显示；三者互斥，同一天只会出现一条。',
      '「休」表示法定节假日放假，「班」表示调休上班（本来是周末却要上班的日子）。这两个字与右上角那一条**可以同时出现**，位置夹在日号与农历之间。',
      `农历、二十四节气、中国传统节日都是历法推算出来的；**法定节假日不是**——它由国务院逐年公布，本插件内置的数据只到 ${HOLIDAY_DATA_LAST_YEAR} 年。`,
      `所以 ${HOLIDAY_DATA_LAST_YEAR + 1} 年及以后不显示「休 / 班」，农历与节气照常显示。要确认那一年的安排，以国务院办公厅的通知为准。`,
    ],
  },
  {
    title: '待办四象限',
    hint: '四个优先级、四个等面积格子',
    lines: [
      '四个象限 = 四个优先级（重要且紧急 / 紧急不重要 / 重要不紧急 / 不重要不紧急），面积恒等，标题左侧的色块就是它的优先级色。',
      '每格只显示"最近创建、且当前界面放得下"的条目；被截掉的条数会在该格标题右侧写明「未显示 N」。',
      '排序：未完成在前，已完成一律排在所有未完成之后，两组内部都按创建时间倒序、已完成划线置灰。"最近创建"依据工作日志里的行号——条目追加在章节末尾，行号越大越晚写入。',
      '条目只显示标题与完成状态，标题过长自动省略；把鼠标停在条目上可看到完整标题与所属项目。',
      '**点标题行或空白处**就能新建一条**这个优先级**的待办（优先级已经预填好）；未设优先级的待办不属于任何象限，其条数在标题行如实提示，新建时点「未设」那一片即可。',
    ],
  },
  {
    title: '项目线索',
    hint: '按案件读，一条待办都不裁',
    lines: [
      '列出全部已就绪项目，每个项目显示未完成待办、已完成待办、日程总数与格式异常数，右侧细线是完成进度。',
      '点进项目后，待办按**四个优先级铺成 2×2 四象限**（每格是标题 + 备注 + 勾选框，未完成在前、已完成在后），日程在下方按时间升序。',
      '四象限里**空格也会显示**并写「暂无」——"这一类一件事都没有"本身就是要读到的信息；整个项目详情一页滚到底，**一条待办都不会被截掉**。没写优先级的待办不属于任何象限，单独列在四象限下面。',
      '想给这个案子记一件事，就在「**待办事项**」或「**日程安排**」这两张卡片里点空白：案件默认就是这个，窗里也可以改成别的。',
    ],
  },
  {
    title: '优先级与颜色',
    hint: '四个颜色可以自己改',
    lines: [
      '重要且紧急（赤）、紧急不重要（橙）、重要不紧急（黄）、不重要不紧急（绿）——条目与象限上的颜色就是它的紧急度，不是装饰。',
      '这四个颜色可以自己改：顶部「插件设置」→「四象限颜色」，用取色器或直接填 #RRGGBB 都行，四个键可逐个恢复默认。颜色只写进 DSH 的设置，**不会写进你的数据文件**。',
      '条内的文字色按对比度自动取白或取深，所以把颜色改深改浅都还读得清。',
    ],
  },
  {
    title: '插件设置',
    hint: '数据目录与四象限颜色',
    lines: [
      '顶部「插件设置」里有两块，**各自独立保存**（改颜色不必先设数据目录，反之亦然）：',
      '数据目录：填入包含各项目文件夹的那一层（目录需要已存在）。保存后写入 DSH 的用户设置并立即生效。',
      '四象限颜色：四个优先级各一个取色器；改完点「保存颜色」。写坏的色值会被逐键退回默认色，并在下方说明原因。',
    ],
  },
]

/**
 * 说明文案里的 `**重点**` 渲染成加粗。
 *
 * 文案是**数据**（`HELP_SECTIONS` 里的字符串数组）而不是 JSX，所以重点只能在渲染时还原。
 * 只认一对 `**`，**不引 markdown 解析器**：这几十行文案不值得为它加一个依赖，也免得
 * 支持了标题 / 列表之后，有人往这里塞大段文档——说明页该是**一页索引**，不是一本手册。
 *
 * 实测踩过：先写了 `**` 文案却没写这段，界面上就原样显示 `**择一**`。
 */
function richLine(line: string): JSX.Element {
  // `split` 之后，奇数下标（1、3、5…）落在成对的 `**` 之间。
  return (
    <>
      {line.split('**').map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} style={UI.helpStrong}>
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  )
}

/**
 * 使用说明：介绍运行规则与使用方法。
 *
 * **折叠式**：开场说明恒定可见，其余每条默认收起，点标题展开。
 *
 * 三条来自用户反馈的规矩（原文："不要一股脑堆在一起，除了最基础的介绍说明之外，其他内容
 * 默认折叠，用户点击问题标题后再展开"）：
 *
 * 1. **默认全部收起**。以前是把十几节正文一次铺满，用户得自己滚两屏去找一条；
 *    现在折叠状态下每一行就是一条索引（标题 + 一句 hint）。
 * 2. **顺序按用户的实际动作排**：先"怎么打开"，再"数据放在哪"（本项目最难自己猜出来的一条），
 *    然后"有哪三条线索""怎么新增"，最后才是各处的细节与设置。
 * 3. **可同时展开多条**。不做成"开一条关一条"的互斥手风琴——用户常常要对着两条看
 *    （比如"怎么新增"与"数据放在哪"），强制收起只会让人来回点。
 *
 * 展开状态是**组件内 state**，关掉说明页即重置（下次打开又是干净的索引）。
 */
export function HelpView(props: {
  readonly onClose: () => void
  readonly hover: string | null
  readonly setHover: (key: string | null) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  return (
    <div data-fl="help-overlay" style={UI.helpOverlay} role="dialog" aria-label="法程使用说明">
      <header style={UI.topBar}>
        <span style={UI.sectionTitle}>法程 · 使用说明</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={UI.primaryButton(props.hover === 'help-close', false)}
          onMouseEnter={() => props.setHover('help-close')}
          onMouseLeave={() => props.setHover(null)}
          onClick={props.onClose}
        >
          知道了
        </button>
      </header>
      <div style={UI.helpBody} data-fl="help-body">
        {/* 开场说明**恒定可见**，其余全部默认折叠：一屏能读完"这是什么、怎么用"，
            要细节再点开。用户原话是"不要一股脑堆在一起"。 */}
        <div style={UI.helpIntro} data-fl="help-intro">
          <span style={{ ...UI.helpText, color: T.labelPrimary }}>
            法程把本地工作日志里的「待办」与「日程」按三条线索摊开，帮助你回答三个问题：
            我今天有什么安排（日程）、现在最该先做哪几件（待办）、手头每个案子各压着多少事（项目）。
          </span>
          <span style={UI.sectionHint}>
            下面 {HELP_SECTIONS.length} 条按使用的先后顺序排；点标题展开、再点收起。
            数据怎么存、放在哪，写在第 2 条里——那条最值得先看一眼。
          </span>
        </div>

        <div style={UI.helpList}>
          {HELP_SECTIONS.map((section, index) => {
            const open = expanded[section.title] === true
            const key = `help-${index}`
            return (
              <section
                key={section.title}
                data-fl="help-section"
                data-fl-open={open ? 'y' : 'n'}
                style={UI.helpSection}
              >
                <button
                  type="button"
                  data-fl="help-toggle"
                  data-fl-title={section.title}
                  style={UI.helpToggle(open, props.hover === key)}
                  aria-expanded={open}
                  aria-label={`${section.title}（${open ? '收起' : '展开'}）`}
                  onMouseEnter={() => props.setHover(key)}
                  onMouseLeave={() => props.setHover(null)}
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [section.title]: prev[section.title] !== true }))
                  }
                >
                  <span style={UI.helpIndex}>{index + 1}</span>
                  <span style={UI.helpTitle}>{section.title}</span>
                  <span style={UI.helpHint}>{section.hint}</span>
                  <span style={UI.helpChevron(open)}>▾</span>
                </button>
                {open ? (
                  <div style={UI.helpPanel} data-fl="help-panel">
                    {section.lines.map((line) => (
                      <div key={line} style={UI.helpText}>
                        {richLine(line)}
                      </div>
                    ))}
                    {section.code === undefined ? null : (
                      <div style={UI.helpText}>
                        <span style={UI.helpCode}>{section.code}</span>
                      </div>
                    )}
                    {(section.more ?? []).map((line) => (
                      <div key={line} style={UI.helpText}>
                        {richLine(line)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 数据目录表单
// ---------------------------------------------------------------------------

/** 未设定数据目录时的界面：**只给一个路径输入框**（数据来源未知时其余功能无意义）。 */
export function SetupForm(props: {
  readonly value: string
  readonly error: string | null
  readonly saving: boolean
  readonly canCancel: boolean
  readonly hover: string | null
  readonly setHover: (key: string | null) => void
  readonly onChange: (value: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
  /** 四象限颜色草稿（`null` = 还没取到，此时只显示数据目录那一块）。 */
  readonly colors: Record<Priority, string> | null
  /** 出厂默认色，供「恢复默认」用。 */
  readonly defaultColors: Record<Priority, string> | null
  readonly colorError: string | null
  readonly savingColors: boolean
  /** host 较旧、没下发颜色：颜色区会显示一条说明，保存也会被短路。 */
  readonly colorsUnavailable?: boolean
  readonly onChangeColor: (priority: Priority, value: string) => void
  readonly onResetColors: () => void
  readonly onSaveColors: () => void
}): JSX.Element {
  const disabled = props.saving || props.value.trim().length === 0
  return (
    <div style={{ padding: S.xl, display: 'flex', flexDirection: 'column', gap: S.xxl, maxWidth: 640 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
        <div style={UI.sectionHint}>
          请填入数据根目录（包含各项目文件夹的那一层）。插件按
          「&lt;数据根目录&gt;/&lt;顶级目录&gt;/&lt;项目&gt;/0. 协作/1. 工作日志.md」读取工作日志；
          目录需要已存在，插件不会创建它。完整的数据约定见顶部「使用说明」。
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
          <span style={UI.sectionTitle}>数据根目录</span>
          <input
            style={UI.input(props.hover === 'data-root-input')}
            placeholder="例如 L:\\法律工作"
            value={props.value}
            aria-label="数据根目录"
            onMouseEnter={() => props.setHover('data-root-input')}
            onMouseLeave={() => props.setHover(null)}
            onChange={(event) => props.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') props.onSave()
            }}
          />
        </label>
        {props.error === null ? null : (
          <div style={{ ...FONT.secondary, color: T.error }} role="alert">
            {props.error}
          </div>
        )}
        <div style={{ display: 'flex', gap: S.sm }}>
          <button
            type="button"
            disabled={disabled}
            style={UI.primaryButton(props.hover === 'save-data-root', disabled)}
            onMouseEnter={() => props.setHover('save-data-root')}
            onMouseLeave={() => props.setHover(null)}
            onClick={props.onSave}
          >
            {props.saving ? '保存中…' : '保存'}
          </button>
          {props.canCancel ? (
            <button
              type="button"
              style={UI.textButton(props.hover === 'cancel-setup')}
              onMouseEnter={() => props.setHover('cancel-setup')}
              onMouseLeave={() => props.setHover(null)}
              onClick={props.onCancel}
            >
              取消
            </button>
          ) : null}
        </div>
      </section>

      {props.colors === null ? null : <ColorSection {...props} colors={props.colors} />}
    </div>
  )
}

/** 四象限颜色设置：四个优先级各一行（取色器 + 十六进制文本框）+ 一条实样预览。 */
function ColorSection(
  props: Parameters<typeof SetupForm>[0] & { readonly colors: Record<Priority, string> },
): JSX.Element {
  const colors = props.colors
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm, flexWrap: 'wrap' }}>
        <span style={UI.sectionTitle}>四象限颜色</span>
        <span style={UI.sectionHint}>
          四个优先级在日程条、月历小条、象限色块与复选框上显示的颜色；条内的文字色会按对比度
          自动取白或取深，改深改浅都不会看不清。
        </span>
      </div>

      {/* host 较旧（没有下发颜色）时，这里如实说明——否则用户改完发现没生效，只会以为坏了。 */}
      {props.colorsUnavailable === true ? (
        <div style={UI.banner('warn')} role="status">
          <span style={{ flex: 1 }}>{HOST_OUTDATED_COLORS}</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
        {PRIORITIES.map((priority) => (
          <div key={priority} style={UI.colorRow()}>
            <span style={UI.colorRowLabel()}>{priority}</span>
            <input
              type="color"
              style={UI.colorSwatch()}
              value={colors[priority] ?? '#000000'}
              aria-label={`${priority}的颜色`}
              onChange={(event) => props.onChangeColor(priority, event.target.value)}
            />
            <input
              style={UI.input(props.hover === `color-${priority}`)}
              value={colors[priority] ?? ''}
              aria-label={`${priority}的颜色值`}
              spellCheck={false}
              onMouseEnter={() => props.setHover(`color-${priority}`)}
              onMouseLeave={() => props.setHover(null)}
              onChange={(event) => props.onChangeColor(priority, event.target.value)}
            />
            {props.defaultColors === null ? null : (
              <button
                type="button"
                style={UI.textButton(props.hover === `color-reset-${priority}`)}
                aria-label={`把${priority}恢复为默认色`}
                onMouseEnter={() => props.setHover(`color-reset-${priority}`)}
                onMouseLeave={() => props.setHover(null)}
                onClick={() => props.onChangeColor(priority, props.defaultColors?.[priority] ?? '#000000')}
              >
                默认
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 实样预览：颜色块长什么样，看这一条就够了，不必先保存再回日程里找。 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>
        <span style={UI.sectionHint}>预览（未保存也会跟着变）</span>
        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
          {PRIORITIES.map((priority) => (
            <span key={priority} style={UI.colorPreview(colors[priority] ?? '#000000')}>
              <span style={UI.barMark(false)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {priority}
              </span>
            </span>
          ))}
        </div>
      </div>

      {props.colorError === null ? null : (
        <div style={{ ...FONT.secondary, color: T.error }} role="alert">
          {props.colorError}
        </div>
      )}

      <div style={{ display: 'flex', gap: S.sm }}>
        <button
          type="button"
          disabled={props.savingColors}
          style={UI.primaryButton(props.hover === 'save-colors', props.savingColors)}
          onMouseEnter={() => props.setHover('save-colors')}
          onMouseLeave={() => props.setHover(null)}
          onClick={props.onSaveColors}
        >
          {props.savingColors ? '保存中…' : '保存颜色'}
        </button>
        <button
          type="button"
          style={UI.textButton(props.hover === 'reset-colors')}
          onMouseEnter={() => props.setHover('reset-colors')}
          onMouseLeave={() => props.setHover(null)}
          onClick={props.onResetColors}
        >
          全部恢复默认
        </button>
      </div>
    </section>
  )
}

/** 供测试引用的行高常量：`styles.ts` 是唯一事实来源（象限裁剪按它换算条数）。 */
export const QUADRANT_ROW_HEIGHT: number = TODO_ROW_HEIGHT
