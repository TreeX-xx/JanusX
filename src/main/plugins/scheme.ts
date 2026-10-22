import { protocol } from 'electron'
/** Scheme registration alone must run before app.ready; carriers load with IPC. */
export function registerPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'janusx-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}
