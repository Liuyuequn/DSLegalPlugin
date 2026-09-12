import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkLogWatcher, type WatchAdapter } from '../src/watcher.ts'

const LOG = resolve('虚拟目录', '1. 工作日志.md')

interface Fake {
  readonly adapter: WatchAdapter
  emit(event: string, path: string): void
  readonly added: string[][]
  readonly removed: string[][]
  isClosed(): boolean
}

function createFake(): Fake {
  const handlers: Array<(event: string, path: string) => void> = []
  const added: string[][] = []
  const removed: string[][] = []
  let closed = false
  return {
    adapter: {
      on: (_event, handler) => {
        handlers.push(handler)
      },
      add: (paths) => {
        added.push([...paths])
      },
      unwatch: (paths) => {
        removed.push([...paths])
      },
      close: async () => {
        closed = true
      },
    },
    emit: (event, path) => {
      for (const handler of handlers) handler(event, path)
    },
    added,
    removed,
    isClosed: () => closed,
  }
}

describe('createWorkLogWatcher（注入式适配器）', () => {
  it('防抖：短时间内多次变更只通知一次', () => {
    vi.useFakeTimers()
    try {
      const fake = createFake()
      const watcher = createWorkLogWatcher([LOG], {
        debounceMs: 100,
        createAdapter: () => fake.adapter,
      })
      const seen: string[] = []
      watcher.subscribe((path) => seen.push(path))

      fake.emit('change', LOG)
      fake.emit('change', LOG)
      fake.emit('add', LOG)
      expect(seen).toEqual([])

      vi.advanceTimersByTime(150)
      expect(seen).toEqual([LOG])
    } finally {
      vi.useRealTimers()
    }
  })

  it('抑制回环：自身写入后的窗口内事件被忽略', () => {
    vi.useFakeTimers()
    try {
      let clock = 1000
      const fake = createFake()
      const watcher = createWorkLogWatcher([LOG], {
        debounceMs: 50,
        echoWindowMs: 500,
        createAdapter: () => fake.adapter,
        now: () => clock,
      })
      const seen: string[] = []
      watcher.subscribe((path) => seen.push(path))

      watcher.markSelfWrite(LOG)
      fake.emit('change', LOG)
      vi.advanceTimersByTime(100)
      expect(seen).toEqual([])

      // 超出抑制窗口后，外部改动应正常通知。
      clock += 1000
      fake.emit('change', LOG)
      vi.advanceTimersByTime(100)
      expect(seen).toEqual([LOG])
    } finally {
      vi.useRealTimers()
    }
  })

  it('忽略未监听的路径与目录事件', () => {
    vi.useFakeTimers()
    try {
      const fake = createFake()
      const watcher = createWorkLogWatcher([LOG], {
        debounceMs: 50,
        createAdapter: () => fake.adapter,
      })
      const seen: string[] = []
      watcher.subscribe((path) => seen.push(path))

      fake.emit('change', resolve('别的', '1. 工作日志.md'))
      fake.emit('addDir', LOG)
      fake.emit('unlinkDir', LOG)
      vi.advanceTimersByTime(100)
      expect(seen).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('setPaths 增删监听集合', () => {
    const fake = createFake()
    const other = resolve('虚拟目录', '另一个项目', '1. 工作日志.md')
    const watcher = createWorkLogWatcher([LOG], { createAdapter: () => fake.adapter })

    watcher.setPaths([other])
    expect(fake.added).toEqual([[other]])
    expect(fake.removed).toEqual([[LOG]])
  })

  it('取消订阅后不再收到通知；close 关闭适配器', async () => {
    vi.useFakeTimers()
    try {
      const fake = createFake()
      const watcher = createWorkLogWatcher([LOG], {
        debounceMs: 50,
        createAdapter: () => fake.adapter,
      })
      const seen: string[] = []
      const unsubscribe = watcher.subscribe((path) => seen.push(path))
      unsubscribe()

      fake.emit('change', LOG)
      vi.advanceTimersByTime(100)
      expect(seen).toEqual([])

      await watcher.close()
      expect(fake.isClosed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createWorkLogWatcher（真实 chokidar）', () => {
  let root = ''

  afterEach(async () => {
    if (root.length > 0) await rm(root, { recursive: true, force: true })
  })

  it('外部写入触发通知', async () => {
    root = await mkdtemp(join(tmpdir(), 'dslegal-watch-'))
    const file = join(root, '1. 工作日志.md')
    await writeFile(file, '初始内容', 'utf8')

    const watcher = createWorkLogWatcher([file], { debounceMs: 50, echoWindowMs: 0 })
    const seen: string[] = []
    watcher.subscribe((path) => seen.push(path))

    // 等 chokidar 完成初始化。
    await new Promise((done) => setTimeout(done, 500))
    await writeFile(file, '外部改动', 'utf8')

    const deadline = Date.now() + 5000
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 50))
    }
    await watcher.close()

    expect(seen).toEqual([file])
  }, 20000)
})
