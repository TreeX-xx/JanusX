/**
 * src/main/project/config/project-config.ts
 * 项目配置读写和管理的核心实现
 */

import { readFile, mkdir } from 'node:fs/promises'
// Note: .agents/notes/desktop/workspace-state-storage.md
import { workspaceIo, writeIoFile, resolveWorkspaceStorage, useWorkspaceStorage as acquireWorkspaceStorage } from '@janus-agent/agent-core'
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { LaunchConfig, LaunchConfiguration, ValidationResult } from '../types'
import { ProjectType } from '../types'

const CONFIG_VERSION = '0.1.0'

export class ProjectConfig {
  /**
   * 读取项目的启动配置
   * @param projectPath 项目根目录
   * @returns 启动配置，若不存在则返回 null
   */
  static async read(projectPath: string): Promise<LaunchConfig | null> {
    return workspaceIo.run(projectPath, async () => {
      const release = acquireWorkspaceStorage(projectPath)
      try {
        const { launchPath: configPath } = await resolveWorkspaceStorage(projectPath)

        if (!existsSync(configPath)) {
          return null
        }

        try {
          const content = await readFile(configPath, 'utf-8')
          const config = JSON.parse(content) as LaunchConfig

          return config
        } catch (error) {
          throw new Error(`Failed to read config from ${configPath}: ${error}`)
        }
      } finally { release() }
    })
  }

  /**
   * 写入项目的启动配置
   * @param projectPath 项目根目录
   * @param config 启动配置
   */
  static async write(projectPath: string, config: LaunchConfig): Promise<void> {
    return workspaceIo.run(projectPath, async () => {
      const release = acquireWorkspaceStorage(projectPath)
      try {
        const { launchPath: configPath } = await resolveWorkspaceStorage(projectPath, true)

        // Ensure the host-resolved configuration directory exists.
        const configDir = dirname(configPath)
        await mkdir(configDir, { recursive: true })

        // 添加元数据
        config.metadata = {
          autoDetected: config.metadata?.autoDetected ?? false,
          lastModified: new Date().toISOString(),
        }

        try {
          const content = JSON.stringify(config, null, 2)
          await writeIoFile(projectPath, configPath, [content], true)
        } catch (error) {
          throw new Error(`Failed to write config to ${configPath}: ${error}`)
        }
      } finally { release() }
    })
  }

  /**
   * 创建默认配置
   * @param projectPath 项目根目录（保留用于公开 API 位置兼容）
   * @param projectType 项目类型
   * @param projectName 项目名称
   */
  static createDefault(...args: [projectPath: string, projectType: ProjectType, projectName: string]): LaunchConfig {
    const [, projectType, projectName] = args
    const defaultConfig = this.getDefaultConfigForType(projectType)

    return {
      version: CONFIG_VERSION,
      projectType,
      projectName,
      configurations: [defaultConfig],
      metadata: {
        lastModified: new Date().toISOString(),
        autoDetected: true,
      },
    }
  }

  /**
   * 获取指定项目类型的默认配置
   */
  private static getDefaultConfigForType(type: ProjectType): LaunchConfiguration {
    const baseConfig: LaunchConfiguration = {
      name: 'dev',
      type,
      request: 'launch',
    }

    // 根据项目类型补充默认配置
    switch (type) {
      case ProjectType.NextJs:
      case ProjectType.Vite:
      case ProjectType.ElectronVite:
        return {
          ...baseConfig,
          packageManager: 'npm',
          port: 5173,
          env: { NODE_ENV: 'development' },
        }

      case ProjectType.Rust:
        return {
          ...baseConfig,
          buildType: 'Debug',
        }

      case ProjectType.CppCMake:
        return {
          ...baseConfig,
          buildDir: '${workspaceFolder}/build',
          buildType: 'Debug',
          compiler: 'auto',
        }

      case ProjectType.Django:
        return {
          ...baseConfig,
          pythonPath: 'python',
          port: 8000,
          env: { DJANGO_SETTINGS_MODULE: 'settings' },
        }

      default:
        return baseConfig
    }
  }

  /**
   * 验证配置的合法性
   */
  static validate(config: LaunchConfig): ValidationResult {
    const errors = []
    const warnings = []

    // 检查版本
    if (config.version !== CONFIG_VERSION) {
      warnings.push({
        field: 'version',
        message: `Config version ${config.version} may not be fully compatible with ${CONFIG_VERSION}`,
      })
    }

    // 检查项目类型
    if (!Object.values(ProjectType).includes(config.projectType)) {
      errors.push({
        field: 'projectType',
        message: `Invalid project type: ${config.projectType}`,
      })
    }

    // 检查配置数组
    if (!Array.isArray(config.configurations) || config.configurations.length === 0) {
      errors.push({
        field: 'configurations',
        message: 'At least one configuration is required',
      })
    } else {
      config.configurations.forEach((cfg, index) => {
        const cfgErrors = this.validateConfiguration(cfg)
        cfgErrors.forEach(err => {
          errors.push({
            ...err,
            field: `configurations[${index}].${err.field}`,
          })
        })
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * 验证单个配置对象
   */
  private static validateConfiguration(config: LaunchConfiguration): Array<{
    field: string
    message: string
  }> {
    const errors = []

    if (!config.name) {
      errors.push({
        field: 'name',
        message: 'Configuration name is required',
      })
    }

    if (!config.type) {
      errors.push({
        field: 'type',
        message: 'Configuration type is required',
      })
    }

    if (config.script && !/^[\w:.-]+$/.test(config.script)) {
      errors.push({ field: 'script', message: 'Package script name contains unsupported characters' })
    }

    // 类型特化验证
    if (config.type === ProjectType.CppCMake) {
      if (!config.buildDir) {
        errors.push({
          field: 'buildDir',
          message: 'Build directory is required for C++ CMake projects',
        })
      }
    }
    if (config.type === ProjectType.Custom && !config.program) {
      errors.push({
        field: 'program',
        message: 'Program is required for custom configurations',
      })
    }

    return errors
  }

  /**
   * 合并配置（用于覆盖默认值）
   */
  static merge(baseConfig: LaunchConfig, overrides: Partial<LaunchConfig>): LaunchConfig {
    return {
      ...baseConfig,
      ...overrides,
      configurations: overrides.configurations || baseConfig.configurations,
    }
  }

  /**
   * 获取指定名称的配置
   */
  static getConfiguration(
    config: LaunchConfig,
    name: string,
  ): LaunchConfiguration | undefined {
    return config.configurations.find(cfg => cfg.name === name)
  }

  /**
   * 添加或更新配置
   */
  static upsertConfiguration(
    config: LaunchConfig,
    newConfig: LaunchConfiguration,
  ): LaunchConfig {
    const index = config.configurations.findIndex(cfg => cfg.name === newConfig.name)

    if (index >= 0) {
      config.configurations[index] = newConfig
    } else {
      config.configurations.push(newConfig)
    }

    return config
  }

  /**
   * 删除配置
   */
  static removeConfiguration(config: LaunchConfig, name: string): LaunchConfig {
    config.configurations = config.configurations.filter(cfg => cfg.name !== name)
    return config
  }

  /**
   * 检查配置文件是否存在
   */
  static async exists(projectPath: string): Promise<boolean> {
    return existsSync((await resolveWorkspaceStorage(projectPath)).launchPath)
  }

  /**
   * 获取配置文件的完整路径
   */
  static async getConfigPath(projectPath: string): Promise<string> {
    return (await resolveWorkspaceStorage(projectPath)).launchPath
  }

  /**
   * 导出配置为 JSON 字符串（格式化）
   */
  static stringify(config: LaunchConfig, pretty = true): string {
    return JSON.stringify(config, null, pretty ? 2 : 0)
  }

  /**
   * 从 JSON 字符串导入配置
   */
  static parse(jsonString: string): LaunchConfig {
    try {
      return JSON.parse(jsonString) as LaunchConfig
    } catch (error) {
      throw new Error(`Invalid JSON: ${error}`)
    }
  }
}

export default ProjectConfig
