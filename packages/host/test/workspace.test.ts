import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { COLLAB_DIR, WORK_LOG_FILE } from '@dslegal/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  checkHierarchy,
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
  return scanProjects({ rootDir: root, ...over })
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

  it('携带类型目录名与工作日志路径', async () => {
    await makeProject('诉讼案件', '某案')
    const result = await scanAt()
    const first = result.projects[0]!
    expect(first.typeDir).toBe('诉讼案件')
    expect(first.typeDirPath).toBe(join(root, '诉讼案件'))
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

  it('目录名不影响类别判定：H1 是唯一依据，没有"类别与目录不符"这回事', async () => {
    // 2026-09-15 起取消了"类型目录名 → 服务类别"的映射表，这条断言就是那次取消的守卫：
    // 目录叫「诉讼案件」而工作日志写「# 工作日志_法律顾问」，一切照常、不报任何异常。
    await makeProject('诉讼案件', '披着诉讼外衣的顾问', '# 工作日志_法律顾问')
    const result = await scanAt()
    expect(result.projects[0]?.category).toBe('法律顾问')
    expect(result.projects[0]?.categoryIssue).toBeNull()
  })

  it('结构推定出来的类型目录：缺工作日志的子文件夹静默跳过，不进 incomplete', async () => {
    await makeProject('诉讼案件', '完整项目')
    await makeProject('诉讼案件', '缺工作日志', '', false)

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['完整项目'])
    // 根目录下的类型目录**都是**结构推定出来的（它靠"下面确实有合格项目"才被认出来），
    // 所以其余子文件夹一律静默跳过——只有用户**显式指定**的目录才如实报出。
    expect(result.incomplete).toEqual([])
  })

  it('类型目录或根目录不存在时返回空结果，不抛错', async () => {
    const missingTop = await scanAt()
    expect(missingTop.projects).toEqual([])
    const missingRoot = await scanAt({ rootDir: join(root, '不存在') })
    expect(missingRoot.projects).toEqual([])
  })
})

describe('scanProjects（另行指定的类型目录 / 项目目录）', () => {
  it('另行指定的类型目录：可以在根目录之外，名字不参与类别判定', async () => {
    await makeProjectAt(join(outside, '自家分类'), '外部案件', '# 工作日志_民事')

    const result = await scanAt({ extraTypeDirs: [join(outside, '自家分类')] })
    const item = result.projects.find((project) => project.project === '外部案件')
    expect(item?.typeDir).toBe('自家分类')
    expect(item?.typeDirPath).toBe(join(outside, '自家分类'))
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
      extraProjectDirs: [join(outside, '诉讼案件', '孤案')],
    })
    expect(result.projects.map((item) => item.project)).toEqual(['孤案'])
    expect(result.projects[0]?.typeDir).toBe('诉讼案件')
  })

  it('同一个项目被多处命中时只收一次（根目录扫描优先）', async () => {
    const projectPath = await makeProjectAt(join(root, '诉讼案件'), '重复案件')
    const result = await scanAt({ extraProjectDirs: [projectPath] })
    expect(result.projects.filter((item) => item.project === '重复案件')).toHaveLength(1)
    // 根目录那一趟先扫到，所以 typeDir 是它真正所在的那一层，而不是父目录推导出来的。
    expect(result.projects[0]?.typeDir).toBe('诉讼案件')
    expect(result.projects[0]?.typeDirPath).toBe(join(root, '诉讼案件'))
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

describe('scanProjects（类型目录只按结构推定，名称不参与判定）', () => {
  /**
   * 规则（2026-09-15 用户要求彻底取消"名称映射"）：一个子文件夹**只有**在它下面存在符合
   * 项目目录形式规则的子文件夹（`<子>/0. 协作/1. 工作日志.md` 是文件）时，才被判为类型目录。
   * 目录叫什么名字**完全不影响**判定；推定出来的类型目录，其余子文件夹**不进** `incomplete`。
   */
  it('其下有合格的项目目录 → 判为类型目录（名字随便叫什么）', async () => {
    await makeProjectAt(join(root, '自家分类'), '自家案件', '# 工作日志_刑事')

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['自家案件'])
    const item = result.projects[0]!
    expect(item.typeDir).toBe('自家分类')
    expect(item.typeDirPath).toBe(join(root, '自家分类'))
    // 类别只由 H1 决定：没有映射表，也就没有"类别与目录不符"。
    expect(item.category).toBe('刑事诉讼')
    expect(item.categoryIssue).toBeNull()
  })

  it('传统那 5 个名字不再有任何特权：里面没有合格项目就完全不扫', async () => {
    await makeProjectAt(join(root, '诉讼案件'), '缺工作日志', '', false)

    const result = await scanAt()
    expect(result.projects).toEqual([])
    expect(result.incomplete).toEqual([])
  })

  it('其下没有合格的项目目录 → 完全不扫，也不报 incomplete', async () => {
    await makeProjectAt(join(root, '归档'), '旧案', '', false) // 缺工作日志
    await mkdir(join(root, '草稿'), { recursive: true }) // 空目录

    const result = await scanAt()
    expect(result.projects).toEqual([])
    expect(result.incomplete).toEqual([])
  })

  it('推定出来的类型目录：其余子文件夹静默跳过', async () => {
    await makeProjectAt(join(root, '自家分类'), '合格案件')
    await makeProjectAt(join(root, '自家分类'), '材料堆', '', false)

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['合格案件'])
    expect(result.incomplete).toEqual([])
  })

  it('根目录下的案件文件夹本身不会被误判成类型目录（反向保护）', async () => {
    await makeProject('诉讼案件', '案件甲')
    // `案件乙` 是"项目目录本身"被放在根目录下：它下面只有 `0. 协作`，
    // 没有 `<子>/0. 协作/1. 工作日志.md` —— 结构推定不该把它当成类型目录。
    await makeProjectAt(root, '案件乙')

    const result = await scanAt()
    expect(result.projects.map((item) => item.project)).toEqual(['案件甲'])
    expect(result.incomplete).toEqual([])
  })

  it('结构推定只认一层：更深的嵌套不会把上层认成类型目录', async () => {
    await makeProjectAt(join(root, '外层', '中层'), '太深了')

    const result = await scanAt()
    expect(result.projects).toEqual([])
    expect(result.incomplete).toEqual([])
  })
})

describe('checkHierarchy（强制目录层级契约）', () => {
  /**
   * 允许的形状只有三种：`<根>/<类型>/<项目>`、根目录之外独立的类型目录、根目录之外独立的
   * 项目目录。位置不对的「另行指定」一律拒绝（保存时 400；组合层 / 手工配置则忽略并记下来）。
   */
  it('根目录之外独立存在的类型目录 / 项目目录：放行', () => {
    const typeDir = join(outside, '自家分类')
    const projectDir = join(outside, '散装', '单列案件')
    const checked = checkHierarchy({
      rootDir: root,
      extraTypeDirs: [typeDir],
      extraProjectDirs: [projectDir],
    })
    expect(checked.issues).toEqual([])
    expect(checked.extraTypeDirs).toEqual([typeDir])
    expect(checked.extraProjectDirs).toEqual([projectDir])
  })

  it('项目目录位于某个类型目录之下（根目录之外）：放行', () => {
    const typeDir = join(outside, '自家分类')
    const checked = checkHierarchy({
      rootDir: root,
      extraTypeDirs: [typeDir],
      extraProjectDirs: [join(typeDir, '案件甲')],
    })
    expect(checked.issues).toEqual([])
  })

  it('根目录之内的类型目录（直接子文件夹）与其下的项目目录：放行', () => {
    const checked = checkHierarchy({
      rootDir: root,
      extraTypeDirs: [join(root, '诉讼案件')],
      extraProjectDirs: [join(root, '诉讼案件', '张三诉李四')],
    })
    expect(checked.issues).toEqual([])
  })

  it('根目录之下不能直接指定项目目录：拒绝并剔除该项', () => {
    const projectDir = join(root, '张三诉李四')
    const checked = checkHierarchy({
      rootDir: root,
      extraTypeDirs: [],
      extraProjectDirs: [projectDir],
    })
    expect(checked.issues).toHaveLength(1)
    expect(checked.issues[0]).toContain('根目录之下只能是类型目录')
    expect(checked.issues[0]).toContain(projectDir)
    expect(checked.extraProjectDirs).toEqual([])
  })

  it('根目录之内的类型目录只能是直接子文件夹', () => {
    const nested = join(root, '诉讼案件', '子分类')
    const checked = checkHierarchy({ rootDir: root, extraTypeDirs: [nested], extraProjectDirs: [] })
    expect(checked.issues[0]).toContain('只能是根目录的直接子文件夹')
    expect(checked.extraTypeDirs).toEqual([])
  })

  it('类型目录之间不得嵌套：剔除被嵌套的那一个，外层保留', () => {
    const outer = join(outside, '外层')
    const inner = join(outer, '内层')
    const checked = checkHierarchy({
      rootDir: null,
      extraTypeDirs: [outer, inner],
      extraProjectDirs: [],
    })
    expect(checked.issues[0]).toContain('不能嵌套在另一个类型目录里')
    expect(checked.extraTypeDirs).toEqual([outer])
  })

  it('项目目录之内不能再有类型目录（类型目录被剔除，项目目录本身保留）', () => {
    const projectDir = join(outside, '案件甲')
    const checked = checkHierarchy({
      rootDir: null,
      extraTypeDirs: [join(projectDir, '子分类')],
      extraProjectDirs: [projectDir],
    })
    expect(checked.issues.join('\n')).toContain('不能位于项目目录之内')
    expect(checked.extraTypeDirs).toEqual([])
    expect(checked.extraProjectDirs).toEqual([projectDir])
  })

  it('项目目录之间不得嵌套', () => {
    const outer = join(outside, '案件甲')
    const checked = checkHierarchy({
      rootDir: null,
      extraTypeDirs: [],
      extraProjectDirs: [outer, join(outer, '子目录')],
    })
    expect(checked.issues.join('\n')).toContain('不能嵌套在另一个项目目录里')
    expect(checked.extraProjectDirs).toEqual([outer])
  })

  it('根目录只能有一个：与它重合、或把它装在里面，都不允许', () => {
    const same = checkHierarchy({ rootDir: root, extraTypeDirs: [root], extraProjectDirs: [] })
    expect(same.issues[0]).toContain('根目录只能有一个')
    expect(same.extraTypeDirs).toEqual([])

    const covering = checkHierarchy({
      rootDir: root,
      extraTypeDirs: [dirname(root)],
      extraProjectDirs: [],
    })
    expect(covering.issues[0]).toContain('根目录只能有一个')
    expect(covering.extraTypeDirs).toEqual([])
  })

  it('同一个文件夹不能既是类型目录又是项目目录', () => {
    const both = join(outside, '自家分类')
    const checked = checkHierarchy({
      rootDir: null,
      extraTypeDirs: [both],
      extraProjectDirs: [both],
    })
    expect(checked.issues[0]).toContain('不能既是类型目录又是项目目录')
    expect(checked.extraTypeDirs).toEqual([])
    expect(checked.extraProjectDirs).toEqual([])
  })

  it.runIf(process.platform === 'win32')('Windows 上大小写不敏感：换个写法照样判出违规', () => {
    const checked = checkHierarchy({
      rootDir: root.toUpperCase(),
      extraTypeDirs: [],
      extraProjectDirs: [join(root, '张三诉李四')],
    })
    expect(checked.issues).toHaveLength(1)
    expect(checked.extraProjectDirs).toEqual([])
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
