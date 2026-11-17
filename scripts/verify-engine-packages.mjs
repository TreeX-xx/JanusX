import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, relative, isAbsolute, sep, join } from 'node:path'
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
function inside(root,path){const full=resolve(root,path),rel=relative(root,full);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Invalid engine artifact path');return full}
export function verifyEnginePackages(root, dependencies, installed=true){
  const directory=join(root,'vendor/janus-agent'), manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'))
  if(manifest.schema!==1)throw Error('Unsupported engine artifact manifest')
  const packages=Object.entries(dependencies).filter(([name])=>name.startsWith('@janus-agent/'))
  if(manifest.packages.length!==packages.length)throw Error('Engine package set changed')
  for(const [name,reference] of packages){
    const record=manifest.packages.find(row=>row.name===name)
    if(!record||reference!==`file:vendor/janus-agent/${record.archive}`)throw Error('Engine reference mismatch: '+name)
    const archive=inside(directory,record.archive)
    if(!existsSync(archive)||hash(archive)!==record.sha256)throw Error('Engine artifact hash mismatch: '+name)
    if(installed){const base=inside(join(root,'node_modules'),name)
      for(const [file,digest] of Object.entries(record.files)){
        const target=inside(base,file)
        if(!existsSync(target)||hash(target)!==digest)throw Error(`Installed engine differs from pinned artifact: ${name}/${file}. Run npm ci.`)
      }
    }
  }
  console.log(`Pinned engine verified: ${packages.length} packages, build ${manifest.build.slice(0,16)}.`)
  return []
}
