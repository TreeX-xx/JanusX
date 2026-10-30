import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// node_modules is copied verbatim (electron-builder.yml's beforeBuild hook), so
// the boundary gate guards the opposite direction: nothing from the working tree
// may reach the archive, and nothing build-only may stay in node_modules.
const REQUIRED_TREE_EXCLUSIONS = [
  'src',
  'plugins',
  'tests',
  'wiki',
  'design',
  'artifacts',
  'apps',
  'scripts/android-lab',
  'scripts/remote-lab',
  'test-results',
  'release',
  '.agents',
  '.claude',
  '.codex',
  '.github',
  '.cache',
  '.janusX',
  '.janusx',
]

const REQUIRED_OUTPUTS = [
  'out/preload/index.mjs',
  'out/renderer/index.html',
]

const FORBIDDEN_RUNTIME_REFERENCES = [
  /\brequire\w*\.resolve\(\s*["']@janusx\/llm-core(?:\/[^"']*)?["']/,
  /\brequire\w*\(\s*["']@janusx\/llm-core(?:\/[^"']*)?["']/,
  /\bimport\(\s*["']@janusx\/llm-core(?:\/[^"']*)?["']\s*\)/,
  /\bfrom\s*["']@janusx\/llm-core(?:\/[^"']*)?["']/,
]

export function parseFilesList(yaml) {
  const lines = yaml.split(/\r?\n/)
  let foundFiles = false
  let inFiles = false
  const values = []

  for (const [index, line] of lines.entries()) {
    if (line.includes('\t')) throw new Error(`Tabs are unsupported in electron-builder.yml at line ${index + 1}`)

    const topLevelFiles = line.match(/^files\s*:(.*)$/)
    if (topLevelFiles) {
      if (foundFiles) throw new Error('Duplicate top-level files key')
      if (topLevelFiles[1].trim() && !topLevelFiles[1].trim().startsWith('#')) {
        throw new Error('The top-level files value must be a block sequence')
      }
      foundFiles = true
      inFiles = true
      continue
    }

    if (!inFiles) continue
    if (!line.trim() || /^\s*#/.test(line)) continue
    if (!/^\s/.test(line)) {
      if (!/^[A-Za-z0-9_-]+\s*:/.test(line)) {
        throw new Error(`Unsupported content after files sequence at line ${index + 1}`)
      }
      inFiles = false
      continue
    }

    const item = line.match(/^  -\s+(\S+)\s*$/)
    if (!item) throw new Error(`Unsupported files sequence content at line ${index + 1}`)
    // YAML scalars: patterns are quoted when they carry minimatch punctuation.
    const raw = item[1]
    const quoted = raw.length > 1 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    values.push(quoted ? raw.slice(1, -1) : raw)
  }

  if (!foundFiles) throw new Error('Missing top-level files list')
  return values
}

// `!prefix{,/**/*}` -> `prefix`
function exclusionTarget(pattern) {
  return pattern.slice(1).replace(/[,{].*$/, '')
}

export function validateFilePatterns(patterns) {
  if (new Set(patterns).size !== patterns.length) {
    throw new Error('Package files allowlist contains duplicate entries')
  }

  const inclusions = patterns.filter((pattern) => !pattern.startsWith('!'))
  if (!inclusions.includes('**/*')) {
    throw new Error('Package files must copy the installed tree through the **/* pattern')
  }
  if (!inclusions.includes('package.json')) {
    throw new Error('Package files must include package.json')
  }
  const leaked = inclusions.filter((pattern) => REQUIRED_TREE_EXCLUSIONS.some((prefix) => pattern === prefix || pattern.startsWith(`${prefix}/`)))
  if (leaked.length) {
    throw new Error(`Package files must not include repository sources or caches: ${leaked.join(', ')}`)
  }

  const exclusionTargets = new Set(patterns.filter((pattern) => pattern.startsWith('!')).map(exclusionTarget))
  const missing = REQUIRED_TREE_EXCLUSIONS.filter((prefix) => !exclusionTargets.has(prefix))
  if (missing.length) {
    throw new Error(`Package files must exclude repository sources and caches: ${missing.join(', ')}`)
  }
  // Named repository trees must be excluded explicitly; node_modules entries and
  // root-level dev files (playwright configs, *.log, scratch files) are free-form.
  // An extension-wide negation drops a debug artifact class from every packaged
  // tree at once, so it is judged by shape rather than by path.
  const EXTENSION_EXCLUSION = /^\*\*\/\*\.[A-Za-z0-9]{1,8}$/
  const allowedExclusion = (pattern) =>
    REQUIRED_TREE_EXCLUSIONS.includes(pattern) ||
    pattern.startsWith('node_modules/') ||
    EXTENSION_EXCLUSION.test(pattern) ||
    !pattern.includes('/')
  const unexpected = [...exclusionTargets].filter((pattern) => !allowedExclusion(pattern))
  if (unexpected.length) {
    throw new Error(`Package files exclude unknown paths: ${unexpected.join(', ')}`)
  }
}

// Check the assembled archive as well as the builder configuration. This does
// not prove the host bundles are free of legacy Blueprint business imports.
export function validatePackagedPluginEntries(entries) {
  const leaked = [...entries].map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, '')).filter((entry) =>
    /^(?:plugins|node_modules\/(?:@janusx\/blueprint|@xyflow))(?:\/|$)/.test(entry))
  if (leaked.length) throw new Error(`Downloadable plugin files must not ship in the application: ${leaked.slice(0, 5).join(', ')}`)
}

export function validateDependencyContract(root) {
  const appPackage = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const corePackage = JSON.parse(readFileSync(`${root}/packages/llm-core/package.json`, 'utf8'))
  const appAiVersion = appPackage.dependencies?.ai
  const corePeerVersion = corePackage.peerDependencies?.ai
  const coreDevVersion = corePackage.devDependencies?.ai

  if (!appPackage.dependencies?.['@janusx/llm-core']) {
    throw new Error('Root package must declare @janusx/llm-core as a workspace dependency')
  }
  if (!appAiVersion || appAiVersion !== corePeerVersion || appAiVersion !== coreDevVersion) {
    throw new Error(
      `AI SDK contract mismatch: app=${appAiVersion || 'missing'}, peer=${corePeerVersion || 'missing'}, dev=${coreDevVersion || 'missing'}`,
    )
  }

  const tsconfig = JSON.parse(readFileSync(`${root}/tsconfig.json`, 'utf8'))
  const paths = tsconfig.compilerOptions?.paths ?? {}
  if (paths.ai || paths['@ai-sdk/*']) {
    throw new Error('AI SDK must use standard Node resolution; remove ai/@ai-sdk path aliases')
  }
}

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return listJavaScriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })
}

export function validateRuntimeBundle(root) {
  const mainOutput = `${root}/out/main`
  const violations = listJavaScriptFiles(mainOutput).filter((path) => {
    const source = readFileSync(path, 'utf8')
    return FORBIDDEN_RUNTIME_REFERENCES.some((pattern) => pattern.test(source))
  })
  if (violations.length) {
    throw new Error(`Bundled main process still resolves @janusx/llm-core at runtime: ${violations.join(', ')}`)
  }
}

export function checkPackageBoundary(root = process.cwd()) {
  const config = readFileSync(`${root}/electron-builder.yml`, 'utf8')
  validateFilePatterns(parseFilesList(config))

  const appPackage = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const entries = [appPackage.main, ...Object.values(appPackage.bin ?? {})]
  if (entries.some((path) => typeof path !== 'string' || !/^out\/main\/[\w./-]+\.js$/.test(path) || path.split('/').includes('..'))) {
    throw new Error('Package main and bin entries must name JavaScript outputs under out/main/')
  }
  const missingOutputs = [...new Set([...REQUIRED_OUTPUTS, ...entries])].filter((path) => !existsSync(`${root}/${path}`))
  if (missingOutputs.length) {
    throw new Error(`Run the production build first; missing package outputs: ${missingOutputs.join(', ')}`)
  }
  validateDependencyContract(root)
  validateRuntimeBundle(root)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    checkPackageBoundary()
    console.log('Package boundary verified: the installed tree is packaged and no working-tree path leaks in.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
