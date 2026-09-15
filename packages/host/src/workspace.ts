/**
 * 目录扫描：定位各项目及其「1. 工作日志.md」，并读取其中的服务类别。
 *
 * 目录契约见 `maintenance/2. DSLegalPlugin 数据约定规范.md`：
 * `<根目录>/<类型目录>/<项目目录>/0. 协作/1. 工作日志.md`。
 *
 * **三级目录都可以由用户单独指定**（用户 2026-09-15 明确要求）：
 * - **根目录**：它下面的子文件夹不是一律都算类型目录，而是走**两条判据**：
 *   ① **名称在映射里**（默认 5 个）→ 是类型目录，与既有行为一致；
 *   ② 名称不在映射里的 → **结构补判**：只有当它下面**存在**符合项目目录形式规则的子文件夹
 *      （即 `<子文件夹>/0. 协作/1. 工作日志.md` 是一个文件）时，才认它是类型目录。
 *   两条都不满足的文件夹**完全不扫**，所以根目录里放别的东西（归档、草稿，乃至**案件文件夹
 *   本身**——它下面只有 `0. 协作`，没有 `<子>/0. 协作/1. 工作日志.md`）都不会被误判成类型目录。
 * - **类型目录**：除根目录下的默认类型目录外，还可以**另行指定任意绝对路径**（可以在根目录
 *   之外）；它下面的子文件夹就是项目目录。
 * - **项目目录**：还可以**直接指定任意绝对路径**（可以在根目录之外）；此时它的"类型目录名"
 *   取父文件夹名，允许的类别按该名字在映射里的取值，映射里没有这个名字则**不限类别**。
 *
 * 类别来源：工作日志的 **H1 标题**（`# 工作日志_<类别>`，诉讼类为
 * `# 工作日志_民事` / `_刑事` / `_行政`）。类型目录名只表达大类，不足以区分
 * 诉讼案件下的民事 / 刑事 / 行政，故以 H1 标题为准。
 *
 * 插件**不创建**任何目录，只读取既有结构。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import {
  COLLAB_DIR,
  SERVICE_CATEGORIES,
  WORK_LOG_FILE,
  categoryFromTitle,
  parseWorkLogTitle,
  type ServiceCategory,
} from '@dslegal/core'

/** 一个已定位的项目。 */
export interface ProjectLocation {
  /** 项目名（项目文件夹名）。 */
  readonly project: string
  /** 类型目录名。 */
  readonly typeDir: string
  /** 类型目录绝对路径。 */
  readonly typeDirPath: string
  /** 该类型目录允许的类别集合。 */
  readonly allowedCategories: readonly ServiceCategory[]
  /** 由工作日志 H1 解析出的类别；无法确定时为 `null`。 */
  readonly category: ServiceCategory | null
  /** 工作日志 H1 原文。 */
  readonly title: string | null
  /** 项目目录绝对路径。 */
  readonly projectPath: string
  /** 「1. 工作日志.md」绝对路径。 */
  readonly workLogPath: string
  /** 类别异常说明（标题缺失 / 无法识别 / 与类型目录不符）；正常为 `null`。 */
  readonly categoryIssue: string | null
}

/** 结构不完整的项目目录（缺少「0. 协作/1. 工作日志.md」）。 */
export interface IncompleteProject {
  readonly project: string
  readonly typeDir: string
  readonly projectPath: string
}

export interface ScanOptions {
  /** 根目录绝对路径；未设定时为 `null`（只配了另行指定的目录时仍可扫描）。 */
  readonly rootDir: string | null
  /** 类型目录名 → 允许的服务类别。 */
  readonly typeDirs: Readonly<Record<string, readonly ServiceCategory[]>>
  /** 另行指定的类型目录（绝对路径列表，可在根目录之外）。 */
  readonly extraTypeDirs?: readonly string[]
  /** 另行指定的项目目录（绝对路径列表，可在根目录之外）。 */
  readonly extraProjectDirs?: readonly string[]
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

/**
 * 某类型目录允许的类别。
 *
 * 映射里有这个名字就用映射（例如「诉讼案件」只许民事 / 刑事 / 行政）；**没有就不限类别**
 * ——另行指定的类型目录名往往不在默认映射里（那是用户自己的分类习惯），此时按"不限制"
 * 处理，否则完全合法的工作日志会被判成「类别与目录不符」。**结构补判**认出来的类型目录
 * 同样走这一条（名字不在映射里 = 不限类别）。
 */
function allowedFor(
  typeDirs: Readonly<Record<string, readonly ServiceCategory[]>>,
  typeDir: string,
): readonly ServiceCategory[] {
  return typeDirs[typeDir] ?? SERVICE_CATEGORIES
}

/**
 * 一个目录下**是否存在**符合项目目录形式规则的子文件夹。
 *
 * "项目目录形式规则"就是本插件认项目的唯一结构判据：`<子文件夹>/0. 协作/1. 工作日志.md`
 * 是一个文件。**命中一条就返回**——根目录下未在映射里的文件夹可能是几十个，而探测每个都
 * 要读一次子目录列表；短路之后最坏情况才是"把这个文件夹翻一遍"。
 */
async function hasProjectChild(typeDirPath: string): Promise<boolean> {
  for (const project of await listDirectories(typeDirPath)) {
    if (await isFile(join(typeDirPath, project, COLLAB_DIR, WORK_LOG_FILE))) return true
  }
  return false
}

function describeCategoryIssue(
  title: string | null,
  category: ServiceCategory | null,
  allowed: readonly ServiceCategory[],
  typeDir: string,
): string | null {
  if (title === null) return '工作日志缺少 H1 标题；应为「# 工作日志_<类别>」。'
  if (category === null) {
    return `H1 标题「${title}」无法识别；应为「# 工作日志_<类别>」（诉讼类如「# 工作日志_民事」）。`
  }
  if (!allowed.includes(category)) {
    return `类别「${category}」不属于类型目录「${typeDir}」（该目录允许：${allowed.join('、')}）。`
  }
  return null
}

/** 去重用的路径键：Windows 上大小写不敏感。 */
function pathKey(path: string): string {
  const abs = resolve(path)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

/** 扫描过程的累加器：同一个项目目录只收一次（先到先得）。 */
interface Sink {
  readonly projects: ProjectLocation[]
  readonly incomplete: IncompleteProject[]
  readonly seen: Set<string>
}

/**
 * 收一个项目目录（含"结构不完整"的情况）。
 *
 * `reportIncomplete` 决定缺工作日志的目录要不要进 `incomplete` 清单：映射里 / 用户显式
 * 指定的类型目录要（用户在那儿放了东西却不成项目，是值得看见的事实），**结构补判**认出来
 * 的类型目录不要——它是靠"下面确实有合格项目"才被认出来的，其余子文件夹（`1. 材料`、
 * `2. 归档` 这类）逐个报成"缺工作日志"只会淹没有用信息。
 */
async function collectProject(
  projectPath: string,
  project: string,
  typeDir: string,
  typeDirPath: string,
  allowed: readonly ServiceCategory[],
  reportIncomplete: boolean,
  sink: Sink,
): Promise<void> {
  const key = pathKey(projectPath)
  if (sink.seen.has(key)) return
  sink.seen.add(key)

  const workLogPath = join(projectPath, COLLAB_DIR, WORK_LOG_FILE)
  if (!(await isFile(workLogPath))) {
    if (reportIncomplete) sink.incomplete.push({ project, typeDir, projectPath })
    return
  }
  const title = await readTitle(workLogPath)
  const category = title === null ? null : categoryFromTitle(title)
  sink.projects.push({
    project,
    typeDir,
    typeDirPath,
    allowedCategories: allowed,
    category,
    title,
    projectPath,
    workLogPath,
    categoryIssue: describeCategoryIssue(title, category, allowed, typeDir),
  })
}

/** 收一个类型目录下的全部项目目录。 */
async function collectTypeDir(
  typeDirPath: string,
  typeDir: string,
  allowed: readonly ServiceCategory[],
  reportIncomplete: boolean,
  sink: Sink,
): Promise<void> {
  for (const project of await listDirectories(typeDirPath)) {
    await collectProject(
      join(typeDirPath, project),
      project,
      typeDir,
      typeDirPath,
      allowed,
      reportIncomplete,
      sink,
    )
  }
}

/**
 * 扫描：根目录下的默认类型目录 → 根目录下的**结构补判**类型目录 → 另行指定的类型目录 →
 * 另行指定的项目目录。
 *
 * 顺序即优先级：同一个项目目录被多处命中时，取**先扫到**的那一份（根目录扫描的类别判定
 * 最准，因为它的类型目录名一定在映射里）。目录不存在时不抛错，只是扫不到东西——磁盘是
 * 唯一真相，"目录没了"应当在界面上表现为"项目没了"，而不是整片面板报错。
 *
 * 唯一的例外是**另行指定的项目目录**：它是用户手填的那一条路径，不存在时进 `incomplete`
 * 如实报出来（用户写错了路径，应该看得见，而不是静默消失）。
 */
export async function scanProjects(options: ScanOptions): Promise<ScanResult> {
  const sink: Sink = { projects: [], incomplete: [], seen: new Set<string>() }

  const root = options.rootDir === null ? null : resolve(options.rootDir)
  if (root !== null) {
    // ① 映射里的名称：照旧无条件扫。它下面一个合格项目都没有时，那些子文件夹照旧进
    //    `incomplete`——"这里放了东西却不成项目"是用户该看见的事实。
    for (const [typeDir, categories] of Object.entries(options.typeDirs)) {
      await collectTypeDir(join(root, typeDir), typeDir, categories, true, sink)
    }
    // ② 名称不在映射里的：**结构补判**。只有当它下面存在符合项目目录形式规则的子文件夹
    //    时才认它是类型目录（此时不限类别），其余子文件夹静默跳过。
    //    这一条同时挡住了"根目录下堆着案件文件夹"的常见盘面：案件文件夹下面只有
    //    `0. 协作`，没有 `<子>/0. 协作/1. 工作日志.md`，所以它不会被误判成类型目录。
    for (const name of await listDirectories(root)) {
      if (options.typeDirs[name] !== undefined) continue
      const typeDirPath = join(root, name)
      if (!(await hasProjectChild(typeDirPath))) continue
      await collectTypeDir(typeDirPath, name, allowedFor(options.typeDirs, name), false, sink)
    }
  }

  for (const dir of options.extraTypeDirs ?? []) {
    const abs = resolve(dir)
    const typeDir = basename(abs)
    await collectTypeDir(abs, typeDir, allowedFor(options.typeDirs, typeDir), true, sink)
  }

  for (const dir of options.extraProjectDirs ?? []) {
    const abs = resolve(dir)
    const parent = dirname(abs)
    const typeDir = basename(parent) || parent
    await collectProject(
      abs,
      basename(abs),
      typeDir,
      parent,
      allowedFor(options.typeDirs, typeDir),
      true,
      sink,
    )
  }

  return { projects: sink.projects, incomplete: sink.incomplete }
}

/** 按项目名定位；同名项目需用 `typeDir` 消歧。 */
export function findProject(
  projects: readonly ProjectLocation[],
  project: string,
  typeDir?: string,
): ProjectLocation | undefined {
  const matches = projects.filter(
    (candidate) =>
      candidate.project === project && (typeDir === undefined || candidate.typeDir === typeDir),
  )
  return matches.length === 1 ? matches[0] : undefined
}

/** 项目名是否在多个类型目录中重名。 */
export function isAmbiguous(projects: readonly ProjectLocation[], project: string): boolean {
  return projects.filter((candidate) => candidate.project === project).length > 1
}
