import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareControlledCommit, executeControlledCommit } from '../../src/main/git/controlled-commit'
import { inspectCheckout } from '../../src/main/git/controlled-worktree'
import { environmentFixture } from '../helpers/superagent-environment-fixture'

describe('host commit with reviewed file bytes', () => {
  it('refuses changed content and staged changes without touching HEAD or user files', async () => {
    const f = await environmentFixture()
    try {
      const checkout = await inspectCheckout(f.repo)
      await writeFile(join(f.repo, 'feature.txt'), 'reviewed\n')
      const plan = await prepareControlledCommit(checkout, ['feature.txt'])
      await writeFile(join(f.repo, 'feature.txt'), 'changed after review\n')
      await expect(executeControlledCommit(checkout, plan, 'Must not commit', join(f.root, 'indexes'))).rejects.toThrow('changed after review')
      expect(await f.git(['rev-parse', 'HEAD'])).toBe(checkout.head)
      expect(await readFile(join(f.repo, 'feature.txt'), 'utf8')).toBe('changed after review\n')
      await f.git(['add', 'feature.txt'])
      await expect(prepareControlledCommit(checkout, ['feature.txt'])).rejects.toThrow('staged changes')
    } finally { await f.dispose() }
  })
  it('rejects protected files, aliases and branch changes', async () => {
    const f = await environmentFixture()
    try {
      const checkout = await inspectCheckout(f.repo)
      for (const path of ['../escape', '.git/HEAD', '.agents/rules.md', '.codex/config.toml', 'C:/absolute']) {
        await expect(prepareControlledCommit(checkout, [path])).rejects.toThrow()
      }
      const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'data.txt'), 'user')
      await symlink(outside, join(f.repo, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(prepareControlledCommit(checkout, ['alias/data.txt'])).rejects.toThrow('escapes')
      await writeFile(join(f.repo, 'feature.txt'), 'reviewed\n')
      const plan = await prepareControlledCommit(checkout, ['feature.txt'])
      await f.git(['checkout', '-b', 'other'])
      await expect(executeControlledCommit(checkout, plan, 'Must not commit', join(f.root, 'indexes'))).rejects.toThrow('environment changed')
      expect(await f.git(['rev-list', '--count', 'HEAD'])).toBe('1')
    } finally { await f.dispose() }
  })
  it('commits raw approved bytes without hooks or clean filters and preserves executable mode on Windows', async () => {
    const f = await environmentFixture()
    try {
      await f.git(['update-index', '--chmod=+x', 'feature.txt'])
      await f.git(['commit', '-m', 'Executable baseline'])
      await writeFile(join(f.repo, '.gitattributes'), 'feature.txt filter=blocked\n')
      await f.git(['add', '.gitattributes']); await f.git(['commit', '-m', 'Attributes'])
      await f.git(['config', 'filter.blocked.clean', 'must-not-execute-filter'])
      await f.git(['config', 'filter.blocked.required', 'true'])
      const checkout = await inspectCheckout(f.repo)
      const hook = join(checkout.gitDir, 'hooks', 'pre-commit')
      await writeFile(hook, '#!/bin/sh\nexit 77\n', { mode: 0o755 })
      await writeFile(join(f.repo, 'feature.txt'), 'exact bytes\n')
      const plan = await prepareControlledCommit(checkout, ['feature.txt'])
      const hash = await executeControlledCommit(checkout, plan, 'Approved exact bytes', join(f.root, 'indexes'))
      expect(await f.git(['rev-parse', 'HEAD'])).toBe(hash)
      expect(await f.git(['show', 'HEAD:feature.txt'])).toBe('exact bytes')
      expect(await f.git(['ls-tree', 'HEAD', '--', 'feature.txt'])).toMatch(/^100755 /)
    } finally { await f.dispose() }
  })
})
