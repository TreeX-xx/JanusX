/**
 * @file 代理管理工具
 * @description 自动检测和设置全局代理
 * @module @janusx/llm-core/proxy
 */

// Note: fetch compatibility and explicit routing — see .agents/notes/workbench/service-integrations.md
import { macProxyEnvironment } from './mac-system-proxy'
import http from 'node:http'
import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

interface ProxyLogger {
  error?: (message: string, ...data: any[]) => void
  warn?: (message: string, ...data: any[]) => void
  info?: (message: string, ...data: any[]) => void
}

/**
 * 从 Windows 注册表读取系统代理设置
 */
function getWindowsSystemProxy(): string | null {
  try {
    const { execSync } = require('child_process')
    const result = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
      { encoding: 'utf-8', timeout: 5000 }
    )

    // 检查代理是否启用
    if (!result.includes('0x1')) {
      return null
    }

    // 读取代理服务器地址
    const proxyResult = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: 'utf-8', timeout: 5000 }
    )

    const match = proxyResult.match(/ProxyServer\s+REG_SZ\s+(.+)/)
    if (match) {
      const proxy = match[1].trim()
      // 如果没有协议前缀，添加 http://
      if (!proxy.startsWith('http://') && !proxy.startsWith('https://') && !proxy.startsWith('socks')) {
        return `http://${proxy}`
      }
      return proxy
    }
  } catch {
    // 忽略错误
  }
  return null
}

/**
 * 获取系统代理配置
 * 优先使用显式环境，再检查系统静态代理
 */
export function getSystemProxy(env = macProxyEnvironment(process.env)): string | null {
  // 1. 检查环境变量
  const proxyKeys = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]

  for (const key of proxyKeys) {
    const value = env[key]
    if (value && value.trim()) {
      return value.trim()
    }
  }

  // 2. 检查 Windows 系统代理
  if (process.platform === 'win32') {
    const windowsProxy = getWindowsSystemProxy()
    if (windowsProxy) {
      return windowsProxy
    }
  }

  return null
}

/**
 * 代理管理器
 * 全局劫持 Node.js 的 HTTP/HTTPS 模块和 undici 的 fetch
 */
export class ProxyManager {
  private proxyAgent: HttpsProxyAgent<string> | null = null
  private currentProxy: string | null = null
  private logger: ProxyLogger

  // 保存原始方法
  private originalHttpGet: typeof http.get
  private originalHttpRequest: typeof http.request
  private originalHttpsGet: typeof https.get
  private originalHttpsRequest: typeof https.request

  constructor(logger?: ProxyLogger) {
    this.logger = logger || {}
    this.originalHttpGet = http.get
    this.originalHttpRequest = http.request
    this.originalHttpsGet = https.get
    this.originalHttpsRequest = https.request
  }

  /**
   * 配置代理
   * @param proxyUrl 代理地址，如 http://127.0.0.1:7890，传空则禁用代理
   */
  configure(proxyUrl?: string | null): void {
    const normalizedUrl = proxyUrl?.trim() || null

    // 如果代理地址没变，跳过
    if (normalizedUrl === this.currentProxy) {
      return
    }

    // 清除旧的代理
    this.cleanup()

    if (!normalizedUrl) {
      this.logger.info?.('[ProxyManager] 代理已禁用')
      this.currentProxy = null
      return
    }

    try {
      // 创建代理 Agent
      this.proxyAgent = new HttpsProxyAgent(normalizedUrl)
      this.currentProxy = normalizedUrl

      process.env.HTTP_PROXY = normalizedUrl
      process.env.HTTPS_PROXY = normalizedUrl
      process.env.http_proxy = normalizedUrl
      process.env.https_proxy = normalizedUrl

      // 设置环境变量
      // 劫持 HTTP/HTTPS 模块
      this.hookHttpMethods()

      // 劫持 undici 的 fetch（Node.js 18+ 内置的 fetch）
      this.hookUndiciFetch()

      this.logger.info?.(`[ProxyManager] 代理已启用: ${normalizedUrl}`)
    } catch (error) {
      this.logger.error?.('[ProxyManager] 设置代理失败:', error)
      this.currentProxy = null
    }
  }

  /**
   * 自动检测并配置代理
   */
  autoDetect(): void {
    // The global agent forces one route for every host. Keep native macOS
    // settings in the per-launch environment so system bypass rules survive.
    const proxy = getSystemProxy(process.env)
    if (proxy) {
      this.logger.info?.(`[ProxyManager] 检测到系统代理: ${proxy}`)
    } else {
      this.logger.info?.('[ProxyManager] 未检测到系统代理')
    }
    this.configure(proxy)
  }

  /**
   * 获取当前代理 Agent（用于传递给 google-auth-library）
   */
  getAgent(): HttpsProxyAgent<string> | undefined {
    return this.proxyAgent || undefined
  }

  /**
   * 获取当前代理地址
   */
  getProxyUrl(): string | null {
    return this.currentProxy
  }

  /**
   * 是否启用了代理
   */
  isEnabled(): boolean {
    return this.proxyAgent !== null
  }

  /**
   * 劫持 HTTP/HTTPS 模块方法
   */
  private hookHttpMethods(): void {
    const agent = this.proxyAgent!

    http.get = this.createHookedMethod(this.originalHttpGet, agent) as any
    http.request = this.createHookedMethod(this.originalHttpRequest, agent) as any
    https.get = this.createHookedMethod(this.originalHttpsGet, agent) as any
    https.request = this.createHookedMethod(this.originalHttpsRequest, agent) as any
  }

  /**
   * 劫持 undici 的 fetch（Node.js 18+ 内置的 fetch）
   */
  private hookUndiciFetch(): void {
    try {
      // 设置 undici 的全局代理（读取环境变量）
      const agent = new EnvHttpProxyAgent()
      setGlobalDispatcher(agent)
      this.logger.info?.('[ProxyManager] undici fetch 代理已设置')
    } catch (error) {
      this.logger.warn?.('[ProxyManager] 设置 undici fetch 代理失败:', error)
    }
  }

  /**
   * 创建劫持后的方法
   */
  private createHookedMethod(originalMethod: Function, agent: HttpsProxyAgent<string>) {
    return (...args: any[]) => {
      let url: string | URL | undefined
      let options: any
      let callback: ((res: any) => void) | undefined

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = args[0]
        if (typeof args[1] === 'function') {
          options = {}
          callback = args[1]
        } else {
          options = { ...args[1] }
          callback = args[2]
        }
      } else {
        options = { ...args[0] }
        callback = args[1]
      }

      // 设置代理 Agent
      // Explicit agents own their routing (e.g. a local proxy's selected upstream).
      // Overwriting them can proxy the proxy connection a second time.
      if (options.agent === undefined) options.agent = agent

      if (url) {
        return originalMethod(url, options, callback)
      }
      return originalMethod(options, callback)
    }
  }

  /**
   * 清理：恢复原始方法
   */
  private cleanup(): void {
    http.get = this.originalHttpGet
    http.request = this.originalHttpRequest
    https.get = this.originalHttpsGet
    https.request = this.originalHttpsRequest

    if (this.proxyAgent) {
      try {
        this.proxyAgent.destroy()
      } catch {
        // ignore
      }
      this.proxyAgent = null
    }

    // 清除环境变量
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
  }

  /**
   * 销毁管理器，恢复原始状态
   */
  dispose(): void {
    this.cleanup()
    this.currentProxy = null
    this.logger.info?.('[ProxyManager] 已销毁，恢复原始状态')
  }
}

// 全局单例
let globalProxyManager: ProxyManager | null = null

/**
 * 获取全局代理管理器实例
 */
export function getProxyManager(logger?: ProxyLogger): ProxyManager {
  if (!globalProxyManager) {
    globalProxyManager = new ProxyManager(logger)
  }
  return globalProxyManager
}
