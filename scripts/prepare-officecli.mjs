// Build-time preparation only; the app never downloads OfficeCLI.
// Note: .agents/notes/desktop/officecli-bundled.md
import { parseArgs } from 'node:util'
import { checkOfficecliResource, officecliRelease, prepareOfficecliResource } from './officecli-resources.mjs'

const { values } = parseArgs({ options: {
  platform: { type: 'string', default: process.platform },
  arch: { type: 'string', default: process.arch },
  check: { type: 'boolean', default: false },
} })
const resource = await (values.check ? checkOfficecliResource(values) : prepareOfficecliResource(values))
console.log(`OfficeCLI ${officecliRelease.version} (${resource.platform}/${resource.arch}) verified: ${resource.binary}`)
