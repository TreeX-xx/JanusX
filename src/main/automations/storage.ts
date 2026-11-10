import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  } finally { await rm(temporary, { force: true }) }
}
export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
export async function jsonFiles(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).filter(name => name.endsWith('.json')).map(name => join(directory, name)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
