// Note: read-only corpus validation — see .agents/notes/blueprint/module-responsibilities.md
import { parseNote, readMarkdownView } from '@janus-agent/harness-core'
import { buildNoteIndex, indexEntries, readIndexedNote, toNoteDoc, toReadSnapshot, toSlimSnapshot } from '@janus-agent/harness-node'
import { projectGraph } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'

/** Use the real parser/projection without mutating the live checkout's cache or leases. */
export async function readCorpus(root = process.cwd()) {
  const index = await buildNoteIndex(root), { entries } = indexEntries(index)
  const blueprint = projectGraph({ repoId: index.repoId, repoName: 'JanusX', entries, revision: 1, snapshot: toSlimSnapshot(index) }, root)
  for (const node of Object.values(blueprint.nodes)) if (node.note) node.note = { ...node.note, body: undefined, sections: [] }
  return {
    blueprint, snapshot: toReadSnapshot(index),
    async read(uri: string) {
      const entry = index.byUri.get(uri)
      if (!entry?.note) throw new Error('Unknown corpus Note: ' + uri)
      const fresh = await readIndexedNote(index, entry.relPath)
      if (!fresh.ok) throw new Error(JSON.stringify(fresh.diagnostics))
      const parsed = parseNote(fresh.text)
      if (parsed.meta.id !== entry.note.meta.id) throw new Error('Corpus identity changed')
      return { uri, relPath: entry.relPath, raw: fresh.text, sourceHash: fresh.sha256,
        indexedSourceHash: fresh.indexedSourceHash, matchesSnapshot: fresh.matchesSnapshot,
        doc: toNoteDoc(parsed), view: readMarkdownView(parsed.body) }
    },
  }
}
