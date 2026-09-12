/**
 * 文件监听：感知外部编辑器的改动。
 *
 * 三条硬要求（见 AGENTS.md 第 5.2 节）：
 * 1. **抑制回环** —— 插件自身写入后短时间内忽略该路径的事件；
 * 2. **防抖** —— 合并短时间内的多次变更；
 * 3. **可测试** —— 底层监听器与时钟可注入。
 */

import { resolve } from 'node:path'

import { watch as chokidarWatch } from 'chokidar'

/** 底层监听适配器（默认由 chokidar 实现）。 */
export interface WatchAdapter {
  on(event: 'all', handler: (event: string, path: string) => void): void
  add(paths: readonly string[]): void
  unwatch(paths: readonly string[]): void
  close(): Promise<void>
}

export type WatchAdapterFactory = (paths: readonly string[]) => WatchAdapter

export interface WorkLogWatcherOptions {
  /** 防抖毫秒数，默认 150。 */
  readonly debounceMs?: number
  /** 自身写入后的回环抑制窗口，默认 500 毫秒。 */
  readonly echoWindowMs?: number
  readonly createAdapter?: WatchAdapterFactory
  /** 可注入时钟，便于测试。 */
  readonly now?: () => number
}

export interface WorkLogWatcher {
  /** 订阅变更（已去抖、已抑制回环）；返回取消订阅。 */
  subscribe(listener: (path: string) => void): () => void
  /** 通知"这是本插件自己写的"，抑制随后的回环事件。 */
  markSelfWrite(path: string): void
  /** 更新被监听的路径集合。 */
  setPaths(paths: readonly string[]): void
  close(): Promise<void>
}

const chokidarAdapter: WatchAdapterFactory = (paths) => {
  const watcher = chokidarWatch([...paths], { ignoreInitial: true })
  return {
    on: (event, handler) => {
      watcher.on(event, handler)
    },
    add: (next) => {
      watcher.add([...next])
    },
    unwatch: (next) => {
      void watcher.unwatch([...next])
    },
    close: () => watcher.close(),
  }
}

/** 创建监听器。 */
export function createWorkLogWatcher(
  paths: readonly string[],
  options: WorkLogWatcherOptions = {},
): WorkLogWatcher {
  const debounceMs = options.debounceMs ?? 150
  const echoWindowMs = options.echoWindowMs ?? 500
  const now = options.now ?? ((): number => Date.now())
  const createAdapter = options.createAdapter ?? chokidarAdapter

  const watched = new Set(paths.map((path) => resolve(path)))
  const listeners = new Set<(path: string) => void>()
  const selfWrites = new Map<string, number>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const adapter = createAdapter([...watched])

  adapter.on('all', (event, changed) => {
    if (event === 'addDir' || event === 'unlinkDir') return
    const target = resolve(changed)
    if (!watched.has(target)) return

    const writtenAt = selfWrites.get(target)
    if (writtenAt !== undefined && now() - writtenAt <= echoWindowMs) return

    const pending = timers.get(target)
    if (pending !== undefined) clearTimeout(pending)
    timers.set(
      target,
      setTimeout(() => {
        timers.delete(target)
        for (const listener of listeners) listener(target)
      }, debounceMs),
    )
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    markSelfWrite(path) {
      selfWrites.set(resolve(path), now())
    },
    setPaths(next) {
      const desired = new Set(next.map((path) => resolve(path)))
      const added = [...desired].filter((path) => !watched.has(path))
      const removed = [...watched].filter((path) => !desired.has(path))
      if (added.length > 0) adapter.add(added)
      if (removed.length > 0) adapter.unwatch(removed)
      watched.clear()
      for (const path of desired) watched.add(path)
    },
    async close() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      listeners.clear()
      await adapter.close()
    },
  }
}
