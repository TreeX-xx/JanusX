import { runProcess } from '../platform/process-host'

// Note: .agents/notes/workbench/file-tree-reveal-race.md — bound background refresh work.
const MAX_CONCURRENT_CHECKS = 2
const CHECK_TIMEOUT_MS = 3000
type Batch = { paths: Set<string>; resolve: Array<(ignored: Set<string>) => void> }
const queued = new Map<string, Batch>()
let active = 0
let scheduled = false

/** All directory requests queued for a root share one git process. */
export function getGitIgnoredPaths(rootPath: string, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return Promise.resolve(new Set())
  return new Promise((resolve) => {
    let batch = queued.get(rootPath)
    if (!batch) {
      batch = { paths: new Set(), resolve: [] }
      queued.set(rootPath, batch)
    }
    paths.forEach(path => batch.paths.add(path))
    batch.resolve.push(resolve)
    if (!scheduled) {
      scheduled = true
      setTimeout(() => { scheduled = false; pump() }, 0)
    }
  })
}

function pump(): void {
  while (active < MAX_CONCURRENT_CHECKS && queued.size) {
    const [root, batch] = queued.entries().next().value!
    queued.delete(root)
    active++
    void check(root, [...batch.paths]).catch(() => new Set<string>()).then(ignored => {
      batch.resolve.forEach(resolve => resolve(ignored))
    }).finally(() => { active--; pump() })
  }
}

async function check(root: string, paths: string[]): Promise<Set<string>> {
  const result = await runProcess('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, input: paths.join('\0') + '\0', timeoutMs: CHECK_TIMEOUT_MS,
  })
  return result.status === 'exited' && (result.exitCode === 0 || result.exitCode === 1)
    ? new Set(result.stdout.split('\0').filter(Boolean).map(path => path.replace(/\\/g, '/').replace(/\/$/, '')))
    : new Set()
}
