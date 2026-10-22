// No API or IPC channel is exposed. Main transfers only this instance's port.
import { ipcRenderer } from 'electron'
ipcRenderer.once('janusx:plugin-port', (event, context) => {
  if (event.ports.length === 1) window.postMessage({ type: 'janusx:plugin-port', contextRevision: context.contextRevision }, '*', [event.ports[0]])
})
