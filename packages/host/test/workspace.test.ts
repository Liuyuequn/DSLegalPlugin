import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { COLLAB_DIR, DEFAULT_TOP_LEVEL_DIRS, WORK_LOG_FILE } from '@dslegal/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findProject, isAmbiguous, scanProjects } from '../src/workspace.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dslegal-workspace-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function makeProject(
  topLevel: string,
  project: string,
  title = '# 工作日志_民事',
  withWorkLog = true,
): Promise<void> {
  const dir = join(root, topLevel, project, COLLAB_DIR)
  await mkdir(dir, { recursive: true })
  if (withWorkLog) {
    await writeFile(join(dir, WORK_LOG_FILE), `${title}\n\n## 1. 待办事项\n`, 'utf8')
  }
}

const options = { dataRoot: '', topLevelDirs: DEFAULT_TOP_LEVEL_DIRS }

describe('scanProjects', () => {
  it('类别来自工作日志的 H1 标题', async () => {
    await makeProject('诉讼案件', '民事案件', '# 工作日志_民事')
    await makeProject('诉讼案件', '刑事案件', '# 工作日志_刑事')
    await makeProject('法律顾问', '常年顾问', '# 工作日志_法律顾问')

    const result = await scanProjects({ ...options, dataRoot: root })
    expect(result.incomplete).toEqual([])
    const byProject = new Map(result.projects.map((item) => [item.project, item.category]))
    expect(byProject.get('民事案件')).toBe('民事诉讼')
    expect(byProject.get('刑事案件')).toBe('刑事诉讼')
    expect(byProject.get('常年顾问')).toBe('法律顾问')
    for (const item of result.projects) expect(item.categoryIssue).toBeNull()
  })

  it('携带允许类别集合与工作日志路径', async () => {
    await makeProject('诉讼案件', '某案')
    const result = await scanProjects({ ...options, dataRoot: root })
    const first = result.projects[0]!
    expect(first.allowedCategories).toEqual(['民事诉讼', '刑事诉讼', '行政诉讼'])
    expect(first.title).toBe('工作日志_民事')
    expect(first.workLogPath.endsWith(join(COLLAB_DIR, WORK_LOG_FILE))).toBe(true)
  })

  it('H1 无法识别 → categoryIssue，类别为 null', async () => {
    await makeProject('诉讼案件', '乱写标题', '# 张三诉李四')
    const result = await scanProjects({ ...options, dataRoot: root })
    expect(result.projects[0]?.category).toBeNull()
    expect(result.projects[0]?.categoryIssue).toContain('无法识别')
  })

  it('缺少 H1 → categoryIssue', async () => {
    await makeProject('诉讼案件', '没有标题', '## 1. 待办事项')
    const result = await scanProjects({ ...options, dataRoot: root })
    expect(result.projects[0]?.category).toBeNull()
    expect(result.projects[0]?.categoryIssue).toContain('缺少 H1 标题')
  })

  it('类别与顶级目录不符 → categoryIssue', async () => {
    await makeProject('诉讼案件', '错放的项目', '# 工作日志_法律顾问')
    const result = await scanProjects({ ...options, dataRoot: root })
    expect(result.projects[0]?.category).toBe('法律顾问')
    expect(result.projects[0]?.categoryIssue).toContain('不属于顶级目录')
  })

  it('缺少「0. 协作/1. 工作日志.md」的项目归入 incomplete', async () => {
    await makeProject('诉讼案件', '完整项目')
    await makeProject('诉讼案件', '缺工作日志', '', false)

    const result = await scanProjects({ ...options, dataRoot: root })
    expect(result.projects.map((item) => item.project)).toEqual(['完整项目'])
    expect(result.incomplete.map((item) => item.project)).toEqual(['缺工作日志'])
  })

  it('顶级目录或数据根目录不存在时返回空结果，不抛错', async () => {
    const missingTop = await scanProjects({ ...options, dataRoot: root })
    expect(missingTop.projects).toEqual([])
    const missingRoot = await scanProjects({ ...options, dataRoot: join(root, '不存在') })
    expect(missingRoot.projects).toEqual([])
  })

  it('支持自定义顶级目录名', async () => {
    await makeProject('案件', '某案', '# 工作日志_民事')
    const result = await scanProjects({ dataRoot: root, topLevelDirs: { 案件: ['民事诉讼'] } })
    expect(result.projects.map((item) => item.project)).toEqual(['某案'])
    expect(result.projects[0]?.category).toBe('民事诉讼')
  })
})

describe('findProject / isAmbiguous', () => {
  it('唯一项目名可直接定位；重名需 topLevelDir 消歧', async () => {
    await makeProject('诉讼案件', '同名项目')
    await makeProject('法律顾问', '同名项目', '# 工作日志_法律顾问')
    await makeProject('诉讼案件', '独立项目')

    const { projects } = await scanProjects({ ...options, dataRoot: root })
    expect(findProject(projects, '独立项目')?.topLevelDir).toBe('诉讼案件')
    expect(findProject(projects, '同名项目')).toBeUndefined()
    expect(findProject(projects, '同名项目', '法律顾问')?.topLevelDir).toBe('法律顾问')
    expect(isAmbiguous(projects, '同名项目')).toBe(true)
    expect(isAmbiguous(projects, '独立项目')).toBe(false)
  })
})
