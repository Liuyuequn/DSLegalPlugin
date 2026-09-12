/**
 * 用户设置（数据目录）—— `$DSH_HOME/settings.yaml` 的 `dslegal:` 段。
 *
 * 为什么用 `ctx.settings` 而不是自己写文件：
 * 1. DSH 的 `dsh-settings-file` 已经是用户设置的**唯一落点**（`settings.yaml`，热重载），
 *    用户也能在 DSH 自己的设置界面里改；插件另起一个配置文件会造成两处真相。
 * 2. 平台约定：**组合层配置作为 `base`**、用户设置作为覆盖层，settings 服务缺席时
 *    自动退回组合层，插件不会因为 profile 里没有该服务而失效。
 *
 * 因此数据根目录的最终取值 = 用户设置 → 插件配置（`cordis.patch.yml` 的 `dataRoot`）→ 未设定。
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

/** 用户可改的插件设置；全部可选，字段缺席即"未设定"。 */
export interface LegalSettings {
  /** 数据根目录的绝对路径。 */
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
  dataRoot: z.string().description('数据根目录的绝对路径'),
  priorityColors: z
    .dict(z.string())
    .description('四个优先级各自的显示颜色（#RRGGBB）'),
})

/** 未设定数据目录时，工具与接口统一返回的提示。 */
export const DATA_ROOT_UNSET =
  '尚未设定数据目录。请在「法程」面板中填写数据根目录（即包含各项目文件夹的目录）并保存。'

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
 * 规范化用户输入：去首尾空白、展开开头的 `~`、转绝对路径；空串 → `undefined`。
 * @param input - 原始输入或配置值。
 */
export function normalizeDataRoot(input: string | undefined): string | undefined {
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
 * 校验并规范化数据根目录。插件**不创建目录**（见 AGENTS.md 5.2 第 10 条），
 * 只接受已存在的目录。
 * @param input - 用户填写的路径。
 * @returns 规范化后的绝对路径。
 */
export async function checkDataRoot(input: string): Promise<string> {
  const path = normalizeDataRoot(input)
  if (path === undefined) throw new Error('请填写数据根目录的路径。')
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    throw new Error(`目录不存在：${path}`)
  }
  if (!info.isDirectory()) throw new Error(`这不是一个目录：${path}`)
  return path
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
