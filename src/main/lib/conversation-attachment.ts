import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MAX_CONVERSATION_ATTACHMENT_BYTES, type ConversationReference } from '../../shared/conversation-context'

export async function saveConversationAttachment(root: string, name: string, bytes: Uint8Array): Promise<ConversationReference> {
  if (typeof name !== 'string' || !name || name.length > 255 || !(bytes instanceof Uint8Array)
    || !bytes.byteLength || bytes.byteLength > MAX_CONVERSATION_ATTACHMENT_BYTES) throw new Error('Invalid attachment (maximum 10 MB)')
  const safeName = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'attachment'
  const id = randomUUID()
  const directory = join(root, id)
  await mkdir(directory, { recursive: true })
  const path = join(directory, safeName)
  await writeFile(path, bytes, { flag: 'wx' })
  return { id, name: safeName, path, kind: /\.(png|jpe?g|webp|gif)$/i.test(safeName) ? 'image' : 'file' }
}
