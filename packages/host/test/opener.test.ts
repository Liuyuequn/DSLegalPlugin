import { describe, expect, it } from 'vitest'

import {
  OPEN_DRY_ENV,
  openInDefaultApp,
  parseHandlerCommand,
  planOpen,
  readMdHandlerCommand,
  type RegQuery,
} from '../src/opener.ts'

const PATH = 'C:\\数据\\诉讼案件\\甲诉乙\\0. 协作\\1. 工作日志.md'
const VSCODE = '"C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" "%1"'
const NOTEPAD = '"C:\\Windows\\notepad.exe" "%1"'
const NUTSTORE = '"C:\\Program Files\\Nutstore\\Nutstore.exe" --nutstore-lightapp "%1"'

describe('从注册表命令里取出可执行文件', () => {
  it('带引号（路径含空格）时取引号内的那一段', () => {
    expect(parseHandlerCommand(VSCODE)).toBe(
      'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    )
  })

  it('不带引号时取第一个空白之前的那一段', () => {
    expect(parseHandlerCommand('C:\\tools\\vscode\\Code.exe "%1"')).toBe(
      'C:\\tools\\vscode\\Code.exe',
    )
  })

  it('查不到 / 空串一律给 null，不猜', () => {
    expect(parseHandlerCommand(null)).toBeNull()
    expect(parseHandlerCommand(undefined)).toBeNull()
    expect(parseHandlerCommand('   ')).toBeNull()
  })
})

describe('planOpen：认得出编辑器就跳行，认不出就退回系统默认关联', () => {
  it('VS Code：--goto file:line:col（冒号后缀从右往左解析，盘符不受影响）', () => {
    const plan = planOpen({ platform: 'win32', path: PATH, line: 12, handlerCommand: VSCODE })
    expect(plan.lineCapable).toBe(true)
    expect(plan.app).toBe('VS Code')
    expect(plan.command).toBe(
      'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
    )
    expect(plan.args).toEqual(['--goto', `${PATH}:12:1`])
  })

  it('Notepad++ / Sublime / JetBrains 各自的写法', () => {
    expect(
      planOpen({
        platform: 'win32',
        path: PATH,
        line: 7,
        handlerCommand: '"C:\\Program Files\\Notepad++\\notepad++.exe" "%1"',
      }).args,
    ).toEqual(['-n7', PATH])

    expect(
      planOpen({
        platform: 'win32',
        path: PATH,
        line: 7,
        handlerCommand: '"C:\\Program Files\\Sublime Text\\sublime_text.exe" "%1"',
      }).args,
    ).toEqual([`${PATH}:7`])

    expect(
      planOpen({
        platform: 'win32',
        path: PATH,
        line: 7,
        handlerCommand: '"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe" "%1"',
      }).args,
    ).toEqual(['--line', '7', PATH])
  })

  it('认不出的关联程序：走 cmd /c start，并且**补上那个空标题位**', () => {
    const plan = planOpen({ platform: 'win32', path: PATH, line: 7, handlerCommand: NUTSTORE })
    expect(plan.lineCapable).toBe(false)
    expect(plan.command).toBe('cmd.exe')
    // `start` 会把第一个带引号的参数当成窗口标题，所以 '' 这一位不能省。
    expect(plan.args).toEqual(['/c', 'start', '', PATH])
    expect(plan.app).toBe('Nutstore')
  })

  it('连关联程序都查不到：照样能打开，只是不能跳行', () => {
    const plan = planOpen({ platform: 'win32', path: PATH, line: 3, handlerCommand: null })
    expect(plan.lineCapable).toBe(false)
    expect(plan.app).toBe('系统默认程序')
    expect(plan.args).toEqual(['/c', 'start', '', PATH])
  })

  it('非 Windows 平台用 open / xdg-open（都没有跳行参数）', () => {
    expect(planOpen({ platform: 'darwin', path: '/tmp/a.md', line: 1, handlerCommand: null })).toMatchObject(
      { command: 'open', args: ['/tmp/a.md'], lineCapable: false },
    )
    expect(planOpen({ platform: 'linux', path: '/tmp/a.md', line: 1, handlerCommand: null })).toMatchObject(
      { command: 'xdg-open', args: ['/tmp/a.md'], lineCapable: false },
    )
  })

  it('notepad.exe 不在表里：它没有"跳到第 N 行"的命令行参数，硬塞参数只会更糟', () => {
    const plan = planOpen({ platform: 'win32', path: PATH, line: 5, handlerCommand: NOTEPAD })
    expect(plan.lineCapable).toBe(false)
    expect(plan.args).toEqual(['/c', 'start', '', PATH])
  })
})

describe('readMdHandlerCommand：优先看用户选过的那一个（UserChoice）', () => {
  /** 按 key 返回预设的注册表输出。 */
  const fakeReg = (table: Record<string, string>): RegQuery => (args) => {
    const key = args[1] ?? ''
    const name = args[2] === '/v' ? (args[3] ?? '') : '(Default)'
    if (args[2] === '/ve') {
      const value = table[key]
      return value === undefined ? '' : `HKEY\n    (Default)    REG_SZ    ${value}`
    }
    const value = table[`${key}\\${name}`]
    return value === undefined ? '' : `HKEY\n    ${name}    REG_SZ    ${value}`
  }

  it('UserChoice 与 HKCR 不一致时以 UserChoice 为准（本机就是这样：HKCR 指向坚果云）', () => {
    const run = fakeReg({
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice\\ProgId':
        'VSCode.md',
      'HKCR\\.md': 'Nutstore.LightApp.md',
      'HKCR\\VSCode.md\\shell\\open\\command': VSCODE,
      'HKCR\\Nutstore.LightApp.md\\shell\\open\\command': NUTSTORE,
    })
    expect(readMdHandlerCommand('win32', run)).toBe(VSCODE)
  })

  it('没有 UserChoice 时退回 HKCR 的默认关联', () => {
    const run = fakeReg({
      'HKCR\\.md': 'Notepad.md',
      'HKCR\\Notepad.md\\shell\\open\\command': NOTEPAD,
    })
    expect(readMdHandlerCommand('win32', run)).toBe(NOTEPAD)
  })

  it('查不到就给 null，不抛错（关联缺失不该让整个接口 500）', () => {
    expect(readMdHandlerCommand('win32', fakeReg({}))).toBeNull()
    expect(readMdHandlerCommand('linux', fakeReg({}))).toBeNull()
  })
})

describe('openInDefaultApp：演练不启动、真实启动等 spawn 事件', () => {
  it('dry-run 只回计划，不进 spawn', async () => {
    let called = 0
    const outcome = await openInDefaultApp(PATH, 9, {
      platform: 'win32',
      handlerCommand: VSCODE,
      dryRun: true,
      spawnFn: async () => {
        called += 1
      },
    })
    expect(called).toBe(0)
    expect(outcome).toMatchObject({ launched: false, dryRun: true, lineCapable: true, app: 'VS Code' })
    expect(outcome.args).toEqual(['--goto', `${PATH}:9:1`])
  })

  it('`DSLEGAL_OPEN_DRY=1` 环境变量同样只演练（自动化测试的开关）', async () => {
    const before = process.env[OPEN_DRY_ENV]
    process.env[OPEN_DRY_ENV] = '1'
    try {
      let called = 0
      const outcome = await openInDefaultApp(PATH, 9, {
        platform: 'win32',
        handlerCommand: VSCODE,
        spawnFn: async () => {
          called += 1
        },
      })
      expect(called).toBe(0)
      expect(outcome.dryRun).toBe(true)
    } finally {
      if (before === undefined) delete process.env[OPEN_DRY_ENV]
      else process.env[OPEN_DRY_ENV] = before
    }
  })

  it('真实启动时把命令与参数原样交给 spawn，并把参数顺序钉住', async () => {
    const seen: Array<{ command: string; args: readonly string[] }> = []
    const outcome = await openInDefaultApp(PATH, 42, {
      platform: 'win32',
      handlerCommand: VSCODE,
      dryRun: false,
      spawnFn: async (command, args) => {
        seen.push({ command, args })
      },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.args).toEqual(['--goto', `${PATH}:42:1`])
    expect(outcome).toMatchObject({ launched: true, dryRun: false })
  })

  it('spawn 抛错要如实上报（关联程序被卸载 = ENOENT）', async () => {
    await expect(
      openInDefaultApp(PATH, 1, {
        platform: 'win32',
        handlerCommand: VSCODE,
        dryRun: false,
        spawnFn: async () => {
          throw new Error('spawn Code.exe ENOENT')
        },
      }),
    ).rejects.toThrow(/ENOENT/)
  })

  it('真 spawn 一遍无害命令，确认"等 spawn 事件"这条路径本身是通的', async () => {
    // 这里刻意不注入 spawnFn：走真实 spawn，但目标是 `cmd /c exit 0`——不会弹任何窗口。
    const outcome = await openInDefaultApp('C:\\nul', 1, {
      dryRun: false,
      plan: { command: 'cmd.exe', args: ['/c', 'exit', '0'], app: 'cmd', lineCapable: false },
    })
    expect(outcome.launched).toBe(true)
  })
})
