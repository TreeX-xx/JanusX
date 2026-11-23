import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { approveToolRequests } from './tool-approval.fixture'
import { registerProjectTools } from '../../../src/main/agent/runtime/tools/project-tools'
import { ProjectType, type LaunchConfig } from '../../../src/shared/ipc/project'
import { getProjectRunner } from '../../../src/main/project/runner/service'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-project-tools-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createRuntime(root: string) {
  const runtime = new WorkspaceAgentRuntime(async () => root)
  registerProjectTools(runtime.registry)
  const session = await runtime.createSession({ workspaceId: 'workspace-1', workspaceRoot: root })
  return { runtime, session }
}

afterEach(async () => {
  await getProjectRunner().stopAll(100)
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('project Agent Runtime tools', () => {
  it('registers every project tool once', async () => {
    const root = await temporaryDirectory()
    const runtime = new WorkspaceAgentRuntime(async () => root)

    registerProjectTools(runtime.registry)
    registerProjectTools(runtime.registry)

    expect(runtime.registry.list().filter(({ name }) => name.startsWith('project.')).map(({ name }) => name)).toEqual([
      'project.detect',
      'project.generate-config',
      'project.apply-config',
      'project.list-processes',
      'project.process-output',
      'project.start-process',
      'project.stop-process',
    ])
  })

  it('detects bounded candidate directories with evidence and explicit resource identity', async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, 'apps', 'web', 'src'), { recursive: true })
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'apps', 'web', 'package.json'), '{}')
    await writeFile(join(root, 'apps', 'web', 'vite.config.ts'), 'export default {}')
    await writeFile(join(root, '.git', 'package.json'), '{}')
    const { runtime, session } = await createRuntime(root)

    const result = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'project.detect', input: { workspaceId: 'workspace-1', depth: 2 } },
    })

    expect(result).toMatchObject({
      status: 'completed',
      reasonCode: 'READ_ONLY_ALLOWED',
      output: {
        workspaceId: 'workspace-1',
        type: ProjectType.Vite,
      },
    })
    const candidates = (result.output as { candidates: Array<{ path: string; type: ProjectType; evidence: string[] }> }).candidates
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({
      path: 'apps/web',
      type: ProjectType.Vite,
      evidence: expect.arrayContaining(['package.json', 'vite.config.ts', 'src/']),
    })]))
    expect(JSON.stringify(result.output)).not.toContain('.git')
  })

  it('generates and validates a candidate without writing it', async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(root, 'vite.config.ts'), 'export default {}')
    const { runtime, session } = await createRuntime(root)

    const result = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'project.generate-config', input: { workspaceId: 'workspace-1' } },
    })

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        workspaceId: 'workspace-1',
        config: { projectType: ProjectType.Vite, projectName: expect.any(String) },
        validation: { valid: true, errors: [] },
      },
    })
    await expect(readFile(join(root, '.janusX', 'janusX.launch.json'))).rejects.toThrow()
  })

  it('lets explicit launch intent override a detected CMake project', async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'CMakeLists.txt'), 'project(demo)')
    await writeFile(join(root, 'scripts', 'start.cmd'), '@echo off')
    const { runtime, session } = await createRuntime(root)

    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'project.generate-config',
        input: {
          workspaceId: 'workspace-1',
          launch: {
            name: 'external-script',
            program: 'scripts/start.cmd',
            args: ['--dev'],
            cwd: '.',
          },
        },
      },
    })

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        detectedType: ProjectType.CppCMake,
        intentOverrideApplied: true,
        config: {
          projectType: ProjectType.Custom,
          metadata: { autoDetected: false },
          configurations: [{
            name: 'external-script',
            type: ProjectType.Custom,
            program: 'scripts/start.cmd',
            args: ['--dev'],
            cwd: '.',
          }],
        },
        validation: { valid: true },
      },
    })
  })

  it('shares managed process state across project tool sessions', async () => {
    const root = await temporaryDirectory()
    const script = join(root, 'stay-alive.js')
    await writeFile(script, 'setInterval(() => {}, 1000)')
    const config: LaunchConfig = {
      version: '0.1.0',
      projectType: ProjectType.Custom,
      projectName: 'shared-runner',
      configurations: [{
        name: 'external-script',
        type: ProjectType.Custom,
        request: 'launch',
        program: process.execPath,
        args: [script],
        cwd: '.',
      }],
    }
    const { runtime, session } = await createRuntime(root)
    await import('../../../src/main/project/config/project-config').then(({ default: ProjectConfig }) => ProjectConfig.write(root, config))
    approveToolRequests(runtime)

    const started = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'project.start-process',
        input: { workspaceId: 'workspace-1', configName: 'external-script' },
        preview: { summary: 'Start external script', paths: [''], truncated: false },
      },
    })
    expect(started).toMatchObject({ status: 'completed', output: { process: { name: 'external-script' } } })

    const listed = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'project.list-processes', input: { workspaceId: 'workspace-1' } },
    })
    const processes = (listed.output as { processes: Array<{ id: string }> }).processes
    expect(processes).toHaveLength(1)

    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'project.process-output', input: { workspaceId: 'workspace-1', projectId: processes[0].id, maxLines: 10 } },
    })).resolves.toMatchObject({ status: 'completed', output: { projectId: processes[0].id, output: expect.any(String) } })

    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'project.stop-process',
        input: { workspaceId: 'workspace-1', projectId: processes[0].id },
        preview: { summary: 'Stop external script', paths: [processes[0].id], truncated: false },
      },
    })).resolves.toMatchObject({ status: 'completed', output: { stopped: true } })
  })

  it('applies a valid config only after Runtime approval', async () => {
    const root = await temporaryDirectory()
    const { runtime, session } = await createRuntime(root)
    const config: LaunchConfig = {
      version: '0.1.0',
      projectType: ProjectType.Vite,
      projectName: 'demo',
      configurations: [{ name: 'dev', type: ProjectType.Vite, request: 'launch' }],
    }
    approveToolRequests(runtime)

    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'project.apply-config',
        input: { workspaceId: 'workspace-1', config },
        preview: { summary: 'Apply generated project configuration', paths: ['.janusX/janusX.launch.json'], truncated: false },
      },
    })

    expect(result).toMatchObject({ status: 'completed', reasonCode: 'APPROVAL_GRANTED', output: { applied: true } })
    await expect(readFile(join(root, '.janusX', 'janusX.launch.json'), 'utf-8')).resolves.toContain('"projectName": "demo"')
  })

  it('rejects missing or mismatched resource ids and outside paths', async () => {
    const root = await temporaryDirectory()
    const { runtime, session } = await createRuntime(root)
    const execute = (input: Record<string, unknown>) => runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'project.detect', input },
    })

    await expect(execute({})).resolves.toMatchObject({ status: 'failed', output: undefined })
    await expect(execute({ workspaceId: 'workspace-2' })).resolves.toMatchObject({ status: 'failed', output: undefined })
    await expect(execute({ workspaceId: 'workspace-1', path: '../outside' })).resolves.toMatchObject({
      status: 'failed',
      reasonCode: 'PATH_TRAVERSAL',
    })
  })

  it('rejects launch working directories outside the active workspace', async () => {
    const root = await temporaryDirectory()
    const { runtime, session } = await createRuntime(root)
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'project.generate-config',
        input: {
          workspaceId: 'workspace-1',
          launch: { name: 'outside', program: 'node', cwd: '../outside' },
        },
      },
    })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('outside the active workspace') })
  })
})
