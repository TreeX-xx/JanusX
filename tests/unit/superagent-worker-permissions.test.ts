import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'smol-toml'
import { workerPermissions } from '../../src/main/janus/superagent/worker-permissions'
import { workerLaunch } from '../../src/main/janus/superagent/worker-launch'
import { environmentFixture } from '../helpers/superagent-environment-fixture'

const exec = promisify(execFile)
const binary = process.env.JANUS_SUPERAGENT_CODEX_BINARY

describe('SuperAgent native worker permissions', () => {
  it('provides an explicit per-thread profile without ambient temp or global write grants', async () => {
    const fixture = await environmentFixture()
    try {
      const work = await fixture.work()
      const operation = await fixture.service.proposeCreate(fixture.workspace.workspaceId, { workId: work.id })
      await fixture.service.decide({ workspaceId: fixture.workspace.workspaceId, operationId: operation.id, approved: true })
      const lease = await fixture.service.acquire(fixture.workspace.workspaceId, work.id)
      const policy = workerPermissions(lease)
      const config = parse(policy.configOverrides.join('\n')) as any
      const filesystem = config.permissions[policy.profile].filesystem
      expect(filesystem[':root']).toBe('read')
      expect(Object.values(filesystem).filter(value => value === 'write')).toHaveLength(1)
      expect(filesystem[lease.checkout.path.replaceAll('\\', '/')]).toBe('write')
      for (const path of policy.readOnlyPaths) expect(filesystem[path.replaceAll('\\', '/')]).toBe('read')
      expect(policy.thread).toMatchObject({ permissions: policy.profile, runtimeWorkspaceRoots: [lease.checkout.path],
        approvalPolicy: { granular: { sandbox_approval: false, request_permissions: false } } })
      const entry = join(fixture.root, 'worker-mcp.js'); await writeFile(entry, '')
      const native = { config: { projects: { [lease.checkout.path]: { trust_level: 'trusted' } }, tool_output_token_limit: 1000 } }
      const before = structuredClone(native), launched = workerLaunch(lease, native, { command: process.execPath, entry, endpoint: 'http://127.0.0.1:1', token: 'fixture' })
      expect((launched.params.config.mcp_servers.janus_worker as any).tools.read_resource.output_token_limit).toBe(1000)
      expect(launched.contextOutputBytes).toBe(2800); expect(native).toEqual(before)
    } finally { await fixture.dispose() }
  })

  it.skipIf(!binary || process.platform !== 'win32')('enforces the production profile on actual Windows MXC commands and child processes', async () => {
    const fixture = await environmentFixture()
    try {
      const work = await fixture.work(), scope = fixture.workspace.workspaceId
      const operation = await fixture.service.proposeCreate(scope, { workId: work.id })
      await fixture.service.decide({ workspaceId: scope, operationId: operation.id, approved: true })
      const lease = await fixture.service.acquire(scope, work.id), policy = workerPermissions(lease)
      await fixture.git(['checkout', '-b', 'protected-branch'])
      await fixture.commit(fixture.repo, 'protected change\n', 'other.txt')
      await fixture.git(['checkout', 'main'])
      const originalPointer = await readFile(join(lease.checkout.path, '.git'), 'utf8')
      const originalHead = await readFile(join(lease.checkout.gitDir, 'HEAD'), 'utf8')
      const outside = join(fixture.root, 'outside.txt')
      await writeFile(outside, 'outside')
      await symlink(fixture.repo, join(lease.checkout.path, 'outside-link'), 'junction')
      const script = join(fixture.root, 'native-boundary.cjs')
      await writeFile(script, String.raw`
const fs=require('node:fs'), cp=require('node:child_process'), path=require('node:path');
const [root,repo,work,gitdir]=process.argv.slice(2), checks=[];
const attempt=(name,fn)=>{try{fn();checks.push({name,allowed:true})}catch(error){checks.push({name,allowed:false,code:error.code||error.status})}};
const git=args=>cp.execFileSync('git',args,{cwd:work,windowsHide:true,stdio:'pipe',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
attempt('read-git',()=>git(['status','--porcelain']));
attempt('edit-code',()=>fs.writeFileSync(path.join(work,'allowed.txt'),'allowed'));
attempt('write-outside',()=>fs.writeFileSync(path.join(root,'outside.txt'),'escaped'));
attempt('write-other-checkout',()=>fs.writeFileSync(path.join(repo,'feature.txt'),'escaped'));
attempt('write-through-junction',()=>fs.writeFileSync(path.join(work,'outside-link','feature.txt'),'escaped'));
attempt('create-worktree',()=>git(['worktree','add','-b','escaped',path.join(root,'escaped'),'main']));
attempt('merge-branch',()=>git(['merge','--no-ff','protected-branch','-m','test']));
attempt('delete-branch',()=>git(['branch','-D','protected-branch']));
attempt('switch-branch',()=>git(['checkout','--detach','main']));
attempt('remove-worktree',()=>git(['-C',repo,'worktree','remove','--force',work]));
attempt('write-git-pointer',()=>fs.appendFileSync(path.join(work,'.git'),'\n'));
attempt('write-git-head',()=>fs.appendFileSync(path.join(gitdir,'HEAD'),'\n'));
attempt('rename-git-pointer',()=>fs.renameSync(path.join(work,'.git'),path.join(work,'.git.moved')));
process.stdout.write(JSON.stringify(checks));
`)
      const { stdout } = await exec(binary!, [...policy.configOverrides.flatMap(value => ['-c', value]),
        'sandbox', '--include-managed-config', '-P', policy.profile, '-C', policy.cwd, '--', process.execPath, script,
        fixture.root, fixture.repo, lease.checkout.path, lease.checkout.gitDir], { cwd: policy.cwd, windowsHide: true, timeout: 30000, maxBuffer: 128 * 1024, encoding: 'utf8' })
      const checks = JSON.parse(stdout) as Array<{ name: string; allowed: boolean }>
      expect(checks.filter(check => check.allowed).map(check => check.name)).toEqual(['read-git', 'edit-code'])
      expect(checks).toHaveLength(13)
      expect(await readFile(outside, 'utf8')).toBe('outside')
      expect(await readFile(join(fixture.repo, 'feature.txt'), 'utf8')).toBe('initial\n')
      expect(await readFile(join(lease.checkout.path, 'feature.txt'), 'utf8')).toBe('initial\n')
      expect(await readFile(join(lease.checkout.path, '.git'), 'utf8')).toBe(originalPointer)
      expect(await readFile(join(lease.checkout.gitDir, 'HEAD'), 'utf8')).toBe(originalHead)
      expect(await fixture.git(['show-ref', '--verify', 'refs/heads/protected-branch'])).toContain('refs/heads/protected-branch')
    } finally { await fixture.dispose() }
  })
})
