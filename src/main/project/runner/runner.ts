/**
 * src/main/project/runner/runner.ts
 *
 * 项目启动执行模块
 * 职责：
 * 1. 读取启动配置
 * 2. 构造启动命令
 * 3. 启动子进程，管理生命周期
 * 4. 流式输出日志，提取关键信息（端口号等）
 */

import { spawn, spawnSync, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { workspaceIo, writeIoFile, resolveWorkspaceStorage, assertWorkspaceStorageAvailable, useWorkspaceStorage as acquireWorkspaceStorage } from '@janus-agent/agent-core'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { ProjectType, type LaunchConfiguration, type ProcessHandle, type ProjectRunOptions } from '../types'
import ProjectConfig from '../config/project-config'
import CommandBuilder from './command-builder'
import PortExtractor from '../utils/port-extractor'

/**
 * 运行的项目信息
 * 用于跟踪正在运行的进程
 */
interface RunningProject extends ProcessHandle {
  process: ChildProcess
  output: string[]
  outputBuffer: string // 用于缓存未完整的输出行
  eventEmitter: EventEmitter
  terminated: boolean
  /** P4尾巴：仅 adhoc 后台命令有值，退出时落盘，process-output 可读已退出任务。 */
  persistLogPath?: string
  storageRoot?: string
  releaseStorage?: () => void
  /** R3：adhoc 可配超时（毫秒，未设置即无截止，保持 P3 历史行为）；触发后按 stop 语义 SIGTERM→SIGKILL。 */
  timeoutMs?: number
  timeoutTimer?: NodeJS.Timeout
  /** R3：true 表示本次退出由超时触发（手动 stop 不置位），随快照落盘供 process-output 回看。 */
  timedOut?: boolean
  /** 启动失败文本（spawn ENOENT 等只发 error 不发 exit）：随快照与落盘日志透出，避免空日志盲查。 */
  spawnError?: string
  /** 启动时的解析模式，随落盘日志头供诊断（与同步 command.run 同口径）。 */
  executionMode?: 'direct' | 'windows-shell-shim'
}

/**
 * P4尾巴：已退出 adhoc 任务的保留快照（内存 + 磁盘日志），有界保留。
 */
export interface ExitedAdhocProject {
  pid: number
  config: LaunchConfiguration
  startTime: Date
  endTime: Date
  exitCode: number | null
  signal: string | null
  /** R3：true 表示被超时 kill（而非自然退出/手动 stop）。 */
  timedOut: boolean
  output: string[]
  logPath?: string
}

const WINDOWS_SHELL_COMMANDS = new Set(['npm', 'yarn', 'pnpm', 'bun'])
const WINDOWS_SHELL_META = /[&|<>^\r\n]/

// Note: 后台 adhoc 与同步 command.run 共享 shell 判定，启动失败落盘、win32 整树强杀 — see .agents/notes/terminal/adhoc-shell-parity.md

/*-- 不完整行缓冲上限：长期无换行的输出（单行 JSON 流等）保尾截断，防止无界增长（audit M3） --*/
const MAX_OUTPUT_LINE_BUFFER_CHARS = 256 * 1024
const MAX_STORED_OUTPUT_LINE_CHARS = 16 * 1024

export function requiresCommandShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false
  return WINDOWS_SHELL_COMMANDS.has(command.toLowerCase())
    || ['.bat', '.cmd'].includes(extname(command).toLowerCase())
}

/** Shared with the sync command-tools path so both start failures carry the same hint. */
export function spawnHint(program: string): string {
  return `hint: the program '${program}' failed to start (ENOENT reads as a negative exit such as -4058 on Windows).`
    + ` Launch the host from a shell with Node on PATH; package-manager shims resolve through cmd.exe on win32.`
}

/** win32 树杀预清：控制台进程无视优雅终结，taskkill 成败都不影响后续句柄杀流程。 */
export function tryTreeKill(pid: unknown): void {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid)) return
  try {
    const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    spawnSync(`${systemRoot}\\System32\\taskkill.exe`,
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 10_000 })
  } catch {
    // Best effort: the handle-kill flow below covers the miss.
  }
}

/**
 * ProjectRunner - 项目启动和执行
 *
 * 设计目标：
 * - 管理项目进程的完整生命周期
 * - 流式处理日志输出，实时推送
 * - 自动检测关键信息（如服务器端口）
 * - 支持多项目并行运行
 * - 优雅的错误处理和恢复
 */
export class ProjectRunner extends EventEmitter {
  private runningProjects: Map<string, RunningProject> = new Map()
  private readonly exitedAdhoc = new Map<string, ExitedAdhocProject>()
  private maxConcurrent: number = 5
  private activeCount: number = 0

  constructor(maxConcurrent: number = 5) {
    super()
    this.maxConcurrent = maxConcurrent
  }

  /**
   * 启动项目
   *
   * 流程：
   * 1. 读取项目配置（目标目录缺失时可用 inheritFrom 继承主仓模板）
   * 2. 验证配置有效性
   * 3. 等待可用的进程槽位
   * 4. 构造和启动命令
   * 5. 监听输出和事件
   *
   * @param projectPath 项目根目录（worktree 运行时为目标 worktree）
   * @param configName 配置名称（默认 'dev'）
   * @param options 归属盖章 + 配置继承来源（见 ProjectRunOptions）
   * @returns 进程句柄
   */
  async run(projectPath: string, configName: string = 'dev', options: ProjectRunOptions = {}): Promise<ProcessHandle> {
    // 1. 读取配置：目标目录优先；缺失时从 inheritFrom 继承模板（命令仍在 projectPath 执行）
    let config = await ProjectConfig.read(projectPath)
    let configInherited = false
    if (!config && options.inheritFrom && options.inheritFrom !== projectPath) {
      config = await ProjectConfig.read(options.inheritFrom)
      configInherited = config != null
    }
    if (!config) {
      throw new Error(`No configuration found for project at ${projectPath}`)
    }

    const launchConfig = ProjectConfig.getConfiguration(config, configName)
    if (!launchConfig) {
      throw new Error(`Configuration '${configName}' not found`)
    }

    // 2. 验证配置
    const validation = ProjectConfig.validate(config)
    if (!validation.valid) {
      const errors = validation.errors.map(e => e.message).join('; ')
      throw new Error(`Configuration validation failed: ${errors}`)
    }

    // 3. 检查并发限制
    if (this.activeCount >= this.maxConcurrent) {
      throw new Error(
        `Maximum concurrent projects (${this.maxConcurrent}) reached. Stop another project first.`
      )
    }

    // 4. 构造命令
    const commandInfo = CommandBuilder.build(launchConfig)
    if (!commandInfo) {
      throw new Error(`Cannot build command for project type: ${launchConfig.type}`)
    }

    // 5. 启动进程
    const processId = this.generateProcessId(projectPath, configName)
    const configuredCwd = launchConfig.cwd?.replace('${workspaceFolder}', projectPath)
    const runCwd = configuredCwd
      ? (isAbsolute(configuredCwd) ? configuredCwd : resolve(projectPath, configuredCwd))
      : projectPath
    // 继承来的配置不得把命令带回主盘：解析后的工作目录必须落在目标 projectPath 内。
    if (configInherited) {
      const rel = relative(resolve(projectPath), resolve(runCwd))
      if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) {
        throw new Error(
          `Inherited launch configuration '${configName}' resolves cwd outside the target directory: ${runCwd}`
        )
      }
    }
    assertWorkspaceStorageAvailable(projectPath)
    const childProc = this.spawnProcess(commandInfo.command, commandInfo.args, {
      cwd: runCwd,
      env: { ...process.env, ...launchConfig.env },
    })

    const runningProject: RunningProject = {
      pid: childProc.pid!,
      config: launchConfig,
      startTime: new Date(),
      port: undefined,
      output: [],
      outputBuffer: '',
      process: childProc,
      eventEmitter: new EventEmitter(),
      terminated: false,
      configName,
      ...(options.identity?.workspaceId ? { workspaceId: options.identity.workspaceId } : {}),
      ...(options.identity?.scopePath ? { scopePath: options.identity.scopePath } : {}),
      ...(options.identity?.branch ? { branch: options.identity.branch } : {}),
    }

    // 6. 设置事件监听
    this.setupProcessListeners(processId, runningProject)

    this.runningProjects.set(processId, runningProject)
    this.activeCount++

    this.emit('project:started', {
      projectId: processId,
      type: launchConfig.type,
      command: commandInfo.displayName,
    })

    return this.toHandle(runningProject)
  }

  /**
   * 启动一次性后台命令（供 command.run background 复用）。
   * 不要求工作区存在已保存的 LaunchConfig；输出/生命周期与普通项目进程一致，
   * 可用 getRunning/getAllRunning/project.process-output 读取，用 stop 停止。
   * 退出后日志落宿主解析的 logs 目录，快照进 exitedAdhoc
   * （有界保留），project.process-output 可读已退出任务。
   * R3：`timeoutMs` 可选（整数 1000~600000，与 command.run 同步路径同界，
   * 缺席即无截止）；到期按 stop 语义 SIGTERM→SIGKILL，`timedOut` 随快照落盘。
   * R4：`env` 可选（调用方已 allowlist 校验，见 command-tools.ts filterCommandEnv），与进程 env 合并。
   */
  async runAdhoc(input: { cwd: string; storageRoot?: string; program: string; args?: string[]; label?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<{ projectId: string; handle: ProcessHandle; logPath?: string }> {
    if (this.activeCount >= this.maxConcurrent) {
      throw new Error(
        `Maximum concurrent projects (${this.maxConcurrent}) reached. Stop another project first.`,
      )
    }
    if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 600_000)) {
      throw new Error('adhoc timeoutMs must be an integer between 1000 and 600000')
    }
    const args = input.args ?? []
    const label = (input.label ?? `${input.program} ${args.join(' ')}`.trim()).slice(0, 120) || 'adhoc'
    // 与同步 command.run 同口径：shell 承载的 shim 参数含元字符直接拒绝（fail-closed）。
    const executionMode = requiresCommandShell(input.program) ? 'windows-shell-shim' as const : 'direct' as const
    if (executionMode === 'windows-shell-shim' && args.some((arg) => WINDOWS_SHELL_META.test(arg))) {
      throw new Error('command.run shell-backed arguments contain unsupported metacharacters')
    }
    const config: LaunchConfiguration = {
      name: label,
      type: ProjectType.Custom,
      request: 'launch',
      program: input.program,
      args,
      cwd: input.cwd,
    }
    const projectId = `${input.cwd}::adhoc:${Date.now()}-${randomUUID().slice(0, 8)}`
    // 日志目录建失败不阻断启动：仅失去落盘，内存输出照常可用。
    const releaseStorage = acquireWorkspaceStorage(input.storageRoot ?? input.cwd)
    try {
      let logPath: string | undefined
      try {
        const storage = await resolveWorkspaceStorage(input.storageRoot ?? input.cwd, true)
        await workspaceIo.run(input.cwd, () => mkdir(storage.logsPath, { recursive: true }))
        logPath = join(storage.logsPath, `bg-${Date.now()}-${randomUUID().slice(0, 8)}.log`)
      } catch {
        logPath = undefined
      }
      const childProc = this.spawnProcess(input.program, args, {
        cwd: input.cwd,
        env: { ...process.env, ...(input.env ?? {}) },
        windowsHide: true,
      })
      const runningProject: RunningProject = {
        pid: childProc.pid!,
        config,
        startTime: new Date(),
        port: undefined,
        output: [],
        outputBuffer: '',
        process: childProc,
        eventEmitter: new EventEmitter(),
        terminated: false,
        executionMode,
        storageRoot: input.storageRoot ?? input.cwd,
        releaseStorage,
        ...(logPath ? { persistLogPath: logPath } : {}),
      }
      this.setupProcessListeners(projectId, runningProject)
      this.runningProjects.set(projectId, runningProject)
      this.activeCount++
      // R3：超时计时与 stop/退出互斥清理（见 stop()/handleExit）；unref 避免长计时单独拖住主进程退出。
      if (input.timeoutMs !== undefined) {
        runningProject.timeoutMs = input.timeoutMs
        runningProject.timedOut = false
        runningProject.timeoutTimer = setTimeout(() => {
          const current = this.runningProjects.get(projectId)
          if (!current || current.terminated) return
          current.timedOut = true
          void this.stop(projectId, 5000).catch(() => undefined)
        }, input.timeoutMs)
        runningProject.timeoutTimer.unref?.()
      }
      this.emit('project:started', { projectId, type: config.type, command: label })
      return {
        projectId,
        ...(logPath ? { logPath } : {}),
        handle: this.toHandle(runningProject),
      }
    } catch (error) { releaseStorage(); throw error }
  }

  /**
   * 停止项目
   *
   * 流程：
   * 1. 查找运行中的进程
   * 2. 发送 SIGTERM 信号
   * 3. 等待进程退出（超时后发送 SIGKILL）
   */
  async stop(projectId: string, timeout: number = 5000): Promise<void> {
    const running = this.runningProjects.get(projectId)
    // P4尾巴：停已退出的 adhoc 任务视为成功（日志仍可读），未知 id 照旧抛错。
    if (!running) {
      if (this.exitedAdhoc.has(projectId)) return
      throw new Error(`Project ${projectId} is not running`)
    }

    if (running.terminated) {
      return
    }

    running.terminated = true
    // R3：手动 stop 清掉超时计时（快照 timedOut 保持 false，区别于超时 kill）。
    if (running.timeoutTimer) {
      clearTimeout(running.timeoutTimer)
      running.timeoutTimer = undefined
    }

    // win32 先整树强杀（子树不残留），再走句柄杀流程；taskkill 失败时句柄杀兜底。
    tryTreeKill(running.pid)
    // 先发送 SIGTERM
    running.process.kill('SIGTERM')

    // 设置超时强制杀死
    const killTimer = setTimeout(() => {
      if (!running.process.killed) {
        running.process.kill('SIGKILL')
      }
    }, timeout)

    // 等待进程退出
    return new Promise((resolve, reject) => {
      running.process.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
      running.process.once('error', reject)
    })
  }

  /**
   * Stop every running project. Best-effort for app shutdown.
   */
  async stopAll(timeout: number = 1500): Promise<void> {
    const ids = Array.from(this.runningProjects.keys())
    if (ids.length === 0) return

    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.stop(id, timeout)
        } catch {
          // ignore missing/racy entries during shutdown
        }
      }),
    )
  }

  /**
   * 获取运行中的项目
   */
  getRunning(projectId: string): ProcessHandle | null {
    const running = this.runningProjects.get(projectId)
    return running ? this.toHandle(running) : null
  }

  /**
   * 获取已退出的 adhoc 任务快照（P4尾巴：后台构建结束后仍可读日志）。
   */
  getExited(projectId: string): ExitedAdhocProject | null {
    return this.exitedAdhoc.get(projectId) ?? null
  }

  /**
   * 获取所有运行中的项目
   */
  getAllRunning(): Map<string, ProcessHandle> {
    const result = new Map<string, ProcessHandle>()
    this.runningProjects.forEach((running, id) => {
      result.set(id, this.toHandle(running))
    })
    return result
  }

  /** 运行条目 → 对外句柄（含 worktree 归属盖章字段）。 */
  private toHandle(running: RunningProject): ProcessHandle {
    return {
      pid: running.pid,
      config: running.config,
      startTime: running.startTime,
      port: running.port,
      output: running.output,
      ...(running.configName ? { configName: running.configName } : {}),
      ...(running.workspaceId ? { workspaceId: running.workspaceId } : {}),
      ...(running.scopePath ? { scopePath: running.scopePath } : {}),
      ...(running.branch ? { branch: running.branch } : {}),
    }
  }

  /**
   * ════════════════════════════════════════════
   * 私有工具方法
   * ════════════════════════════════════════════
   */

  /**
   * 生成唯一的进程 ID
   */
  private generateProcessId(projectPath: string, configName: string): string {
    return `${projectPath}::${configName}::${Date.now()}`
  }

  /**
   * 启动子进程
   */
  private spawnProcess(
    command: string,
    args: string[],
    options: any
  ): ChildProcess {
    assertWorkspaceStorageAvailable(options.cwd)
    return spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: requiresCommandShell(command),
    })
  }

  /**
   * 设置进程事件监听
   */
  private setupProcessListeners(
    projectId: string,
    running: RunningProject
  ): void {
    const { process: child } = running

    // 标准输出
    child.stdout?.on('data', (data: Buffer) => {
      this.handleOutput(projectId, running, data.toString(), 'stdout')
    })

    // 错误输出
    child.stderr?.on('data', (data: Buffer) => {
      this.handleOutput(projectId, running, data.toString(), 'stderr')
    })

    // 进程退出
    child.on('exit', (code: number | null, signal: string | null) => {
      this.handleExit(projectId, running, code, signal)
    })

    // 进程错误：spawn 失败（如 ENOENT）只发 error 不发 exit，
    // 必须在这里回收条目，否则 activeCount 泄漏累积到上限后无法再启动项目（audit M3）
    child.on('error', (error: Error) => {
      this.emit('project:error', {
        projectId,
        error: error.message,
      })
      // 启动失败文本随快照与落盘日志透出（含修复指引），轮询侧不再面对空日志。
      running.spawnError = error.message
      if (this.runningProjects.has(projectId)) {
        this.handleExit(projectId, running, null, null)
      }
    })
  }

  /**
   * 处理进程输出
   * - 累积输出到日志数组
   * - 提取关键信息（端口号）
   * - 发送事件给监听者
   */
  private handleOutput(
    projectId: string,
    running: RunningProject,
    data: string,
    stream: 'stdout' | 'stderr'
  ): void {
    // 缓冲输出，逐行处理；`\r` 也视为分隔，进度条类输出不会滞留缓冲
    running.outputBuffer += data
    const lines = running.outputBuffer.split(/\r\n|\n|\r/)

    // 保留最后一个不完整的行；超长单行（无换行的 JSON 流等）保尾截断，防止无界增长
    running.outputBuffer = lines.pop() || ''
    if (running.outputBuffer.length > MAX_OUTPUT_LINE_BUFFER_CHARS) {
      running.outputBuffer = running.outputBuffer.slice(-MAX_OUTPUT_LINE_BUFFER_CHARS)
    }

    for (const line of lines) {
      if (line.trim()) {
        const boundedLine = line.length > MAX_STORED_OUTPUT_LINE_CHARS
          ? line.slice(-MAX_STORED_OUTPUT_LINE_CHARS)
          : line
        running.output.push(boundedLine)

        // 尝试提取端口号
        if (!running.port) {
          const extractedPort = PortExtractor.extract(boundedLine)
          if (extractedPort) {
            running.port = extractedPort
            this.emit('project:ready', {
              projectId,
              port: extractedPort,
              url: `http://localhost:${extractedPort}`,
            })
          }
        }

        // 发送日志事件
        this.emit('project:output', {
          projectId,
          stream,
          line: boundedLine,
          timestamp: new Date(),
        })
      }
    }

    // 保持输出数组大小有限（最近 1000 行）
    if (running.output.length > 1000) {
      running.output = running.output.slice(-1000)
    }
  }

  /** P4尾巴：已退出 adhoc 快照最多保留 20 个，淘汰时连磁盘日志一起清。 */
  private static readonly MAX_EXITED_ADHOC = 20

  /**
   * 处理进程退出
   * exit 与 error 都可能触发（各一次或先后触发），按条目在场与否去重
   */
  private handleExit(
    projectId: string,
    running: RunningProject,
    code: number | null,
    signal: string | null
  ): void {
    if (!this.runningProjects.has(projectId)) return
    this.activeCount--
    this.runningProjects.delete(projectId)
    // R3：退出即停超时计时（自然退出/手动 stop/超时 kill 三路互斥）。
    if (running.timeoutTimer) {
      clearTimeout(running.timeoutTimer)
      running.timeoutTimer = undefined
    }

    // P4尾巴：adhoc 后台任务保留快照 + 落盘；普通 dev 进程保持原行为。
    if (running.persistLogPath) {
      const lines = [...running.output]
      const tail = running.outputBuffer.trim()
      if (tail) lines.push(tail.length > MAX_STORED_OUTPUT_LINE_CHARS ? tail.slice(-MAX_STORED_OUTPUT_LINE_CHARS) : tail)
      // 启动失败（或 win32 负退出码）随快照透出原因与修复指引，而非空输出。
      const program = running.config.program ?? ''
      const spawnReport = running.spawnError
        ? [`spawn error: ${running.spawnError}`, spawnHint(program)]
        : (typeof code === 'number' && code < 0 ? [spawnHint(program)] : [])
      this.exitedAdhoc.set(projectId, {
        pid: running.pid,
        config: running.config,
        startTime: running.startTime,
        endTime: new Date(),
        exitCode: code,
        signal,
        timedOut: running.timedOut === true,
        output: [...spawnReport, ...lines.slice(-1000)],
        logPath: running.persistLogPath,
      })
      while (this.exitedAdhoc.size > ProjectRunner.MAX_EXITED_ADHOC) {
        const oldest = this.exitedAdhoc.keys().next().value
        if (!oldest) break
        const evicted = this.exitedAdhoc.get(oldest)
        this.exitedAdhoc.delete(oldest)
        if (evicted?.logPath) void workspaceIo.run(evicted.config.cwd || '.', () => rm(evicted.logPath!, { force: true })).catch(() => undefined)
      }
      const logPath = running.persistLogPath
      const header = `# adhoc ${running.config.name}\nexitCode: ${String(code)} signal: ${String(signal)} timedOut: ${String(running.timedOut === true)}${running.executionMode ? ` executionMode: ${running.executionMode}` : ''}\n${spawnReport.length > 0 ? `${spawnReport.join('\n')}\n` : ''}--- output (${lines.length} lines, tail 1000 kept) ---\n`
      // Bounded retained output is written in chunks through the shared lane.
      const chunks = function* () { yield header; for (const line of lines.slice(-1000)) yield `${line}\n` }
      void writeIoFile(running.storageRoot ?? running.config.cwd ?? '.', logPath, chunks()).catch(error => console.error('Background log write failed:', error)).finally(() => running.releaseStorage?.())
    }
    else running.releaseStorage?.()

    this.emit('project:exit', {
      projectId,
      exitCode: code,
      signal,
      timedOut: running.timedOut === true,
      uptime: Date.now() - running.startTime.getTime(),
    })
  }
}

export default ProjectRunner
