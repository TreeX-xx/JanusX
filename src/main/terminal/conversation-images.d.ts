export const IMAGE_MAX_BYTES: number
export function storeConversationImage(root: string, source: { path?: string; data?: string }, cwd?: string): Promise<{
  id: string; path: string; mimeType: string; status: string
}>
