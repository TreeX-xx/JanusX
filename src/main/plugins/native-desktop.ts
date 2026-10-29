// Note: .agents/notes/workbench/service-integrations.md — trusted native desktop services.
import { app, clipboard, safeStorage, shell } from 'electron'
import { join, relative, resolve, isAbsolute } from 'node:path'
import type { JsonValue, NativeHandler } from '@janusx/plugin-sdk'
import { NativeServiceError } from '@janusx/plugin-sdk'
import type { InstalledPlugin } from '../../shared/ipc/plugins'
import { configService } from '../config/service'
import { HostProxy, hostProxyEnvironment } from '../lib/host-proxy'
import type { PluginRuntime } from './runtime'
import type { NativePluginService } from './native-service'
import { ContainerTerminals } from './container-terminals'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Only an already verified, explicitly authorized native process can call this adapter. */
export class NativeDesktop {
  private relay = new HostProxy()
  private proxy?: Promise<string>
  private disposed = false
  private terminals?: ContainerTerminals
  constructor(private record: InstalledPlugin, private runtime: () => PluginRuntime,
    private native: () => NativePluginService, private openBrowser?: (url: string) => void) {}
  private encryption(): void {
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      throw new NativeServiceError('ENCRYPTION_UNAVAILABLE')
    }
  }
  call: NativeHandler = async (method, value) => {
    if (this.disposed) throw new NativeServiceError('SERVICE_STOPPED')
    if (!this.record.manifest.capabilities.required.includes('desktop.native')) throw new NativeServiceError('PERMISSION_DENIED')
    const input = (value ?? {}) as Record<string, JsonValue>
    if ((method.startsWith('desktop.terminal.') || ['desktop.service.open', 'desktop.docker.open'].includes(method))
      && !this.record.manifest.capabilities.required.includes('desktop.containers')) throw new NativeServiceError('PERMISSION_DENIED')
    if (method === 'desktop.terminal.end') { this.terminals?.close(String(input.id)); return null }
    if (method.startsWith('desktop.terminal.')) {
      if (typeof input.owner !== 'string') throw new NativeServiceError('INVALID_REQUEST')
      this.runtime().assertNativeOwner(this.record.manifest.id, input.owner)
      const terminals = this.terminals ??= new ContainerTerminals()
      const id = String(input.id ?? '')
      if (method === 'desktop.terminal.open') return terminals.open(input.request) as unknown as JsonValue
      if (method === 'desktop.terminal.read') return terminals.read(id, Number(input.cursor) || 0) as unknown as JsonValue
      if (method === 'desktop.terminal.write') { terminals.write(id, String(input.data ?? '')); return null }
      if (method === 'desktop.terminal.resize') { terminals.resize(id, Number(input.cols), Number(input.rows)); return null }
      if (method === 'desktop.terminal.close') { terminals.close(id); return null }
      throw new NativeServiceError('UNKNOWN_METHOD')
    }
    if (method === 'desktop.service.open') {
      const url = new URL(String(input.url))
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || !this.openBrowser) throw new NativeServiceError('INVALID_REQUEST')
      this.openBrowser(url.href); return null
    }
    if (method === 'desktop.docker.open') {
      const file = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Docker/Docker/Docker Desktop.exe')
        : process.platform === 'darwin' ? '/Applications/Docker.app' : ''
      if (!file || !existsSync(file)) throw new NativeServiceError('RESOURCE_UNAVAILABLE')
      if (process.platform === 'darwin') { if (await shell.openPath(file)) throw new NativeServiceError('RESOURCE_UNAVAILABLE') }
      else await new Promise<void>((done, reject) => { const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: true }); child.once('error', reject); child.once('spawn', () => { child.unref(); done() }) })
      return null
    }
    if (method === 'desktop.encryption') { this.encryption(); return null }
    if (method === 'desktop.encrypt') {
      this.encryption()
      if (typeof input.text !== 'string' || input.text.length > 8192) throw new NativeServiceError('INVALID_REQUEST')
      return safeStorage.encryptString(input.text).toString('base64')
    }
    if (method === 'desktop.decrypt') {
      this.encryption()
      if (typeof input.value !== 'string' || input.value.length > 32768) throw new NativeServiceError('INVALID_REQUEST')
      return safeStorage.decryptString(Buffer.from(input.value, 'base64'))
    }
    if (method === 'desktop.clipboard') {
      const limit = this.record.manifest.capabilities.required.includes('desktop.containers') ? 256 * 1024 : 8192
      if (typeof input.text !== 'string' || input.text.length > limit) throw new NativeServiceError('INVALID_REQUEST')
      clipboard.writeText(input.text); return null
    }
    if (method === 'desktop.environment') return hostProxyEnvironment() as JsonValue
    if (method === 'desktop.proxy') {
      const url = await (this.proxy ??= this.relay.start())
      if (this.disposed) throw new NativeServiceError('SERVICE_STOPPED')
      return url
    }
    if (method === 'desktop.legacy') {
      // Fixed migration mapping, never a caller-selected host configuration key or directory.
      if (this.record.manifest.id !== 'official.cpa') return null
      return { settings: (await configService.get()).cpaSettings ?? null,
        directory: join(app.getPath('userData'), 'janusx', 'components', 'cpa') } as JsonValue
    }
    if (method === 'desktop.openPath') {
      if (typeof input.path !== 'string') throw new NativeServiceError('INVALID_REQUEST')
      const root = join(app.getPath('userData'), 'janusx', 'plugins', 'data', this.record.manifest.id, 'native')
      const child = relative(root, resolve(input.path))
      if (!child || child.startsWith('..') || isAbsolute(child)) throw new NativeServiceError('PATH_NOT_GRANTED')
      if (await shell.openPath(resolve(input.path))) throw new NativeServiceError('RESOURCE_UNAVAILABLE')
      return null
    }
    if (method === 'desktop.external') {
      if (typeof input.url !== 'string') throw new NativeServiceError('INVALID_REQUEST')
      const url = new URL(input.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new NativeServiceError('INVALID_REQUEST')
      await shell.openExternal(url.href); return null
    }
    if (method.startsWith('desktop.browser.')) {
      return this.runtime().browserCall(this.record.manifest.id, method, input, (method, input, signal) => this.native().call(method, input, signal))
    }
    throw new NativeServiceError('UNKNOWN_METHOD')
  }
  dispose(): void {
    this.disposed = true
    this.terminals?.dispose()
    this.runtime().closeBrowsers(this.record.manifest.id)
    void this.relay.close()
  }
}
