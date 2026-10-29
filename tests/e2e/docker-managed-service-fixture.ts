// Synthetic installer only. Never shipped: the test bundles this entry into an isolated signed package.
import { startNativePlugin } from '@janusx/plugin-sdk/native'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DockerCli } from '../../plugins/docker/src/main/cli'
import { ManagedWsl, installScript } from '../../plugins/docker/src/main/managed-wsl'
import { createDockerService } from '../../plugins/docker/src/main/service'
import { Environments } from '../../plugins/docker/src/main/environments'
import type { Execute } from '../../plugins/docker/src/main/runtime-process'
declare const FIXTURE_WSL_PATH: string
startNativePlugin(async (context, host) => {
  const root = (context as { directory: string }).directory
  let exists = false, installed = false, running = false, owner = '', attempt = 0
  const managed = new ManagedWsl(join(root, 'runtime'), host, {
    platform: 'win32', architecture: 'x64', wsl: FIXTURE_WSL_PATH,
    async run(_file, args, settings) {
      if (args[0] === '--list') return exists ? 'JanusX-Docker' : ''
      if (args[0] === '--import') { exists = true; return '' }
      if (args.includes('/etc/janusx-docker-owner')) return owner
      if (args.includes('/proc/sys/kernel/osrelease')) return '6.6-microsoft-standard-WSL2'
      if (args.includes('/usr/bin/test')) { if (!installed) throw new Error('not installed'); return '' }
      if (settings?.input === installScript) { await new Promise(resolve => setTimeout(resolve, 6000)); installed = true; return '' }
      if (settings?.input?.includes('/etc/janusx-docker-owner')) { owner = JSON.parse(await readFile(join(root, 'runtime/owner.json'), 'utf8')).id; return '' }
      if (args.includes('/usr/bin/docker')) { if (!running) throw new Error('not running'); return '28-fixture' }
      throw new Error('unexpected synthetic installer command')
    },
    async download(_file, _signal, progress) {
      attempt++; progress(25); await new Promise(resolve => setTimeout(resolve, 250))
      if (attempt === 1) throw new Error('fixture-download-failed')
      progress(100)
    },
    async launch() { running = true }, async elevate() { throw new Error('Synthetic installer must never elevate') },
  })
  const cli = new DockerCli(undefined, async () => { throw new Error('docker-cli-missing') })
  let emptyInstalled = false
  const run: Execute = async (_file, args, settings) => {
    if (args[0] === '--list') return 'Ubuntu-24.04\nUbuntu-Empty\nDebian'
    if (args.includes('/proc/sys/kernel/osrelease')) return '6.6-microsoft-standard-WSL2'
    if (args.includes('/etc/os-release')) return args[1] === 'Debian' ? 'ID=debian' : 'ID=ubuntu'
    if (settings?.input) { await new Promise(resolve => setTimeout(resolve, 1800)); emptyInstalled = true; return '' }
    if (args.includes('/usr/bin/test')) { if (args[1] === 'Ubuntu-Empty' && !emptyInstalled) throw new Error('missing'); return '' }
    if (args.includes('/usr/bin/docker')) return '28-fixture'
    throw new Error('Unexpected existing distro invocation')
  }
  const environments = new Environments(root, managed, { run, platform: 'win32' })
  const service = await createDockerService(context, host, cli, managed, environments)
  return { ...service, async stop() { await service.stop(); await rm(join(root, 'runtime/install.lock'), { force: true }) } }
})
