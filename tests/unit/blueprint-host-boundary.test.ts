import { describe, expect, it } from 'vitest'
import { build, type BuildOptions } from 'esbuild'
import { resolve } from 'node:path'

// Note: downloadable Blueprint code must leave the host bundle — see .agents/notes/planning/blueprint-official-plugin.md

const ROOT = resolve(import.meta.dirname, '../..')

const MAIN: BuildOptions = { entryPoints: ['src/main/index.ts'], platform: 'node' }
const BACKEND: BuildOptions = { entryPoints: ['src/main/workspace/backend-entry.ts'], platform: 'node' }
const RENDERER: BuildOptions = {
  entryPoints: ['src/renderer/src/main.tsx'],
  outdir: 'artifacts/host-boundary-renderer',
  platform: 'browser',
  loader: { '.css': 'empty', '.module.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
}

/** Bundle inputs actually compiled into an entry, normalized to repository-relative POSIX paths. */
async function bundleInputs(options: BuildOptions): Promise<string[]> {
  const result = await build({
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    format: 'esm',
    logLevel: 'silent',
    ...options,
  })
  return Object.keys(result.metafile!.inputs).map(input => input.replaceAll('\\', '/')).sort()
}

const pluginSources = (inputs: string[]) => inputs.filter(input => input.startsWith('plugins/blueprint/'))
const hostBlueprintSources = (inputs: string[]) =>
  inputs.filter(input => /^src\/(?:main|renderer\/src)\/.*blueprint/i.test(input))

/*
 * Ratchet: the residual Blueprint sources each host entry still compiles in (2026-10-26 baseline).
 * New entries fail the test. When a cleanup step removes a dependency, delete it here in the same
 * change; the exact match also fails until the list is shrunk, so progress cannot silently regress.
 */
const RESIDUAL = {
  main: {
    plugin: [
      'plugins/blueprint/src/main/blueprint/blueprint-composition.ts',
      'plugins/blueprint/src/main/janus/blueprint-factory.ts',
      'plugins/blueprint/src/main/janus/blueprint-migration.ts',
      'plugins/blueprint/src/main/janus/blueprint-persistence.ts',
      'plugins/blueprint/src/main/janus/maintenance/audit-records.ts',
      'plugins/blueprint/src/main/janus/maintenance/changeset.ts',
      'plugins/blueprint/src/main/janus/requirement-candidates.ts',
      'plugins/blueprint/src/main/notes/note-authoring.ts',
      'plugins/blueprint/src/main/notes/note-to-blueprint.ts',
      'plugins/blueprint/src/main/notes/note-types.ts',
      'plugins/blueprint/src/main/notes/projection.ts',
      'plugins/blueprint/src/main/notes/workspace-blueprint.ts',
      'plugins/blueprint/src/shared/ipc/blueprint-review.ts',
      'plugins/blueprint/src/shared/janus/relations.ts',
    ],
    host: [
      'src/main/blueprint/note-service.ts',
      'src/main/harness/workspace-blueprint.ts',
      'src/main/ipc/blueprint-review-handlers.ts',
      'src/main/janus/blueprint-migrate.ts',
      'src/main/janus/blueprint-paths.ts',
      'src/main/janus/blueprint-store.ts',
      'src/main/plugins/legacy-blueprint.ts',
    ],
  },
  backend: {
    plugin: [
      'plugins/blueprint/src/main/blueprint/blueprint-composition.ts',
      'plugins/blueprint/src/main/notes/note-to-blueprint.ts',
      'plugins/blueprint/src/main/notes/note-types.ts',
      'plugins/blueprint/src/main/notes/projection.ts',
      'plugins/blueprint/src/main/notes/workspace-blueprint.ts',
    ],
    host: [
      'src/main/blueprint/note-service.ts',
      'src/main/harness/workspace-blueprint.ts',
    ],
  },
  renderer: {
    plugin: [] as string[],
    // Shared UI still living under blueprint directories; to be extracted into common components.
    host: [
      'src/renderer/src/components/blueprint/NoteChatActivity.module.css',
      'src/renderer/src/components/blueprint/NoteChatActivity.tsx',
      'src/renderer/src/components/blueprint/NoteTimelineDetails.tsx',
      'src/renderer/src/components/blueprint/PromptDialog.css',
      'src/renderer/src/components/blueprint/PromptDialog.tsx',
      'src/renderer/src/components/blueprint/note-focus.css',
      'src/renderer/src/features/blueprint/resolveNodeWorkspace.ts',
      'src/renderer/src/features/blueprint/review-diff.ts',
    ],
  },
}

it('builds the application without the legacy Blueprint review, suggestions or maintenance runtime', async () => {
  const inputs = await bundleInputs(MAIN)
  const business = inputs.filter(input =>
    /^(?:plugins\/blueprint\/src\/main\/(?:blueprint\/(?:review|suggestions)\/|janus\/maintenance\/(?:service|native-service|native-models|proposal-context|blueprint-tools|dispatch-brief)\.)|src\/main\/(?:blueprint\/review\/|janus\/maintenance\/|janus\/analyzer\.))/.test(input),
  )
  expect(business).toEqual([])
  expect(inputs).toContain('src/main/harness/service.ts')
}, 30_000)

it('builds the renderer without loading retired Blueprint stores or business views', async () => {
  const inputs = await bundleInputs(RENDERER)
  expect(inputs.filter(input =>
    /^(?:plugins\/blueprint\/src\/renderer\/|src\/renderer\/src\/(?:stores\/(?:blueprint(?:-maintenance|-review)?|note-repair)\.|services\/blueprint(?:-review|-loading)?\.|components\/blueprint\/Blueprint(?:View|Workbench)\.))/.test(input),
  )).toEqual([])
  expect(inputs).toContain('src/renderer/src/features/workspace/useWorkspaceBootstrap.ts')
  expect(inputs).toContain('src/renderer/src/stores/note-chat.ts')
}, 30_000)

describe('residual Blueprint sources compiled into host entries only shrink', () => {
  for (const [name, options] of [['main', MAIN], ['backend', BACKEND], ['renderer', RENDERER]] as const) {
    it(name, async () => {
      const inputs = await bundleInputs(options)
      expect(pluginSources(inputs), `${name}: plugins/blueprint sources`).toEqual([...RESIDUAL[name].plugin].sort())
      expect(hostBlueprintSources(inputs), `${name}: host blueprint sources`).toEqual([...RESIDUAL[name].host].sort())
    }, 30_000)
  }
})
