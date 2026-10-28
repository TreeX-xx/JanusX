import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { transformWithEsbuild } from 'vite'
import { build as bundleBackend } from 'esbuild'

export default defineConfig(async ({ command }) => {
  const remoteScope = process.env.JANUSX_REMOTE_SCOPE || (command === 'serve' ? 'develop' : 'lan')
  if (!['lan', 'develop'].includes(remoteScope)) throw Error('JANUSX_REMOTE_SCOPE must be lan or develop')
  const remoteDefine = { __JANUSX_REMOTE_SCOPE__: JSON.stringify(remoteScope), __JANUSX_LOCAL_PLUGIN__: 'null' }
  let rendererPort = Number(process.env.ELECTRON_VITE_PORT) || undefined
  if (command === 'serve' && rendererPort === undefined) {
    // Let Windows avoid Hyper-V/WSL reserved ranges. Vite 6 treats port: 0 as its default port.
    rendererPort = await new Promise<number>((resolvePort, reject) => {
      const probe = createServer()
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        if (!address || typeof address === 'string') {
          probe.close(() => reject(new Error('Unable to select a renderer dev port')))
          return
        }
        probe.close(error => error ? reject(error) : resolvePort(address.port))
      })
    })
  }
  return {
    main: {
      define: remoteDefine,
      plugins: [{ name: 'workspace-linux-backend', async buildStart() {
        const result = await bundleBackend({ entryPoints: [resolve(__dirname, 'src/main/workspace/backend-entry.ts')],
          bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, metafile: true })
        for (const path of Object.keys(result.metafile.inputs)) this.addWatchFile(resolve(__dirname, path))
        this.addWatchFile(resolve(__dirname, 'resources/workspace-runtime/host.py'))
        this.addWatchFile(resolve(__dirname, 'resources/workspace-runtime/cli.py'))
        this.addWatchFile(resolve(__dirname, 'resources/icon.png'))
        this.addWatchFile(resolve(__dirname, 'resources/icon.ico'))
        this.emitFile({ type: 'asset', fileName: 'workspace-backend.cjs', source: result.outputFiles[0].text })
        this.emitFile({ type: 'asset', fileName: 'workspace-host.py', source: readFileSync(resolve(__dirname, 'resources/workspace-runtime/host.py')) })
        this.emitFile({ type: 'asset', fileName: 'workspace-cli.py', source: readFileSync(resolve(__dirname, 'resources/workspace-runtime/cli.py')) })
      } }, externalizeDepsPlugin({
        exclude: ['@janusx/llm-core', '@janusx/llm-core/model-registry', '@janusx/plugin-sdk', '@janusx/note-tools', 'proxy-chain']
      })],
      resolve: { alias: { '@janusx/plugin-sdk/native': resolve(__dirname, 'packages/plugin-sdk/src/native.ts'), '@janusx/plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src/index.ts') } },
      build: {
        rollupOptions: {
          external: ['original-fs'],
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
            'note-mcp': resolve(__dirname, 'src/main/plugins/note-mcp-launcher.ts'),
            'plugin-mcp': resolve(__dirname, 'src/main/plugins/plugin-mcp-entry.ts'),
            'office-mcp': resolve(__dirname, 'src/main/office/office-mcp.ts'),
            'office-launcher': resolve(__dirname, 'src/main/office/office-launcher.ts')
          }
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin(), {
        name: 'sandboxed-remote-preload',
        buildStart() { this.addWatchFile(resolve(__dirname, 'src/preload/remote.ts')) },
        async generateBundle() {
          const path = resolve(__dirname, 'src/preload/remote.ts')
          const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { format: 'cjs', target: 'es2022' })
          this.emitFile({ type: 'asset', fileName: 'remote.cjs', source: code })
          const pluginPath = resolve(__dirname, 'src/preload/plugin.ts')
          this.addWatchFile(pluginPath)
          const plugin = await transformWithEsbuild(readFileSync(pluginPath, 'utf8'), pluginPath, { format: 'cjs', target: 'es2022' })
          this.emitFile({ type: 'asset', fileName: 'plugin.cjs', source: plugin.code })
        }
      }],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/preload/index.ts')
          }
        }
      }
    },
    renderer: {
      define: remoteDefine,
      server: {
        host: '127.0.0.1',
        port: rendererPort,
        strictPort: false
      },
      resolve: {
        alias: {
          '@janusx/plugin-sdk/native': resolve(__dirname, 'packages/plugin-sdk/src/native.ts'), '@janusx/plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
          '@': resolve(__dirname, 'src/renderer/src')
        }
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            'remote-host': resolve(__dirname, 'src/renderer/remote-host.html')
          }
        }
      }
    }
  }
})
