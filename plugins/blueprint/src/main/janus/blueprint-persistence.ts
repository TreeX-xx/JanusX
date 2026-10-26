/**
 * @file Blueprint JSON 持久化
 * @description readJson/writeJson（temp+rename 原子写），无业务逻辑
 *              （audit A1 自 blueprint-store 拆出；原子写来自 audit C2）。
 */

import { promises as fs } from 'node:fs'
import { writeFileAtomic } from '@janusx/plugin-sdk/native'

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  // temp+rename 原子写：退出期中断不会产生截断 JSON
  await writeFileAtomic(file, JSON.stringify(data, null, 2))
}
