import { parseDocument } from 'yaml'
import { IntegrationError, object } from './config'

export function parseSkill(text: string): { name: string; description: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new IntegrationError('invalid-skill')
  try {
    const document = parseDocument(match[1])
    if (document.errors.length) throw new Error()
    const data = object(document.toJS({ maxAliasCount: 20 }))
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 128 || typeof data.description !== 'string' || !data.description.trim() || data.description.length > 4096) throw new Error()
    return { name: data.name.trim(), description: data.description.trim() }
  } catch { throw new IntegrationError('invalid-skill') }
}
