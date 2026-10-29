// Stage verified Windows artifacts; publication is a separate, build-free action.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

export function releaseFiles(root, outputDirectory) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const config = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
  if (config.publish?.provider !== 'github' || !config.publish.owner || !config.publish.repo) throw new Error('A GitHub publish owner and repo are required')
  const prerelease = pkg.version.includes('-')
  const channel = prerelease ? pkg.version.split('-')[1].split('.')[0] : 'latest'
  if (!/^[\w-]+$/.test(channel)) throw new Error('Invalid update channel')
  const directory = outputDirectory ?? join(root, 'release', pkg.version)
  const setup = `${config.productName}-${pkg.version}-x64-setup.exe`
  const portable = `${config.productName}-${pkg.version}-x64-portable.exe`
  const names = [setup, `${setup}.blockmap`, portable, `${channel}.yml`]
  for (const name of names) if (!existsSync(join(directory, name))) throw new Error(`Release artifact missing: ${name}`)
  const update = parse(readFileSync(join(directory, `${channel}.yml`), 'utf8'))
  if (update.version !== pkg.version || update.path !== setup) throw new Error('Update manifest does not match the current version and setup artifact')
  const entry = update.files?.find(({ url }) => url === setup)
  const bytes = readFileSync(join(directory, setup))
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  if (!entry || entry.sha512 !== sha512 || update.sha512 !== sha512 || entry.size !== bytes.length) throw new Error('Setup artifact does not match the update manifest hash and size')
  return { tag: `v${pkg.version}`, repo: `${config.publish.owner}/${config.publish.repo}`, prerelease, files: names.map((name) => join(directory, name)) }
}

function runner(root) {
  return (command, args, { capture = false } = {}) => execFileSync(command, args, {
    cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
}

function githubJson(run, endpoint) {
  return JSON.parse(run('gh', ['api', endpoint], { capture: true }))
}

function assertSource(run, release) {
  if (run('git', ['status', '--porcelain'], { capture: true }).trim()) {
    throw new Error('Release staging/publication requires a clean checkout of the version tag')
  }
  const head = run('git', ['rev-parse', 'HEAD'], { capture: true }).trim()
  const remote = githubJson(run, `repos/${release.repo}/commits/${encodeURIComponent(`refs/tags/${release.tag}`)}`)
  if (remote.sha !== head) throw new Error('Remote version tag does not match the current checkout')
  return head
}

function draftRelease(run, release, { allowMissing = false } = {}) {
  // The tag endpoint may omit drafts. Enumerate the authenticated release list
  // so a retry can find an unpublished release rather than try to recreate it.
  const pages = JSON.parse(run('gh', ['api', `repos/${release.repo}/releases?per_page=100`, '--paginate', '--slurp'], { capture: true }))
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error('Release list is unavailable')
  const remote = pages.flat().find(candidate => candidate.tag_name === release.tag)
  if (!remote) {
    if (allowMissing) return null
    throw new Error(`Draft release not found: ${release.tag}`)
  }
  if (remote.tag_name !== release.tag || remote.draft !== true) throw new Error('Only an unpublished draft may be staged or published; use a new version')
  if (remote.prerelease !== release.prerelease) throw new Error('Draft prerelease status does not match the version')
  if (!Array.isArray(remote.assets)) throw new Error('Release assets are unavailable')
  return remote
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function runtimeIdentity(root, release, head) {
  const checker = join(root, 'scripts/check-packaged-runtime.mjs')
  const unpacked = join(dirname(release.files[0]), 'win-unpacked')
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push([path, sha256(path)])
      else throw new Error(`Unsupported runtime entry: ${path}`)
    }
  }
  if (existsSync(unpacked)) visit(unpacked)
  return { head, node: process.version, platform: process.platform, arch: process.arch,
    checker: existsSync(checker) ? sha256(checker) : null,
    artifacts: release.files.map(file => [file, sha256(file)]), unpacked: files }
}

function assertRemoteFile(run, release, asset, file, { metadataOnly = false } = {}) {
  const bytes = readFileSync(file)
  if (asset.size !== bytes.length) throw new Error(`Remote artifact differs: ${basename(file)}`)
  if (/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) {
    if (asset.digest !== `sha256:${sha256(file)}`) throw new Error(`Remote artifact differs: ${basename(file)}`)
    return
  }
  if (metadataOnly) return
  // GitHub may omit digests for older assets. Compare downloaded bytes instead.
  const temporary = mkdtempSync(join(tmpdir(), 'janusx-release-compare-'))
  try {
    run('gh', ['release', 'download', release.tag, '--repo', release.repo, '--pattern', basename(file), '--dir', temporary])
    if (sha256(join(temporary, basename(file))) !== sha256(file)) throw new Error(`Remote artifact differs: ${basename(file)}`)
  } finally {
    if (dirname(resolve(temporary)) !== resolve(tmpdir())) throw new Error('Unexpected temporary directory')
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function stageWin(root = process.cwd(), run = runner(root), { outputDirectory } = {}) {
  const release = releaseFiles(root, outputDirectory)
  const head = assertSource(run, release)
  // Reject public releases and known byte conflicts before launching Electron.
  const existing = draftRelease(run, release, { allowMissing: true })
  for (const file of release.files) {
    const asset = existing?.assets.find(({ name }) => name === basename(file))
    if (asset) assertRemoteFile(run, release, asset, file, { metadataOnly: true })
  }
  const hashes = release.files.map(sha256)
  const identity = runtimeIdentity(root, release, head)
  const receiptPath = join(dirname(release.files[0]), 'staging-runtime.json')
  let verified = false
  try { verified = JSON.stringify(JSON.parse(readFileSync(receiptPath, 'utf8'))) === JSON.stringify(identity) } catch { /* No matching verification yet. */ }
  if (verified) console.log('Reusing runtime verification: source, checker and all packaged bytes match.')
  else run(process.execPath, [join(root, 'scripts/check-packaged-runtime.mjs'), '--portable', '--release-dir', dirname(release.files[0])])
  // The runtime check must not have changed the artifacts or source metadata.
  releaseFiles(root, outputDirectory)
  if (release.files.some((file, index) => sha256(file) !== hashes[index])) throw new Error('Artifacts changed during runtime verification')
  if (JSON.stringify(runtimeIdentity(root, release, head)) !== JSON.stringify(identity)) throw new Error('Runtime inputs changed during verification')
  assertSource(run, release)
  if (!verified) writeFileSync(receiptPath, JSON.stringify(identity))
  // Refresh after runtime verification: the draft may have changed meanwhile.
  const remote = draftRelease(run, release, { allowMissing: true })
  const missing = []
  for (const file of release.files) {
    const asset = remote?.assets.find(({ name }) => name === basename(file))
    if (asset) assertRemoteFile(run, release, asset, file)
    else missing.push(file)
  }
  if (!remote) {
    run('gh', ['release', 'create', release.tag, '--draft', '--verify-tag', '--title', release.tag, '--notes', '', ...(release.prerelease ? ['--prerelease'] : []), '--repo', release.repo])
  }
  if (missing.length) run('gh', ['release', 'upload', release.tag, ...missing, '--repo', release.repo])
  console.log(`Draft ${release.tag} staged. Review notes, then run npm run publish:win. Nothing was published.`)
}

export function publishWin(root = process.cwd(), run = runner(root), { outputDirectory } = {}) {
  const release = releaseFiles(root, outputDirectory)
  assertSource(run, release)
  const remote = draftRelease(run, release)
  for (const file of release.files) {
    const asset = remote.assets.find(({ name }) => name === basename(file))
    if (!asset) throw new Error(`Remote artifact missing: ${basename(file)}`)
    assertRemoteFile(run, release, asset, file)
  }
  // No build, install or runtime launch here. Publish exactly the compared files.
  run('gh', ['release', 'edit', release.tag, '--draft=false', `--prerelease=${release.prerelease}`, `--latest=${!release.prerelease}`, '--repo', release.repo])
}

export function parsePublishArgs(args) {
  const options = { stage: false, check: false, outputDirectory: undefined }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--stage') options.stage = true
    else if (args[index] === '--check') options.check = true
    else if (args[index] === '--release-dir' && args[index + 1] && !args[index + 1].startsWith('--')) options.outputDirectory = resolve(args[++index])
    else throw new Error(`Unknown or incomplete argument: ${args[index]}. Use [--stage | --check] [--release-dir directory].`)
  }
  if (options.stage && options.check) throw new Error('--stage and --check are mutually exclusive')
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePublishArgs(process.argv.slice(2))
    if (options.check) releaseFiles(process.cwd(), options.outputDirectory)
    else {
      const action = options.stage ? stageWin : publishWin
      action(process.cwd(), undefined, options)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
