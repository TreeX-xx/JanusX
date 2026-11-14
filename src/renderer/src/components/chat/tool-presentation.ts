export type ToolAction = 'run' | 'edit' | 'read' | 'search' | 'think' | 'tool'
// Classify known protocol names only; unknown/MCP names stay available in the details.
const actions: Record<string, ToolAction> = {
  commandExecution: 'run', command_run: 'run', 'command.run': 'run', bash: 'run', shell: 'run',
  fileChange: 'edit', edit_file: 'edit', write_file: 'edit', apply_patch: 'edit',
  read_file: 'read', note_read: 'read', 'file.read': 'read', 'note.read': 'read',
  search_files: 'search', 'file.search': 'search', 'note.search': 'search', reasoning: 'think',
}
export function toolAction(kind?: string): ToolAction { return (kind && actions[kind]) || 'tool' }
