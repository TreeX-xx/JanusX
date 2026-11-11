/**
 * @file 配置加载器
 * @description 加载和管理 Provider 元数据配置
 * @module @janusx/llm-core/loader
 */

import { ConfigLoadError } from '../utils/errors'
import providersData from './providers.json' with { type: 'json' }

/* ════════════════════════════════════════════════════════════
   配置数据类型
   ════════════════════════════════════════════════════════════ */

/**
 * Provider 元数据配置
 */
export interface ProviderMetadata {
  id: string
  name: string
  description: string
  authType: string
  defaultEndpoint?: string
  capabilities: string[]
  configSchema: Record<string, unknown>
  supportedAdapters?: string[]
  supportedModels?: string[]
  documentation?: {
    setup?: string
    authentication?: string
    models?: string
  }
}

/**
 * Providers 配置文件结构
 */
export interface ProvidersConfig {
  version: string
  providers: ProviderMetadata[]
}

/* ════════════════════════════════════════════════════════════
   配置加载器
   ════════════════════════════════════════════════════════════ */

/**
 * 配置加载器类
 *
 * @description
 * 职责：
 * 1. 加载 providers.json
 * 2. 查询 Provider 元数据
 * 3. 支持热更新（未来扩展）
 */
export class ConfigLoader {
  private config: ProvidersConfig
  private static instance: ConfigLoader | null = null

  /**
   * 获取全局单例实例
   */
  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader()
    }
    return ConfigLoader.instance
  }

  /**
   * 私有构造函数
   */
  private constructor() {
    this.config = providersData as ProvidersConfig
  }

  /**
   * 获取所有 Provider 元数据
   */
  getAllProviderMetadata(): ProviderMetadata[] {
    return this.config.providers
  }

  /**
   * 根据 ID 获取 Provider 元数据
   * @param providerId Provider ID
   * @returns Provider 元数据或 undefined
   */
  getProviderMetadata(providerId: string): ProviderMetadata | undefined {
    return this.config.providers.find(p => p.id === providerId)
  }

  /**
   * 根据认证类型筛选 Provider 元数据
   * @param authType 认证类型
   */
  filterByAuthType(authType: string): ProviderMetadata[] {
    return this.config.providers.filter(p => p.authType === authType)
  }

  /**
   * 根据能力筛选 Provider 元数据
   * @param capability 能力名称
   */
  filterByCapability(capability: string): ProviderMetadata[] {
    return this.config.providers.filter(p => p.capabilities.includes(capability))
  }

  /**
   * 获取配置版本
   */
  getVersion(): string {
    return this.config.version
  }

  /**
   * 从外部 JSON 文件重新加载配置（热更新）
   * @param jsonPath JSON 文件路径
   */
  async reloadFromFile(jsonPath: string): Promise<void> {
    try {
      // Node.js 环境
      if (typeof require !== 'undefined') {
        // 清除 require 缓存
        delete require.cache[require.resolve(jsonPath)]
        const newConfig = require(jsonPath) as ProvidersConfig
        this.config = newConfig
      } else {
        // 浏览器环境或 ES Module
        const response = await fetch(jsonPath)
        const newConfig = (await response.json()) as ProvidersConfig
        this.config = newConfig
      }
    } catch (error) {
      throw new ConfigLoadError(jsonPath, error as Error)
    }
  }

  /**
   * 验证 Provider 元数据完整性
   * @param metadata Provider 元数据
   */
  validateMetadata(metadata: ProviderMetadata): { valid: boolean; errors?: string[] } {
    const errors: string[] = []

    if (!metadata.id) errors.push('缺少 id 字段')
    if (!metadata.name) errors.push('缺少 name 字段')
    if (!metadata.authType) errors.push('缺少 authType 字段')
    if (!metadata.capabilities || metadata.capabilities.length === 0) {
      errors.push('缺少 capabilities 字段')
    }
    if (!metadata.configSchema) errors.push('缺少 configSchema 字段')

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    }
  }
}

/* ════════════════════════════════════════════════════════════
   便捷导出
   ════════════════════════════════════════════════════════════ */

/**
 * 获取全局配置加载器实例
 */
export function getConfigLoader(): ConfigLoader {
  return ConfigLoader.getInstance()
}

/**
 * 获取所有 Provider 元数据
 */
export function getAllProviderMetadata(): ProviderMetadata[] {
  return getConfigLoader().getAllProviderMetadata()
}

/**
 * 获取指定 Provider 元数据
 */
export function getProviderMetadata(providerId: string): ProviderMetadata | undefined {
  return getConfigLoader().getProviderMetadata(providerId)
}
