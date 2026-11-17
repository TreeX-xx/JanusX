// Note: .agents/notes/desktop/application-shutdown.md
// Desktop composition; the Node ownership implementation is reusable by CLI/backend hosts.
import { logShutdown } from './diagnostics'
import { configureProcessTreeDiagnostics } from '../platform/process-host/owned-tree'
configureProcessTreeDiagnostics(logShutdown)
export { stopProcessTree, retryPendingProcessStops } from '../platform/process-host/owned-tree'
export type { OwnedProcess } from '../platform/process-host/owned-tree'
