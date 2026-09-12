/**
 * 工作日志读写。
 *
 * 读：整篇读取并交给 `@dslegal/core` 解析。
 * 写：**原子替换**（临时文件 + rename），内容由 core 的外科手术式写回产出，
 * 因此除目标行外文件字节不变。
 */

import { readFile, rename, writeFile } from 'node:fs/promises'

import { parseWorkLog, type WorkLogParseResult } from '@dslegal/core'

export interface WorkLogSnapshot {
  readonly path: string
  /** 文件原始文本。 */
  readonly text: string
  /** 解析结果。 */
  readonly result: WorkLogParseResult
}

/** 读取并解析一个工作日志文件。 */
export async function readWorkLog(path: string): Promise<WorkLogSnapshot> {
  const text = await readFile(path, 'utf8')
  return { path, text, result: parseWorkLog(text) }
}

/**
 * 原子写入：先写临时文件再 rename，避免写入过程中被读到半截内容。
 * 内容原样落盘（BOM / 换行符由 core 的写回引擎保证）。
 */
export async function writeWorkLog(path: string, text: string): Promise<void> {
  const temp = `${path}.dslegal-${process.pid}-${Date.now()}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}
