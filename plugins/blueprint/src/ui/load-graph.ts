import type { Blueprint } from '../shared/janus/types'
import { call } from './client'

export async function loadGraph(signal?: AbortSignal): Promise<{ blueprint: Blueprint }> {
  const snapshot = await call<{ id: string; parts: number }>('blueprint.graph-open', null, signal)
  try {
    const parts: string[] = []
    for (let index = 0; index < snapshot.parts; index++) {
      signal?.throwIfAborted()
      parts.push((await call<{ text: string }>('blueprint.graph-part', { id: snapshot.id, index }, signal)).text)
    }
    return JSON.parse(parts.join(''))
  } finally {
    await call('blueprint.graph-close', snapshot.id).catch(() => {})
  }
}
