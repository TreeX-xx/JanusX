import { createHash } from 'node:crypto'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { runProcess } from '../platform/process-host/node'
import { OFFICE_EXTENSIONS } from '../../shared/office'
import { expectedBundledOfficecliSha256 } from './office-bundled-path'

export type OfficeBrokerTool = 'office_create' | 'office_batch' | 'office_help'

export interface OfficeBrokerRequest {
  tool: OfficeBrokerTool
  path?: string
  documentType?: 'docx' | 'xlsx' | 'pptx'
  batch?: unknown
  topic?: 'create' | 'batch'
}

export interface OfficeBrokerDependencies {
  run(binary: string, args: readonly string[], options: { input?: string; timeout: number; maxBuffer: number; cwd: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>
  verifyExecutable(binary: string): Promise<boolean>
}

const BROKER_TIMEOUT_MS = 30_000
const BROKER_MAX_OUTPUT_BYTES = 1024 * 1024

const defaultDependencies: OfficeBrokerDependencies = {
  run: async (binary, args, options) => {
    const result = await runProcess(binary, args, {
      timeoutMs: options.timeout,
      maxOutputBytes: options.maxBuffer,
      input: options.input,
      cwd: options.cwd,
    })
    return { exitCode: result.status === 'exited' ? result.exitCode ?? 1 : 1, stdout: result.stdout, stderr: result.stderr || (result.status !== 'exited' ? `Office process ${result.status}` : '') }
  },
  verifyExecutable: async (binary) => {
    const expectedSha256 = expectedBundledOfficecliSha256()
    const hash = createHash('sha256')
    const handle = await open(binary, 'r')
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024)
      let position = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) break
        hash.update(buffer.subarray(0, bytesRead))
        position += bytesRead
      }
    } finally { await handle.close() }
    return hash.digest('hex') === expectedSha256
  },
}

function isOutside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

function validateRelativeOfficePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || isAbsolute(value) ||
    /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(value) || value.split(/[\\/]+/).includes('..')) {
    throw new Error('Office path must be workspace-relative')
  }
  if (!(OFFICE_EXTENSIONS as readonly string[]).includes(extname(value).toLowerCase())) {
    throw new Error('Unsupported Office extension')
  }
  return value
}

function requireOnlyKeys(request: OfficeBrokerRequest, allowed: readonly string[]): void {
  if (Object.keys(request).some((key) => !allowed.includes(key))) throw new Error('Unsupported Office tool argument')
}

export class OfficeBroker {
  private constructor(
    private readonly workspaceRoot: string,
    private readonly binary: string,
    private readonly deps: OfficeBrokerDependencies,
  ) {}

  static async create(workspaceRoot: string, binary: string, dependencies: Partial<OfficeBrokerDependencies> = {}): Promise<OfficeBroker> {
    const deps = { ...defaultDependencies, ...dependencies }
    const root = await realpath(workspaceRoot)
    const executable = await realpath(binary)
    if (!(await stat(executable)).isFile() || !isAbsolute(executable) || !(await deps.verifyExecutable(executable))) {
      throw new Error('Verified OfficeCLI binary is unavailable')
    }
    return new OfficeBroker(root, executable, deps)
  }

  async invoke(request: OfficeBrokerRequest): Promise<{ output: string }> {
    if (!(await this.deps.verifyExecutable(this.binary))) throw new Error('Verified OfficeCLI binary identity changed')
    let args: string[]
    let input: string | undefined
    if (request.tool === 'office_help') {
      requireOnlyKeys(request, ['tool', 'topic'])
      if (request.topic !== 'create' && request.topic !== 'batch') throw new Error('Unsupported Office help topic')
      args = [request.topic, '--help']
    } else if (request.tool === 'office_create' || request.tool === 'office_batch') {
      requireOnlyKeys(request, request.tool === 'office_create' ? ['tool', 'path', 'documentType'] : ['tool', 'path', 'batch'])
      const relPath = validateRelativeOfficePath(request.path)
      const candidate = resolve(this.workspaceRoot, relPath)
      const parent = await realpath(resolve(candidate, '..'))
      if (isOutside(this.workspaceRoot, parent)) throw new Error('Office path escapes the workspace')
      if (request.tool === 'office_create') {
        if (request.documentType && `.${request.documentType}` !== extname(relPath).toLowerCase()) {
          throw new Error('Office document type does not match its extension')
        }
        try {
          await lstat(candidate)
          throw new Error('Office create target already exists')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        args = ['create', candidate]
      } else {
        const existing = await realpath(candidate)
        if (isOutside(this.workspaceRoot, existing) || !(await stat(existing)).isFile()) {
          throw new Error('Office path escapes the workspace')
        }
        if (request.batch === undefined) throw new Error('Office batch payload is required')
        args = ['batch', existing, '--input', '-']
        input = JSON.stringify(request.batch)
        if (input === undefined) throw new Error('Office batch payload must be JSON-serializable')
      }
    } else {
      throw new Error('Unsupported Office tool')
    }
    const result = await this.deps.run(this.binary, args, {
      input,
      timeout: BROKER_TIMEOUT_MS,
      maxBuffer: BROKER_MAX_OUTPUT_BYTES,
      cwd: this.workspaceRoot,
    })
    if (result.exitCode !== 0) throw new Error(`OfficeCLI command failed (${result.exitCode}): ${result.stderr.slice(0, 500)}`)
    return { output: result.stdout.slice(0, BROKER_MAX_OUTPUT_BYTES) }
  }
}
