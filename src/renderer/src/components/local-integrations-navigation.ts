export const LOCAL_INTEGRATIONS_EVENT = 'janusx:local-integrations'
export function openLocalIntegrations(workspaceId: string): void {
  window.dispatchEvent(new CustomEvent(LOCAL_INTEGRATIONS_EVENT, { detail: workspaceId }))
}
