/**
 * 插件配置。
 *
 * DSH 的插件配置由 Cordis 加载器按 schemastery 校验；profile 的 `cordis.patch.yml`
 * 里通过该行的 `config` 提供。
 *
 * 这里的每一项都是**组合层默认值**，用户设置（`settings.yaml` 的 `dslegal:` 段）优先。
 * 三级目录（根目录 / 类型目录 / 项目目录）**各自独立**，可以只配其中任意一级。
 *
 * **没有「类型目录名 → 服务类别」的映射表**（2026-09-15 用户要求彻底取消）：一个文件夹
 * 是不是类型目录**只由结构推定**，名字不参与判定；项目的服务类别只由工作日志的 H1 标题
 * 决定（见 `@dslegal/core` 的 `categoryFromTitle`）。
 */

import z from '@deepseek-ai/schemastery'

export interface HostConfig {
  /**
   * 根目录的绝对路径。
   *
   * **可省略**：省略时视为"尚未设定"，由「法程」面板的「插件设置」写入用户设置
   * （`$DSH_HOME/settings.yaml` 的 `dslegal:` 段）后生效。
   */
  readonly rootDir?: string
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
  extraTypeDirs: z
    .array(z.string())
    .description('另行指定的类型目录（绝对路径列表，可位于根目录之外）'),
  extraProjectDirs: z
    .array(z.string())
    .description('另行指定的项目目录（绝对路径列表，可位于根目录之外）'),
  debounceMs: z.natural().default(150).description('文件监听防抖毫秒数'),
  echoWindowMs: z.natural().default(500).description('自身写入后的回环抑制窗口毫秒数'),
})
