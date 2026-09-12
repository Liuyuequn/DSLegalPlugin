/**
 * 数据根目录扫描：定位各项目及其「1. 工作日志.md」，并读取其中的服务类别。
 *
 * 目录契约见 `maintenance/2. DSLegalPlugin 数据约定规范.md`：
 * `<数据根目录>/<顶级目录>/<项目>/0. 协作/1. 工作日志.md`。
 *
 * 类别来源：工作日志的 **H1 标题**（`# 工作日志_<类别>`，诉讼类为
 * `# 工作日志_民事` / `_刑事` / `_行政`）。顶级目录名只表达大类，不足以区分
 * 诉讼案件下的民事 / 刑事 / 行政，故以 H1 标题为准。
 *
 * 插件**不创建**任何目录，只读取既有结构。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  COLLAB_DIR,
  WORK_LOG_FILE,
  categoryFromTitle,
  parseWorkLogTitle,
  type ServiceCategory,
} from '@dslegal/core'

/** 一个已定位的项目。 */
export interface ProjectLocation {
  /** 项目名（次级子文件夹名）。 */
  readonly project: string
  /** 顶级目录名。 */
  readonly topLevelDir: string
  /** 该顶级目录允许的类别集合。 */
  readonly allowedCategories: readonly ServiceCategory[]
  /** 由工作日志 H1 解析出的类别；无法确定时为 `null`。 */
  readonly category: ServiceCategory | null
  /** 工作日志 H1 原文。 */
  readonly title: string | null
  /** 项目目录绝对路径。 */
  readonly projectPath: string
  /** 「1. 工作日志.md」绝对路径。 */
  readonly workLogPath: string
  /** 类别异常说明（标题缺失 / 无法识别 / 与顶级目录不符）；正常为 `null`。 */
  readonly categoryIssue: string | null
}

/** 结构不完整的项目目录（缺少「0. 协作/1. 工作日志.md」）。 */
export interface IncompleteProject {
  readonly project: string
  readonly topLevelDir: string
  readonly projectPath: string
}

export interface ScanOptions {
  readonly dataRoot: string
  readonly topLevelDirs: Readonly<Record<string, readonly ServiceCategory[]>>
}

export interface ScanResult {
  readonly projects: readonly ProjectLocation[]
  readonly incomplete: readonly IncompleteProject[]
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function readTitle(path: string): Promise<string | null> {
  try {
    return parseWorkLogTitle(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function describeCategoryIssue(
  title: string | null,
  category: ServiceCategory | null,
  allowed: readonly ServiceCategory[],
  topLevelDir: string,
): string | null {
  if (title === null) return '工作日志缺少 H1 标题；应为「# 工作日志_<类别>」。'
  if (category === null) {
    return `H1 标题「${title}」无法识别；应为「# 工作日志_<类别>」（诉讼类如「# 工作日志_民事」）。`
  }
  if (!allowed.includes(category)) {
    return `类别「${category}」不属于顶级目录「${topLevelDir}」（该目录允许：${allowed.join('、')}）。`
  }
  return null
}

/** 扫描数据根目录，返回完整与不完整的项目。 */
export async function scanProjects(options: ScanOptions): Promise<ScanResult> {
  const root = resolve(options.dataRoot)
  const projects: ProjectLocation[] = []
  const incomplete: IncompleteProject[] = []

  for (const [topLevelDir, categories] of Object.entries(options.topLevelDirs)) {
    const topPath = join(root, topLevelDir)
    for (const project of await listDirectories(topPath)) {
      const projectPath = join(topPath, project)
      const workLogPath = join(projectPath, COLLAB_DIR, WORK_LOG_FILE)
      if (!(await isFile(workLogPath))) {
        incomplete.push({ project, topLevelDir, projectPath })
        continue
      }
      const title = await readTitle(workLogPath)
      const category = title === null ? null : categoryFromTitle(title)
      projects.push({
        project,
        topLevelDir,
        allowedCategories: categories,
        category,
        title,
        projectPath,
        workLogPath,
        categoryIssue: describeCategoryIssue(title, category, categories, topLevelDir),
      })
    }
  }

  return { projects, incomplete }
}

/** 按项目名定位；同名项目需用 `topLevelDir` 消歧。 */
export function findProject(
  projects: readonly ProjectLocation[],
  project: string,
  topLevelDir?: string,
): ProjectLocation | undefined {
  const matches = projects.filter(
    (candidate) =>
      candidate.project === project &&
      (topLevelDir === undefined || candidate.topLevelDir === topLevelDir),
  )
  return matches.length === 1 ? matches[0] : undefined
}

/** 项目名是否在多个顶级目录中重名。 */
export function isAmbiguous(projects: readonly ProjectLocation[], project: string): boolean {
  return projects.filter((candidate) => candidate.project === project).length > 1
}
