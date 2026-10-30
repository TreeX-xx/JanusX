/**
 * src/main/project/detector/detector.ts
 *
 * 项目类型自动检测模块
 * 职责：
 * 1. 扫描项目目录，检测特征文件
 * 2. 识别项目类型和相关配置
 * 3. 返回检测结果和推荐配置
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DetectResult, LaunchConfiguration } from '../types'
import { ProjectType } from '../types'
import { detectByFeatures, getProjectSchema } from '../config/project-schemas'
import ProjectConfig from '../config/project-config'

export interface DetectionContext {
  projectPath: string
  files: string[]
  hasConfig: boolean
}

/**
 * ProjectDetector - 项目类型自动检测
 *
 * 设计目标：
 * - 高效扫描，最小化文件系统操作
 * - 清晰的检测逻辑，易于添加新项目类型
 * - 详细的检测信息，支持用户选择
 */
export class ProjectDetector {
  /**
   * 检测项目类型
   *
   * 流程：
   * 1. 扫描项目根目录文件
   * 2. 使用 schema 的特征文件进行匹配
   * 3. 返回最可能的项目类型
   *
   * @param projectPath 项目根目录
   * @returns 检测到的项目类型
   */
  static async detect(projectPath: string): Promise<ProjectType> {
    const context = this.createContext(projectPath)
    const candidates = detectByFeatures(context.files)

    return candidates.length > 0 ? candidates[0] : ProjectType.Unknown
  }

  /**
   * 详细检测 - 返回检测结果、置信度、推荐配置
   *
   * 这是对外的主要接口，提供完整的检测信息
   *
   * @param projectPath 项目根目录
   * @returns 详细的检测结果
   */
  static async detectWithDetails(projectPath: string): Promise<DetectResult> {
    const context = this.createContext(projectPath)
    context.hasConfig = await ProjectConfig.exists(projectPath)
    const candidates = detectByFeatures(context.files)
    const detectedType = candidates.length > 0 ? candidates[0] : ProjectType.Unknown

    const confidence = this.calculateConfidence(detectedType, context)

    return {
      type: detectedType,
      confidence,
      detectedFeatures: this.getDetectedFeatures(detectedType, context),
      recommendedConfig: this.buildRecommendedConfig(detectedType, projectPath, context),
      availableScripts: this.readPackageScripts(projectPath),
    }
  }

  /**
   * 判断指定项目类型是否可能
   * 用于用户手动选择时的验证
   */
  static isProjectType(projectPath: string, type: ProjectType): boolean {
    const context = this.createContext(projectPath)
    const schema = getProjectSchema(type)

    if (schema.featureFiles.length === 0) {
      return type === ProjectType.Custom || type === ProjectType.Unknown
    }

    return schema.featureFiles.some(feature =>
      context.files.some(file => file.includes(feature))
    )
  }

  /**
   * ════════════════════════════════════════════
   * 私有工具方法
   * ════════════════════════════════════════════
   */

  /**
   * 创建检测上下文
   * 缓存文件列表，避免重复扫描
   */
  private static createContext(projectPath: string): DetectionContext {
    try {
      const files = readdirSync(projectPath)

      return {
        projectPath: resolve(projectPath),
        files,
        hasConfig: false,
      }
    } catch (error) {
      throw new Error(`Failed to read directory ${projectPath}: ${error}`)
    }
  }

  /**
   * 计算检测置信度
   * 基于特征文件的匹配程度
   */
  private static calculateConfidence(type: ProjectType, context: DetectionContext): number {
    if (type === ProjectType.Unknown || type === ProjectType.Custom) {
      return 0.3
    }

    const schema = getProjectSchema(type)
    const matchCount = schema.featureFiles.filter(feature =>
      context.files.some(file => file.includes(feature))
    ).length

    const maxMatches = schema.featureFiles.length
    return maxMatches > 0 ? Math.min(matchCount / maxMatches, 0.95) : 0.5
  }

  /**
   * 获取检测到的特征文件列表
   */
  private static getDetectedFeatures(type: ProjectType, context: DetectionContext): string[] {
    const schema = getProjectSchema(type)

    return schema.featureFiles.filter(feature =>
      context.files.some(file => file.includes(feature))
    )
  }

  /**
   * 为检测到的项目类型构建推荐配置
   * 这个配置将作为默认值显示给用户
   */
  private static buildRecommendedConfig(
    type: ProjectType,
    projectPath: string,
    context: DetectionContext,
  ): LaunchConfiguration {
    const baseName = projectPath.split(/[/\\]/).pop() || 'app'

    const baseConfig: LaunchConfiguration = {
      name: 'dev',
      type,
      request: 'launch',
      program: projectPath,
    }

    // 根据项目类型补充特化的推荐配置
    switch (type) {
      case ProjectType.NextJs:
      case ProjectType.Vite:
      case ProjectType.ElectronVite:
      case ProjectType.CreateReactApp:
      case ProjectType.Remix:
        return {
          ...baseConfig,
          packageManager: this.detectPackageManager(context),
          port: this.getDefaultPort(type),
          env: { NODE_ENV: 'development' },
        }

      case ProjectType.Rust:
        return {
          ...baseConfig,
          buildType: 'Debug',
          args: [],
        }

      case ProjectType.CppCMake:
      case ProjectType.CppMake:
        return {
          ...baseConfig,
          buildDir: '${workspaceFolder}/build',
          buildType: 'Debug',
          compiler: 'auto',
          target: baseName,
        }

      case ProjectType.Go:
        return {
          ...baseConfig,
          mainPackage: '.',
          args: [],
        }

      case ProjectType.Django:
        return {
          ...baseConfig,
          pythonPath: 'python',
          port: 8000,
          env: { DJANGO_SETTINGS_MODULE: 'settings' },
        }

      case ProjectType.Flask:
      case ProjectType.FastAPI:
        return {
          ...baseConfig,
          pythonPath: 'python',
          port: 5000,
          env: { FLASK_ENV: 'development', FLASK_DEBUG: '1' },
        }

      case ProjectType.Laravel:
        return {
          ...baseConfig,
          port: 8000,
        }

      default:
        return baseConfig
    }
  }

  /**
   * 检测 Node.js 项目的包管理器
   * 优先级：pnpm > yarn > bun > npm
   */
  private static detectPackageManager(context: DetectionContext): 'npm' | 'pnpm' | 'yarn' | 'bun' {
    if (context.files.includes('pnpm-lock.yaml')) return 'pnpm'
    if (context.files.includes('yarn.lock')) return 'yarn'
    if (context.files.includes('bun.lockb')) return 'bun'
    return 'npm'
  }

  private static readPackageScripts(projectPath: string): string[] {
    const packagePath = join(projectPath, 'package.json')
    if (!existsSync(packagePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as { scripts?: unknown }
      if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return []
      return Object.keys(parsed.scripts).filter((name) => /^[\w:.-]+$/.test(name)).sort()
    } catch {
      return []
    }
  }

  /**
   * 获取项目类型的默认端口
   */
  private static getDefaultPort(type: ProjectType): number {
    const ports: Record<ProjectType, number> = {
      [ProjectType.NextJs]: 3000,
      [ProjectType.Vite]: 5173,
      [ProjectType.ElectronVite]: 5173,
      [ProjectType.CreateReactApp]: 3000,
      [ProjectType.Remix]: 3000,
      [ProjectType.Django]: 8000,
      [ProjectType.Flask]: 5000,
      [ProjectType.Laravel]: 8000,
      // 其他类型不使用默认端口
      [ProjectType.Rust]: 0,
      [ProjectType.Go]: 0,
      [ProjectType.CppCMake]: 0,
      [ProjectType.CppMake]: 0,
      [ProjectType.FastAPI]: 8000,
      [ProjectType.Unknown]: 0,
      [ProjectType.Custom]: 0,
    }
    return ports[type] || 0
  }

}

export default ProjectDetector
