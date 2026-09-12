import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addTodoItem, parseWorkLog } from '@dslegal/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkLog, writeWorkLog } from '../src/store.ts'

const SOURCE = [
  '# 项目',
  '',
  '## 1. 待办事项',
  '',
  '- [ ] [甲]，[重要且紧急]',
  '',
  '## 2. 日程安排',
  '',
  '- [ ] [开庭]，[]，[]，[2026-09-01]，[]，[09:00]，[11:00]',
  '',
].join('\n')

let root = ''
let file = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dslegal-store-'))
  file = join(root, '1. 工作日志.md')
  await writeFile(file, SOURCE, 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readWorkLog', () => {
  it('读取并解析出待办与日程', async () => {
    const snapshot = await readWorkLog(file)
    expect(snapshot.text).toBe(SOURCE)
    expect(snapshot.result.todo.items.map((item) => item.title)).toEqual(['甲'])
    expect(snapshot.result.schedule.items.map((item) => item.title)).toEqual(['开庭'])
  })

  it('文件不存在时抛错', async () => {
    await expect(readWorkLog(join(root, '缺失.md'))).rejects.toThrow()
  })
})

describe('writeWorkLog', () => {
  it('原子写入后内容可被解析器无损读回', async () => {
    const snapshot = await readWorkLog(file)
    const written = addTodoItem(snapshot.text, { title: '乙', priority: '不重要不紧急' })
    if (!written.ok) throw new Error(written.message)

    await writeWorkLog(file, written.text)

    const after = await readWorkLog(file)
    expect(after.text).toBe(written.text)
    expect(after.result.todo.items.map((item) => item.title)).toEqual(['甲', '乙'])
    expect(after.result.todo.issues).toEqual([])
  })

  it('保留 CRLF 与结尾换行形态', async () => {
    const crlf = SOURCE.replace(/\n/g, '\r\n')
    await writeWorkLog(file, crlf)
    const raw = await readFile(file, 'utf8')
    expect(raw).toBe(crlf)
    expect(raw.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('不留下临时文件', async () => {
    await writeWorkLog(file, SOURCE)
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(root)
    expect(entries).toEqual(['1. 工作日志.md'])
  })

  it('写入结果仍可被解析（含空字段占位）', async () => {
    await writeWorkLog(file, SOURCE.replace('- [ ] [甲]，[重要且紧急]', '- [ ] [甲]，[]，[]'))
    const parsed = parseWorkLog(await readFile(file, 'utf8'))
    expect(parsed.todo.items[0]).toMatchObject({ title: '甲', priority: null, note: null })
  })
})
