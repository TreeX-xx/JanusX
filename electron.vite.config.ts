import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { transformWithEsbuild } from 'vite'

/** 5173/5799 等端口会被 Windows winnat/Hyper-V 的 excludedportrange 吞掉（listen EACCES，
 * 且 vite 只对 EADDRINUSE 自动换端口）。保留区随重启漂移，写死端口必然再犯——
 * 启动时真实探测一次可绑端口，ELECTRON_VITE_PORT 仍可显式指定。 */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolveBind) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => resolveBind(false))
    probe.once('listening', () => probe.close(() => resolveBind(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function pickDevPort(): Promise<number> {
  const envPort = Number(process.env.ELECTRON_VITE_PORT)
  if (Number.isFinite(envPort) && envPort > 0) return envPort
  // 候选序：历史默认 5799 → 低段 → 高段；探测失败（占用/系统保留）即换下一个
  const candidates: number[] = [5799]
  for (let p = 4300; p < 4500; p++) candidates.push(p)
  for (let p = 8600; p < 8800; p++) candidates.push(p)
  for (const port of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await canBind(port)) return port
  }
  return 5799
}

export default defineConfig(async ({ command }) => {
  const remoteScope = process.env.JANUSX_REMOTE_SCOPE || (command === 'serve' ? 'develop' : 'lan')
  if (!['lan', 'develop'].includes(remoteScope)) throw Error('JANUSX_REMOTE_SCOPE must be lan or develop')
  const remoteDefine = { __JANUSX_REMOTE_SCOPE__: JSON.stringify(remoteScope) }
  const devPort = command === 'serve' ? await pickDevPort() : 5799
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
        // 5173 常被 Windows winnat/Hyper-V/WSL2 保留（netsh excludedportrange），会报 EACCES；
        // 保留区随重启漂移（5799 亦曾被吞），默认端口改为启动时探测（pickDevPort）。
        port: devPort,
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
