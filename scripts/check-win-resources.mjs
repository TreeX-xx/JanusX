import { checkOfficecliResource, officecliRelease } from './officecli-resources.mjs'

await checkOfficecliResource({ platform: 'win32', arch: 'x64' })
console.log(`Windows resources verified: OfficeCLI ${officecliRelease.version} SHA256 matches.`)
