import type { ExternalCliToolId, OpenCodeChannel } from '../../shared/ipc/external-cli'

// Official v2 installation: https://github.com/anomalyco/opencode/blob/dev/README.md
export const OPENCODE_PACKAGES: Record<OpenCodeChannel, string> = { v1: 'opencode-ai', v2: '@opencode/cli' }

export interface ExternalCliToolDescriptor {
  id: ExternalCliToolId
  displayName: string
  /** PATH 与已知位置中查找的可执行文件名（win32 含 .cmd/.exe 变体）。 */
  binaryNames: readonly string[]
  /** npm 分发包名；不走 npm 的工具为空。 */
  npmPackage?: string
  /** 手动安装命令或指引（展示与复制用，静默执行侧按平台重算）。 */
  manualInstallCommand: string
  latestStrategy: 'npm-dist-tags' | 'local-source'
  /** 各工具原生安装器遗留的额外目录（win32），与 npm 全局目录并列探测。 */
  extraKnownDirs?: {
    win32?: readonly string[]
  }
  /**
   * 自有 sibling 源码的构建＋全局 link 生命周期（janus 开发回退）。
   * 有源码时静默执行更新；无源码时回退到 npmPackage 安装。
   */
  localLifecycle?: {
    /** sibling 仓库下包目录名，如 'cli'。 */
    packageDirName: string
    /** 校验用包名，如 '@janus-agent/cli'。 */
    packageName: string
  }
}

function npmInstallCommand(npmPackage: string): string {
  return `npm i -g ${npmPackage}@latest`
}

/**
 * 工具声明单表：展示名、包名、安装命令、最新版策略收敛在一处，
 * 前后端不再各维护一份映射（上游三张小表拼凑的教训）。
 */
export const EXTERNAL_CLI_TOOLS: Record<ExternalCliToolId, ExternalCliToolDescriptor> = {
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    binaryNames: ['claude'],
    npmPackage: '@anthropic-ai/claude-code',
    manualInstallCommand: npmInstallCommand('@anthropic-ai/claude-code'),
    latestStrategy: 'npm-dist-tags',
    extraKnownDirs: {
      // 原生安装器位置（上游 build_tool_search_paths 同源）。
      win32: ['%LOCALAPPDATA%\\Programs\\claude'],
    },
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    binaryNames: ['codex'],
    npmPackage: '@openai/codex',
    manualInstallCommand: npmInstallCommand('@openai/codex'),
    latestStrategy: 'npm-dist-tags',
    extraKnownDirs: {
      win32: ['%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin'],
    },
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    binaryNames: ['opencode'],
    // New installs use v2; the service keeps existing v1 installs on opencode-ai.
    npmPackage: OPENCODE_PACKAGES.v2,
    manualInstallCommand: npmInstallCommand(OPENCODE_PACKAGES.v2),
    latestStrategy: 'npm-dist-tags',
  },
  pi: {
    id: 'pi',
    displayName: 'Pi Agent',
    binaryNames: ['pi'],
    npmPackage: '@earendil-works/pi-coding-agent',
    manualInstallCommand: npmInstallCommand('@earendil-works/pi-coding-agent'),
    latestStrategy: 'npm-dist-tags',
  },
  janus: {
    id: 'janus',
    displayName: 'Janus',
    binaryNames: ['janus'],
    npmPackage: '@janus-agent/cli',
    manualInstallCommand: npmInstallCommand('@janus-agent/cli'),
    latestStrategy: 'npm-dist-tags',
    localLifecycle: {
      packageDirName: 'cli',
      packageName: '@janus-agent/cli',
    },
  },
  dsh: {
    id: 'dsh',
    displayName: 'DeepSeek Harness',
    binaryNames: ['dsh'],
    npmPackage: '@deepseek-ai/dsh',
    // 上游 TUI 安装口径（ccch1mneyyy/dsh-TUI README）：dsh 与 TUI 启动器一起装全局，
    // 首次运行 `dsh-tui` 自动初始化 dsh-tui profile；终端启动命令见 shared/terminalLaunch。
    manualInstallCommand: 'npm i -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui && dsh-tui',
    latestStrategy: 'npm-dist-tags',
  },
}

export function getExternalCliTool(toolId: string): ExternalCliToolDescriptor | undefined {
  if (toolId !== 'claude' && toolId !== 'codex' && toolId !== 'opencode' && toolId !== 'pi' && toolId !== 'janus' && toolId !== 'dsh') return undefined
  return EXTERNAL_CLI_TOOLS[toolId]
}
