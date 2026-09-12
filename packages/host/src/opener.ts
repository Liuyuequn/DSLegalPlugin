/**
 * 用**系统默认程序**打开工作日志，并尽量把光标定位到指定行。
 *
 * 为什么这件事必须落在 host：浏览器没有"打开本地文件"的能力，而 host 插件就跑在
 * 用户自己的机器上。所以界面点一下标题 → 一次 `POST /dslegal/open` → 这里起一个
 * **脱离 DSH 的**子进程。
 *
 * 定位到行不是所有编辑器都支持，所以能力分成两档，并且**如实回报是哪一档**：
 *
 * - 关联程序认得出（VS Code / Cursor / Notepad++ / Sublime / JetBrains 系）→ 带上
 *   "跳到第 N 行"的参数，真的跳过去；
 * - 认不出（Typora、坚果云这类）→ 用系统默认关联打开整个文件，`lineCapable: false`。
 *
 * 界面拿到 `lineCapable: false` 时必须**明说"行号没跳过去"**，不能默不作声——
 * 用户以为跳了却没跳，比一开始就知道要自己找更糟。
 */

import { execFileSync, spawn } from 'node:child_process'
import { basename } from 'node:path'

/** 演练开关：置 `1` 时只解析"要执行什么"，不真的起进程（自动化测试与排查用）。 */
export const OPEN_DRY_ENV = 'DSLEGAL_OPEN_DRY'

/** 一份"要怎么打开"的计划（纯数据，可单测）。 */
export interface OpenPlan {
  readonly command: string
  readonly args: readonly string[]
  /** 展示给用户的程序名。 */
  readonly app: string
  /** 是否真的会跳到指定行。 */
  readonly lineCapable: boolean
}

/** 打开结果 = 计划 + "到底起没起进程"。 */
export interface OpenOutcome extends OpenPlan {
  readonly launched: boolean
  readonly dryRun: boolean
}

interface LineHandler {
  readonly app: string
  readonly args: (path: string, line: number) => string[]
}

/**
 * 认得出来的"能跳行"程序表，键是 exe 基名（小写）。
 *
 * 刻意**只收能确认参数写法**的程序：猜错了会变成"打开时多出一个奇怪的参数"，
 * 那是比不跳行更糟的失败。表里没有的一律走系统默认关联。
 */
const LINE_CAPABLE: Readonly<Record<string, LineHandler>> = {
  // VS Code 系的 `--goto file:line:col`：冒号后缀从右往左解析，所以 `C:\a\b.md:12:1` 也认。
  'code.exe': { app: 'VS Code', args: (path, line) => ['--goto', `${path}:${line}:1`] },
  'code - insiders.exe': {
    app: 'VS Code Insiders',
    args: (path, line) => ['--goto', `${path}:${line}:1`],
  },
  'codium.exe': { app: 'VSCodium', args: (path, line) => ['--goto', `${path}:${line}:1`] },
  'vscodium.exe': { app: 'VSCodium', args: (path, line) => ['--goto', `${path}:${line}:1`] },
  'cursor.exe': { app: 'Cursor', args: (path, line) => ['--goto', `${path}:${line}:1`] },
  'windsurf.exe': { app: 'Windsurf', args: (path, line) => ['--goto', `${path}:${line}:1`] },
  'trae.exe': { app: 'Trae', args: (path, line) => ['--goto', `${path}:${line}:1`] },
  'notepad++.exe': { app: 'Notepad++', args: (path, line) => [`-n${line}`, path] },
  'sublime_text.exe': { app: 'Sublime Text', args: (path, line) => [`${path}:${line}`] },
  ...Object.fromEntries(
    [
      'idea64.exe',
      'idea.exe',
      'webstorm64.exe',
      'pycharm64.exe',
      'goland64.exe',
      'phpstorm64.exe',
      'clion64.exe',
      'rider64.exe',
      'datagrip64.exe',
    ].map((exe) => [exe, { app: 'JetBrains IDE', args: (path: string, line: number) => ['--line', String(line), path] }]),
  ),
}

/**
 * 从注册表里那条 `shell\open\command` 里取出可执行文件路径。
 *
 * 形如 `"C:\...\Code.exe" "%1"`（带引号，路径含空格）或 `C:\tools\x.exe %1`（不带）。
 * 返回值**原样保留**，不做规范化：要执行的就是注册表里那一个。
 */
export function parseHandlerCommand(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const text = raw.trim()
  if (text.length === 0) return null
  const quoted = /^"([^"]+)"/.exec(text)
  if (quoted !== null) return quoted[1] ?? null
  const bare = /^([^\s]+)/.exec(text)
  return bare === null ? null : (bare[1] ?? null)
}

/** 展示名：认得出就给编辑器名字，认不出就把 exe 名给出去，再不行说"系统默认程序"。 */
function appNameOf(exePath: string | null): string {
  if (exePath === null) return '系统默认程序'
  const name = basename(exePath)
  return name.length === 0 ? '系统默认程序' : name.replace(/\.exe$/i, '')
}

/**
 * 决定"要执行什么"。纯函数：平台、路径、行号、关联程序命令进，命令与参数出。
 *
 * Windows 上"用默认关联打开"走 `cmd /c start "" "<path>"`：`start` 的第一个带引号的
 * 参数会被当成**窗口标题**，所以那个空标题位不能省（省了文件路径就有被当成标题的风险）。
 */
export function planOpen(input: {
  readonly platform: NodeJS.Platform
  readonly path: string
  readonly line: number
  readonly handlerCommand: string | null
}): OpenPlan {
  const exe = parseHandlerCommand(input.handlerCommand)
  const handler = exe === null ? undefined : LINE_CAPABLE[basename(exe).toLowerCase()]

  if (input.platform === 'win32' && exe !== null && handler !== undefined) {
    return {
      command: exe,
      args: handler.args(input.path, input.line),
      app: handler.app,
      lineCapable: true,
    }
  }
  if (input.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/c', 'start', '', input.path],
      app: appNameOf(exe),
      lineCapable: false,
    }
  }
  if (input.platform === 'darwin') {
    return { command: 'open', args: [input.path], app: '系统默认程序', lineCapable: false }
  }
  return { command: 'xdg-open', args: [input.path], app: '系统默认程序', lineCapable: false }
}

/** `reg query` 的出口，抽成参数是为了单测不必真的读注册表。 */
export type RegQuery = (args: readonly string[]) => string

const MD_USER_CHOICE_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice'

function defaultRegQuery(args: readonly string[]): string {
  try {
    return execFileSync('reg.exe', [...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // 键不存在 / 权限不足都会走到这里，语义上都是"查不到"，不是错误。
    return ''
  }
}

/** 读一个注册表值（`name` 为 `null` 时读默认值）。 */
function regValue(run: RegQuery, key: string, name: string | null): string | null {
  const out = run(name === null ? ['query', key, '/ve'] : ['query', key, '/v', name])
  for (const line of out.split(/\r?\n/)) {
    // 值里可能含空格（路径），所以取类型标记之后的**整段**。
    const matched = /\bREG_(?:SZ|EXPAND_SZ)\s+(.+)$/.exec(line)
    if (matched !== null) return matched[1]!.trim()
  }
  return null
}

/**
 * 查 `.md` 当前关联的打开命令。
 *
 * **必须先看 `UserChoice`**：`HKCR\.md` 是机器级默认值，而 Windows 实际用的是用户在
 * "打开方式"里选过的那一个（本机实测：`HKCR\.md` 指向坚果云，`UserChoice` 指向 VS Code）。
 * 只看 `HKCR` 会算出一个用户根本不会看到的程序，进而把"跳行"判成"不支持"。
 */
export function readMdHandlerCommand(
  platform: NodeJS.Platform = process.platform,
  run: RegQuery = defaultRegQuery,
): string | null {
  if (platform !== 'win32') return null
  const progId = regValue(run, MD_USER_CHOICE_KEY, 'ProgId') ?? regValue(run, 'HKCR\\.md', null)
  if (progId === null || progId.length === 0) return null
  return regValue(run, `HKCR\\${progId}\\shell\\open\\command`, null)
}

/** 起一个**不跟着 DSH 一起退出**的子进程：编辑器是独立的应用，不该被宿主带走。 */
async function spawnDetached(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'ignore', windowsHide: true })
    // 等 'spawn' 而不是"发出去就算成功"：ENOENT（关联程序被卸载了）要如实报给用户。
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', reject)
  })
}

/** 打开选项（全部可注入，供单测与演练使用）。 */
export interface OpenOptions {
  readonly platform?: NodeJS.Platform
  readonly dryRun?: boolean
  /** 关联程序命令；显式传 `null` 表示"当作查不到"。 */
  readonly handlerCommand?: string | null
  /** 自己发进程（测试注入）。 */
  readonly spawnFn?: (command: string, args: readonly string[]) => Promise<void>
  /** 直接给一份计划（测试注入），跳过平台探测。 */
  readonly plan?: OpenPlan
}

/** 打开 `path` 并尽量定位到第 `line` 行（1-based）。 */
export async function openInDefaultApp(
  path: string,
  line: number,
  options: OpenOptions = {},
): Promise<OpenOutcome> {
  const platform = options.platform ?? process.platform
  const plan =
    options.plan ??
    planOpen({
      platform,
      path,
      line,
      handlerCommand:
        options.handlerCommand !== undefined
          ? options.handlerCommand
          : readMdHandlerCommand(platform),
    })
  const dryRun = options.dryRun ?? process.env[OPEN_DRY_ENV] === '1'
  if (dryRun) return { ...plan, launched: false, dryRun: true }
  const spawnFn = options.spawnFn ?? spawnDetached
  await spawnFn(plan.command, plan.args)
  return { ...plan, launched: true, dryRun: false }
}
