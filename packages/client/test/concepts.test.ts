import { readFileSync, readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 目录概念的术语守卫：**源码里不许再出现旧的两级目录说法**。
 *
 * 目录层级已经从"数据根目录 → 顶级目录 → 项目"改成
 * "根目录 → 类型目录 → 项目目录"，且**三级可各自独立设定**。这类改名最容易漏在
 * *注释*与*面向用户的文案*里：代码改对了、界面上还写着"顶级目录"，用户按老词去找
 * 那个输入框就会找不到。这一条守卫扫的正是**整份源码的所有字符串**（注释也算），
 * 所以它是"改干净了没有"的机械判据，不依赖谁记得去搜。
 *
 * 三条命中的写法都写在这里：`顶级目录` / `数据根目录` 是两个旧概念名，
 * `topLevelDir` / `dataRoot` 是两个旧字段名（旧 host 的接口里叫这个）。
 */
describe('目录概念的术语守卫', () => {
  /** `src/` 下的全部源文件（递归；目录层级是平的，但递归写更经得住以后加子目录）。 */
  const sourceFiles = (): string[] => {
    const root = new URL('../src/', import.meta.url)
    const out: string[] = []
    const walk = (dir: URL): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
        if (entry.isDirectory()) walk(child)
        else if (/\.tsx?$/.test(entry.name)) out.push(fileURLToPath(child))
      }
    }
    walk(root)
    return out
  }

  const files = sourceFiles().map((path) => ({
    name: basename(path),
    path,
    text: readFileSync(path, 'utf8'),
  }))

  it('扫到了源码（守卫本身没失效）', () => {
    expect(files.length, `扫到的文件：${files.map((f) => f.name).join(' / ')}`).toBeGreaterThanOrEqual(5)
    expect(files.some((f) => f.name === 'views.tsx')).toBe(true)
  })

  it('每一份源码里都不再出现「顶级目录」/「数据根目录」', () => {
    const hit = files
      .filter((file) => file.text.includes('顶级目录') || file.text.includes('数据根目录'))
      .map((file) => file.name)
    expect(hit, `这些源码里还留着旧概念：${hit.join(' / ')}`).toEqual([])
  })

  it('也不再出现旧字段名 topLevelDir / dataRoot', () => {
    const hit = files
      .filter((file) => /\btopLevelDir\b/.test(file.text) || /\bdataRoot\b/.test(file.text))
      .map((file) => file.name)
    expect(hit, `这些源码里还留着旧字段名：${hit.join(' / ')}`).toEqual([])
  })

  it('路径模板统一写成三级：<根目录>/<类型目录>/<项目目录>/0. 协作/1. 工作日志.md', () => {
    const full = files.filter((file) => file.text.includes('0. 协作/1. 工作日志.md'))
    expect(full.length, '一份源码里都没写这条路径模板？').toBeGreaterThan(0)
    // 两级（<类型目录>/<项目>/…）的残缺模板不许再出现。
    const partial = files
      .filter((file) => /<类型目录>\/<项目>/.test(file.text))
      .map((file) => file.name)
    expect(partial, `这些源码里还是两级路径模板：${partial.join(' / ')}`).toEqual([])
  })

  it('「插件设置」里的那块叫「目录设置」而不是「数据目录」', () => {
    const views = files.find((file) => file.name === 'views.tsx')
    expect(views, '找不到 views.tsx').toBeDefined()
    const form = views!.text.slice(views!.text.indexOf('export function SetupForm('))
    expect(form, '表单还是旧的"数据目录"说法').not.toContain('数据目录')
    expect(form, '表单没讲清三级目录').toContain('另行指定的类型目录')
  })
})
