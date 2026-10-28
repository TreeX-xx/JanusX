import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkNotes } from '../../scripts/check-agent-notes.mjs'
import { checkSkillsSync, normalizeSkillText } from '../../scripts/check-skills-sync.mjs'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'notes-check-'))
  roots.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, body)
  }
  return root
}

const GOOD_IMPLEMENTED = [
  '# Agent Note: Good',
  '',
  'Status: implemented',
  '',
  '## Problem',
  'P.',
  '',
  '## Decision',
  'D.',
  '',
  '## Alternatives considered',
  '- Do nothing / reuse — not viable.',
  '',
  '## Consequences',
  '- **Gains**: x.',
  '- **Costs and limits**: y.',
  '',
].join('\n')

describe('agent-notes mechanical gate', () => {
  it('checks every formal Note in the supplied checkout independently of personal files', async () => {
    const repo = '11111111-1111-4111-8111-111111111111'
    const project = '22222222-2222-4222-8222-222222222222'
    const child = '33333333-3333-4333-8333-333333333333'
    const document = (id: string, extra: object) => `---\n${JSON.stringify({ schema: 'harness-note/2', id,
      kind: 'module', lifecycle: 'accepted', moduleState: 'partial', created: '2026-10-28', updated: '2026-10-28T00:00:00Z',
      ...extra })}\n---\n# Fixture\n\n## Responsibility\nOwn the test fixture.\n\n## Design\nTwo formal Notes.\n`
    const root = await makeTree({
      '.agents/harness.json': JSON.stringify({ schemaVersion: 1, repoId: repo, name: 'Validator fixture', profile: 'harness-note/2' }),
      '.agents/notes/module.md': document(project, { role: 'project' }),
      '.agents/notes/child/module.md': document(child, { parent: `note://${repo}/${project}` }),
    })
    const { errors, checked, harnessChecked, diagnostics } = checkNotes(root)
    expect(errors).toEqual([])
    expect(checked).toBe(0)
    expect(harnessChecked).toBe(2)
    expect(diagnostics).toEqual([])
  })

  it('flags path, header, section, link, and version violations', async () => {
    const root = await makeTree({
      '.agents/notes/implemented/feature/2026-09-19-good.md': GOOD_IMPLEMENTED,
      '.agents/notes/implemented/feature/bad-name.md': GOOD_IMPLEMENTED,
      '.agents/notes/implemented/feature/2026-09-19-no-alt.md': GOOD_IMPLEMENTED.replace('## Alternatives considered', '## Something else'),
      '.agents/notes/implemented/feature/2026-09-19-bad-link.md': GOOD_IMPLEMENTED.replace(
        '- Do nothing / reuse — not viable.',
        '- Do nothing / reuse — not viable. See [ghost](./2026-01-01-ghost.md).',
      ),
      '.agents/notes/implemented/feature/2026-09-19-pinned.md': GOOD_IMPLEMENTED.replace(
        '## Decision\nD.',
        '## Decision\nShipped in v1.2.3.',
      ),
      '.agents/notes/implemented/feature/2026-09-19-wrong-status.md': GOOD_IMPLEMENTED.replace('Status: implemented', 'Status: proposed'),
    })
    const { errors } = checkNotes(root)
    const joined = errors.join('\n')
    expect(joined).toMatch('bad-name.md: filename must be')
    expect(joined).toMatch('no-alt.md: missing required section ## Alternatives considered')
    expect(joined).toMatch('bad-link.md: broken relative link')
    expect(joined).toMatch('pinned.md: implemented/ must not pin')
    expect(joined).toMatch("wrong-status.md: Status must be 'implemented'")
  })

  it('validates harness-note/1 assets in the requested checkout', async () => {
    const root = await makeTree({
      '.agents/notes/2026-09-19-t--33333333.md': [
        '---',
        'schema: harness-note/1',
        'id: 33333333-3333-4333-8333-333333333333',
        'kind: requirement',
        'lifecycle: draft',
        'created: 2026-09-16',
        '---',
        '',
        '# Formal requirement',
        '',
        '## Problem',
        'Existing facts.',
        '',
      ].join('\n'),
    })
    expect(checkNotes(root).errors).toEqual([])
  })
})

describe('modern asset validation', () => {
  it('rejects malformed modern assets and broken source, image and reference links while ignoring code', async () => {
    const header='---\nschema: harness-note/1\nid: 12345678-1234-4234-8234-123456789abc\nkind: requirement\nlifecycle: draft\ncreated: 2026-09-20\n---\n'
    const root=await makeTree({
      '.agents/notes/broken.md':header+'# Broken\n\n## Problem\n\n[source](../../src/missing.ts)\n\n![image](../../missing.png)\n\n[ref][r]\n\n[r]: ./missing.md "Title"\n\n~~~md\n[example](./ignored.md)\n~~~\n',
      '.agents/notes/malformed.md':header.replace('12345678-1234-4234-8234-123456789abc','not-an-id')+'# Invalid\n',
    })
    const result=checkNotes(root)
    expect(result.harnessChecked).toBe(2)
    expect(result.errors.join('\n')).toContain('missing.ts')
    expect(result.errors.join('\n')).toContain('missing.png')
    expect(result.errors.join('\n')).toContain('missing.md')
    expect(result.errors.join('\n')).toContain('malformed.md')
    expect(result.errors.join('\n')).not.toContain('ignored.md')
  })

})

describe('skills-sync gate', () => {
  it('compares matching host skills without requiring personal checkout files', async () => {
    const root = await makeTree({
      '.claude/skills/example/SKILL.md': 'Read .claude/skills/example/guide.md and CLAUDE.md.\n',
      '.codex/skills/example/SKILL.md': 'Read .codex/skills/example/guide.md and AGENTS.md.\n',
    })
    const { errors, compared } = checkSkillsSync(root)
    expect(errors).toEqual([])
    expect(compared).toBe(1)
  })

  it('reports missing hosts and logic drift as failures', async () => {
    const missing = await makeTree({ '.claude/skills/example/SKILL.md': 'A' })
    expect(checkSkillsSync(missing).errors).toContain('missing .codex/skills directory')
    const drift = await makeTree({
      '.claude/skills/example/SKILL.md': 'A',
      '.codex/skills/example/SKILL.md': 'B',
    })
    expect(checkSkillsSync(drift).errors.join('\n')).toContain('logic drift')
  })

  it('normalizes host paths before comparing', () => {
    expect(normalizeSkillText('see .claude/skills/noteX/SKILL.md and CLAUDE.md')).toBe('see .codex/skills/noteX/SKILL.md and AGENTS.md')
  })
})
