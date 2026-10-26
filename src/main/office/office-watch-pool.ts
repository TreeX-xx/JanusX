import { createServer } from 'node:net'
import { isAbsolute, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execa } from 'execa'
import type { OfficePreviewLease, OfficeWatchErrorCode, OfficeWatchEvictedEvent } from '../../shared/office'
import { officecliManager } from './officecli-manager'
import { createOfficePreviewProxy } from './office-preview-proxy'
import type { ResolveWorkspaceRoot, TrustedOfficeFile } from './office-workspace-guard'
import { resolveTrustedOfficeWorkspace } from './office-workspace-guard'
import {
  readinessFailureCode,
  waitForOfficeWatchReady,
  type OfficeWatchReadyChild,
} from './office-watch-ready'

export const MAX_CONCURRENT_WATCHES = 32
const START_TIMEOUT_MS = 8_000
const MAX_START_ATTEMPTS = 2

interface WatchChild extends OfficeWatchReadyChild {
  stop(): Promise<void>
}

interface ReadyEntry {
  child: WatchChild
  port: number
  canonicalPath: string
  relPath: string
  rootPath: string
  workspaceId: string
  leases: Set<string>
  startedAt: number
}

interface ReloadOperation {
  key: string
  file: TrustedOfficeFile
  epoch: number
  done: Promise<void>
  finish(): void
}

interface OfficeWatchPoolDependencies {
  decoratePreview(port: number): Promise<{ port: number; stop(): Promise<void> }>
  resolveProvider(): Promise<{ installed: boolean; compatible: boolean; path?: string }>
  allocatePort(): Promise<number>
  spawn(binary: string, filePath: string, port: number): WatchChild
  reach(port: number): Promise<boolean>
  now(): number
  leaseId(): string
  onEvicted(event: OfficeWatchEvictedEvent): void
  startTimeoutMs: number
  maxConcurrent: number
}

export class OfficeWatchPoolError extends Error {
  constructor(readonly code: OfficeWatchErrorCode) {
    super(code)
    this.name = 'OfficeWatchPoolError'
  }
}

async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('NO_PORT'))
      })
    })
  })
}

function spawnWatch(binary: string, filePath: string, port: number): WatchChild {
  const subprocess = execa(binary, ['watch', filePath, '--port', String(port)], {
    shell: false,
    reject: false,
    windowsHide: true,
    stdout: 'pipe',
    stderr: 'pipe',
    forceKillAfterDelay: 1_000,
  })
  const exited = subprocess.then(() => undefined, () => undefined)
  return {
    stdout: subprocess.stdout!,
    stderr: subprocess.stderr!,
    exited,
    isAlive: () => isOfficeWatchProcessRunning(subprocess),
    stop: () => stopOfficeWatchProcess(subprocess, exited),
  }
}

export interface OfficeWatchProcessState {
  exitCode: number | null
  signalCode: string | null
  killed: boolean
}

export function isOfficeWatchProcessRunning(subprocess: OfficeWatchProcessState): boolean {
  return subprocess.exitCode === null && subprocess.signalCode === null && !subprocess.killed
}

export async function stopOfficeWatchProcess(
  subprocess: OfficeWatchProcessState & { kill(signal: 'SIGTERM'): unknown },
  exited: Promise<void>,
): Promise<void> {
  if (isOfficeWatchProcessRunning(subprocess)) subprocess.kill('SIGTERM')
  await exited
}

async function defaultReach(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(250),
    })
    return response.status < 500
  } catch {
    return false
  }
}

const defaultDependencies: OfficeWatchPoolDependencies = {
  decoratePreview: createOfficePreviewProxy,
  resolveProvider: () => officecliManager.detect(),
  allocatePort: allocateFreePort,
  spawn: spawnWatch,
  reach: defaultReach,
  now: Date.now,
  leaseId: randomUUID,
  onEvicted: () => {},
  startTimeoutMs: START_TIMEOUT_MS,
  maxConcurrent: MAX_CONCURRENT_WATCHES,
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export class OfficeWatchPool {
  private readonly starting = new Map<string, Promise<ReadyEntry>>()
  private readonly startingFiles = new Map<string, TrustedOfficeFile>()
  private readonly startingChildren = new Map<string, WatchChild>()
  private readonly ready = new Map<string, ReadyEntry>()
  private readonly leaseToKey = new Map<string, string>()
  private readonly targetEpoch = new Map<string, number>()
  private readonly reloadOperations = new Map<string, ReloadOperation>()
  private readonly deps: OfficeWatchPoolDependencies
  private stoppingAll = false
  private readonly stoppingRoots = new Set<string>()

  constructor(
    private readonly resolveWorkspaceRoot: ResolveWorkspaceRoot,
    dependencies: Partial<OfficeWatchPoolDependencies> = {},
  ) {
    this.deps = { ...defaultDependencies, ...dependencies }
  }

  async acquire(file: TrustedOfficeFile): Promise<OfficePreviewLease> {
    const key = file.filePath
    if (this.stoppingAll || Array.from(this.stoppingRoots).some((root) => isWithinRoot(root, key))) {
      throw new OfficeWatchPoolError('START_FAILED')
    }

    let entry = this.ready.get(key)
    if (entry && !entry.child.isAlive()) {
      this.evictCrashed(entry)
      entry = undefined
    }
    if (!entry) {
      let pending = this.starting.get(key)
      if (!pending) {
        if (this.starting.size + this.ready.size >= this.deps.maxConcurrent) {
          throw new OfficeWatchPoolError('TOO_MANY')
        }
        pending = this.beginStart(file)
        this.starting.set(key, pending)
        this.startingFiles.set(key, file)
      }
      entry = await pending
    }

    if (this.ready.get(key) !== entry) throw new OfficeWatchPoolError('START_FAILED')
    const previewLeaseId = this.deps.leaseId()
    entry.leases.add(previewLeaseId)
    this.leaseToKey.set(previewLeaseId, key)
    return { previewLeaseId, port: entry.port, relPath: file.relPath }
  }

  async release(previewLeaseId: string, expectedCanonicalPath?: string): Promise<void> {
    const reload = this.reloadOperations.get(previewLeaseId)
    if (reload && (!expectedCanonicalPath || reload.key === expectedCanonicalPath)) {
      this.bumpEpoch(reload.key)
      await reload.done
      return
    }
    await this.releaseLease(previewLeaseId, expectedCanonicalPath)
  }

  private async releaseLease(previewLeaseId: string, expectedCanonicalPath?: string): Promise<void> {
    const key = this.leaseToKey.get(previewLeaseId)
    if (!key || (expectedCanonicalPath && key !== expectedCanonicalPath)) return
    const entry = this.ready.get(key)
    this.leaseToKey.delete(previewLeaseId)
    if (!entry) return
    entry.leases.delete(previewLeaseId)
    if (entry.leases.size > 0) return
    this.ready.delete(key)
    await this.stopChild(entry.child)
    this.cleanupEpoch(key)
  }

  async reload(previewLeaseId: string, file: TrustedOfficeFile): Promise<OfficePreviewLease> {
    const key = file.filePath
    if (this.leaseToKey.get(previewLeaseId) !== key || this.reloadOperations.has(previewLeaseId)) {
      throw new OfficeWatchPoolError('START_FAILED')
    }
    let finish!: () => void
    const operation: ReloadOperation = {
      key,
      file,
      epoch: this.bumpEpoch(key),
      done: new Promise<void>((resolve) => { finish = resolve }),
      finish: () => finish(),
    }
    this.reloadOperations.set(previewLeaseId, operation)
    try {
      await this.releaseLease(previewLeaseId, key)
      if (this.targetEpoch.get(key) !== operation.epoch) throw new OfficeWatchPoolError('START_FAILED')
      const replacement = await this.acquire(file)
      if (this.targetEpoch.get(key) !== operation.epoch) {
        await this.releaseLease(replacement.previewLeaseId, key)
        throw new OfficeWatchPoolError('START_FAILED')
      }
      return replacement
    } finally {
      if (this.reloadOperations.get(previewLeaseId) === operation) {
        this.reloadOperations.delete(previewLeaseId)
      }
      operation.finish()
      this.cleanupEpoch(key)
    }
  }

  async stopUnderRoot(workspaceId: string): Promise<void> {
    let root: string | undefined
    try {
      root = (await resolveTrustedOfficeWorkspace(workspaceId, this.resolveWorkspaceRoot)).rootPath
      if (root.startsWith('janusx-workspace://')) root = undefined
    } catch {}
    if (root) this.stoppingRoots.add(root)
    try {
      const cancelledReloads = this.cancelReloads((operation) =>
        root ? isWithinRoot(root, operation.key) : operation.file.workspaceId === workspaceId,
      )
      const pending = this.removeStarting((key, file) =>
        root ? isWithinRoot(root, key) : file?.workspaceId === workspaceId,
      )
      const stops = this.removeReady((entry) =>
        root ? isWithinRoot(root, entry.canonicalPath) : entry.workspaceId === workspaceId,
      'workspace-removed')
      await Promise.allSettled([...cancelledReloads, ...pending, ...stops])
    } finally {
      if (root) this.stoppingRoots.delete(root)
    }
  }

  async stopAll(): Promise<void> {
    this.stoppingAll = true
    try {
      const cancelledReloads = this.cancelReloads(() => true)
      const pending = this.removeStarting(() => true)
      const stops = this.removeReady(() => true, 'shutdown')
      this.leaseToKey.clear()
      await Promise.allSettled([...cancelledReloads, ...pending, ...stops])
    } finally {
      this.stoppingAll = false
    }
  }

  private beginStart(file: TrustedOfficeFile): Promise<ReadyEntry> {
    const key = file.filePath
    let promise!: Promise<ReadyEntry>
    promise = this.start(file, () => this.starting.get(key) === promise).then(async (entry) => {
      if (this.starting.get(key) !== promise) {
        await this.stopChild(entry.child)
        throw new OfficeWatchPoolError('START_FAILED')
      }
      this.ready.set(key, entry)
      void entry.child.exited.then(() => this.handleCrash(entry))
      return entry
    }).finally(() => {
      if (this.starting.get(key) === promise) {
        this.starting.delete(key)
        this.startingFiles.delete(key)
        this.startingChildren.delete(key)
      }
    })
    return promise
  }

  private async start(file: TrustedOfficeFile, isCurrent: () => boolean): Promise<ReadyEntry> {
    const provider = await this.deps.resolveProvider()
    if (!provider.installed) throw new OfficeWatchPoolError('NOT_INSTALLED')
    if (!provider.compatible || !provider.path || !isAbsolute(provider.path)) {
      throw new OfficeWatchPoolError('INCOMPATIBLE')
    }

    const deadline = this.deps.now() + this.deps.startTimeoutMs
    let lastCode: OfficeWatchErrorCode = 'START_FAILED'
    for (let attempt = 0; attempt < MAX_START_ATTEMPTS && this.deps.now() < deadline; attempt++) {
      let child: WatchChild | undefined
      try {
        let port: number
        try {
          port = await this.deps.allocatePort()
        } catch {
          throw new OfficeWatchPoolError('NO_PORT')
        }
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new OfficeWatchPoolError('NO_PORT')
        }
        if (!isCurrent()) throw new OfficeWatchPoolError('START_FAILED')
        child = this.deps.spawn(provider.path, file.filePath, port)
        this.startingChildren.set(file.filePath, child)
        await waitForOfficeWatchReady({
          child,
          port,
          deadline,
          now: this.deps.now,
          reach: this.deps.reach,
        })
        const proxy = await this.deps.decoratePreview(port)
        const source = child
        let proxyStop: Promise<void> | undefined
        const stopProxy = () => proxyStop ??= proxy.stop()
        // The proxy shares the watch lifetime, including failed starts and crashes.
        void source.exited.then(stopProxy)
        child = { stdout: source.stdout, stderr: source.stderr, exited: source.exited,
          isAlive: () => source.isAlive(), stop: async () => { await stopProxy(); await source.stop() } }
        this.startingChildren.set(file.filePath, child)
        return {
          child,
          port: proxy.port,
          canonicalPath: file.filePath,
          relPath: file.relPath,
          rootPath: file.rootPath,
          workspaceId: file.workspaceId,
          leases: new Set(),
          startedAt: this.deps.now(),
        }
      } catch (error) {
        lastCode = error instanceof OfficeWatchPoolError ? error.code : readinessFailureCode(error)
        if (child) await this.stopChild(child)
        if (this.startingChildren.get(file.filePath) === child) {
          this.startingChildren.delete(file.filePath)
        }
        if (lastCode === 'NO_PORT' || !isCurrent()) break
      }
    }
    throw new OfficeWatchPoolError(lastCode)
  }

  private async handleCrash(entry: ReadyEntry): Promise<void> {
    this.evictCrashed(entry)
  }

  private evictCrashed(entry: ReadyEntry): void {
    if (this.ready.get(entry.canonicalPath) !== entry) return
    this.ready.delete(entry.canonicalPath)
    const previewLeaseIds = Array.from(entry.leases)
    previewLeaseIds.forEach((id) => this.leaseToKey.delete(id))
    entry.leases.clear()
    this.emitEvicted({ previewLeaseIds, relPath: entry.relPath, reason: 'crashed' })
    this.cleanupEpoch(entry.canonicalPath)
  }

  private removeStarting(predicate: (key: string, file?: TrustedOfficeFile) => boolean): Promise<unknown>[] {
    const removed: Promise<unknown>[] = []
    for (const [key, pending] of this.starting) {
      if (!predicate(key, this.startingFiles.get(key))) continue
      this.starting.delete(key)
      this.startingFiles.delete(key)
      removed.push(pending)
      const child = this.startingChildren.get(key)
      this.startingChildren.delete(key)
      if (child) removed.push(this.stopChild(child))
    }
    return removed
  }

  private removeReady(
    predicate: (entry: ReadyEntry) => boolean,
    reason: Extract<OfficeWatchEvictedEvent['reason'], 'workspace-removed' | 'shutdown'>,
  ): Promise<void>[] {
    const stops: Promise<void>[] = []
    for (const [key, entry] of this.ready) {
      if (!predicate(entry)) continue
      this.ready.delete(key)
      const previewLeaseIds = Array.from(entry.leases)
      previewLeaseIds.forEach((id) => this.leaseToKey.delete(id))
      entry.leases.clear()
      if (previewLeaseIds.length > 0) {
        this.emitEvicted({ previewLeaseIds, relPath: entry.relPath, reason })
      }
      stops.push(this.stopChild(entry.child))
      this.cleanupEpoch(key)
    }
    return stops
  }

  private async stopChild(child: WatchChild): Promise<void> {
    try {
      await child.stop()
    } catch {}
  }

  private emitEvicted(event: OfficeWatchEvictedEvent): void {
    try {
      this.deps.onEvicted(event)
    } catch {}
  }

  private bumpEpoch(key: string): number {
    const epoch = (this.targetEpoch.get(key) ?? 0) + 1
    this.targetEpoch.set(key, epoch)
    return epoch
  }

  private cancelReloads(predicate: (operation: ReloadOperation) => boolean): Promise<void>[] {
    const cancelled = new Set<Promise<void>>()
    const bumped = new Set<string>()
    for (const operation of this.reloadOperations.values()) {
      if (!predicate(operation)) continue
      if (!bumped.has(operation.key)) {
        this.bumpEpoch(operation.key)
        bumped.add(operation.key)
      }
      cancelled.add(operation.done)
    }
    return Array.from(cancelled)
  }

  private cleanupEpoch(key: string): void {
    if (this.ready.has(key) || this.starting.has(key)) return
    if (Array.from(this.reloadOperations.values()).some((operation) => operation.key === key)) return
    this.targetEpoch.delete(key)
  }
}
