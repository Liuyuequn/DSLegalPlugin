import { afterEach, describe, expect, it, vi } from 'vitest'

import { HOST_OUTDATED, HOST_OUTDATED_COLORS, getOverview, getSettings, postSettings } from '../src/api.js'

/** 一份形状完整的响应（含后加的 priorityColors 与三级目录字段）。 */
const FULL = {
  configured: true,
  rootDir: 'L:\\法律工作',
  extraTypeDirs: ['L:\\别的盘\\诉讼案件'],
  extraProjectDirs: [],
  today: '2026-09-11',
  projects: [],
  todos: [],
  schedules: [],
  priorityColors: {
    重要且紧急: '#E53E3E',
    紧急不重要: '#ED8936',
    重要不紧急: '#f3e417',
    不重要不紧急: '#98c51e',
  },
}

/**
 * client 产物按请求从磁盘读、刷新页面即生效；host 插件要重启 DSH 才换新。
 * 于是存在"先刷新了页面、还没重启 DSH"的窗口期：新界面会拿到旧接口的响应。
 * 这里守住"必须给出可执行提示"这条底线——否则界面会把"接口没有这个字段"渲染成
 * "今天没有安排"，看起来一切正常，极具迷惑性。
 */
describe('总览接口的形状守卫', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubJson(payload: unknown, ok = true, status?: number): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status: status ?? (ok ? 200 : 500),
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      })),
    )
  }

  it('返回 schedules 与 todos 时原样通过', async () => {
    stubJson(FULL)
    await expect(getOverview()).resolves.toMatchObject({ configured: true, today: '2026-09-11' })
  })

  it('host 接口过旧（只有 timeline、没有 schedules）时抛出可执行提示', async () => {
    stubJson({
      configured: true,
      rootDir: 'L:\\法律工作',
      today: '2026-09-11',
      projects: [],
      todos: [],
      timeline: [],
    })
    await expect(getOverview()).rejects.toThrow(HOST_OUTDATED)
    expect(HOST_OUTDATED).toContain('重启 DSH')
  })

  /**
   * 颜色字段是后加的。缺它**不抛错**——内置默认色是可证明正确的兜底（正是旧 host
   * 一直在用的那一套），降级渲染 + 标记出来提示重启 DSH，比让整个面板打不开有用。
   * 注意这与 `schedules` 缺失的处理**刻意不同**：那里缺失等于"数据是错的"。
   */
  it('缺 priorityColors（做了颜色自定义之前的 host）时降级为默认色并标记出来', async () => {
    const { priorityColors: _omitted, ...withoutColors } = FULL
    stubJson(withoutColors)
    const overview = await getOverview()
    expect(overview.colorsUnavailable).toBe(true)
    expect(overview.priorityColors['重要且紧急']).toBe('#E53E3E')
    expect(HOST_OUTDATED_COLORS).toContain('重启 DSH')
  })

  it('接口带颜色时不做降级标记', async () => {
    stubJson(FULL)
    const overview = await getOverview()
    expect(overview.colorsUnavailable).toBeUndefined()
    expect(overview.priorityColors['重要且紧急']).toBe('#E53E3E')
  })

  it('非 2xx 时报告状态码', async () => {
    stubJson({}, false, 500)
    await expect(getOverview()).rejects.toThrow('请求失败：HTTP 500')
  })
})

/**
 * 三级目录字段的**降级**。
 *
 * 与 `schedules` / `todos` 那条守卫**刻意相反**：那里字段缺失等于"数据是错的"（会把
 * "接口没这个字段"渲染成"今天没有安排"），必须抛错；而目录字段缺失在旧 host 上就是
 * 常态，"一个目录都没设"是一个可证明正确的兜底——界面照常打开、只是表单是空的。
 * 抛错会让设置页在"页面已刷新、DSH 还没重启"的窗口期里整页打不开。
 */
describe('三级目录字段的降级（旧 host 没有这些字段）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubJson(payload: unknown, ok = true, status?: number): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status: status ?? (ok ? 200 : 500),
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      })),
    )
  }

  /** 完整响应，但**没有**三级目录字段（＝目录设置上线之前的 host）。 */
  const withoutDirs = (): Record<string, unknown> => {
    const { rootDir: _root, extraTypeDirs: _types, extraProjectDirs: _projects, ...rest } = FULL
    return rest
  }

  it('总览缺目录字段时降级为 null / []，而不是抛错', async () => {
    stubJson(withoutDirs())
    const overview = await getOverview()
    expect(overview.rootDir).toBeNull()
    expect(overview.extraTypeDirs).toEqual([])
    expect(overview.extraProjectDirs).toEqual([])
    // 关键：schedules / todos 那道抛错守卫**不该**被这条路径触发。
    expect(overview.today).toBe('2026-09-11')
  })

  it('目录字段在、但类型不对时同样降级（旧 host 可能给字符串而不是数组）', async () => {
    stubJson({ ...withoutDirs(), rootDir: 42, extraTypeDirs: 'L:\\甲', extraProjectDirs: null })
    const overview = await getOverview()
    expect(overview.rootDir).toBeNull()
    expect(overview.extraTypeDirs).toEqual([])
    expect(overview.extraProjectDirs).toEqual([])
  })

  it('字段齐全时原样读出，不覆盖', async () => {
    stubJson(FULL)
    const overview = await getOverview()
    expect(overview.rootDir).toBe('L:\\法律工作')
    expect(overview.extraTypeDirs).toEqual(['L:\\别的盘\\诉讼案件'])
    expect(overview.extraProjectDirs).toEqual([])
  })

  it('设置接口同样降级（旧 host 的设置响应里也没有这些键）', async () => {
    stubJson({
      configured: true,
      projectCount: 0,
      incompleteCount: 0,
      priorityColors: FULL.priorityColors,
      defaultPriorityColors: FULL.priorityColors,
      colorIssues: [],
    })
    const settings = await getSettings()
    expect(settings.rootDir).toBeNull()
    expect(settings.extraTypeDirs).toEqual([])
    expect(settings.extraProjectDirs).toEqual([])
  })

  it('保存的回值也降级：旧 host 回的是"只认 rootDir"的那一份', async () => {
    stubJson({ configured: true, rootDir: 'L:\\法律工作', priorityColors: FULL.priorityColors })
    const saved = await postSettings({ priorityColors: FULL.priorityColors })
    expect(saved.rootDir).toBe('L:\\法律工作')
    expect(saved.extraTypeDirs).toEqual([])
    expect(saved.extraProjectDirs).toEqual([])
  })

  it('保存时把三个目录字段原样送出去（rootDir 空串＝清空，不是省略）', async () => {
    // 形参必须写出来：`vi.fn` 按实现签名推断实参元组，写成 `async () => …` 会让
    // `mock.calls[0]` 变成空元组，取 `[1]` 连类型检查都过不去（也真取不到 body）。
    const fetchMock = vi.fn(async (_url: string, _init?: { readonly body?: unknown }) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    }))
    vi.stubGlobal('fetch', fetchMock)
    await postSettings({ rootDir: '', extraTypeDirs: ['L:\\甲'], extraProjectDirs: [] })
    const sent = fetchMock.mock.calls[0]?.[1]?.body
    const body = JSON.parse(String(sent)) as Record<string, unknown>
    expect(body).toEqual({ rootDir: '', extraTypeDirs: ['L:\\甲'], extraProjectDirs: [] })
  })
})
