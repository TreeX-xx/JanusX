import { PluginError } from './errors.js'

/** Lexical validation only. The P2 broker must also verify real filesystem paths. */
export function validatePluginPath(path: string): string {
  if (!path || path.length > 1024 || /[\\:%?#<>"|*]/.test(path)
    || [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || path.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new PluginError('INVALID_PACKAGE_PATH', 'Use a normalized relative resource path.')
  }
  return path
}

export function isSensitivePluginPath(path: string): boolean {
  return path.split('/').some((part) => /^(\.git|\.ssh|\.aws|\.azure|\.gnupg|\.janusx)$/i.test(part)
    || /^\.env(?:\.|$)/i.test(part) || /^(credentials(?:\.json)?|id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|p12|pfx))$/i.test(part))
}
