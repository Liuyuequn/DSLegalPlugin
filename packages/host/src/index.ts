/**
 * DSLegalPlugin host 插件。
 *
 * 职责：注册 `legal_*` 工具、扫描三级目录、读写「1. 工作日志.md」、监听外部改动。
 *
 * 三级目录（根目录 / 类型目录 / 项目目录）是**运行时可变**的：初值取自插件配置
 * （`cordis.patch.yml` 的 `rootDir` / `extraTypeDirs` / `extraProjectDirs`），用户设置
 * （`$DSH_HOME/settings.yaml` 的 `dslegal:` 段）优先；一个都没设定时视为"尚未设定"，
 * 界面只显示目录设置表单，工具与接口返回可读提示。
 *
 * 约束（见 AGENTS.md 第 5.1 节）：必须是 `{ name, inject, apply }` 命名导出，
 * **禁止 `export default`** —— DSH loader 会拆包导致 `inject` 丢失，插件静默失效。
 */

import type { Context } from '@deepseek-ai/cordis'

import { resolvePriorityColors, type ResolvedPriorityColors } from '@dslegal/core'

import { Config, type HostConfig } from './config.js'
import { isConfigured, type LegalDeps, type ResolvedPaths } from './deps.js'
import { registerHttpRoutes, type WebServerLike } from './http.js'
import { openInDefaultApp } from './opener.js'
import {
  DIRS_UNSET,
  LegalSettingsSchema,
  SETTINGS_NS,
  checkDir,
  checkDirList,
  effectiveRootDir,
  installSettings,
  normalizeDirList,
  normalizeDirPath,
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
    /** 插件设置（三级目录 / 四象限颜色）发生变化。 */
    'dslegal/settings-changed'(payload: Record<string, never>): void
  }
}

export const name = 'dslegal-host'

/** 硬依赖：工具注册表。 */
export const inject = ['tools']

export { Config }

/** 组合层配置 → 三级目录。只规范化路径，**不校验存在性**（那是"保存"时的事）。 */
function pathsFromConfig(config: HostConfig): ResolvedPaths {
  return {
    rootDir: normalizeDirPath(config.rootDir) ?? null,
    extraTypeDirs: normalizeDirList(config.extraTypeDirs),
    extraProjectDirs: normalizeDirList(config.extraProjectDirs),
  }
}

/** 缓存键：三级目录任一项变化都要重扫。 */
function pathsKey(value: ResolvedPaths): string {
  return JSON.stringify([value.rootDir, value.extraTypeDirs, value.extraProjectDirs])
}

export function apply(ctx: Context, config: HostConfig): void {
  let paths: ResolvedPaths = pathsFromConfig(config)
  let cached: ScanResult | null = null
  let cachedKey: string | null = null

  /** 扫描当前三级目录；一个都没设定时抛出可读错误（工具据此提示用户先设置）。 */
  const scan = async (force = false): Promise<ScanResult> => {
    if (!isConfigured(paths)) throw new Error(DIRS_UNSET)
    const key = pathsKey(paths)
    if (cached === null || force || cachedKey !== key) {
      cached = await scanProjects({
        rootDir: paths.rootDir,
        extraTypeDirs: paths.extraTypeDirs,
        extraProjectDirs: paths.extraProjectDirs,
      })
      cachedKey = key
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

  /** 按当前三级目录重建监听清单；一个都没设定时清空。 */
  const refreshWatch = async (): Promise<void> => {
    if (!isConfigured(paths)) {
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

  /** 切换目录设置：清缓存、重建监听。三级目录一个都没变时为无操作。 */
  const applyPaths = async (next: ResolvedPaths): Promise<void> => {
    if (pathsKey(next) === pathsKey(paths)) return
    paths = next
    cached = null
    cachedKey = null
    await refreshWatch()
  }

  /** 用户设置里读到的值（由 `installSettings` 维护来源）。 */
  let readSettings: () => LegalSettings = () => ({
    rootDir: config.rootDir,
    extraTypeDirs: config.extraTypeDirs,
    extraProjectDirs: config.extraProjectDirs,
  })

  /** 用户设置 → 三级目录（旧键 `dataRoot` 在这里兜底成根目录）。 */
  const settingsPaths = (settings: LegalSettings): ResolvedPaths => ({
    rootDir: effectiveRootDir(settings) ?? null,
    extraTypeDirs: normalizeDirList(settings.extraTypeDirs),
    extraProjectDirs: normalizeDirList(settings.extraProjectDirs),
  })

  // 用户设置优先于组合层配置；settings 服务缺席时自动退回组合层。
  installSettings(
    ctx,
    SETTINGS_NS,
    LegalSettingsSchema,
    {
      rootDir: config.rootDir,
      extraTypeDirs: config.extraTypeDirs,
      extraProjectDirs: config.extraProjectDirs,
    },
    {
      setSource: (current) => {
        readSettings = current
      },
      onChange: () => {
        void applyPaths(settingsPaths(readSettings()))
        // 颜色是纯渲染参数，无需重建监听，但要让已连的界面知道该换色了。
        ctx.emit('dslegal/settings-changed', {})
      },
    },
  )

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
    getPaths: () => paths,
    setPaths: async (patch) => {
      const settings = ctx.get('settings') as SettingsProviderLike | undefined
      if (settings === undefined) {
        throw new Error(
          '当前 profile 未提供 settings 服务，无法从界面保存目录设置；请在 cordis.patch.yml 里配置 dslegal-host 的 rootDir / extraTypeDirs / extraProjectDirs。',
        )
      }

      // 逐项组装：**只写用户这次真的改了的键**（设置层的合并没有"删除键"这一步，
      // 不传的键必须保持原值，否则改根目录会把另行指定的目录一起抹掉）。
      const update: Record<string, unknown> = {}
      let nextRoot = paths.rootDir
      if (patch.rootDir !== undefined) {
        const raw = patch.rootDir ?? ''
        const normalized = normalizeDirPath(raw)
        if (normalized === undefined) {
          // 空串 / 空白 = 清空根目录（根目录不再必填）。设置层的合并没有"删除键"，
          // 所以清空靠写入空串来表达，读取时它会被规范化成 undefined。
          update.rootDir = ''
          nextRoot = null
        } else {
          const checked = await checkDir(raw, '根目录')
          update.rootDir = checked
          nextRoot = checked
        }
      }
      let nextExtraTypeDirs = paths.extraTypeDirs
      if (patch.extraTypeDirs !== undefined) {
        const checked = await checkDirList(patch.extraTypeDirs, '类型目录')
        update.extraTypeDirs = checked
        nextExtraTypeDirs = checked
      }
      let nextExtraProjectDirs = paths.extraProjectDirs
      if (patch.extraProjectDirs !== undefined) {
        const checked = await checkDirList(patch.extraProjectDirs, '项目目录')
        update.extraProjectDirs = checked
        nextExtraProjectDirs = checked
      }
      if (Object.keys(update).length === 0) {
        throw new Error('缺少要保存的设置项（rootDir / extraTypeDirs / extraProjectDirs）。')
      }

      await settings.update(SETTINGS_NS, update)
      // 立即生效，不等 watch 回调（watch 是异步的，界面要拿到确定结果）。
      const next: ResolvedPaths = {
        rootDir: nextRoot,
        extraTypeDirs: nextExtraTypeDirs,
        extraProjectDirs: nextExtraProjectDirs,
      }
      await applyPaths(next)
      if (!isConfigured(next)) return { ...next, projectCount: 0, incompleteCount: 0 }
      const { projects, incomplete } = await scan(true)
      return { ...next, projectCount: projects.length, incompleteCount: incomplete.length }
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
    // 「点日程标题 → 打开原始 markdown」：认关联程序、按平台拼命令、起一个脱离 DSH 的
    // 子进程（详见 opener.ts）。`DSLEGAL_OPEN_DRY=1` 时只解析不启动，供测试与排查使用。
    openWorkLog: (path, line) => openInDefaultApp(path, line),
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
