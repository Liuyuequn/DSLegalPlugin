import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 统一包的结构守卫（2026-09-13 并入）。
 *
 * 背景：对外**只有一个 DSH 插件**——`dsh-legal-schedule`。它同时提供 host 面与浏览器面，
 * 浏览器面靠**同一行** loader 条目上的 `dsh.client` 声明被发现，所以在「插件设置」里
 * 只占一个条目。
 *
 * 这一组断言守的是"这个形态不会被无声破坏"：
 *
 * 1. **全仓库有且只有一个包声明 `dsh.client`**，且就是本包。多一个出来，插件设置里
 *    就会多一张卡（曾经是两个包各占一行）；少一个，浏览器面根本不会被发现。
 * 2. **声明必须配 `./client` 出口**，否则 `dsh-client-modules` 会抛
 *    `declares dsh.client but exports no "./client" bundle`。
 * 3. **产物 banner 的 id 必须等于包名**：loader 行的 `name` 就是包名，boot graph 的行 key
 *    也是它；对不上就会报 `not a row in the boot graph`，而服务器端探针全部正常，极具迷惑性
 *    （2026-09-09 事故）。
 * 4. **包名不得以 `/client` 结尾**：`stripClientSuffix` 会把 `@pkg/client` 误削成 `@pkg`。
 * 5. **产物自足**：只能 require shell 提供的 react / react/jsx-runtime；`@dslegal/*`
 *    一个都不许留在产物里（浏览器模块表里没有它们，而 profile 是"复制产物"安装的）。
 */

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const repoRoot = join(here, '..', '..', '..')

const ourPkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
  dsh?: { client?: { inject?: string[]; platform?: string } }
}
const tsdownConfig = readFileSync(join(pkgDir, 'tsdown.config.ts'), 'utf8')
const bannerId = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(tsdownConfig)?.[1]

/** 顶层 packages/* 里每个包的 name 与是否声明 dsh.client。 */
function workspacePackages(): Array<{ dir: string; name: string; declaresClient: boolean }> {
  return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages', entry.name, 'package.json'), 'utf8')) as {
        name: string
        dsh?: { client?: unknown }
      }
      return { dir: entry.name, name: manifest.name, declaresClient: manifest.dsh?.client !== undefined }
    })
}

describe('统一包：一个包、两半', () => {
  it('本包名就是 dsh-legal-schedule', () => {
    expect(ourPkg.name).toBe('dsh-legal-schedule')
  })

  it('包名不得以 /client 结尾，也不得以 client 结尾', () => {
    expect(ourPkg.name.endsWith('/client')).toBe(false)
    expect(ourPkg.name.endsWith('client')).toBe(false)
  })

  it('声明了 dsh.client（web）与 ./client 出口', () => {
    expect(ourPkg.dsh?.client).toBeDefined()
    expect(ourPkg.dsh?.client?.platform).toBe('web')
    expect(ourPkg.exports).toHaveProperty('./client')
  })

  it('产物 banner 的模块 id 等于包名', () => {
    expect(bannerId).toBe(ourPkg.name)
  })

  it('全仓库**只有本包**声明 dsh.client（多处声明 = 插件设置里多出卡）', () => {
    const declaring = workspacePackages().filter((pkg) => pkg.declaresClient)
    expect(declaring.map((pkg) => pkg.name)).toEqual([ourPkg.name])
  })
})

describe('产物自足（复制安装的前提）', () => {
  const clientBundlePath = join(pkgDir, 'lib', 'client.js')
  const clientBundle = readFileSync(clientBundlePath, 'utf8')

  it('浏览器面只 require shell 共享的模块', () => {
    const required = [...clientBundle.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
    expect([...new Set(required)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })

  it('浏览器面不含任何 @dslegal/* 外部 import（必须内联）', () => {
    expect(/require\("@dslegal\//.test(clientBundle)).toBe(false)
    expect(/from\s*"@dslegal\//.test(clientBundle)).toBe(false)
  })

  it('host 面自足：不含任何 @dslegal/* 外部 import', () => {
    const hostBundle = readFileSync(join(pkgDir, 'lib', 'index.js'), 'utf8')
    expect(/from\s*"@dslegal\//.test(hostBundle)).toBe(false)
    expect(/require\("@dslegal\//.test(hostBundle)).toBe(false)
  })

  it('host 面不得有 export default（loader 会拆包导致 inject 丢失）', () => {
    const hostBundle = readFileSync(join(pkgDir, 'lib', 'index.js'), 'utf8')
    expect(/export\s+default/.test(hostBundle)).toBe(false)
  })
})
