// Note: retain application identity, with an explicit local-plugin profile and output tree.
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = resolve(process.env.JANUSX_DOCKER_LOCAL_DIRECTORY ?? resolve(root, '.cache/docker-local'))
const build = JSON.parse(readFileSync(resolve(directory, 'build.json'), 'utf8'))
const metadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (app.isPackaged) throw new Error('The local DOCKER entry is for development only.')
app.name = metadata.productName || metadata.name
app.setVersion(metadata.version)
app.setAppPath(root)
app.setPath('userData', build.profile)
process.env.JANUSX_KNOWLEDGE_ROOT = resolve(build.profile, 'knowledge')
process.env.JANUSX_DEV_BUILD_ROOT = build.appDirectory
await import(pathToFileURL(resolve(build.appDirectory, 'main/index.js')).href)
