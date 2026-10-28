// Note: isolate dev chunks without changing application identity or checkout discovery — see .agents/notes/desktop/reproducible-verification.md
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const metadata = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
// Passing a file to Electron bypasses its package-directory initialization.
// Restore the same metadata before any main-process service resolves paths.
app.name = metadata.productName || metadata.name
app.setVersion(metadata.version)
app.setDesktopName(metadata.desktopName || `${app.name}.desktop`)
app.setAppPath(resolve(fileURLToPath(root)))
if (process.platform === 'win32') app.setAppUserModelId('com.janusx.app.dev')
process.env.JANUSX_DEV_BUILD_ROOT = fileURLToPath(new URL('.cache/', root))

await import(new URL('.cache/main/index.js', root).href)
