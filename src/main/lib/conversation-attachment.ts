import { randomUUID } from 'node:crypto'
import { mkdir, open, rm, stat, type FileHandle } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { CONVERSATION_ATTACHMENT_CHUNK_BYTES, CONVERSATION_NATIVE_IMAGE_BUDGET, MAX_CONVERSATION_NATIVE_IMAGES,
  conversationReferenceFileKind, supportsNativeConversationImage, type ConversationReference } from '../../shared/conversation-context'
import type { ConversationAttachmentImport } from '../../shared/ipc/workspace'

// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
interface PendingImport {
  owner: number
  reference: ConversationReference
  directory: string
  handle: FileHandle
  remaining: number
  writing: boolean
}

/** The textual references already name every file. Native images are supplemental. */
export async function selectNativeConversationImages(paths: readonly string[]): Promise<string[]> {
  const selected: string[] = []
  let remaining = CONVERSATION_NATIVE_IMAGE_BUDGET
  for (const path of new Set(paths)) {
    if (selected.length === MAX_CONVERSATION_NATIVE_IMAGES || remaining === 0) break
    if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || !supportsNativeConversationImage(path)) continue
    const file = await stat(path).catch(() => undefined)
    if (!file?.isFile() || file.size === 0 || file.size > remaining) continue
    selected.push(path)
    remaining -= file.size
  }
  return selected
}

export class ConversationAttachmentImporter {
  private pending = new Map<string, PendingImport>()

  constructor(private readonly root: string) {}

  async dispatch(owner: number, request: ConversationAttachmentImport): Promise<ConversationReference | string | void> {
    if (request.type === 'path') {
      if (typeof request.path !== 'string' || !isAbsolute(request.path) || request.path.includes('\0')) throw new Error('Invalid attachment path')
      const file = await stat(request.path).catch(() => undefined)
      const name = basename(request.path)
      if (file?.isDirectory()) return { id: randomUUID(), path: request.path, name: name || request.path, kind: 'directory' }
      if (file && !file.isFile()) throw new Error('The attachment must be a file or folder')
      return { id: randomUUID(), path: request.path, name, size: file?.size, kind: conversationReferenceFileKind(name) }
    }
    if (request.type === 'begin') {
      const { name, size } = request
      if (typeof name !== 'string' || !name || name.length > 255 || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid attachment')
      const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'attachment'
      const id = randomUUID()
      const directory = join(this.root, id)
      const path = join(directory, safeName)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      try {
        const handle = await open(path, 'wx', 0o600)
        this.pending.set(id, { owner, reference: { id, name: safeName, path, size, kind: conversationReferenceFileKind(safeName) },
          directory, handle, remaining: size, writing: false })
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
      return id
    }
    const entry = this.pending.get(request.id)
    if (!entry || entry.owner !== owner) throw new Error('Unknown attachment transfer')
    if (request.type === 'cancel') return this.discard(entry)
    if (entry.writing) throw new Error('Attachment write in progress')
    if (request.type === 'append') {
      const { bytes } = request
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > CONVERSATION_ATTACHMENT_CHUNK_BYTES
        || bytes.byteLength > entry.remaining) throw new Error('Invalid attachment chunk')
      entry.writing = true
      try {
        await entry.handle.writeFile(bytes)
        entry.remaining -= bytes.byteLength
      } catch (error) {
        await this.discard(entry)
        throw error
      } finally { entry.writing = false }
      return
    }
    if (request.type !== 'finish' || entry.remaining !== 0) throw new Error('Incomplete attachment')
    entry.writing = true
    await entry.handle.close()
    if (!this.pending.delete(entry.reference.id)) throw new Error('Attachment import cancelled')
    return entry.reference
  }

  async releaseOwner(owner: number): Promise<void> {
    await Promise.allSettled([...this.pending.values()].filter(entry => entry.owner === owner).map(entry => this.discard(entry)))
  }

  private async discard(entry: PendingImport): Promise<void> {
    if (!this.pending.delete(entry.reference.id)) return
    await entry.handle.close().catch(() => {})
    await rm(entry.directory, { recursive: true, force: true })
  }
}
