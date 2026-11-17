import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'smol-toml'
import { createWorkerScratch, workerPermissions } from '../../src/main/janus/superagent/worker-permissions'
import { workerLaunch } from '../../src/main/janus/superagent/worker-launch'
import { environmentFixture } from '../helpers/superagent-environment-fixture'

const exec = promisify(execFile)
const binary = process.env.JANUS_SUPERAGENT_CODEX_BINARY

it.skipIf(!binary || process.platform !== 'win32')('runs isolated Git fixtures and atomic writes in private scratch while protecting the real checkout', async () => {
  const f = await environmentFixture(), scratch = await createWorkerScratch(), other = await createWorkerScratch()
  try {
    const work = await f.work()
    await f.service.reuse(f.workspace.workspaceId, { workId: work.id, path: f.repo, branch: 'main' })
    const lease = await f.service.acquire(f.workspace.workspaceId, work.id), policy = workerPermissions(lease, scratch.path)
    const script = join(f.root, 'scratch-probe.cjs')
    await writeFile(script, String.raw`
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),os=require('node:os');
const [expected,realGit,other]=process.argv.slice(2);
if(path.resolve(os.tmpdir())!==path.resolve(expected))throw Error('Wrong test temp directory: '+JSON.stringify({actual:os.tmpdir(),expected,TMP:process.env.TMP,TEMP:process.env.TEMP,TMPDIR:process.env.TMPDIR}));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'test-')), repo=path.join(root,'fixture');fs.mkdirSync(repo);
const git=args=>cp.execFileSync('git',args,{cwd:repo,windowsHide:true,stdio:'pipe'});
git(['init','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
fs.writeFileSync(path.join(repo,'file.txt'),'test');git(['add','.']);git(['commit','-m','fixture']);
const target=path.join(root,'state.json');fs.writeFileSync(target,'old');fs.writeFileSync(target+'.tmp','new');fs.renameSync(target+'.tmp',target);
if(fs.readFileSync(target,'utf8')!=='new')throw Error('Atomic replacement failed');
let denied=0;for(const file of [path.join(realGit,'scratch-escape'),path.join(other,'scratch-escape')]){try{fs.writeFileSync(file,'escape')}catch{denied++}}
fs.rmSync(root,{recursive:true});
const http=require('node:http'),net=require('node:net');
const server=http.createServer((req,res)=>res.end('ok'));
server.listen(0,'127.0.0.1',()=>{http.get('http://127.0.0.1:'+server.address().port,res=>{res.resume();res.on('end',()=>{
server.close();const socket=net.connect({host:'192.0.2.1',port:80});
socket.setTimeout(3000,()=>{socket.destroy();throw Error('External access was not explicitly denied')});
socket.on('connect',()=>{socket.destroy();throw Error('External network escaped')});
socket.on('error',error=>process.stdout.write(JSON.stringify({denied,cleaned:!fs.existsSync(root),loopback:res.statusCode===200,externalDenied:error.code==='EACCES'||error.code==='EPERM'})));
})}).on('error',error=>{server.close();throw error})});
`)
    const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
    const command = `$env:TEMP=$env:TMPDIR; $env:TMP=$env:TMPDIR; & ${[process.execPath, script, scratch.path, lease.checkout.gitDir, other.path].map(psQuote).join(' ')}`
    const { stdout } = await exec(binary!, [...policy.configOverrides.flatMap(value => ['-c', value]),
      'sandbox', '--include-managed-config', '-P', policy.profile, '-C', policy.cwd, '--', 'powershell.exe', '-NoProfile', '-Command', command],
    { cwd: policy.cwd, env: { ...process.env, ...scratch.env }, windowsHide: true, timeout: 30000, encoding: 'utf8' })
    expect(JSON.parse(stdout)).toEqual({ denied: 2, cleaned: true, loopback: true, externalDenied: true })
    expect(await f.git(['rev-list', '--count', 'HEAD'])).toBe('1')
  } finally { await scratch.dispose(); await other.dispose(); await f.dispose() }
})

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
      expect(config.features.network_proxy).toBe(true)
      expect(config.permissions[policy.profile].network.domains).toEqual({ localhost: 'allow', '127.0.0.1': 'allow', '::1': 'allow' })
      expect(filesystem[':root']).toBe('read')
      expect(Object.values(filesystem).filter(value => value === 'write')).toHaveLength(2)
      expect(filesystem[lease.checkout.path.replaceAll('\\', '/')]).toBe('write')
      expect(filesystem[join(lease.checkout.path, '.agents').replaceAll('\\', '/')]).toBe('write')
      for (const name of ['.git', '.codex', '.aws']) expect(filesystem[join(lease.checkout.path, name).replaceAll('\\', '/')]).toBe('read')
      for (const path of policy.readOnlyPaths) expect(filesystem[path.replaceAll('\\', '/')]).toBe('read')
      expect(policy.thread).toMatchObject({ permissions: policy.profile, runtimeWorkspaceRoots: [lease.checkout.path],
        approvalPolicy: { granular: { sandbox_approval: true, request_permissions: true } } })
      const entry = join(fixture.root, 'worker-mcp.js'); await writeFile(entry, '')
      const native = { config: { projects: { [lease.checkout.path]: { trust_level: 'trusted' } }, tool_output_token_limit: 1000 } }
      const before = structuredClone(native), launched = workerLaunch(lease, native, { command: process.execPath, entry, endpoint: 'http://127.0.0.1:1', token: 'fixture' })
      expect((launched.params.config.mcp_servers.janus_worker as any).tools.read_resource.output_token_limit).toBe(1000)
      const server = launched.params.config.mcp_servers.janus_worker as any
      expect(server.default_tools_approval_mode).toBe('prompt')
      expect(Object.keys(server.tools).sort()).toEqual(['commit_work', 'git_work', 'read_resource', 'read_work', 'report_work'])
      for (const tool of Object.values(server.tools) as any[]) expect(tool.approval_mode).toBe('approve')
      expect(launched.params.approvalPolicy.granular.mcp_elicitations).toBe(true)
      expect(launched.params.approvalsReviewer).toBe('user')
      expect(launched.params.developerInstructions).toContain('including its entire .agents directory, is writable')
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
      for (const folder of ['.agents/notes', '.agents/custom', '.codex', '.aws']) await mkdir(join(lease.checkout.path, folder), { recursive: true })
      await writeFile(join(lease.checkout.path, '.agents/notes/existing.md'), 'original note')
      await writeFile(join(lease.checkout.path, '.agents/custom/config.json'), '{}')
      await writeFile(join(lease.checkout.path, '.codex/config.toml'), '# protected')
      await writeFile(join(lease.checkout.path, '.aws/config'), '# protected')
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
attempt('edit-note',()=>fs.writeFileSync(path.join(work,'.agents/notes/existing.md'),'updated note'));
attempt('create-note',()=>{const dir=path.join(work,'.agents/notes/new');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'new.md'),'new note')});
attempt('edit-agents-other',()=>fs.writeFileSync(path.join(work,'.agents/custom/config.json'),'{"updated":true}'));
attempt('atomic-note',()=>{const file=path.join(work,'.agents/notes/existing.md');fs.writeFileSync(file+'.tmp','atomic note');fs.renameSync(file+'.tmp',file)});
attempt('write-codex',()=>fs.writeFileSync(path.join(work,'.codex/config.toml'),'escaped'));
attempt('write-aws',()=>fs.writeFileSync(path.join(work,'.aws/config'),'escaped'));
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
      expect(checks.filter(check => check.allowed).map(check => check.name)).toEqual(['read-git', 'edit-code', 'edit-note', 'create-note', 'edit-agents-other', 'atomic-note'])
      expect(checks).toHaveLength(19)
      expect(await readFile(join(lease.checkout.path, '.agents/notes/existing.md'), 'utf8')).toBe('atomic note')
      expect(await readFile(join(lease.checkout.path, '.agents/notes/new/new.md'), 'utf8')).toBe('new note')
      expect(await readFile(join(lease.checkout.path, '.codex/config.toml'), 'utf8')).toBe('# protected')
      expect(await readFile(join(lease.checkout.path, '.aws/config'), 'utf8')).toBe('# protected')
      expect(await readFile(outside, 'utf8')).toBe('outside')
      expect(await readFile(join(fixture.repo, 'feature.txt'), 'utf8')).toBe('initial\n')
      expect(await readFile(join(lease.checkout.path, 'feature.txt'), 'utf8')).toBe('initial\n')
      expect(await readFile(join(lease.checkout.path, '.git'), 'utf8')).toBe(originalPointer)
      expect(await readFile(join(lease.checkout.gitDir, 'HEAD'), 'utf8')).toBe(originalHead)
      expect(await fixture.git(['show-ref', '--verify', 'refs/heads/protected-branch'])).toContain('refs/heads/protected-branch')
    } finally { await fixture.dispose() }
  })
})

it.skipIf(!binary || process.platform !== 'win32')('protects nested worktree files when explicitly reusing the parent checkout on Windows MXC', async () => {
  const f = await environmentFixture()
  try {
    const nested = join(f.repo, 'nested-checkout')
    await f.git(['worktree', 'add', '-b', 'nested-checkout', nested])
    const work = await f.work()
    await f.service.reuse(f.workspace.workspaceId, { workId: work.id, path: f.repo, branch: 'main', includeChanges: true })
    const lease = await f.service.acquire(f.workspace.workspaceId, work.id), policy = workerPermissions(lease)
    const script = join(f.root, 'nested-boundary.cjs')
    await writeFile(script, `const fs=require('node:fs'),path=require('node:path');const [parent,nested]=process.argv.slice(2);fs.writeFileSync(path.join(parent,'allowed.txt'),'allowed');let denied=false;try{fs.writeFileSync(path.join(nested,'feature.txt'),'escaped')}catch{denied=true}process.stdout.write(JSON.stringify({denied}));`)
    const { stdout } = await exec(binary!, [...policy.configOverrides.flatMap(value => ['-c', value]), 'sandbox', '--include-managed-config', '-P', policy.profile, '-C', policy.cwd, '--', process.execPath, script, f.repo, nested], { cwd: f.repo, windowsHide: true, timeout: 30000, encoding: 'utf8' })
    expect(JSON.parse(stdout)).toEqual({ denied: true })
    expect(await readFile(join(nested, 'feature.txt'), 'utf8')).toBe('initial\n')
  } finally { await f.dispose() }
})

it.skipIf(!binary || process.platform !== 'win32')('completes directory trust through the real native configuration API before starting a managed thread', async () => {
  const f = await environmentFixture(), engine = new CodexConversation('native-trust', () => {})
  let pending: Promise<void> | undefined
  try {
    const home = join(f.root, 'isolated-codex'); await mkdir(home)
    await writeFile(join(home, 'config.toml'), 'model="probe"\nmodel_provider="local"\ncheck_for_update_on_startup=false\n[model_providers.local]\nname="Trust test"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n')
    pending = engine.startManaged({ command: binary!, args: ['-c', 'features.plugins=false', '-c', 'features.hooks=false'], cwd: f.repo,
      env: { ...process.env, CODEX_HOME: home }, configure: () => ({}) })
    void pending.catch(() => undefined)
    await vi.waitFor(() => expect(engine.snapshot().startup?.kind, engine.snapshot().error ?? '').toBe('trust'), { timeout: 15000 })
    expect(engine.snapshot().threadId).toBeNull()
    const state = engine.snapshot()
    await engine.command({ type: 'startup', startupId: state.startup!.id, controlEpoch: state.controlEpoch, action: 'trust' })
    await pending
    expect(engine.snapshot().startup).toBeUndefined()
    expect(engine.snapshot().threadId).toBeTruthy()
    const config = parse(await readFile(join(home, 'config.toml'), 'utf8')) as any
    expect(Object.values(config.projects).some((row: any) => row.trust_level === 'trusted')).toBe(true)
  } finally { await engine.dispose(); await pending?.catch(() => undefined); await f.dispose() }
})
