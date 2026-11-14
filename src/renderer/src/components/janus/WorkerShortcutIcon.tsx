import { Terminal } from 'lucide-react'
import type { WorkerShortcut } from '../../../../shared/worker-shortcuts'
import { TerminalPresetIcon } from '../ui/TerminalPresetIcon'

export function WorkerShortcutIcon({ target, size = 16 }: { target: WorkerShortcut; size?: number }) {
  return target.kind === 'worker'
    ? <Terminal size={size} aria-hidden="true" />
    : <TerminalPresetIcon preset={target.backend} style={{ width: size, height: size }} />
}
