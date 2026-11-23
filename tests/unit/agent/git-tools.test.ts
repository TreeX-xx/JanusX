import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { approveToolRequests } from './tool-approval.fixture'
import { registerGitTools } from '../../../src/main/agent/runtime/tools/git-tools'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-git-tools-'))
  temporaryDirectories.push(root)
  await git(root, 'init', '--quiet')
  await git(root, 'config', 'user.name', 'JanusX Test')
  await git(root, 'config', 'user.email', 'janusx@example.test')
  await writeFile(join(root, 'notes.txt'), 'before\n')
  await git(root, 'add', '--', 'notes.txt')
  await git(root, 'commit', '--quiet', '-m', 'initial')
  const runtime = new WorkspaceAgentRuntime(async () => root)
  registerGitTools(runtime.registry)
  const session = await runtime.createSession({ workspaceId: 'workspace-1', workspaceRoot: root })
  return { root, runtime, session }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Git Agent Runtime tools', () => {
  it('registers the bounded Git tool set once', () => {
    const runtime = new WorkspaceAgentRuntime(async () => process.cwd())
    registerGitTools(runtime.registry)
    registerGitTools(runtime.registry)
    expect(runtime.registry.list().map(({ name }) => name)).toEqual([
      'git.status', 'git.log', 'git.diff', 'git.stage', 'git.unstage', 'git.commit', 'git.pull', 'git.push',
    ])
  })

  it('reads status and diff, then stages and commits with approval', async () => {
    const { root, runtime, session } = await createRepository()
    await writeFile(join(root, 'notes.txt'), 'after\n')

    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'git.status', input: { workspaceId: 'workspace-1' } },
    })).resolves.toMatchObject({ status: 'completed', output: { status: { clean: false } } })

    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'git.diff', input: { workspaceId: 'workspace-1', file: 'notes.txt', maxBytes: 4096 } },
    })).resolves.toMatchObject({
      status: 'completed',
      output: { content: expect.stringContaining('+after'), truncated: false },
    })

    approveToolRequests(runtime)
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'git.stage',
        input: { workspaceId: 'workspace-1', paths: ['notes.txt'] },
        preview: { summary: 'Stage notes.txt', paths: ['notes.txt'], truncated: false },
      },
    })).resolves.toMatchObject({ status: 'completed', reasonCode: 'APPROVAL_GRANTED' })
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'git.commit',
        input: { workspaceId: 'workspace-1', message: 'update notes' },
        preview: { summary: 'Commit staged changes', paths: [''], detail: 'update notes', truncated: false },
      },
    })).resolves.toMatchObject({ status: 'completed', output: { status: { clean: true } } })
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'git.log', input: { workspaceId: 'workspace-1', maxCount: 1 } },
    })).resolves.toMatchObject({ output: { commits: [expect.objectContaining({ message: 'update notes' })] } })
  }, 20_000)

  it('requires previews and rejects traversal and sensitive Git paths', async () => {
    const { runtime, session } = await createRepository()
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'git.stage', input: { workspaceId: 'workspace-1', paths: ['notes.txt'] } },
    })).resolves.toMatchObject({ status: 'failed', reasonCode: 'PREVIEW_REQUIRED' })

    await expect(runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'git.status', input: { workspaceId: 'workspace-1', path: '../outside' } },
    })).resolves.toMatchObject({ status: 'failed', reasonCode: 'PATH_TRAVERSAL' })

    approveToolRequests(runtime)
    await expect(runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'git.stage',
        input: { workspaceId: 'workspace-1', paths: ['.env'] },
        preview: { summary: 'Stage .env', paths: ['.env'], truncated: false },
      },
    })).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('sensitive path') })
  }, 20_000)
})
