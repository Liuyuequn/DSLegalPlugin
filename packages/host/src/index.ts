/**
 * DSLegalPlugin host 插件。
 *
 * 职责：注册 `legal_*` 工具、扫描数据根目录、读写「1. 工作日志.md」、监听外部改动。
 *
 * 数据根目录是**运行时可变**的：初值取自插件配置（`cordis.patch.yml` 的 `dataRoot`），
 * 用户设置（`$DSH_HOME/settings.yaml` 的 `dslegal:` 段）优先；两者都没有时视为
 * "尚未设定"，界面只显示数据目录输入框，工具与接口返回可读提示。
 *
 * 约束（见 AGENTS.md 第 5.1 节）：必须是 `{ name, inject, apply }` 命名导出，
 * **禁止 `export default`** —— DSH loader 会拆包导致 `inject` 丢失，插件静默失效。
 */

import type { Context } from '@deepseek-ai/cordis'

import { resolvePriorityColors, type ResolvedPriorityColors } from '@dslegal/core'

import { Config, resolveTopLevelDirs, type HostConfig } from './config.js'
import type { LegalDeps } from './deps.js'
import { registerHttpRoutes, type WebServerLike } from './http.js'
import {
  DATA_ROOT_UNSET,
  LegalSettingsSchema,
  SETTINGS_NS,
  checkDataRoot,
  installSettings,
  normalizeDataRoot,
  type LegalSettings,
  type SettingsProviderLike,
} from './settings.js'
import { readWorkLog, writeWorkLog } from './store.js'
import { registerTools } from './tools.js'
import { createWorkLogWatcher } from './watcher.js'
import { scanProjects, type ScanResult } from './workspace.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 某项目的「1. 工作日志.md」被外部改动（已防抖、已抑制自身写入的回环）。 */
    'dslegal/work-log-changed'(payload: { path: string }): void
    /** 插件设置（数据目录 / 四象限颜色）发生变化。 */
    'dslegal/settings-changed'(payload: Record<string, never>): void
  }
}

export const name = 'dslegal-host'

/** 硬依赖：工具注册表。 */
export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: HostConfig): void {
  const topLevelDirs = resolveTopLevelDirs(config)

  let dataRoot: string | undefined = normalizeDataRoot(config.dataRoot)
  let cached: ScanResult | null = null
  let cachedRoot: string | null = null

  /** 扫描当前数据根目录；未设定时抛出可读错误（工具据此提示用户先设置）。 */
  const scan = async (force = false): Promise<ScanResult> => {
    const root = dataRoot
    if (root === undefined) throw new Error(DATA_ROOT_UNSET)
    if (cached === null || force || cachedRoot !== root) {
      cached = await scanProjects({ dataRoot: root, topLevelDirs })
      cachedRoot = root
    }
    return cached
  }

  const watcher = createWorkLogWatcher([], {
    debounceMs: config.debounceMs ?? 150,
    echoWindowMs: config.echoWindowMs ?? 500,
  })

  watcher.subscribe((path) => {
    cached = null
    ctx.emit('dslegal/work-log-changed', { path })
  })

  /** 按当前数据根目录重建监听清单；未设定时清空。 */
  const refreshWatch = async (): Promise<void> => {
    if (dataRoot === undefined) {
      watcher.setPaths([])
      return
    }
    try {
      const { projects } = await scan(true)
      watcher.setPaths(projects.map((project) => project.workLogPath))
    } catch {
      watcher.setPaths([])
    }
  }

  /** 切换数据根目录：清缓存、重建监听。值未变时为无操作。 */
  const applyRoot = async (next: string | undefined): Promise<void> => {
    if (next === dataRoot) return
    dataRoot = next
    cached = null
    cachedRoot = null
    await refreshWatch()
  }

  /** 用户设置里读到的值（由 `installSettingsSection` 维护来源）。 */
  let readSettings: () => LegalSettings = () => ({ dataRoot: config.dataRoot })

  // 用户设置优先于组合层配置；settings 服务缺席时自动退回组合层。
  installSettings(ctx, SETTINGS_NS, LegalSettingsSchema, { dataRoot: config.dataRoot }, {
    setSource: (current) => {
      readSettings = current
    },
    onChange: () => {
      void applyRoot(normalizeDataRoot(readSettings().dataRoot))
      // 颜色是纯渲染参数，无需重建监听，但要让已连的界面知道该换色了。
      ctx.emit('dslegal/settings-changed', {})
    },
  })

  /** 当前生效的优先级颜色：每次现算，"用户设置 → 默认色"的兜底逻辑只有一份。 */
  const currentColors = (): ResolvedPriorityColors =>
    resolvePriorityColors(readSettings().priorityColors)

  const deps: LegalDeps = {
    scan,
    readWorkLog,
    writeWorkLog,
    markSelfWrite: (path) => {
      watcher.markSelfWrite(path)
    },
    getDataRoot: () => dataRoot ?? null,
    setDataRoot: async (input) => {
      const next = await checkDataRoot(input)
      const settings = ctx.get('settings') as SettingsProviderLike | undefined
      if (settings === undefined) {
        throw new Error(
          '当前 profile 未提供 settings 服务，无法从界面保存数据目录；请在 cordis.patch.yml 里配置 dslegal-host 的 dataRoot。',
        )
      }
      await settings.update(SETTINGS_NS, { dataRoot: next })
      // 立即生效，不等 watch 回调（watch 是异步的，界面要拿到确定结果）。
      await applyRoot(next)
      const { projects, incomplete } = await scan()
      return { dataRoot: next, projectCount: projects.length, incompleteCount: incomplete.length }
    },
    getPriorityColors: currentColors,
    setPriorityColors: async (input) => {
      const settings = ctx.get('settings') as SettingsProviderLike | undefined
      if (settings === undefined) {
        throw new Error(
          '当前 profile 未提供 settings 服务，无法从界面保存颜色；请在 cordis.patch.yml 里配置 dslegal-host 的 priorityColors。',
        )
      }
      const resolved = resolvePriorityColors(input)
      // 四个键**全部**写下去：设置层的合并没有"删除键"这一步（见 settings 服务说明），
      // 所以"恢复默认"就是把这四个键显式写回默认色——语义等价，且能可靠往返。
      await settings.update(SETTINGS_NS, { priorityColors: resolved.colors })
      return { colors: resolved.colors, issues: resolved.issues }
    },
  }

  registerTools(ctx, deps)

  // 可选依赖：组合里存在 webServer 时，为浏览器侧提供 `/dslegal/*` 接口；不存在则静默跳过。
  ctx.inject(['webServer'], () => {
    const webServer = ctx.get('webServer') as WebServerLike | undefined
    if (webServer !== undefined) registerHttpRoutes(webServer, deps)
  })

  // 首次扫描后把已知工作日志纳入监听；项目增删会在下次工具调用时刷新。
  void refreshWatch()

  // 插件卸载时关闭监听（Cordis effect：返回的 disposer 随 fiber 卸载执行）。
  ctx.effect(() => () => {
    void watcher.close()
  })
}
