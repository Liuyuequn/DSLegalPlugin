/**
 * 插件配置。
 *
 * DSH 的插件配置由 Cordis 加载器按 schemastery 校验；profile 的 `cordis.patch.yml`
 * 里通过该行的 `config` 提供。
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_TOP_LEVEL_DIRS, type ServiceCategory } from '@dslegal/core'

export interface HostConfig {
  /**
   * 数据根目录的绝对路径。
   *
   * **可省略**：省略时视为"尚未设定"，由「法程」面板的「数据目录」表单写入
   * 用户设置（`$DSH_HOME/settings.yaml` 的 `dslegal:` 段）后生效。
   * 此处配置的值是**组合层默认值**，用户设置优先。
   */
  readonly dataRoot?: string
  /** 顶级目录名 → 服务类别列表；省略时使用默认映射。 */
  readonly topLevelDirs?: Record<string, string[]>
  /** 文件监听防抖毫秒数。 */
  readonly debounceMs: number
  /** 自身写入后的回环抑制窗口毫秒数。 */
  readonly echoWindowMs: number
}

export const Config: z<HostConfig> = z.object({
  dataRoot: z
    .string()
    .description('数据根目录的绝对路径；省略表示尚未设定，由界面在「数据目录」中设置'),
  topLevelDirs: z.dict(z.array(z.string())).description('顶级目录名 → 服务类别列表；省略时使用默认映射'),
  debounceMs: z.natural().default(150).description('文件监听防抖毫秒数'),
  echoWindowMs: z.natural().default(500).description('自身写入后的回环抑制窗口毫秒数'),
})

/** 解析顶级目录映射：配置优先，否则使用默认。 */
export function resolveTopLevelDirs(
  config: HostConfig,
): Readonly<Record<string, readonly ServiceCategory[]>> {
  const source = config.topLevelDirs
  if (source === undefined || Object.keys(source).length === 0) return DEFAULT_TOP_LEVEL_DIRS
  const resolved: Record<string, readonly ServiceCategory[]> = {}
  for (const [dir, categories] of Object.entries(source)) {
    resolved[dir] = categories as readonly ServiceCategory[]
  }
  return resolved
}
