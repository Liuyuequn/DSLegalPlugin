import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { COLLAB_DIR, WORK_LOG_FILE } from '@dslegal/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apply } from '../src/index.ts'
import type { WebRouteLike, WebServerLike } from '../src/http.ts'

const WORK_LOG = [
  '# 工作日志_民事',
  '',
  '## 1. 待办事项',
  '',
  '- [ ] [起草起诉状]，[重要且紧急]',
  '- [ ] [整理证据]，[重要不紧急]',
  '',
  '## 2. 日程安排',
  '',
  '- [ ] [开庭]，[重要且紧急]，[]，[2026-09-01]，[]，[09:00]，[11:00]，[第一法庭]',
  '',
].join('\n')

interface Harness {
  readonly ctx: unknown
  readonly tools: Map<string, { name: string; execute: (args: unknown) => Promise<unknown> }>
  readonly request: (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }>
  readonly route: () => WebRouteLike
  /** 执行插件注册的 effect disposer（关闭文件监听），避免临时目录被删除后仍持有句柄。 */
  readonly dispose: () => void
}

/** 假的 `ctx.settings`：用户层可写、可观察（真实实现见 `dsh-settings-file`）。 */
function makeSettings(initial: { dataRoot?: string } = {}): {
  readonly provider: unknown
  readonly user: { dataRoot?: string }
} {
  const user: { dataRoot?: string } = { ...initial }
  const watchers: (() => void)[] = []

  const notify = (): void => {
    for (const watcher of watchers) watcher()
  }

  const provider = {
    register(_ns: string, _schema: unknown, options?: { base?: { dataRoot?: string } }) {
      const scope = {
        get: () => ({ ...options?.base, ...user }),
        watch(callback: () => void) {
          watchers.push(callback)
          return () => undefined
        },
        async update(patch: object) {
          Object.assign(user, patch)
          notify()
        },
      }
      return scope
    },
    async update(_ns: string, patch: object) {
      Object.assign(user, patch)
      notify()
    },
  }

  return { provider, user }
}

function makeHarness(settings?: unknown): Harness {
  const tools = new Map<string, { name: string; execute: (args: unknown) => Promise<unknown> }>()
  const disposers: (() => void)[] = []
  let route: WebRouteLike | null = null

  const webServer: WebServerLike = {
    register(candidate) {
      route = candidate
      return () => {
        route = null
      }
    },
  }

  const ctx = {
    tools: {
      register(definition: { name: string; execute: (args: unknown) => Promise<unknown> }) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    inject(_deps: string[], callback: (scoped: unknown) => void) {
      callback(ctx)
    },
    get(name: string) {
      if (name === 'webServer') return webServer
      if (name === 'settings') return settings
      return undefined
    },
    effect(execute: () => unknown) {
      const disposer = execute()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
    emit() {
      // 事件在本测试中无消费者。
    },
  }

  const routeOf = (): WebRouteLike => {
    if (route === null) throw new Error('未注册 HTTP 路由')
    return route
  }

  return {
    ctx,
    tools,
    route: routeOf,
    dispose() {
      for (const disposer of disposers) disposer()
      disposers.length = 0
    },
    async request(method, url, body) {
      const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
      const req = {
        method,
        url,
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) yield chunk
        },
      } as unknown as IncomingMessage

      const captured: Buffer[] = []
      let status = 200
      let settle: (value: { status: number; body: unknown }) => void = () => undefined
      const done = new Promise<{ status: number; body: unknown }>((resolve) => {
        settle = resolve
      })
      const res = {
        writeHead(code: number) {
          status = code
          return res
        },
        end(chunk?: string | Buffer) {
          if (chunk !== undefined) captured.push(Buffer.from(chunk))
          const text = Buffer.concat(captured).toString('utf8')
          settle({ status, body: text.length === 0 ? {} : JSON.parse(text) })
        },
      } as unknown as ServerResponse

      await routeOf().handler(req, res)
      const settled = await done
      return { status: settled.status, body: settled.body as any }
    },
  }
}

let root = ''
let harness: Harness
let settings: ReturnType<typeof makeSettings>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dslegal-e2e-'))
  const dir = join(root, '诉讼案件', '张三诉李四', COLLAB_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, WORK_LOG_FILE), WORK_LOG, 'utf8')

  settings = makeSettings()
  harness = makeHarness(settings.provider)
  apply(harness.ctx as Parameters<typeof apply>[0], {
      dataRoot: root,
      debounceMs: 20,
      echoWindowMs: 20,
    },
  )
})

afterEach(async () => {
  // 先关闭插件注册的文件监听，再删除临时目录，否则 chokidar 会抛 EPERM: realpath。
  harness.dispose()
  await new Promise((done) => setTimeout(done, 200))
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
})

describe('插件装配', () => {
  it('注册了全部 legal_* 工具', () => {
    const names = [...harness.tools.keys()].sort()
    expect(names).toEqual([
      'legal_agenda_query',
      'legal_project_list',
      'legal_schedule_add',
      'legal_schedule_list',
      'legal_schedule_remove',
      'legal_schedule_set',
      'legal_todo_add',
      'legal_todo_list',
      'legal_todo_remove',
      'legal_todo_set',
    ])
  })

  it('注册了 /dslegal 前缀路由', () => {
    expect(harness.route().kind).toBe('prefix')
    expect(harness.route().path).toBe('/dslegal')
  })
})

describe('HTTP 接口', () => {
  it('GET /dslegal/projects 返回项目与类别', async () => {
    const { status, body } = await harness.request('GET', '/dslegal/projects')
    expect(status).toBe(200)
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]).toMatchObject({
      project: '张三诉李四',
      topLevelDir: '诉讼案件',
      category: '民事诉讼',
    })
  })

  it('GET /dslegal/agenda 返回待办与日程', async () => {
    const { status, body } = await harness.request('GET', '/dslegal/agenda?project=张三诉李四')
    expect(status).toBe(200)
    expect(body.todos.map((row: { title: string }) => row.title)).toEqual(['起草起诉状', '整理证据'])
    expect(body.schedule[0]).toMatchObject({ title: '开庭', startDate: '2026-09-01' })
  })

  it('未知项目返回 400', async () => {
    const { status, body } = await harness.request('GET', '/dslegal/agenda?project=不存在')
    expect(status).toBe(400)
    expect(body.error).toContain('未找到项目')
  })

  it('未知路径返回 404', async () => {
    const { status } = await harness.request('GET', '/dslegal/unknown')
    expect(status).toBe(404)
  })

  it('GET /dslegal/settings 报告已设定的数据目录', async () => {
    const { status, body } = await harness.request('GET', '/dslegal/settings')
    expect(status).toBe(200)
    expect(body).toMatchObject({ configured: true, dataRoot: root, projectCount: 1 })
  })

  /**
   * 四象限颜色：用户可在「插件设置」里自定义。
   *
   * 颜色**随总览一起下发**而不是让 client 自己再读一遍设置——client 与 host 是两个插件，
   * 两边各算一套"用户设置 → 默认色"的兜底迟早会算出两个配色的界面。这里守住这条：
   * 改完之后 `/dslegal/overview` 里的颜色必须跟着变。
   */
  it('四象限颜色可保存，并随总览下发', async () => {
    const before = await harness.request('GET', '/dslegal/overview')
    expect(before.body.priorityColors['重要且紧急']).toBe('#E53E3E')

    const saved = await harness.request('POST', '/dslegal/settings', {
      priorityColors: { 重要且紧急: '#123456' },
    })
    expect(saved.status).toBe(200)
    // 未提供的键保持默认色，落盘的是完整的四个。
    expect(saved.body.priorityColors).toEqual({
      重要且紧急: '#123456',
      紧急不重要: '#ED8936',
      重要不紧急: '#f3e417',
      不重要不紧急: '#98c51e',
    })

    const after = await harness.request('GET', '/dslegal/overview')
    expect(after.body.priorityColors['重要且紧急']).toBe('#123456')
    expect(after.body.colorIssues).toEqual([])
  })

  it('颜色写坏时逐键兜底并如实报出，其余键照常生效', async () => {
    const saved = await harness.request('POST', '/dslegal/settings', {
      priorityColors: { 重要且紧急: '#123456', 紧急不重要: 'ff8800' },
    })
    expect(saved.status).toBe(200)
    expect(saved.body.priorityColors['重要且紧急']).toBe('#123456')
    // 写坏的那一键退回默认色，而不是把整个界面染坏或静默丢弃。
    expect(saved.body.priorityColors['紧急不重要']).toBe('#ED8936')
    // 这一次保存的问题要当场告诉界面，否则用户只会看到颜色"自己变回去了"。
    expect(saved.body.colorIssues).toHaveLength(1)
    expect(String(saved.body.colorIssues[0].message)).toContain('#RRGGBB')

    // 坏值**不落盘**：再读一次设置，设置里是干净的，因此不再报问题。
    const reread = await harness.request('GET', '/dslegal/settings')
    expect(reread.body.priorityColors['紧急不重要']).toBe('#ED8936')
    expect(reread.body.colorIssues).toEqual([])
  })

  it('「恢复默认」就是把四个键显式写回默认色', async () => {
    await harness.request('POST', '/dslegal/settings', {
      priorityColors: { 重要且紧急: '#000000' },
    })
    // 设置层的合并没有"删除键"这一步，所以恢复默认是显式写回默认值。
    const back = await harness.request('POST', '/dslegal/settings', {
      priorityColors: {
        重要且紧急: '#E53E3E',
        紧急不重要: '#ED8936',
        重要不紧急: '#f3e417',
        不重要不紧急: '#98c51e',
      },
    })
    expect(back.body.priorityColors['重要且紧急']).toBe('#E53E3E')
  })

  it('只为改颜色而调用时不必带 dataRoot', async () => {
    const saved = await harness.request('POST', '/dslegal/settings', {
      priorityColors: { 重要不紧急: '#abcdef' },
    })
    expect(saved.status).toBe(200)
    // 数据目录不受影响。
    expect(saved.body.dataRoot).toBe(root)
    expect(saved.body.priorityColors['重要不紧急']).toBe('#abcdef')
  })

  it('两个字段都不给时返回 400', async () => {
    const { status, body } = await harness.request('POST', '/dslegal/settings', {})
    expect(status).toBe(400)
    expect(String(body.error)).toContain('dataRoot')
  })

  it('GET /dslegal/overview 带 configured 与 dataRoot', async () => {
    const { status, body } = await harness.request('GET', '/dslegal/overview')
    expect(status).toBe(200)
    expect(body.configured).toBe(true)
    expect(body.dataRoot).toBe(root)
  })

  /**
   * 界面以「日程 / 待办 / 项目」三条并列线索组织，接口必须下发**完整数据集**：
   * 待办含已完成（界面要展示完成状态）、日程不受"今天"限制（日 / 星期 / 月三形态
   * 各自在本地切片）。这里逐条守住这三个不变量。
   */
  it('GET /dslegal/overview 下发含已完成的全部待办', async () => {
    const log = join(root, '诉讼案件', '张三诉李四', COLLAB_DIR, WORK_LOG_FILE)
    await writeFile(
      log,
      WORK_LOG.replace(
        '- [ ] [整理证据]，[重要不紧急]',
        '- [ ] [整理证据]，[重要不紧急]\n- [x] [归档材料]，[不重要不紧急]',
      ),
      'utf8',
    )

    const { body } = await harness.request('GET', '/dslegal/overview')
    expect(body.todos.map((row: { title: string }) => row.title)).toEqual([
      '起草起诉状',
      '整理证据',
      '归档材料',
    ])
    expect(body.todos.map((row: { done: boolean }) => row.done)).toEqual([false, false, true])
    // 行号是界面判定"最近创建"的唯一依据，必须原样下发。
    expect(body.todos.map((row: { line: number }) => row.line)).toEqual([5, 6, 7])
    expect(body.todos[0]).toMatchObject({
      project: '张三诉李四',
      topLevelDir: '诉讼案件',
      priority: '重要且紧急',
    })
    expect(body.projects[0]).toMatchObject({ todoPending: 2, todoDone: 1 })
  })

  it('GET /dslegal/overview 下发全部日程（不限于今天），按开始时刻升序', async () => {
    const log = join(root, '诉讼案件', '张三诉李四', COLLAB_DIR, WORK_LOG_FILE)
    await writeFile(
      log,
      `${WORK_LOG}- [ ] [二审开庭]，[重要且紧急]，[]，[2030-01-15]，[]，[09:30]，[11:00]，[第二法庭]\n`,
      'utf8',
    )

    const { body } = await harness.request('GET', '/dslegal/overview')
    expect(body.schedules.map((row: { title: string }) => row.title)).toEqual(['开庭', '二审开庭'])
    expect(body.schedules[0]).toMatchObject({
      project: '张三诉李四',
      topLevelDir: '诉讼案件',
      category: '民事诉讼',
      startDate: '2026-09-01',
      startTime: '09:00',
      endTime: '11:00',
      location: '第一法庭',
    })
    // ongoing 是 host 统一计算的派生状态，client 不自己算时间。
    expect(typeof body.schedules[0].ongoing).toBe('boolean')
    expect(body.projects[0]).toMatchObject({ scheduleTotal: 2 })
  })

  it('新建的案件目录无需重启即可被读到（读磁盘，不吃缓存）', async () => {
    // 先等 apply 里那次异步的首轮扫描落定，并显式填充一次缓存：
    // 否则"首轮扫描恰好晚于本用例的写入"会掩盖缓存陈旧的问题（这正是不加 sleep 时的假阳性）。
    await new Promise((done) => setTimeout(done, 300))
    const before = await harness.request('GET', '/dslegal/overview')
    expect(before.body.projects.map((row: { project: string }) => row.project)).toEqual(['张三诉李四'])

    // 案件目录是用户在工作日志之外新建的，插件不创建目录——但它必须立刻"看得见"。
    const fresh = join(root, '诉讼案件', '王五诉赵六')
    await mkdir(join(fresh, COLLAB_DIR), { recursive: true })
    await writeFile(join(fresh, COLLAB_DIR, WORK_LOG_FILE), WORK_LOG, 'utf8')

    const { body } = await harness.request('GET', '/dslegal/overview')
    expect(body.projects.map((row: { project: string }) => row.project).sort()).toEqual([
      '张三诉李四',
      '王五诉赵六',
    ])

    // 写入也必须能立刻命中新项目（requireProject 同样强制重扫）。
    const added = await harness.request('POST', '/dslegal/edit', {
      op: 'todo.add',
      project: '王五诉赵六',
      input: { title: '提交委托手续', priority: '重要且紧急' },
    })
    expect(added.status).toBe(200)
    const text = await readFile(join(fresh, COLLAB_DIR, WORK_LOG_FILE), 'utf8')
    expect(text).toContain('- [ ] [提交委托手续]')
  })

  it('用户设置优先于组合层配置', async () => {
    // 组合层指向空目录，用户设置指向真正的数据根目录。
    const other = await mkdtemp(join(tmpdir(), 'dslegal-other-'))
    const custom = makeSettings({ dataRoot: root })
    const customHarness = makeHarness(custom.provider)
    apply(customHarness.ctx as Parameters<typeof apply>[0], {
      dataRoot: other,
      debounceMs: 20,
      echoWindowMs: 20,
    })
    try {
      const { body } = await customHarness.request('GET', '/dslegal/settings')
      expect(body.dataRoot).toBe(root)
      expect(body.projectCount).toBe(1)
    } finally {
      customHarness.dispose()
      await new Promise((done) => setTimeout(done, 200))
      await rm(other, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('POST /dslegal/edit 新增待办并落盘', async () => {
    const { status, body } = await harness.request('POST', '/dslegal/edit', {
      op: 'todo.add',
      project: '张三诉李四',
      input: { title: '联系承办法官', priority: '紧急不重要' },
    })
    expect(status).toBe(200)
    expect(body.line).toBeGreaterThan(0)

    const text = await readFile(join(root, '诉讼案件', '张三诉李四', COLLAB_DIR, WORK_LOG_FILE), 'utf8')
    expect(text).toContain('- [ ] [联系承办法官]，[紧急不重要]')
    // 其余内容字节不变。
    expect(text.split('\n').length).toBe(WORK_LOG.split('\n').length + 1)
  })

  it('POST /dslegal/edit 切换完成状态', async () => {
    const listed = await harness.request('GET', '/dslegal/agenda?project=张三诉李四')
    const first = listed.body.todos[0] as { line: number; title: string }

    const { status } = await harness.request('POST', '/dslegal/edit', {
      op: 'todo.set',
      project: '张三诉李四',
      target: { line: first.line, title: first.title },
      input: { done: true },
    })
    expect(status).toBe(200)

    const text = await readFile(join(root, '诉讼案件', '张三诉李四', COLLAB_DIR, WORK_LOG_FILE), 'utf8')
    expect(text).toContain(`- [x] [${first.title}]`)
  })

  it('target 与文件不一致时拒绝写入', async () => {
    const { status, body } = await harness.request('POST', '/dslegal/edit', {
      op: 'todo.remove',
      project: '张三诉李四',
      target: { line: 5, title: '不存在的标题' },
    })
    expect(status).toBe(400)
    expect(body.error).toContain('不一致')

    const text = await readFile(join(root, '诉讼案件', '张三诉李四', COLLAB_DIR, WORK_LOG_FILE), 'utf8')
    expect(text).toBe(WORK_LOG)
  })
})

describe('未设定数据目录', () => {
  let bare: Harness
  let bareRoot = ''

  beforeEach(async () => {
    bareRoot = await mkdtemp(join(tmpdir(), 'dslegal-bare-'))
    const dir = join(bareRoot, '诉讼案件', '张三诉李四', COLLAB_DIR)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, WORK_LOG_FILE), WORK_LOG, 'utf8')

    bare = makeHarness(makeSettings().provider)
    // 组合层与用户层都没有 dataRoot。
    apply(bare.ctx as Parameters<typeof apply>[0], { debounceMs: 20, echoWindowMs: 20 })
  })

  afterEach(async () => {
    bare.dispose()
    await new Promise((done) => setTimeout(done, 200))
    await rm(bareRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('GET /dslegal/settings 返回 configured:false', async () => {
    const { status, body } = await bare.request('GET', '/dslegal/settings')
    expect(status).toBe(200)
    expect(body).toMatchObject({ configured: false, dataRoot: null, projectCount: 0 })
  })

  it('GET /dslegal/overview 不报错，返回空集 + configured:false', async () => {
    const { status, body } = await bare.request('GET', '/dslegal/overview')
    expect(status).toBe(200)
    expect(body.configured).toBe(false)
    expect(body.projects).toEqual([])
    expect(body.schedules).toEqual([])
    expect(body.todos).toEqual([])
  })

  it('其余接口提示先设定数据目录', async () => {
    const { status, body } = await bare.request('GET', '/dslegal/projects')
    expect(status).toBe(400)
    expect(body.error).toContain('尚未设定数据目录')
  })

  it('POST /dslegal/settings 保存后立即生效并返回项目数', async () => {
    const saved = await bare.request('POST', '/dslegal/settings', { dataRoot: bareRoot })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ configured: true, dataRoot: bareRoot, projectCount: 1 })

    const overview = await bare.request('GET', '/dslegal/overview')
    expect(overview.body.configured).toBe(true)
    expect(overview.body.projects).toHaveLength(1)
    expect(overview.body.projects[0]).toMatchObject({ project: '张三诉李四', category: '民事诉讼' })
  })

  it('保存不存在的目录返回 400 且保持未设定', async () => {
    const { status, body } = await bare.request('POST', '/dslegal/settings', {
      dataRoot: join(bareRoot, '不存在'),
    })
    expect(status).toBe(400)
    expect(body.error).toContain('目录不存在')
    const after = await bare.request('GET', '/dslegal/settings')
    expect(after.body.configured).toBe(false)
  })

  it('保存空串返回 400', async () => {
    const { status, body } = await bare.request('POST', '/dslegal/settings', { dataRoot: '   ' })
    expect(status).toBe(400)
    expect(body.error).toContain('请填写数据根目录的路径')
  })
})

describe('工具与 HTTP 走同一套领域操作', () => {
  it('legal_todo_list 返回的行号可被 legal_todo_set 使用', async () => {
    const list = harness.tools.get('legal_todo_list')
    if (list === undefined) throw new Error('缺少 legal_todo_list')
    const listed = (await list.execute({ project: '张三诉李四' })) as {
      items: { line: number; title: string }[]
    }
    const first = listed.items[0]!
    expect(first.title).toBe('起草起诉状')

    const set = harness.tools.get('legal_todo_set')
    if (set === undefined) throw new Error('缺少 legal_todo_set')
    await set.execute({
      project: '张三诉李四',
      target: { line: first.line, title: first.title },
      done: true,
    })

    const text = await readFile(join(root, '诉讼案件', '张三诉李四', COLLAB_DIR, WORK_LOG_FILE), 'utf8')
    expect(text).toContain('- [x] [起草起诉状]')
  })
})
