/**
 * 目录扫描：定位各项目及其「1. 工作日志.md」，并读取其中的服务类别。
 *
 * 目录契约见 `maintenance/2. DSLegalPlugin 数据约定规范.md`：
 * `<根目录>/<类型目录>/<项目目录>/0. 协作/1. 工作日志.md`。
 *
 * **三级目录都可以由用户单独指定**（用户 2026-09-15 明确要求）：
 * - **根目录**：它下面的子文件夹**只按结构推定**——只有当它下面**存在**符合项目目录形式
 *   规则的子文件夹（即 `<子文件夹>/0. 协作/1. 工作日志.md` 是一个文件）时，才判它是类型目录。
 *   **名字完全不参与判定**（2026-09-15 用户要求彻底取消"名称映射"这种判定方法）。
 *   因此根目录里放别的东西（归档、草稿，乃至**案件文件夹本身**——它下面只有 `0. 协作`，
 *   没有 `<子>/0. 协作/1. 工作日志.md`）都不会被误判成类型目录。
 * - **类型目录**：也可以**另行指定任意绝对路径**（可以在根目录之外）；它下面的子文件夹
 *   就是项目目录（显式指定的含义是"我就要这一层当类型目录"，故不再要求结构先满足）。
 * - **项目目录**：还可以**直接指定任意绝对路径**（可以在根目录之外）；此时它的"类型目录名"
 *   取父文件夹名。
 *
 * 类别来源：工作日志的 **H1 标题**（`# 工作日志_<类别>`，诉讼类为
 * `# 工作日志_民事` / `_刑事` / `_行政`）。**这是唯一的类别依据**——目录名不表达任何类别，
 * 也就不存在"类别与目录不符"这种判定（它本来就是按目录名判的，随映射表一并取消）。
 *
 * 插件**不创建**任何目录，只读取既有结构。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  COLLAB_DIR,
  WORK_LOG_FILE,
  categoryFromTitle,
  parseWorkLogTitle,
  type ServiceCategory,
} from '@dslegal/core'

/** 一个已定位的项目。 */
export interface ProjectLocation {
  /** 项目名（项目文件夹名）。 */
  readonly project: string
  /** 类型目录名（就是那一层文件夹的名字，只用来消歧与显示）。 */
  readonly typeDir: string
  /** 类型目录绝对路径。 */
  readonly typeDirPath: string
  /** 由工作日志 H1 解析出的类别；无法确定时为 `null`。 */
  readonly category: ServiceCategory | null
  /** 工作日志 H1 原文。 */
  readonly title: string | null
  /** 项目目录绝对路径。 */
  readonly projectPath: string
  /** 「1. 工作日志.md」绝对路径。 */
  readonly workLogPath: string
  /** 类别异常说明（标题缺失 / 无法识别）；正常为 `null`。 */
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
 * 一个目录下**是否存在**符合项目目录形式规则的子文件夹。
 *
 * "项目目录形式规则"就是本插件认项目的唯一结构判据：`<子文件夹>/0. 协作/1. 工作日志.md`
 * 是一个文件。**命中一条就返回**——根目录下的文件夹可能有几十个，而探测每个都要读一次
 * 子目录列表；短路之后最坏情况才是"把这个文件夹翻一遍"。
 *
 * 这同时也是**判定类型目录的唯一依据**（2026-09-15 起不再有任何名称判据）。
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
): string | null {
  if (title === null) return '工作日志缺少 H1 标题；应为「# 工作日志_<类别>」。'
  if (category === null) {
    return `H1 标题「${title}」无法识别；应为「# 工作日志_<类别>」（诉讼类如「# 工作日志_民事」）。`
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
 * `reportIncomplete` 决定缺工作日志的目录要不要进 `incomplete` 清单：**用户显式指定**的
 * 类型目录要（他亲手把这条路径指过来，里面却没有一个成形的项目，是值得看见的事实）；
 * **根目录下结构推定**出来的类型目录不要——它本就是靠"下面确实有合格项目"才被认出来的，
 * 其余子文件夹（`1. 材料`、`2. 归档` 这类）逐个报成"缺工作日志"只会淹没有用信息。
 */
async function collectProject(
  projectPath: string,
  project: string,
  typeDir: string,
  typeDirPath: string,
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
    category,
    title,
    projectPath,
    workLogPath,
    categoryIssue: describeCategoryIssue(title, category),
  })
}

/** 收一个类型目录下的全部项目目录。 */
async function collectTypeDir(
  typeDirPath: string,
  typeDir: string,
  reportIncomplete: boolean,
  sink: Sink,
): Promise<void> {
  for (const project of await listDirectories(typeDirPath)) {
    await collectProject(
      join(typeDirPath, project),
      project,
      typeDir,
      typeDirPath,
      reportIncomplete,
      sink,
    )
  }
}

/**
 * 目录层级契约（2026-09-15 用户要求"强制规范目录层级结构"）。
 *
 * 允许的形状只有三种：
 *
 * ```
 * <根目录>/<类型目录>/<项目目录>/0. 协作/1. 工作日志.md     ← 根目录之内的三层，唯一合法形状
 * <另行的类型目录>/<项目目录>/0. 协作/1. 工作日志.md        ← 根目录之外的独立类型目录
 * <另行的项目目录>/0. 协作/1. 工作日志.md                   ← 根目录之外的独立项目目录
 * ```
 *
 * 由此推出五条判定：
 * 1. **根目录只能有一个**，且它在最上层：任何「另行指定」都不得与根目录重合、也不得把根目录装在里面。
 * 2. **根目录之下只能是类型目录**：不能把根目录的直接子文件夹指定成项目目录。
 * 3. **类型目录之下只能是项目目录**：类型目录之间不得互相嵌套。
 * 4. **项目目录之下不能再有类型目录 / 项目目录**。
 * 5. 落在**根目录之内**的「另行指定」必须正好落在它该在的那一层：类型目录必须是根目录的
 *    直接子文件夹，项目目录必须位于某个直接子文件夹之下（即 `<根>/<类型目录>/<项目目录>`）。
 *
 * 位置不合法的项**不生效**：保存时直接拒绝（界面里红字说明原因），组合层配置或手工改过的
 * `settings.yaml` 则忽略该项并把原因记下来（`/dslegal/settings` 会带回界面）。
 */
export interface HierarchyInput {
  readonly rootDir: string | null
  readonly extraTypeDirs: readonly string[]
  readonly extraProjectDirs: readonly string[]
}

export interface HierarchyCheck {
  /** 违反层级的原因，每条都已指出具体路径；正常为空数组。 */
  readonly issues: readonly string[]
  /** 剔除违规项之后的两张清单（顺序不变）。 */
  readonly extraTypeDirs: readonly string[]
  readonly extraProjectDirs: readonly string[]
}

/** 路径比较键：Windows 上大小写不敏感。 */
function compareKey(path: string): string {
  const abs = resolve(path)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

/** `child` 是否**严格**位于 `parent` 之下（相等不算）。 */
function isUnder(child: string, parent: string): boolean {
  const rel = relative(compareKey(parent), compareKey(child))
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/** `child` 相对 `parent` 的层数（1 = 直接子级）；不在其下时为 0。 */
function depthUnder(child: string, parent: string): number {
  const rel = relative(compareKey(parent), compareKey(child))
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return 0
  return rel.split(/[\\/]+/).filter((part) => part.length > 0).length
}

/** 检查三级目录的层级关系；返回违规原因与剔除违规项之后的清单。 */
export function checkHierarchy(input: HierarchyInput): HierarchyCheck {
  const issues: string[] = []
  const root = input.rootDir === null ? null : resolve(input.rootDir)
  const dropTypeDir = new Set<string>()
  const dropProjectDir = new Set<string>()
  const types = input.extraTypeDirs
  const projects = input.extraProjectDirs

  // ① 根目录唯一且在最上层。
  if (root !== null) {
    for (const dir of types) {
      if (compareKey(dir) === compareKey(root) || isUnder(root, dir)) {
        issues.push(
          `「另行指定的类型目录」${dir} 与根目录 ${root} 的位置冲突：根目录只能有一个、且必须在类型目录之上。已忽略该项。`,
        )
        dropTypeDir.add(compareKey(dir))
      }
    }
    for (const dir of projects) {
      if (compareKey(dir) === compareKey(root) || isUnder(root, dir)) {
        issues.push(
          `「另行指定的项目目录」${dir} 与根目录 ${root} 的位置冲突：根目录只能有一个、且必须在项目目录之上。已忽略该项。`,
        )
        dropProjectDir.add(compareKey(dir))
      }
    }
  }

  // ② 类型目录之间不得嵌套（类型目录之下只能是项目目录）。
  for (const inner of types) {
    for (const outer of types) {
      if (compareKey(inner) === compareKey(outer)) continue
      if (isUnder(inner, outer)) {
        issues.push(
          `「另行指定的类型目录」不能嵌套在另一个类型目录里：${inner} 位于 ${outer} 之下。类型目录之下只能是项目目录。已忽略 ${inner}。`,
        )
        dropTypeDir.add(compareKey(inner))
      }
    }
  }

  // ③ 项目目录之内不能再有类型目录或项目目录。
  for (const project of projects) {
    for (const typeDir of types) {
      if (isUnder(typeDir, project)) {
        issues.push(
          `「另行指定的类型目录」不能位于项目目录之内：${typeDir} 位于 ${project} 之下。已忽略 ${typeDir}。`,
        )
        dropTypeDir.add(compareKey(typeDir))
      }
    }
    for (const outer of projects) {
      if (compareKey(project) === compareKey(outer)) continue
      if (isUnder(project, outer)) {
        issues.push(
          `「另行指定的项目目录」不能嵌套在另一个项目目录里：${project} 位于 ${outer} 之下。已忽略 ${project}。`,
        )
        dropProjectDir.add(compareKey(project))
      }
    }
  }

  // ④ 同一个文件夹不能既是类型目录又是项目目录。
  for (const typeDir of types) {
    for (const project of projects) {
      if (compareKey(typeDir) === compareKey(project)) {
        issues.push(
          `同一个文件夹不能既是类型目录又是项目目录：${typeDir}。两张清单里的这一项都已忽略。`,
        )
        dropTypeDir.add(compareKey(typeDir))
        dropProjectDir.add(compareKey(project))
      }
    }
  }

  // ⑤ 落在根目录之内的「另行指定」，层数必须正好。
  if (root !== null) {
    for (const dir of types) {
      if (!isUnder(dir, root)) continue
      const depth = depthUnder(dir, root)
      if (depth !== 1) {
        issues.push(
          `位于根目录之内的「另行指定的类型目录」只能是根目录的直接子文件夹：${dir} 在根目录之下第 ${depth} 层。已忽略该项。`,
        )
        dropTypeDir.add(compareKey(dir))
      }
    }
    for (const dir of projects) {
      if (!isUnder(dir, root)) continue
      const depth = depthUnder(dir, root)
      if (depth === 1) {
        issues.push(
          `根目录之下只能是类型目录，不能直接把项目目录设在根目录下：${dir}。请把案件文件夹移到某个类型目录之下，或者把它放到根目录之外再另行指定。已忽略该项。`,
        )
        dropProjectDir.add(compareKey(dir))
      } else if (depth !== 2) {
        issues.push(
          `位于根目录之内的「另行指定的项目目录」必须正好落在某个直接子文件夹之下（<根目录>/<类型目录>/<项目目录>）：${dir} 在根目录之下第 ${depth} 层。已忽略该项。`,
        )
        dropProjectDir.add(compareKey(dir))
      }
    }
  }

  return {
    issues,
    extraTypeDirs: types.filter((dir) => !dropTypeDir.has(compareKey(dir))),
    extraProjectDirs: projects.filter((dir) => !dropProjectDir.has(compareKey(dir))),
  }
}

/**
 * 扫描：根目录下**结构推定**出来的类型目录 → 另行指定的类型目录 → 另行指定的项目目录。
 *
 * 顺序即优先级：同一个项目目录被多处命中时，取**先扫到**的那一份（根目录扫描出来的
 * `typeDir` 是它真正所在的那一层）。目录不存在时不抛错，只是扫不到东西——磁盘是唯一真相，
 * "目录没了"应当在界面上表现为"项目没了"，而不是整片面板报错。
 *
 * 唯一的例外是**另行指定的项目目录**：它是用户手填的那一条路径，不存在时进 `incomplete`
 * 如实报出来（用户写错了路径，应该看得见，而不是静默消失）。
 */
export async function scanProjects(options: ScanOptions): Promise<ScanResult> {
  const sink: Sink = { projects: [], incomplete: [], seen: new Set<string>() }

  const root = options.rootDir === null ? null : resolve(options.rootDir)
  if (root !== null) {
    // **只按结构推定**：一个子文件夹是不是类型目录，看它下面有没有符合项目目录形式规则的
    // 子文件夹。名字不参与判定（2026-09-15 用户要求取消名称映射）。推定出来的类型目录其余
    // 子文件夹静默跳过；同时这一条天然挡住了"根目录下堆着案件文件夹"的盘面——案件文件夹
    // 下面只有 `0. 协作`，没有 `<子>/0. 协作/1. 工作日志.md`。
    for (const name of await listDirectories(root)) {
      const typeDirPath = join(root, name)
      if (!(await hasProjectChild(typeDirPath))) continue
      await collectTypeDir(typeDirPath, name, false, sink)
    }
  }

  for (const dir of options.extraTypeDirs ?? []) {
    const abs = resolve(dir)
    await collectTypeDir(abs, basename(abs), true, sink)
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
