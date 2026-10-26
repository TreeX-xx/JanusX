import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { resolve } from 'node:path'

// Note: downloadable review and maintenance must not enter the host bundle — see .agents/notes/planning/blueprint-official-plugin.md
it('builds the application without the legacy Blueprint review, suggestions or maintenance runtime', async () => {
  const result = await build({
    absWorkingDir: resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
  const business = Object.keys(result.metafile!.inputs).filter(input =>
    /^(?:plugins\/blueprint\/src\/main\/(?:blueprint\/(?:review|suggestions)\/|janus\/maintenance\/(?:service|native-service|native-models|proposal-context|blueprint-tools|dispatch-brief)\.)|src\/main\/(?:blueprint\/review\/|janus\/maintenance\/|janus\/analyzer\.))/.test(input.replaceAll('\\', '/')),
  )
  expect(business).toEqual([])
  expect(Object.keys(result.metafile!.inputs)).toContain('src/main/harness/service.ts')
}, 30_000)

it('builds the renderer without loading retired Blueprint stores or business views', async () => {
  const result = await build({
    absWorkingDir: resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/renderer/src/main.tsx'],
    outdir: 'artifacts/host-boundary-renderer',
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'browser',
    format: 'esm',
    loader: { '.css': 'empty', '.module.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    logLevel: 'silent',
  })
  const inputs = Object.keys(result.metafile!.inputs).map(input => input.replaceAll('\\', '/'))
  expect(inputs.filter(input =>
    /^(?:plugins\/blueprint\/src\/renderer\/|src\/renderer\/src\/(?:stores\/(?:blueprint(?:-maintenance|-review)?|note-repair)\.|services\/blueprint(?:-review|-loading)?\.|components\/blueprint\/Blueprint(?:View|Workbench)\.))/.test(input),
  )).toEqual([])
  expect(inputs).toContain('src/renderer/src/features/workspace/useWorkspaceBootstrap.ts')
  expect(inputs).toContain('src/renderer/src/stores/note-chat.ts')
}, 30_000)
