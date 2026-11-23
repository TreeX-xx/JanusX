import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { approveToolRequests } from './tool-approval.fixture'
import { commandExecutionMode, registerCommandTools } from '../../../src/main/agent/runtime/tools/command-tools'

const temporaryDirectories: string[] = []

async function createRuntime() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-command-tools-'))
  temporaryDirectories.push(root)
  const runtime = new WorkspaceAgentRuntime(async () => root)
  registerCommandTools(runtime.registry)
  const session = await runtime.createSession({ workspaceId: 'workspace-1', workspaceRoot: root })
  return { root, runtime, session }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('command Agent Runtime tool', () => {
  it('uses the Windows shell only for the explicit compatibility shim set', () => {
    expect(commandExecutionMode('npm', 'win32')).toBe('windows-shell-shim')
    expect(commandExecutionMode('scripts/start.cmd', 'win32')).toBe('windows-shell-shim')
    expect(commandExecutionMode('node.exe', 'win32')).toBe('direct')
    expect(commandExecutionMode('node', 'linux')).toBe('direct')
  })

  it('runs one structured command and returns bounded output and exit state', async () => {
    const { runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const program = basename(process.execPath)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program, args: ['-e', 'process.stdout.write("command-ok")'], timeoutMs: 30_000 },
        preview: { summary: `Run ${program}`, paths: [''], detail: 'print command-ok', truncated: false },
      },
    })
    expect(result).toMatchObject({
      status: 'completed',
      output: {
        ok: true, exitCode: 0, stdout: 'command-ok', stderr: '', timedOut: false,
        outputTruncated: false, executionMode: 'direct',
      },
    })
  })

  it('returns a nonzero exit without disguising it as a successful command', async () => {
    const { runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program: basename(process.execPath), args: ['-e', 'process.stderr.write("failed");process.exit(2)'] },
        preview: { summary: 'Run failing command', paths: [''], truncated: false },
      },
    })
    expect(result).toMatchObject({ status: 'completed', output: { ok: false, exitCode: 2, stderr: 'failed' } })
  })

  it('requires approval details and confines cwd and executable paths to the workspace', async () => {
    const { runtime, session } = await createRuntime()
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'command.run', input: { workspaceId: 'workspace-1', program: basename(process.execPath) } },
    })).resolves.toMatchObject({ status: 'failed', reasonCode: 'PREVIEW_REQUIRED' })

    approveToolRequests(runtime)
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', cwd: '../outside', program: basename(process.execPath) },
        preview: { summary: 'Run outside', paths: ['../outside'], truncated: false },
      },
    })).resolves.toMatchObject({ status: 'failed', reasonCode: 'PATH_TRAVERSAL' })
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program: process.execPath },
        preview: { summary: 'Run absolute executable', paths: [''], truncated: false },
      },
    })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('workspace-relative') })
  })

  it('returns an 8KB tail preview and persists the full log for large command output', async () => {
    const { root, runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program: basename(process.execPath), args: ['-e', 'process.stdout.write("x".repeat(70000))'] },
        preview: { summary: 'Run bounded output command', paths: [''], truncated: false },
      },
    })
    const output = result.output as { stdout: string; outputTruncated: boolean; totalBytes: number; wallTimeMs: number; logPath: string; logTruncated: boolean }
    expect(output.outputTruncated).toBe(true)
    expect(Buffer.byteLength(output.stdout)).toBe(8 * 1024)
    expect(output.totalBytes).toBe(70000)
    expect(output.wallTimeMs).toEqual(expect.any(Number))
    expect(output.logTruncated).toBe(false)
    expect(typeof output.logPath).toBe('string')
    // P4: the full log is pageable from the workspace log file.
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const logged = await readFile(join(root, output.logPath), 'utf-8')
    expect(logged).toContain('x'.repeat(1000))
    expect(logged.length).toBeGreaterThan(70000)
  })

  it('accepts up to 600s timeouts for long builds', async () => {
    const { runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const program = basename(process.execPath)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program, args: ['-e', 'process.exit(0)'], timeoutMs: 600_000 },
        preview: { summary: `Run ${program}`, paths: [''], truncated: false },
      },
    })
    expect(result).toMatchObject({ status: 'completed', output: { ok: true, exitCode: 0 } })
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program, args: ['-e', 'process.exit(0)'], timeoutMs: 600_001 },
        preview: { summary: `Run ${program}`, paths: [''], truncated: false },
      },
    })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('between 1000 and 600000') })
  })

  it('starts long commands in the background and lets project tools read and stop them', { timeout: 30_000 }, async () => {
    const { registerProjectTools } = await import('../../../src/main/agent/runtime/tools/project-tools')
    const { getProjectRunner } = await import('../../../src/main/project/runner/service')
    const { runtime, session } = await createRuntime()
    registerProjectTools(runtime.registry)
    approveToolRequests(runtime)
    const started = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: {
          workspaceId: 'workspace-1',
          program: basename(process.execPath),
          args: ['-e', 'console.log("bg-line");setInterval(()=>{},1000)'],
          background: true,
        },
        preview: { summary: 'Run background command', paths: [''], truncated: false },
      },
    })
    expect(started).toMatchObject({ status: 'completed', output: { background: true } })
    const projectId = (started.output as { projectId: string }).projectId
    expect(typeof projectId).toBe('string')
    // P4尾巴：后台启动即带 workspace-relative logPath。
    const startedLogPath = (started.output as { logPath?: string }).logPath
    expect(typeof startedLogPath).toBe('string')
    try {
      await expect.poll(async () => getProjectRunner().getRunning(projectId)?.output.join('\n') ?? '', { timeout: 10_000 }).toContain('bg-line')
      const output = await runtime.executeTool({
        sessionId: session.id,
        call: {
          toolName: 'project.process-output',
          input: { workspaceId: 'workspace-1', projectId, maxLines: 10 },
        },
      })
      expect(output).toMatchObject({ status: 'completed', output: { projectId, totalLines: expect.any(Number), exited: false } })
      expect((output.output as { output: string }).output).toContain('bg-line')
      await expect(runtime.executeTool({
        sessionId: session.id,
        call: {
          toolName: 'project.stop-process',
          input: { workspaceId: 'workspace-1', projectId },
          preview: { summary: 'Stop background command', paths: [projectId], truncated: false },
        },
      })).resolves.toMatchObject({ status: 'completed', output: { stopped: true } })
      // P4尾巴：退出后仍可读快照（含 exitCode/logPath），磁盘日志有内容。
      const exited = await runtime.executeTool({
        sessionId: session.id,
        call: {
          toolName: 'project.process-output',
          input: { workspaceId: 'workspace-1', projectId, maxLines: 10 },
        },
      })
      expect(exited).toMatchObject({ status: 'completed', output: { projectId, exited: true, timedOut: false, logPath: startedLogPath } })
      expect((exited.output as { output: string }).output).toContain('bg-line')
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const { getProjectRunner: getRunner } = await import('../../../src/main/project/runner/service')
      const snapshot = getRunner().getExited(projectId)
      expect(snapshot?.exitCode).not.toBeUndefined()
      // 落盘是异步 best-effort：poll 等文件写入。
      const logFile = join(snapshot!.config.cwd as string, '.janusX', 'logs', (startedLogPath as string).split('/').at(-1)!)
      await expect.poll(async () => readFile(logFile, 'utf-8').catch(() => ''), { timeout: 10_000 }).toContain('bg-line')
    } finally {
      await getProjectRunner().stopAll(500).catch(() => undefined)
    }
  })

  it('R3: kills background jobs after timeoutMs and records timedOut', { timeout: 30_000 }, async () => {
    const { registerProjectTools } = await import('../../../src/main/agent/runtime/tools/project-tools')
    const { getProjectRunner } = await import('../../../src/main/project/runner/service')
    const { runtime, session } = await createRuntime()
    registerProjectTools(runtime.registry)
    approveToolRequests(runtime)
    const started = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: {
          workspaceId: 'workspace-1',
          program: basename(process.execPath),
          args: ['-e', 'setInterval(()=>{},100)'],
          background: true,
          timeoutMs: 1000,
        },
        preview: { summary: 'Run background command with timeout', paths: [''], truncated: false },
      },
    })
    expect(started).toMatchObject({ status: 'completed', output: { background: true, timeoutMs: 1000 } })
    const projectId = (started.output as { projectId: string }).projectId
    try {
      await expect.poll(async () => getProjectRunner().getExited(projectId)?.timedOut ?? 'pending', { timeout: 15_000 }).toBe(true)
      const output = await runtime.executeTool({
        sessionId: session.id,
        call: {
          toolName: 'project.process-output',
          input: { workspaceId: 'workspace-1', projectId, maxLines: 10 },
        },
      })
      expect(output).toMatchObject({ status: 'completed', output: { projectId, exited: true, timedOut: true } })
    } finally {
      await getProjectRunner().stopAll(500).catch(() => undefined)
    }
  })

  it('R3: rejects out-of-range background timeoutMs without spawning', async () => {
    const { getProjectRunner } = await import('../../../src/main/project/runner/service')
    await expect(getProjectRunner().runAdhoc({ cwd: tmpdir(), program: 'node', timeoutMs: 999 }))
      .rejects.toThrow('between 1000 and 600000')
    await expect(getProjectRunner().runAdhoc({ cwd: tmpdir(), program: 'node', timeoutMs: 600_001 }))
      .rejects.toThrow('between 1000 and 600000')
  })

  it('R4: passes allowlisted env through to sync commands and echoes it back', async () => {
    const { runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: {
          workspaceId: 'workspace-1',
          program: basename(process.execPath),
          args: ['-e', 'process.stdout.write("env-" + process.env.NODE_ENV)'],
          env: { NODE_ENV: 'janusx-r4-test' },
        },
        preview: { summary: 'Run command with env', paths: [''], truncated: false },
      },
    })
    expect(result).toMatchObject({ status: 'completed', output: { ok: true, env: { NODE_ENV: 'janusx-r4-test' } } })
    expect((result.output as { stdout: string }).stdout).toContain('env-janusx-r4-test')
  })

  it('surfaces a start-failure hint when the program cannot spawn', async () => {
    const { runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: { workspaceId: 'workspace-1', program: 'definitely-not-a-real-cmd-xyz', timeoutMs: 10_000 },
        preview: { summary: 'Run missing program', paths: [''], truncated: false },
      },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('hint:')
    expect(result.error).toContain('definitely-not-a-real-cmd-xyz')
  })

  it('R4: rejects non-allowlisted env keys and malformed env shapes', async () => {
    const { runtime, session } = await createRuntime()
    approveToolRequests(runtime)
    const program = basename(process.execPath)
    const preview = { summary: 'Run command with env', paths: [''], truncated: false }
    const run = (env: unknown) => runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'command.run', input: { workspaceId: 'workspace-1', program, args: ['-e', 'process.exit(0)'], env }, preview },
    })
    // PATH/LD_PRELOAD/NODE_OPTIONS 可劫持解析或注入代码，永不放行。
    await expect(run({ LD_PRELOAD: '/tmp/evil.so' })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('not allowlisted') })
    await expect(run({ PATH: '/tmp/bin' })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('not allowlisted') })
    await expect(run({ NODE_OPTIONS: '--require /tmp/evil.js' })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('not allowlisted') })
    // 数组 env 在 registry schema 层即被拦（纵深防御），其余形状走 filterCommandEnv。
    await expect(run([{ NODE_ENV: 'x' }])).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('Invalid input for tool') })
    await expect(run({ NODE_ENV: 42 })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('must be a bounded string') })
    await expect(run({ 'BAD-NAME': 'x' })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('not allowlisted') })
    // 报错须可直接自愈：枚举白名单并给出参数式替代（git -c），避免裸错烧往返。
    await expect(run({ HTTP_PROXY: 'http://127.0.0.1:7897' })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('git -c http.proxy=') })
    await expect(run(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`NODE_ENV_${i}`, 'x']))))
      .resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('at most 32') })
  })

  it('R4: passes allowlisted env to background jobs', { timeout: 30_000 }, async () => {
    const { registerProjectTools } = await import('../../../src/main/agent/runtime/tools/project-tools')
    const { getProjectRunner } = await import('../../../src/main/project/runner/service')
    const { runtime, session } = await createRuntime()
    registerProjectTools(runtime.registry)
    approveToolRequests(runtime)
    const started = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'command.run',
        input: {
          workspaceId: 'workspace-1',
          program: basename(process.execPath),
          args: ['-e', 'console.log("bg-env-" + process.env.NODE_ENV);setInterval(()=>{},1000)'],
          background: true,
          env: { NODE_ENV: 'janusx-r4-bg' },
        },
        preview: { summary: 'Run background command with env', paths: [''], truncated: false },
      },
    })
    expect(started).toMatchObject({ status: 'completed', output: { background: true, env: { NODE_ENV: 'janusx-r4-bg' } } })
    const projectId = (started.output as { projectId: string }).projectId
    try {
      await expect.poll(async () => getProjectRunner().getRunning(projectId)?.output.join('\n') ?? '', { timeout: 10_000 }).toContain('bg-env-janusx-r4-bg')
    } finally {
      await getProjectRunner().stopAll(500).catch(() => undefined)
    }
  })
})
