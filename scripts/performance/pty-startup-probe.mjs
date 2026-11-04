// Isolated Windows PTY startup probe. Runs only a cmd ready marker.
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pty from 'node-pty'

if (process.argv[2] === '--child') {
  const bundled = process.argv[3] === 'bundled'
  const respond = process.argv[4] === 'respond'
  const start = performance.now()
  const terminal = pty.spawn('cmd.exe', ['/d', '/q', '/c', 'echo JANUS_READY'], {
    cwd: process.cwd(), cols: 120, rows: 40, useConpty: true, useConptyDll: bundled,
  })
  const spawnMs = performance.now() - start
  let output = '', readyMs, firstDataMs
  const timer = setTimeout(() => { terminal.kill(); process.exit(2) }, 15000)
  terminal.onData(data => {
    firstDataMs ??= performance.now() - start
    output += data
    if (respond && data.includes('\x1b[6n')) terminal.write('\x1b[1;1R')
    if (respond && data.includes('\x1b[c')) terminal.write('\x1b[?1;2c')
    if (output.includes('JANUS_READY')) readyMs ??= performance.now() - start
  })
  terminal.onExit(() => {
    clearTimeout(timer)
    console.log(JSON.stringify({ bundled, respond, spawnMs, firstDataMs, readyMs, output }))
    process.exit(readyMs === undefined ? 1 : 0)
  })
} else {
  const results = []
  for (let sample = 0; sample < 3; sample++) {
    const modes = sample % 2 ? ['system', 'bundled'] : ['bundled', 'system']
    for (const mode of modes) for (const response of ['silent', 'respond']) {
      const child = spawnSync(process.execPath, [import.meta.filename, '--child', mode, response], { encoding: 'utf8', timeout: 20000, windowsHide: true })
      if (child.status !== 0) throw Error(child.stderr || `Probe failed: ${child.status}`)
      const result = { sample, ...JSON.parse(child.stdout) }
      results.push(result); console.log(JSON.stringify(result))
    }
  }
  const directory = resolve('artifacts/terminal-startup-investigation')
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'pty.json'), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2))
}
