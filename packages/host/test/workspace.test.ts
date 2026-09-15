import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  COLLAB_DIR,
  DEFAULT_TYPE_DIRS,
  SERVICE_CATEGORIES,
  WORK_LOG_FILE,
} from '@dslegal/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  findProject,
  isAmbiguous,
  scanProjects,
  type ScanOptions,
  type ScanResult,
} from '../src/workspace.ts'

let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dslegal-workspace-'))
  outside = await mkdtemp(join(tmpdir(), 'dslegal-outside-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

/** 在某个绝对目录下造一个项目，返回项目目录绝对路径。 */
async function makeProjectAt(
  typeDirPath: string,
  project: string,
  title = '# 工作日志_民事',
  withWorkLog = true,
): Promise<string> {
  const projectPath = join(typeDirPath, project)
  const dir = join(projectPath, COLLAB_DIR)
  await mkdir(dir, { recursive: true })
  if (withWorkLog) {
    await writeFile(join(dir, WORK_LOG_FILE), `${title}\n\n## 1. 待办事项\n`, 'utf8')
  }
  return projectPath
}

/** 在根目录下造一个项目（`typeDir` 是类型目录名）。 */
async function makeProject(
  typeDir: string,
  project: string,
  title = '# 工作日志_民事',
  withWorkLog = true,
): Promise<void> {
  await makeProjectAt(join(root, typeDir), project, title, withWorkLog)
}

/** 默认扫描选项：根目录指向临时目录；需要时再覆盖。 */
function scanAt(over: Partial<ScanOptions> = {}): Promise<ScanResult> {
  return scanProjects({ rootDir: root, typeDirs: DEFAULT_TYPE_DIRS, ...over })
}

describe('scanProjects（根目录下的类型目录）', () => {
  it('类别来自工作日志的 H1 标题', async () => {
    await makeProject('诉讼案件', '民事案件', '# 工作日志_民事')
    await makeProject('诉讼案件', '刑事案件', '# 工作日志_刑事')
    await makeProject('法律顾问', '常年顾问', '# 工作日志_法律顾问')

    const result = await scanAt()
    expect(result.incomplete).toEqual([])
    const byProject = new Map(result.projects.map((item) => [item.project, item.category]))
    expect(byProject.get('民事案件')).toBe('民事诉讼')
    expect(byProject.get('刑事案件')).toBe('刑事诉讼')
    expect(byProject.get('常年顾问')).toBe('法律顾问')
    for (const item of result.projects) expect(item.categoryIssue).toBeNull()
  })

  it('携带允许类别集合、类型目录名与工作日志路径', async () => {
    await makeProject('诉讼案件', '某案')
    const result = await scanAt()
    const first = result.projects[0]!
    expect(first.typeDir).toBe('诉讼案件')
    expect(first.typeDirPath).toBe(join(root, '诉讼案件'))
    expect(first.allowedCategories).toEqual(['民事诉讼', '刑事诉讼', '行政诉讼'])
    expect(first.title).toBe('工作日志_民事')
    expect(first.workLogPath.endsWith(join(COLLAB_DIR, WORK_LOG_FILE))).toBe(true)
  })

  it('H1 无法识别 → categoryIssue，类别为 null', async () => {
    await makeProject('诉讼案件', '乱写标题', '# 张三诉李四')
    const result = await scanAt()
    expect(result.projects[0]?.category).toBeNull()
    expect(result.projects[0]?.categoryIssue).toContain('无法识别')
  })

  it('缺少 H1 → categoryIssue', async () => {
    await makeProject('诉讼案件', '没有标题', '## 1. 待办事项')
    const result = await scanAt()
    expect(result.projects[0]?.category).toBeNull()
    expect(result.projects[0]?.categoryIssue).toContain('缺少 H1 标题')
  })

  it('类别与类型目录不符 → categoryIssue', async () => {
    await makeProject('诉讼案件', '错放的项目', '# 工作日志_法律顾问')
    const result = await scanAt()
    expect(result.projects[0]?.category).toBe('法律顾问')
    expect(result.projects[0]?.categoryIssue).toContain('不属于类型目录')
  })

  it('缺少「0. 协作/1. 工作日志.md」的项目归入 incomplete', async () => {
    await makeProject('诉讼案件', '完整项目')
    await makeProject('诉讼案件', '缺工作日志', '', false)

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['完整项目'])
    expect(result.incomplete.map((item) => item.project)).toEqual(['缺工作日志'])
    expect(result.incomplete[0]?.typeDir).toBe('诉讼案件')
  })

  it('类型目录或根目录不存在时返回空结果，不抛错', async () => {
    const missingTop = await scanAt()
    expect(missingTop.projects).toEqual([])
    const missingRoot = await scanAt({ rootDir: join(root, '不存在') })
    expect(missingRoot.projects).toEqual([])
  })

  it('支持自定义类型目录名', async () => {
    await makeProject('案件', '某案', '# 工作日志_民事')
    const result = await scanProjects({ rootDir: root, typeDirs: { 案件: ['民事诉讼'] } })
    expect(result.projects.map((item) => item.project)).toEqual(['某案'])
    expect(result.projects[0]?.category).toBe('民事诉讼')
  })
})

describe('scanProjects（另行指定的类型目录 / 项目目录）', () => {
  it('另行指定的类型目录：可以在根目录之外，名字不在映射里则不限类别', async () => {
    await makeProjectAt(join(outside, '自家分类'), '外部案件', '# 工作日志_民事')

    const result = await scanAt({ extraTypeDirs: [join(outside, '自家分类')] })
    const item = result.projects.find((project) => project.project === '外部案件')
    expect(item?.typeDir).toBe('自家分类')
    expect(item?.typeDirPath).toBe(join(outside, '自家分类'))
    expect(item?.allowedCategories).toEqual([...SERVICE_CATEGORIES])
    expect(item?.categoryIssue).toBeNull()
  })

  it('另行指定的类型目录：名字在映射里时仍按映射限类别', async () => {
    await makeProjectAt(join(outside, '法律顾问'), '外部顾问', '# 工作日志_法律顾问')

    const result = await scanAt({ extraTypeDirs: [join(outside, '法律顾问')] })
    const item = result.projects.find((project) => project.project === '外部顾问')
    expect(item?.allowedCategories).toEqual(['法律顾问'])
    expect(item?.categoryIssue).toBeNull()
  })

  it('另行指定的项目目录：类型目录名取父文件夹名', async () => {
    await makeProjectAt(join(outside, '散装'), '单列案件', '# 工作日志_民事')

    const result = await scanAt({ extraProjectDirs: [join(outside, '散装', '单列案件')] })
    const item = result.projects.find((project) => project.project === '单列案件')
    expect(item?.typeDir).toBe('散装')
    expect(item?.typeDirPath).toBe(join(outside, '散装'))
    expect(item?.projectPath).toBe(join(outside, '散装', '单列案件'))
  })

  it('只指定项目目录、不设根目录时也能工作（三级各自独立）', async () => {
    await makeProjectAt(join(outside, '诉讼案件'), '孤案', '# 工作日志_民事')

    const result = await scanProjects({
      rootDir: null,
      typeDirs: DEFAULT_TYPE_DIRS,
      extraProjectDirs: [join(outside, '诉讼案件', '孤案')],
    })
    expect(result.projects.map((item) => item.project)).toEqual(['孤案'])
    expect(result.projects[0]?.typeDir).toBe('诉讼案件')
    expect(result.projects[0]?.allowedCategories).toEqual(['民事诉讼', '刑事诉讼', '行政诉讼'])
  })

  it('同一个项目被多处命中时只收一次（根目录扫描优先）', async () => {
    const projectPath = await makeProjectAt(join(root, '诉讼案件'), '重复案件')
    const result = await scanAt({ extraProjectDirs: [projectPath] })
    expect(result.projects.filter((item) => item.project === '重复案件')).toHaveLength(1)
    expect(result.projects[0]?.allowedCategories).toEqual(['民事诉讼', '刑事诉讼', '行政诉讼'])
  })

  it('另行指定的目录不存在时不抛错：类型目录扫不到东西，项目目录如实报为 incomplete', async () => {
    const result = await scanAt({
      extraTypeDirs: [join(outside, '没有这个目录')],
      extraProjectDirs: [join(outside, '也没有这个目录')],
    })
    expect(result.projects).toEqual([])
    // 类型目录是"枚举"出来的（读不到就是空），项目目录是用户手填的**那一条路径**——
    // 它不存在时进 incomplete，界面上看得见，而不是静默消失。
    expect(result.incomplete.map((item) => item.project)).toEqual(['也没有这个目录'])
  })

  it('另行指定的项目目录缺工作日志时进 incomplete', async () => {
    const projectPath = await makeProjectAt(join(outside, '散装'), '半成品', '', false)
    const result = await scanAt({ extraProjectDirs: [projectPath] })
    expect(result.incomplete.map((item) => item.project)).toEqual(['半成品'])
    expect(result.incomplete[0]?.typeDir).toBe('散装')
  })
})

describe('scanProjects（根目录下未在映射里的子文件夹：结构补判）', () => {
  /**
   * 规则（2026-09-15 用户定下）：名称不在映射里的子文件夹，**只有当它下面存在符合项目目录
   * 形式规则的子文件夹**（`<子>/0. 协作/1. 工作日志.md` 是文件）时才算类型目录；认出来之后
   * **不限类别**，且它其余的子文件夹**不进** `incomplete`。
   */
  it('其下有合格的项目目录 → 认作类型目录，且不限类别', async () => {
    await makeProjectAt(join(root, '自家分类'), '自家案件', '# 工作日志_刑事')

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['自家案件'])
    const item = result.projects[0]!
    expect(item.typeDir).toBe('自家分类')
    expect(item.typeDirPath).toBe(join(root, '自家分类'))
    expect(item.allowedCategories).toEqual([...SERVICE_CATEGORIES])
    // 不限类别 = 「刑事」放在「自家分类」下不算"类别与目录不符"。
    expect(item.categoryIssue).toBeNull()
  })

  it('其下没有合格的项目目录 → 完全不扫，也不报 incomplete', async () => {
    await makeProjectAt(join(root, '归档'), '旧案', '', false) // 缺工作日志
    await mkdir(join(root, '草稿'), { recursive: true }) // 空目录

    const result = await scanAt()
    expect(result.projects).toEqual([])
    expect(result.incomplete).toEqual([])
  })

  it('自动认出来的类型目录：其余子文件夹静默跳过；映射里的照旧如实报出', async () => {
    await makeProjectAt(join(root, '自家分类'), '合格案件')
    await makeProjectAt(join(root, '自家分类'), '材料堆', '', false)
    await makeProject('诉讼案件', '映射内的合格案件')
    await makeProject('诉讼案件', '映射内的缺日志', '', false)

    const result = await scanAt()
    expect(result.projects.map((item) => item.project).sort()).toEqual([
      '合格案件',
      '映射内的合格案件',
    ])
    // 关键这条：只有**映射里**那个类型目录的缺日志目录被报出来。
    expect(result.incomplete.map((item) => item.project)).toEqual(['映射内的缺日志'])
    expect(result.incomplete[0]?.typeDir).toBe('诉讼案件')
  })

  it('根目录下的案件文件夹本身不会被误判成类型目录（反向保护）', async () => {
    await makeProject('诉讼案件', '案件甲')
    // `案件乙` 是"项目目录本身"被放在根目录下：它下面只有 `0. 协作`，
    // 没有 `<子>/0. 协作/1. 工作日志.md` —— 补判不该把它认成类型目录。
    await makeProjectAt(root, '案件乙')

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['案件甲'])
    expect(result.incomplete).toEqual([])
  })

  it('结构补判只认一层：更深的嵌套不会把上层认成类型目录', async () => {
    await makeProjectAt(join(root, '外层', '中层'), '太深了')

    const result = await scanAt()
    expect(result.projects).toEqual([])
    expect(result.incomplete).toEqual([])
  })
})

describe('findProject / isAmbiguous', () => {
  it('唯一项目名可直接定位；重名需 typeDir 消歧', async () => {
    await makeProject('诉讼案件', '同名项目')
    await makeProject('法律顾问', '同名项目', '# 工作日志_法律顾问')
    await makeProject('诉讼案件', '独立项目')

    const { projects } = await scanAt()
    expect(findProject(projects, '独立项目')?.typeDir).toBe('诉讼案件')
    expect(findProject(projects, '同名项目')).toBeUndefined()
    expect(findProject(projects, '同名项目', '法律顾问')?.typeDir).toBe('法律顾问')
    expect(isAmbiguous(projects, '同名项目')).toBe(true)
    expect(isAmbiguous(projects, '独立项目')).toBe(false)
  })
})
