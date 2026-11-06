import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SuperAgentResource } from '../../../shared/superagent'
import { emptyDocument, parseDocument, type SuperAgentDocument } from './schema'

export type AtomicWriter = (path: string, content: string) => Promise<void>

/** Same temp/rename pattern as atomic-file, with file sync before publishing a receipt. */
export const writeRecordAtomic: AtomicWriter = async (path, content) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
    await rename(temporary, path)
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  } finally { await rm(temporary, { force: true }) }
}

export const hashText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

export class SuperAgentPersistence {
  readonly indexPath: string
  constructor(readonly directory: string, private readonly write: AtomicWriter = writeRecordAtomic) {
    this.indexPath = join(directory, 'records.json')
  }

  async load(): Promise<SuperAgentDocument> {
    let raw: string
    try { raw = await readFile(this.indexPath, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument(); throw error }
    try { return parseDocument(JSON.parse(raw)) }
    catch (error) { throw new Error(`SuperAgent records are damaged or unsupported; original file preserved: ${this.indexPath}`, { cause: error }) }
  }

  async save(data: SuperAgentDocument): Promise<void> {
    await this.write(this.indexPath, JSON.stringify(data))
  }

  private resourcePath(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid resource identity')
    return join(this.directory, 'resources', `${id}.txt`)
  }

  async writeResource(resource: SuperAgentResource, text: string): Promise<void> {
    await this.write(this.resourcePath(resource.id), text)
  }

  async readResource(resource: SuperAgentResource): Promise<string> {
    let text: string
    try { text = await readFile(this.resourcePath(resource.id), 'utf8') }
    catch (error) { throw new Error(`SuperAgent resource unavailable: ${resource.id}`, { cause: error }) }
    if (hashText(text) !== resource.sha256 || Buffer.byteLength(text, 'utf8') !== resource.bytes) {
      throw new Error(`SuperAgent resource changed or damaged: ${resource.id}`)
    }
    return text
  }
}
