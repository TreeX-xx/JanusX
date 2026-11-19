import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Supports npm's Windows prefix/node_modules, POSIX prefix/lib/node_modules and symlinked bins. */
export function findCliPackage(command: string, packageName: string): string | undefined {
  let physical = command
  try { physical = realpathSync(command) } catch { /* A shim may not exist in a diagnostic fixture. */ }
  for (const initial of [dirname(physical), dirname(command)]) {
    let directory = initial
    for (let depth = 0; depth < 12; depth++) {
      for (const candidate of [directory, join(directory, 'node_modules', packageName), join(directory, 'lib/node_modules', packageName)]) {
        try {
          const metadata = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as { name?: string }
          if (metadata.name === packageName) return candidate
        } catch { /* Try the next npm layout / ancestor. */ }
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return undefined
}

export function cliPackageFile(command: string, packageName: string, file: string): string {
  const root = findCliPackage(command, packageName)
  if (root) return join(root, file)
  // Keep optional extension imports catchable; callers of required imports validate existence.
  return join(dirname(command), 'node_modules', packageName, file)
}

export function requiredCliPackageFile(command: string, packageName: string, file: string): string {
  const path = cliPackageFile(command, packageName, file)
  if (!existsSync(path)) throw new Error(`Required CLI component ${packageName} is missing. Repair the CLI installation and retry.`)
  return path
}
