export type FileViewType = 'code' | 'markdown' | 'html' | 'image' | 'binary'

export type FileSemanticKind =
  | 'folder'
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'code'
  | 'markdown'
  | 'data'
  | 'image'
  | 'database'
  | 'archive'
  | 'config'
  | 'document'
  | 'binary'

export interface FileClassification {
  semanticKind: FileSemanticKind
  viewerType: FileViewType | null
  monacoLanguage: string | null
}

type FileRule = readonly [FileSemanticKind, FileViewType, string | null]

const EXTENSION_RULES: Record<string, FileRule> = {
  '.ts': ['typescript', 'code', 'typescript'],
  '.tsx': ['typescript', 'code', 'typescriptreact'],
  '.js': ['javascript', 'code', 'javascript'],
  '.jsx': ['javascript', 'code', 'javascriptreact'],
  '.mjs': ['javascript', 'code', 'javascript'],
  '.cjs': ['javascript', 'code', 'javascript'],
  '.py': ['python', 'code', 'python'],
  '.rs': ['rust', 'code', 'rust'],
  '.md': ['markdown', 'markdown', 'markdown'],
  '.markdown': ['markdown', 'markdown', 'markdown'],
  '.html': ['code', 'html', 'html'],
  '.htm': ['code', 'html', 'html'],
  '.json': ['data', 'code', 'json'],
  '.jsonc': ['data', 'code', 'json'],
  '.yaml': ['data', 'code', 'yaml'],
  '.yml': ['data', 'code', 'yaml'],
  '.xml': ['data', 'code', 'xml'],
  '.csv': ['data', 'code', 'plaintext'],
  '.tsv': ['data', 'code', 'plaintext'],
  '.png': ['image', 'image', null],
  '.jpg': ['image', 'image', null],
  '.jpeg': ['image', 'image', null],
  '.gif': ['image', 'image', null],
  '.svg': ['image', 'image', null],
  '.webp': ['image', 'image', null],
  '.ico': ['image', 'image', null],
  '.bmp': ['image', 'image', null],
  '.db': ['database', 'binary', null],
  '.sqlite': ['database', 'binary', null],
  '.sqlite3': ['database', 'binary', null],
  '.zip': ['archive', 'binary', null],
  '.tar': ['archive', 'binary', null],
  '.gz': ['archive', 'binary', null],
  '.tgz': ['archive', 'binary', null],
  '.bz2': ['archive', 'binary', null],
  '.xz': ['archive', 'binary', null],
  '.7z': ['archive', 'binary', null],
  '.rar': ['archive', 'binary', null],
  '.ini': ['config', 'code', 'ini'],
  '.cfg': ['config', 'code', 'ini'],
  '.conf': ['config', 'code', 'plaintext'],
  '.toml': ['config', 'code', 'toml'],
  '.txt': ['document', 'code', 'plaintext'],
  '.log': ['document', 'code', 'plaintext'],
  '.pdf': ['document', 'binary', null],
  '.doc': ['document', 'binary', null],
  '.docx': ['document', 'binary', null],
  '.xls': ['document', 'binary', null],
  '.xlsx': ['document', 'binary', null],
  '.ppt': ['document', 'binary', null],
  '.pptx': ['document', 'binary', null],
  '.go': ['code', 'code', 'go'],
  '.rb': ['code', 'code', 'ruby'],
  '.java': ['code', 'code', 'java'],
  '.c': ['code', 'code', 'c'],
  '.cpp': ['code', 'code', 'cpp'],
  '.h': ['code', 'code', 'c'],
  '.hpp': ['code', 'code', 'cpp'],
  '.sh': ['code', 'code', 'shell'],
  '.bash': ['code', 'code', 'shell'],
  '.zsh': ['code', 'code', 'shell'],
  '.ps1': ['code', 'code', 'powershell'],
  '.bat': ['code', 'code', 'bat'],
  '.cmd': ['code', 'code', 'bat'],
  '.css': ['code', 'code', 'css'],
  '.scss': ['code', 'code', 'scss'],
  '.less': ['code', 'code', 'less'],
  '.sql': ['code', 'code', 'sql'],
  '.graphql': ['code', 'code', 'graphql'],
  '.prisma': ['code', 'code', 'prisma'],
  '.cmake': ['config', 'code', 'plaintext'],
  '.s': ['code', 'code', 'plaintext'],
  '.asm': ['code', 'code', 'plaintext'],
}

const BINARY_EXTENSIONS = new Set([
  '.bin', '.dat', '.dll', '.dylib', '.exe', '.o', '.obj', '.so', '.wasm',
])

const PLAIN_TEXT_EXTENSIONS = new Set([
  '.lock', '.properties', '.prettierrc', '.eslintrc', '.babelrc',
])

export function classifyFile(
  filePath: string,
  nodeType: 'file' | 'directory' = 'file',
): FileClassification {
  if (nodeType === 'directory') {
    return { semanticKind: 'folder', viewerType: null, monacoLanguage: null }
  }

  const fileName = getFileName(filePath).toLowerCase()
  const specialRule = classifySpecialName(fileName)
  if (specialRule) return fromRule(specialRule)

  const extension = getExtension(filePath)
  const extensionRule = EXTENSION_RULES[extension]
  if (extensionRule) return fromRule(extensionRule)

  if (PLAIN_TEXT_EXTENSIONS.has(extension) || isReadableTextName(fileName)) {
    return { semanticKind: 'document', viewerType: 'code', monacoLanguage: 'plaintext' }
  }

  if (BINARY_EXTENSIONS.has(extension)) {
    return { semanticKind: 'binary', viewerType: 'binary', monacoLanguage: null }
  }

  return { semanticKind: 'document', viewerType: 'code', monacoLanguage: 'plaintext' }
}

export function getExtension(filePath: string): string {
  const fileName = getFileName(filePath)
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

export function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  const name = parts[parts.length - 1] || filePath
  if (filePath.startsWith('janusx-workspace://')) {
    try { return decodeURIComponent(name) } catch { return name }
  }
  return name
}

function classifySpecialName(fileName: string): FileRule | null {
  if (fileName === 'package.json') return ['config', 'code', 'json']
  if (/^tsconfig.*\.json$/.test(fileName)) return ['config', 'code', 'json']
  if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) {
    return ['config', 'code', 'plaintext']
  }
  if (fileName === 'makefile' || fileName === 'gnumakefile' || fileName === 'justfile') {
    return ['config', 'code', 'plaintext']
  }
  if (fileName === 'cmakelists.txt') return ['config', 'code', 'plaintext']
  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return ['config', 'code', 'plaintext']
  }
  if (fileName === '.gitignore' || fileName === '.gitattributes' || fileName === '.editorconfig') {
    return ['config', 'code', 'plaintext']
  }
  if (isLockFile(fileName)) return ['config', 'code', languageForLockFile(fileName)]
  if (fileName.endsWith('.lock')) return ['config', 'code', 'plaintext']
  return null
}

function isLockFile(fileName: string): boolean {
  return fileName === 'package-lock.json'
    || fileName === 'npm-shrinkwrap.json'
    || fileName === 'yarn.lock'
    || fileName === 'pnpm-lock.yaml'
    || fileName === 'bun.lock'
    || fileName === 'bun.lockb'
    || fileName === 'cargo.lock'
    || fileName === 'poetry.lock'
    || fileName === 'composer.lock'
    || fileName === 'gemfile.lock'
}

function languageForLockFile(fileName: string): string {
  if (fileName.endsWith('.json')) return 'json'
  if (fileName.endsWith('.yaml')) return 'yaml'
  return 'plaintext'
}

function isReadableTextName(fileName: string): boolean {
  return /^(readme|license|changelog|authors|notice)(\..*)?$/.test(fileName)
}

function fromRule([semanticKind, viewerType, monacoLanguage]: FileRule): FileClassification {
  return { semanticKind, viewerType, monacoLanguage }
}
