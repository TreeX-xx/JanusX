// Note: management traffic stays local — see .agents/notes/workbench/service-integrations.md
import { ClientRequest } from 'node:http'
import { urlToHttpOptions } from 'node:url'

/** Do not send the local management key through the global fetch/HTTP proxy hooks. */
export function cpaLocalRequest(url: string, signal: AbortSignal, key?: string, readStatus = false): Promise<{ ok: boolean; status?: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') { reject(new Error('cpa-invalid-local-url')); return }
    const request = new ClientRequest({ ...urlToHttpOptions(target), agent: false, signal,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    }, (response) => {
      const ok = (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300
      response.on('error', reject)
      if (!readStatus || !ok) { response.resume(); resolve({ ok }); return }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 64 * 1024) response.destroy(new Error('cpa-invalid-response'))
      })
      response.on('end', () => {
        try {
          const value: unknown = JSON.parse(body)
          resolve({ ok, status: value && typeof value === 'object' && 'status' in value && typeof value.status === 'string' ? value.status : undefined })
        } catch { reject(new Error('cpa-invalid-response')) }
      })
    })
    request.on('error', reject)
    request.end()
  })
}
