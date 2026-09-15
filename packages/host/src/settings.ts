/**
 * 用户设置（三级目录 + 四象限颜色）—— `$DSH_HOME/settings.yaml` 的 `dslegal:` 段。
 *
 * 为什么用 `ctx.settings` 而不是自己写文件：
 * 1. DSH 的 `dsh-settings-file` 已经是用户设置的**唯一落点**（`settings.yaml`，热重载），
 *    用户也能在 DSH 自己的设置界面里改；插件另起一个配置文件会造成两处真相。
 * 2. 平台约定：**组合层配置作为 `base`**、用户设置作为覆盖层，settings 服务缺席时
 *    自动退回组合层，插件不会因为 profile 里没有该服务而失效。
 *
 * 因此三级目录的最终取值 = 用户设置 → 插件配置（`cordis.patch.yml`）→ 未设定。
 * 三级目录（根目录 / 类型目录 / 项目目录）**各自独立**：只设定其中任意一级都能工作。
 *
 * `ctx.settings` 只用**结构化契约**声明，不 import `@deepseek-ai/dsh-settings`
 * （同 `http.ts` 的 `WebServerLike`；见 AGENTS.md 5.1 第 6 条）。
 */

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import type { PriorityColorOverrides } from '@dslegal/core'

/** 用户设置命名空间（对应 `settings.yaml` 的 `dslegal:` 段）。 */
export const SETTINGS_NS = 'dslegal'

/** 用户可改的插件设置；除颜色外全部是"目录"，字段缺席即"未设定"。 */
export interface LegalSettings {
  /** 根目录的绝对路径。 */
  readonly rootDir?: string
  /** 另行指定的类型目录（绝对路径列表，可位于根目录之外）。 */
  readonly extraTypeDirs?: string[]
  /** 另行指定的项目目录（绝对路径列表，可位于根目录之外）。 */
  readonly extraProjectDirs?: string[]
  /**
   * @deprecated 旧键名（0.1.x 写的是 `dataRoot`）。**只为兼容读取**：`rootDir` 缺席而它
   * 存在时按根目录处理，老用户的设置不会因为改名而失效。新写入一律写 `rootDir`。
   */
  readonly dataRoot?: string
  /**
   * 四个优先级各自的显示颜色（`#RRGGBB`）。
   *
   * 存的是**用户覆盖层**，缺某个键即该优先级用默认色；非法值由
   * `resolvePriorityColors` 逐键兜底并在界面上提示。
   */
  readonly priorityColors?: PriorityColorOverrides
}

export const LegalSettingsSchema: z<LegalSettings> = z.object({
  rootDir: z.string().description('根目录的绝对路径'),
  extraTypeDirs: z.array(z.string()).description('另行指定的类型目录（绝对路径，可位于根目录之外）'),
  extraProjectDirs: z.array(z.string()).description('另行指定的项目目录（绝对路径，可位于根目录之外）'),
  dataRoot: z.string().description('（已废弃）旧版根目录键，仅作兼容读取'),
  priorityColors: z
    .dict(z.string())
    .description('四个优先级各自的显示颜色（#RRGGBB）'),
})

/** 三级目录一个都没设定时，工具与接口统一返回的提示。 */
export const DIRS_UNSET =
  '尚未设定目录。请在「法程」面板的「插件设置」里填写根目录（里面放各类型目录），' +
  '或在同一页另行指定类型目录 / 项目目录，然后保存。'

/** 旧键名。读取时若 `rootDir` 缺席而它存在，按根目录处理。 */
export const LEGACY_ROOT_KEY = 'dataRoot'

/**
 * 取生效的根目录：新键优先，旧键兜底。
 * @param settings - 当前生效的用户设置（已合过组合层）。
 */
export function effectiveRootDir(settings: LegalSettings): string | undefined {
  const current = normalizeDirPath(settings.rootDir)
  if (current !== undefined) return current
  return normalizeDirPath(settings[LEGACY_ROOT_KEY as 'dataRoot'])
}

/** 一个已注册命名空间的读写面（`ctx.settings` 的结构化契约）。 */
export interface SettingsScopeLike<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void): () => void
  update(patch: object): Promise<void>
}

/** `ctx.settings` 的最小结构契约。 */
export interface SettingsProviderLike {
  register<T>(ns: string, schema: z<T>, options?: { base?: Partial<T> }): SettingsScopeLike<T>
  update(ns: string, patch: object): Promise<void>
}

/**
 * 规范化一个目录输入：去首尾空白、展开开头的 `~`、转绝对路径；空串 → `undefined`。
 * 三级目录共用这一套（"根目录"只是层级概念，路径写法没有区别）。
 * @param input - 原始输入或配置值。
 */
export function normalizeDirPath(input: string | undefined): string | undefined {
  if (input === undefined) return undefined
  const trimmed = input.trim()
  if (trimmed.length === 0) return undefined
  const expanded =
    trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? join(homedir(), trimmed.slice(1))
      : trimmed
  return resolve(expanded)
}

/**
 * 规范化一组目录：逐项规范化、丢弃空项、按大小写不敏感去重并保序。
 *
 * 去重是必要的：用户很容易把同一个项目目录既写进"另行指定的项目目录"，又让它被根目录
 * 扫到——扫描那边也会去重，但**设置里先去掉**能让界面上显示的就是真实生效的清单。
 */
export function normalizeDirList(input?: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input ?? []) {
    const path = normalizeDirPath(typeof item === 'string' ? item : undefined)
    if (path === undefined) continue
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

/**
 * 校验一个目录。插件**不创建目录**（见 AGENTS.md 5.2 第 10 条），只接受已存在的目录。
 * @param input - 用户填写的路径。
 * @param label - 出错提示里用的层级名（"根目录" / "类型目录" / "项目目录"）。
 * @returns 规范化后的绝对路径。
 */
export async function checkDir(input: string, label: string): Promise<string> {
  const path = normalizeDirPath(input)
  if (path === undefined) throw new Error(`请填写${label}的路径。`)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    throw new Error(`${label}不存在：${path}`)
  }
  if (!info.isDirectory()) throw new Error(`${label}不是一个目录：${path}`)
  return path
}

/**
 * 校验一组目录（逐项校验）。空数组是合法的——那就是"清空这一级"。
 * @param input - 用户填写的路径列表。
 * @param label - 出错提示里用的层级名。
 * @returns 规范化后的绝对路径列表（已去重）。
 */
export async function checkDirList(input: readonly string[], label: string): Promise<string[]> {
  const out: string[] = []
  for (const path of normalizeDirList(input)) out.push(await checkDir(path, label))
  return out
}

/** 设置来源切换与变更通知。 */
export interface SettingsHooks<T> {
  /** 收到当前权威来源（settings 服务在位时是用户层，否则是组合层）。 */
  readonly setSource: (current: () => T) => void
  /** 来源或其值变化后重新取值。 */
  readonly onChange: () => void
}

/**
 * 接线 `ctx.settings`：注册命名空间（`base` = 组合层配置）并观察变化；
 * 服务缺席时不做任何事，插件继续用组合层配置。等价于平台 `installSettingsSection`，
 * 但只依赖结构化契约。
 */
export function installSettings(
  ctx: Context,
  ns: string,
  schema: z<LegalSettings>,
  entry: LegalSettings,
  hooks: SettingsHooks<LegalSettings>,
): void {
  ctx.inject(['settings'], (scoped) => {
    const settings = scoped.get('settings') as SettingsProviderLike | undefined
    if (settings === undefined) return
    const scope = settings.register(ns, schema, { base: entry })
    hooks.setSource(() => scope.get())
    scope.watch(() => {
      hooks.onChange()
    })
    scoped.effect(() => () => {
      hooks.setSource(() => entry)
      hooks.onChange()
    })
    hooks.onChange()
  })
}
