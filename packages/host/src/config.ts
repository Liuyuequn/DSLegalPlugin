/**
 * 插件配置。
 *
 * DSH 的插件配置由 Cordis 加载器按 schemastery 校验；profile 的 `cordis.patch.yml`
 * 里通过该行的 `config` 提供。
 *
 * 这里的每一项都是**组合层默认值**，用户设置（`settings.yaml` 的 `dslegal:` 段）优先。
 * 三级目录（根目录 / 类型目录 / 项目目录）**各自独立**，可以只配其中任意一级。
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_TYPE_DIRS, type ServiceCategory } from '@dslegal/core'

export interface HostConfig {
  /**
   * 根目录的绝对路径。
   *
   * **可省略**：省略时视为"尚未设定"，由「法程」面板的「插件设置」写入用户设置
   * （`$DSH_HOME/settings.yaml` 的 `dslegal:` 段）后生效。
   */
  readonly rootDir?: string
  /** 类型目录名 → 服务类别列表；省略时使用默认映射。 */
  readonly typeDirs?: Record<string, string[]>
  /** 另行指定的类型目录（绝对路径列表，可位于根目录之外）；省略表示不额外指定。 */
  readonly extraTypeDirs?: string[]
  /** 另行指定的项目目录（绝对路径列表，可位于根目录之外）；省略表示不额外指定。 */
  readonly extraProjectDirs?: string[]
  /** 文件监听防抖毫秒数。 */
  readonly debounceMs: number
  /** 自身写入后的回环抑制窗口毫秒数。 */
  readonly echoWindowMs: number
}

export const Config: z<HostConfig> = z.object({
  rootDir: z
    .string()
    .description('根目录的绝对路径；省略表示尚未设定，由界面在「插件设置」中设置'),
  typeDirs: z.dict(z.array(z.string())).description('类型目录名 → 服务类别列表；省略时使用默认映射'),
  extraTypeDirs: z
    .array(z.string())
    .description('另行指定的类型目录（绝对路径列表，可位于根目录之外）'),
  extraProjectDirs: z
    .array(z.string())
    .description('另行指定的项目目录（绝对路径列表，可位于根目录之外）'),
  debounceMs: z.natural().default(150).description('文件监听防抖毫秒数'),
  echoWindowMs: z.natural().default(500).description('自身写入后的回环抑制窗口毫秒数'),
})

/** 解析类型目录映射：配置优先，否则使用默认。 */
export function resolveTypeDirs(
  config: HostConfig,
): Readonly<Record<string, readonly ServiceCategory[]>> {
  const source = config.typeDirs
  if (source === undefined || Object.keys(source).length === 0) return DEFAULT_TYPE_DIRS
  const resolved: Record<string, readonly ServiceCategory[]> = {}
  for (const [dir, categories] of Object.entries(source)) {
    resolved[dir] = categories as readonly ServiceCategory[]
  }
  return resolved
}
