// Note: OfficeCLI is a bundled asset, not a managed download — see .agents/notes/desktop/officecli-bundled.md
import { isAbsolute, join } from 'node:path'
import release from '../../shared/officecli-release.json'

export const OFFICECLI_BUNDLED_VERSION = release.version

function bundledTarget(platform: string, arch: string) {
  const key = `${platform}-${arch}`
  return Object.hasOwn(release.targets, key) ? release.targets[key as keyof typeof release.targets] : undefined
}

export function expectedBundledOfficecliSha256(arch: string = process.arch, platform: NodeJS.Platform = process.platform): string {
  const target = bundledTarget(platform, arch)
  if (!target) throw new Error(`Bundled OfficeCLI is unsupported on ${platform}/${arch}`)
  return target.sha256
}

export function resolveBundledOfficecliBinary(options: {
  resourcesPath?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
} = {}): string | undefined {
  const platform = options.platform ?? process.platform
  const target = bundledTarget(platform, options.arch ?? process.arch)
  if (!target) return undefined
  const override = (options.env ?? process.env).JANUSX_OFFICECLI_BINARY
  if (override && isAbsolute(override)) return override
  const resourcesPath = options.resourcesPath
  if (!resourcesPath || !isAbsolute(resourcesPath)) return undefined
  return join(resourcesPath, 'officecli', target.path)
}
