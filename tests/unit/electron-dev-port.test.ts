import { afterEach, expect, it, vi } from 'vitest'
import { resolveConfig } from 'electron-vite'
import { createServer, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
})

it('starts the renderer on a system-selected loopback port and exposes its actual URL', async () => {
  vi.stubEnv('ELECTRON_VITE_PORT', '')
  const { config } = await resolveConfig({ root: repo }, 'serve', 'development')
  const renderer = config!.renderer!
  expect(renderer.server!.port).toBeGreaterThan(0)
  expect(renderer.server!.host).toBe('127.0.0.1')
  server = await createServer({ ...renderer, configFile: false, logLevel: 'silent' })
  await server.listen()
  // Electron-Vite uses config.server.port when setting ELECTRON_RENDERER_URL.
  const url = `http://127.0.0.1:${server.config.server.port}/`
  expect(server.resolvedUrls!.local).toContain(url)
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  expect(await response.text()).toContain('/src/main.tsx')
})

it('preserves an explicitly configured renderer port', async () => {
  vi.stubEnv('ELECTRON_VITE_PORT', '42861')
  const { config } = await resolveConfig({ root: repo }, 'serve', 'development')
  expect(config!.renderer!.server!.port).toBe(42861)
})
