import { runtimePathKey } from '../../shared/runtime/path-identity'
/**
 * @file Workspace identity for knowledge provenance (Phase 0).
 * @description Resolves the registered workspace record id from a filesystem
 *              cwd so tool-driven capture points (git / checkpoint / analyzer)
 *              stamp the same `workspaceId` as chat and agent capture points.
 *              Falls back to the directory basename only when no record
 *              matches, and marks that fallback explicitly.
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import type { CaptureObservationInput, Observation, StructuredCloneValue } from '../../shared/knowledge'
import { knowledgeObservationService } from './observation-service'

export interface WorkspaceIdentity {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  /** True when no registered workspace record matched `workspacePath`. */
  fallback: boolean
}

interface WorkspaceRecordShape {
  id?: unknown
  name?: unknown
  path?: unknown
}

const CACHE_TTL_MS = 5_000

let workspacesDirOverride: string | null = null
let cache: { loadedAt: number; records: Array<{ id: string; name: string; path: string; key: string }> } | null = null

/** Test / composition-root hook: point the resolver at a custom workspaces directory. */
export function configureKnowledgeWorkspacesDir(dir: string | null): void {
  workspacesDirOverride = dir
  cache = null
}

function workspacesDir(): string {
  return workspacesDirOverride ?? join(app.getPath('userData'), 'janusx', 'workspaces')
}

/** Normalizes a path for equality: absolute, forward slashes, no trailing slash, case-folded on Windows. */
export function workspacePathKey(path: string): string {
  return runtimePathKey(resolve(path.trim()))
}

async function loadRecords(): Promise<NonNullable<typeof cache>['records']> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.records

  const dir = workspacesDir()
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch {
    files = []
  }

  const records: NonNullable<typeof cache>['records'] = []
  for (const file of files) {
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as WorkspaceRecordShape
      if (typeof raw.id !== 'string' || !raw.id || typeof raw.path !== 'string' || !raw.path) continue
      records.push({
        id: raw.id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : basename(raw.path),
        path: raw.path,
        key: workspacePathKey(raw.path),
      })
    } catch {
      // Malformed record: skip; the workspace IPC layer owns repair.
    }
  }

  cache = { loadedAt: now, records }
  return records
}

/**
 * Resolves the registered workspace whose `path` equals `cwd` after normalization.
 * When nothing matches, returns a basename fallback with `fallback: true`.
 */
export async function resolveWorkspaceIdentity(cwd: string): Promise<WorkspaceIdentity> {
  const workspacePath = cwd.trim()
  const key = workspacePathKey(workspacePath)
  const match = (await loadRecords()).find((record) => record.key === key)
  if (match) {
    return { workspaceId: match.id, workspaceName: match.name, workspacePath, fallback: false }
  }
  const name = basename(resolve(workspacePath)) || 'workspace'
  return { workspaceId: name, workspaceName: name, workspacePath, fallback: true }
}

/**
 * Builds the workspace provenance fields for a capture input from a cwd.
 * Merges `metadata.workspaceIdFallback=true` when the id had to be guessed.
 */
export async function workspaceProvenanceFor(
  cwd: string,
  metadata?: Record<string, StructuredCloneValue>,
): Promise<{
  workspaceId: string
  workspaceName: string
  workspacePath: string
  metadata?: Record<string, StructuredCloneValue>
}> {
  const identity = await resolveWorkspaceIdentity(cwd)
  const merged = identity.fallback ? { ...(metadata ?? {}), workspaceIdFallback: true } : metadata
  return {
    workspaceId: identity.workspaceId,
    workspaceName: identity.workspaceName,
    workspacePath: identity.workspacePath,
    metadata: merged,
  }
}

let captureFailureCount = 0

/** Knowledge capture is fire-and-forget; failures must still be visible in main-process logs. */
export function logKnowledgeCaptureFailure(error: unknown): void {
  captureFailureCount += 1
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[knowledge] capture failed (#${captureFailureCount}): ${message}`)
}

export function knowledgeCaptureFailureCount(): number {
  return captureFailureCount
}

export type CwdCaptureInput = Omit<CaptureObservationInput, 'workspaceId' | 'workspaceName' | 'workspacePath'>

/**
 * Capture helper for cwd-only call sites (git / checkpoint / analyzer):
 * resolves the registered workspace identity first, then captures.
 */
export async function captureForCwd(cwd: string, input: CwdCaptureInput): Promise<Observation> {
  const provenance = await workspaceProvenanceFor(cwd, input.metadata)
  return knowledgeObservationService.capture({ ...input, ...provenance })
}
