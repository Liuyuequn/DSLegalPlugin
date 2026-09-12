import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
  dsh?: { client?: unknown }
}
const tsdownConfig = readFileSync(join(here, '..', 'tsdown.config.ts'), 'utf8')

/**
 * 2026-09-09 事故的防复发守卫。
 *
 * DSH 的 `dsh-client-modules` 有个 `stripClientSuffix`，本意是把 bundle 里
 * `require("@pkg/client")` 的子路径后缀削掉、规范化回包名，但它无法区分
 * "子路径"与"包名本身"：包名若以 `/client` 结尾会被误削成 `@pkg`，
 * 而 boot graph 的行 key 是全名，于是永远查不到 —— 浏览器报
 * `cannot resolve "..." — not a row in the boot graph`，插件装配整体失败，
 * 且服务器端各探针（HTML / bundle / API）全部正常，极具迷惑性。
 */
describe('包名约束（DSH 模块系统）', () => {
  it('包名不得以 /client 结尾', () => {
    expect(packageJson.name.endsWith('/client')).toBe(false)
  })

  it('包名不得以 client 结尾（含无斜杠形式）', () => {
    expect(packageJson.name.endsWith('client')).toBe(false)
  })

  it('banner 里的模块 id 必须等于包名', () => {
    expect(tsdownConfig).toContain(`id: '${packageJson.name}'`)
  })

  it('声明了 client 出口与 dsh.client 字段', () => {
    expect(packageJson.exports).toHaveProperty('./client')
    expect(packageJson.dsh?.client).toBeDefined()
  })
})
