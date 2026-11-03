import { copyFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ConversationSnapshot } from '../../shared/conversation-display'

/** Export a registered artifact, never a renderer-supplied source or destination path. */
export async function exportConversationImage(snapshot: ConversationSnapshot | undefined, itemId: string, imageId: string,
  choose: (extension: string) => Promise<{ canceled: boolean; filePath?: string }>): Promise<{ canceled: boolean }> {
  const image = snapshot?.items.find(item => item.id === itemId)?.images?.find(image => image.id === imageId)
  if (image?.status !== 'ready' || !image.path) throw new Error('Image is no longer available')
  const extension = extname(image.path).slice(1)
  if (!['png', 'jpeg', 'jpg', 'gif', 'webp'].includes(extension)) throw new Error('Unsupported image export')
  const result = await choose(extension)
  if (result.canceled) return { canceled: true }
  if (!result.filePath) throw new Error('No image export destination selected')
  await copyFile(image.path, result.filePath)
  return { canceled: false }
}
