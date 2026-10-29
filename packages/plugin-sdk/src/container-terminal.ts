/** Structured native desktop contract. No command text or project terminal is accepted. */
export interface ContainerTerminalRequest {
  executable: string
  endpoint: string
  container: string
  shell: '/bin/sh' | '/bin/bash' | 'cmd.exe' | 'powershell.exe'
  cols: number
  rows: number
  /** A registered WSL distribution explicitly selected through desktop.terminal.select. */
  wsl?: string
}
/** Distribution names are argv values, never shell fragments or launcher options. */
export function validDockerWsl(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N}_][\p{L}\p{N}_. -]{0,127}$/u.test(value) && !/^docker-desktop(?:-data)?$/i.test(value)
}
export interface ContainerTerminalOutput { id: string; data: string; cursor: number; truncated: boolean; exited: boolean; exitCode: number | null }
/** Local sockets and Docker's Windows pipes only. TCP/SSH contexts are deliberately unsupported. */
export function localDockerEndpoint(value: string): string {
  if (/^npipe:\/\/\/\/\.\/pipe\/docker[a-zA-Z0-9_-]*$/.test(value)) return value
  if (/^unix:\/\/\/[^\0\r\n]+$/.test(value)) return value
  throw new Error('docker-remote-endpoint')
}
