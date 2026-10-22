import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'

export default defineConfig(({ command }) => {
  const remoteScope = process.env.JANUSX_REMOTE_SCOPE || (command === 'serve' ? 'develop' : 'lan')
  if (!['lan', 'develop'].includes(remoteScope)) throw Error('JANUSX_REMOTE_SCOPE must be lan or develop')
  const remoteDefine = { __JANUSX_REMOTE_SCOPE__: JSON.stringify(remoteScope) }
  return {
    main: {
      define: remoteDefine,
      plugins: [externalizeDepsPlugin({
        exclude: ['@janusx/llm-core', '@janusx/llm-core/model-registry', '@janusx/plugin-sdk', 'proxy-chain']
      })],
      resolve: { alias: { '@janusx/plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src/index.ts') } },
      build: {
        rollupOptions: {
          external: ['original-fs'],
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
            'note-mcp': resolve(__dirname, 'src/main/blueprint/note-mcp.ts'),
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
        // 5173 常被 Windows winnat/Hyper-V/WSL2 保留（netsh excludedportrange），会报 EACCES，改用实测空闲的 5799
        port: Number(process.env.ELECTRON_VITE_PORT) || 5799,
        strictPort: false
      },
      resolve: {
        alias: {
          '@janusx/plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
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
