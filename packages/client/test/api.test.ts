import { afterEach, describe, expect, it, vi } from 'vitest'

import { HOST_OUTDATED, HOST_OUTDATED_COLORS, getOverview } from '../src/api.js'

/** 一份形状完整的响应（含后加的 priorityColors）。 */
const FULL = {
  configured: true,
  dataRoot: 'L:\\法律工作',
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
      dataRoot: 'L:\\法律工作',
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
