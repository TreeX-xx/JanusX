import { readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ProjectConfig, ProjectDetector, ProjectType, detectByFeatures, getProjectSchema } from '../../../project'
import type { LaunchConfig } from '../../../../shared/ipc/project'
import { getProjectRunner } from '../../../project/runner/service'
import { resolveWorkspaceTarget } from '@janus-agent/agent-core'
import { isSensitivePath } from '@janus-agent/agent-core'
import type { RegisteredTool, ToolRegistry } from '@janus-agent/agent-core'

const DEFAULT_DEPTH = 2
const MAX_DEPTH = 3
const DEFAULT_MAX_DIRECTORIES = 50
const MAX_MAX_DIRECTORIES = 100
const registeredRegistries = new WeakSet<ToolRegistry>()

type ScanDirectory = {
  relativePath: string
  absolutePath: string
  depth: number
}

type ProjectCandidate = {
  path: string
  type: ProjectType
  confidence: number
  evidence: string[]
}

function assertWorkspaceId(input: Record<string, unknown>, context: { workspaceId: string }, toolName: string): string {
  const workspaceId = input.workspaceId
  if (typeof workspaceId !== 'string' || workspaceId !== context.workspaceId) {
    throw new Error(`${toolName} workspaceId must match the active workspace resource`)
  }
  return workspaceId
}

function validateScanOptions(input: Record<string, unknown>): { depth: number; maxDirectories: number } {
  const depth = input.depth ?? DEFAULT_DEPTH
  const maxDirectories = input.maxDirectories ?? DEFAULT_MAX_DIRECTORIES
  if (typeof depth !== 'number' || !Number.isSafeInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
    throw new Error(`project scan depth must be an integer between 0 and ${MAX_DEPTH}`)
  }
  if (typeof maxDirectories !== 'number' || !Number.isSafeInteger(maxDirectories) || maxDirectories < 1 || maxDirectories > MAX_MAX_DIRECTORIES) {
    throw new Error(`project maxDirectories must be an integer between 1 and ${MAX_MAX_DIRECTORIES}`)
  }
  return { depth, maxDirectories }
}

function confidenceFor(type: ProjectType, entries: string[]): { confidence: number; evidence: string[] } {
  const features = getProjectSchema(type).featureFiles.filter((feature) => entries.some((entry) => entry.includes(feature)))
  const total = getProjectSchema(type).featureFiles.length
  return { confidence: total > 0 ? Math.min(features.length / total, 0.95) : 0.3, evidence: features }
}

async function scanProjectDirectories(
  workspaceRoot: string,
  requestedPath: string,
  depth: number,
  maxDirectories: number,
  signal: AbortSignal,
): Promise<{ rootPath: string; rootRelativePath: string; candidates: ProjectCandidate[] }> {
  const target = await resolveWorkspaceTarget(workspaceRoot, requestedPath)
  if (target.kind !== 'directory') throw new Error('project target path must be a directory')
  const rootPath = resolve(workspaceRoot, target.relativePath || '.')
  const queue: ScanDirectory[] = [{ relativePath: target.relativePath, absolutePath: rootPath, depth: 0 }]
  const candidates: ProjectCandidate[] = []
  let scanned = 0

  while (queue.length > 0 && scanned < maxDirectories) {
    if (signal.aborted) throw new Error('project detection cancelled')
    const current = queue.shift()!
    const directoryEntries = await readdir(current.absolutePath, { withFileTypes: true })
    const features = directoryEntries
      .filter((entry) => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()))
      .filter((entry) => {
        const relative = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name
        return !isSensitivePath(relative)
      })
      .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name)
    scanned++
    const detected = detectByFeatures(features)
    for (const type of detected) {
      const result = confidenceFor(type, features)
      candidates.push({ path: current.relativePath, type, confidence: result.confidence, evidence: result.evidence })
    }
    if (current.depth >= depth) continue
    for (const entry of directoryEntries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name
      if (isSensitivePath(relativePath)) continue
      queue.push({
        relativePath,
        absolutePath: join(current.absolutePath, entry.name),
        depth: current.depth + 1,
      })
    }
  }

  return { rootPath, rootRelativePath: target.relativePath, candidates }
}

function projectConfigFromDetection(
  projectPath: string,
  details: Awaited<ReturnType<typeof ProjectDetector.detectWithDetails>>,
  requestedType?: ProjectType,
  launchOverride?: Record<string, unknown>,
): LaunchConfig {
  const projectName = basename(projectPath) || 'app'
  const projectType = launchOverride ? ProjectType.Custom : requestedType ?? details.type
  const config = ProjectConfig.createDefault(projectPath, projectType, projectName)
  if (launchOverride) {
    config.configurations = [{
      name: typeof launchOverride.name === 'string' ? launchOverride.name : 'dev',
      type: ProjectType.Custom,
      request: 'launch',
      program: String(launchOverride.program),
      ...(Array.isArray(launchOverride.args) ? { args: launchOverride.args as string[] } : {}),
      ...(typeof launchOverride.cwd === 'string' ? { cwd: launchOverride.cwd } : {}),
      ...(launchOverride.env && typeof launchOverride.env === 'object' && !Array.isArray(launchOverride.env)
        ? { env: launchOverride.env as Record<string, string> }
        : {}),
    }]
  } else if (!requestedType || requestedType === details.type) {
    config.configurations = [{ ...details.recommendedConfig, type: projectType }]
  }
  config.metadata = { autoDetected: !launchOverride && !requestedType, lastModified: new Date().toISOString() }
  return config
}

function isProjectIdInWorkspace(projectId: string, workspaceRoot: string): boolean {
  const projectPath = projectId.split('::', 1)[0]
  const relation = relative(resolve(workspaceRoot), resolve(projectPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function configuredWorkingDirectory(projectPath: string, cwd?: string): string {
  const configured = cwd?.replace('${workspaceFolder}', projectPath)
  return configured ? (isAbsolute(configured) ? resolve(configured) : resolve(projectPath, configured)) : projectPath
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string, label: string): string {
  const relation = relative(resolve(workspaceRoot), resolve(targetPath))
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} is outside the active workspace`)
  }
  return relation
}

function validateLaunchConfigBoundary(workspaceRoot: string, projectPath: string, config: LaunchConfig): void {
  for (const launch of config.configurations) {
    const cwd = configuredWorkingDirectory(projectPath, launch.cwd)
    assertInsideWorkspace(workspaceRoot, cwd, `Launch configuration "${launch.name}" cwd`)
    if (launch.type === ProjectType.Custom && launch.program && !isAbsolute(launch.program) && /[\\/]/.test(launch.program)) {
      assertInsideWorkspace(workspaceRoot, resolve(cwd, launch.program), `Launch configuration "${launch.name}" program`)
    }
  }
}

async function validateRunnableConfigBoundary(
  workspaceRoot: string,
  projectPath: string,
  configName: string,
): Promise<void> {
  const config = await ProjectConfig.read(projectPath)
  if (!config) throw new Error(`No configuration found for project at ${projectPath}`)
  validateLaunchConfigBoundary(workspaceRoot, projectPath, config)
  const launch = ProjectConfig.getConfiguration(config, configName)
  if (!launch) throw new Error(`Configuration '${configName}' not found`)
  const cwd = configuredWorkingDirectory(projectPath, launch.cwd)
  const cwdTarget = await resolveWorkspaceTarget(workspaceRoot, assertInsideWorkspace(workspaceRoot, cwd, 'Launch cwd'))
  if (cwdTarget.kind !== 'directory') throw new Error('Launch cwd must be a workspace directory')
  if (launch.type === ProjectType.Custom && launch.program && !isAbsolute(launch.program) && /[\\/]/.test(launch.program)) {
    const programTarget = await resolveWorkspaceTarget(
      workspaceRoot,
      assertInsideWorkspace(workspaceRoot, resolve(cwd, launch.program), 'Launch program'),
    )
    if (programTarget.kind !== 'file') throw new Error('Launch program must be a regular workspace file')
  }
}

function runningProjectSummary(id: string, handle: ReturnType<ReturnType<typeof getProjectRunner>['getRunning']>) {
  if (!handle) return null
  return {
    id,
    pid: handle.pid,
    type: handle.config.type,
    name: handle.config.name,
    port: handle.port,
    startTime: handle.startTime.toISOString(),
    uptime: Date.now() - handle.startTime.getTime(),
  }
}

export const projectDetectTool: RegisteredTool = {
  name: 'project.detect',
  description: 'Detect project types and candidate directories inside an explicitly selected workspace',
  actionRisk: 'inspect',
  inputSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      path: { type: 'string' },
      depth: { type: 'number' },
      maxDirectories: { type: 'number' },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.detect')
    const requestedPath = input.path ?? ''
    if (typeof requestedPath !== 'string') throw new Error('project.detect path must be a string')
    const { depth, maxDirectories } = validateScanOptions(input)
    if (context.signal.aborted) throw new Error('project detection cancelled')
    const scan = await scanProjectDirectories(context.workspaceRoot, requestedPath, depth, maxDirectories, context.signal)
    const details = await ProjectDetector.detectWithDetails(scan.rootPath)
    const primary = details.type === ProjectType.Unknown ? scan.candidates[0] : undefined
    return {
      workspaceId,
      path: scan.rootRelativePath,
      type: primary?.type ?? details.type,
      confidence: primary?.confidence ?? details.confidence,
      evidence: primary?.evidence ?? details.detectedFeatures,
      candidates: scan.candidates,
      recommendedConfiguration: details.recommendedConfig,
      availableScripts: details.availableScripts ?? [],
    }
  },
}

export const projectGenerateConfigTool: RegisteredTool = {
  name: 'project.generate-config',
  description: 'Generate a validated candidate LaunchConfig without writing it to the workspace',
  actionRisk: 'inspect',
  inputSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      path: { type: 'string' },
      projectType: { type: 'string' },
      launch: { type: 'object' },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.generate-config')
    const requestedPath = input.path ?? ''
    if (typeof requestedPath !== 'string') throw new Error('project.generate-config path must be a string')
    const target = await resolveWorkspaceTarget(context.workspaceRoot, requestedPath)
    if (target.kind !== 'directory') throw new Error('project.generate-config path must be a directory')
    if (context.signal.aborted) throw new Error('project config generation cancelled')
    const projectPath = resolve(context.workspaceRoot, target.relativePath || '.')
    const details = await ProjectDetector.detectWithDetails(projectPath)
    const requestedType = input.projectType
    if (requestedType !== undefined && (typeof requestedType !== 'string' || !Object.values(ProjectType).includes(requestedType as ProjectType))) {
      throw new Error('project.generate-config projectType is invalid')
    }
    const launch = input.launch
    if (launch !== undefined) {
      if (!launch || typeof launch !== 'object' || Array.isArray(launch)) throw new Error('project.generate-config launch must be an object')
      const value = launch as Record<string, unknown>
      if (typeof value.program !== 'string' || value.program.trim().length === 0) throw new Error('project.generate-config launch.program is required')
      if (value.name !== undefined && (typeof value.name !== 'string' || value.name.trim().length === 0)) throw new Error('project.generate-config launch.name is invalid')
      if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string'))) throw new Error('project.generate-config launch.args must contain strings')
      if (value.cwd !== undefined && typeof value.cwd !== 'string') throw new Error('project.generate-config launch.cwd must be a string')
      if (value.env !== undefined && (!value.env || typeof value.env !== 'object' || Array.isArray(value.env) || Object.values(value.env).some((item) => typeof item !== 'string'))) throw new Error('project.generate-config launch.env must contain string values')
    }
    const config = projectConfigFromDetection(projectPath, details, requestedType as ProjectType | undefined, launch as Record<string, unknown> | undefined)
    const validation = ProjectConfig.validate(config)
    if (validation.valid) validateLaunchConfigBoundary(context.workspaceRoot, projectPath, config)
    return {
      workspaceId,
      path: target.relativePath,
      detectedType: details.type,
      intentOverrideApplied: launch !== undefined || requestedType !== undefined,
      config,
      validation,
    }
  },
}

export const projectApplyConfigTool: RegisteredTool = {
  name: 'project.apply-config',
  description: 'Validate and apply a candidate LaunchConfig to an explicitly selected workspace',
  actionRisk: 'config-apply',
  inputSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      path: { type: 'string' },
      config: { type: 'object' },
    },
    required: ['workspaceId', 'config'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.apply-config')
    const requestedPath = input.path ?? ''
    if (typeof requestedPath !== 'string') throw new Error('project.apply-config path must be a string')
    if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) throw new Error('project.apply-config config must be an object')
    const target = await resolveWorkspaceTarget(context.workspaceRoot, requestedPath)
    if (target.kind !== 'directory') throw new Error('project.apply-config path must be a directory')
    const config = structuredClone(input.config) as LaunchConfig
    const validation = ProjectConfig.validate(config)
    if (!validation.valid) throw new Error(`Project configuration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`)
    validateLaunchConfigBoundary(context.workspaceRoot, resolve(context.workspaceRoot, target.relativePath || '.'), config)
    if (context.signal.aborted) throw new Error('project config application cancelled')
    await ProjectConfig.write(resolve(context.workspaceRoot, target.relativePath || '.'), config)
    return { workspaceId, path: target.relativePath, validation, applied: true }
  },
}

export const projectListProcessesTool: RegisteredTool = {
  name: 'project.list-processes',
  description: 'List JanusX-managed project processes inside the active workspace',
  actionRisk: 'inspect',
  inputSchema: {
    type: 'object',
    properties: { workspaceId: { type: 'string' } },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  execute: (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.list-processes')
    const processes = [...getProjectRunner().getAllRunning().entries()]
      .filter(([id]) => isProjectIdInWorkspace(id, context.workspaceRoot))
      .map(([id, handle]) => runningProjectSummary(id, handle))
      .filter((value) => value !== null)
    return { workspaceId, processes }
  },
}

export const projectStartProcessTool: RegisteredTool = {
  name: 'project.start-process',
  description: 'Start one saved JanusX launch configuration in the active workspace',
  actionRisk: 'run',
  inputSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      path: { type: 'string' },
      configName: { type: 'string' },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.start-process')
    const requestedPath = input.path ?? ''
    const configName = input.configName ?? 'dev'
    if (typeof requestedPath !== 'string' || typeof configName !== 'string' || !configName.trim()) throw new Error('project.start-process input is invalid')
    const target = await resolveWorkspaceTarget(context.workspaceRoot, requestedPath)
    if (target.kind !== 'directory') throw new Error('project.start-process path must be a directory')
    const projectPath = resolve(context.workspaceRoot, target.relativePath || '.')
    await validateRunnableConfigBoundary(context.workspaceRoot, projectPath, configName)
    const handle = await getProjectRunner().run(projectPath, configName)
    const entries = [...getProjectRunner().getAllRunning().entries()]
    const entry = entries.find(([, candidate]) => candidate === handle || candidate.pid === handle.pid)
    return { workspaceId, process: entry ? runningProjectSummary(entry[0], entry[1]) : { pid: handle.pid, name: handle.config.name } }
  },
}

export const projectProcessOutputTool: RegisteredTool = {
  name: 'project.process-output',
  description: 'Read recent bounded output from one JanusX-managed project process in the active workspace (supports offsetLines pagination for background command.run jobs, including recently exited jobs with exitCode)',
  actionRisk: 'inspect',
  inputSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      maxLines: { type: 'number' },
      offsetLines: { type: 'number' },
    },
    required: ['workspaceId', 'projectId'],
    additionalProperties: false,
  },
  execute: (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.process-output')
    const projectId = input.projectId
    const maxLines = input.maxLines ?? 100
    const offsetLines = input.offsetLines ?? 0
    if (typeof projectId !== 'string' || !isProjectIdInWorkspace(projectId, context.workspaceRoot)) {
      throw new Error('project.process-output projectId is outside the active workspace')
    }
    if (!Number.isSafeInteger(maxLines) || Number(maxLines) < 1 || Number(maxLines) > 1000) {
      throw new Error('project.process-output maxLines must be an integer between 1 and 1000')
    }
    if (!Number.isSafeInteger(offsetLines) || Number(offsetLines) < 0 || Number(offsetLines) > 1000) {
      throw new Error('project.process-output offsetLines must be an integer between 0 and 1000')
    }
    const runner = getProjectRunner()
    // P4尾巴：后台任务退出后读保留快照（内存 1000 行 + 磁盘日志），而不是直接抛错。
    const running = runner.getRunning(projectId)
    const exited = running ? null : runner.getExited(projectId)
    const process = running ?? exited
    if (!process) throw new Error(`Project ${projectId} is not running`)
    const end = Math.max(0, process.output.length - Number(offsetLines))
    const start = Math.max(0, end - Number(maxLines))
    const lines = process.output.slice(start, end)
    const fullOutput = lines.join('\n')
    const maxChars = 128 * 1024
    const output = fullOutput.length > maxChars ? fullOutput.slice(-maxChars) : fullOutput
    const rawLogPath = exited?.logPath
    let logPath: string | undefined
    if (rawLogPath) {
      const relation = relative(resolve(context.workspaceRoot), resolve(rawLogPath))
      if (relation && relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)) {
        logPath = relation.split(sep).join('/')
      }
    }
    return {
      workspaceId,
      projectId,
      output,
      totalLines: process.output.length,
      offsetLines: Number(offsetLines),
      truncated: start > 0 || output.length < fullOutput.length,
      exited: exited !== null,
      ...(exited ? { exitCode: exited.exitCode, signal: exited.signal, timedOut: exited.timedOut } : {}),
      ...(logPath ? { logPath } : {}),
      ...(rawLogPath ? { logId: basename(rawLogPath), logReadTool: 'command.read-log' } : {}),
    }
  },
}

export const projectStopProcessTool: RegisteredTool = {
  name: 'project.stop-process',
  description: 'Stop one JanusX-managed project process in the active workspace',
  actionRisk: 'run',
  inputSchema: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
    },
    required: ['workspaceId', 'projectId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const workspaceId = assertWorkspaceId(input, context, 'project.stop-process')
    const projectId = input.projectId
    if (typeof projectId !== 'string' || !isProjectIdInWorkspace(projectId, context.workspaceRoot)) throw new Error('project.stop-process projectId is outside the active workspace')
    await getProjectRunner().stop(projectId)
    return { workspaceId, projectId, stopped: true }
  },
}

export function registerProjectTools(registry: ToolRegistry): void {
  if (registeredRegistries.has(registry)) return
  registry.register(projectDetectTool)
  registry.register(projectGenerateConfigTool)
  registry.register(projectApplyConfigTool)
  registry.register(projectListProcessesTool)
  registry.register(projectProcessOutputTool)
  registry.register(projectStartProcessTool)
  registry.register(projectStopProcessTool)
  registeredRegistries.add(registry)
}
