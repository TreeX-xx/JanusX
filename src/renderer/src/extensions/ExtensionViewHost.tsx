import { WorkbenchErrorBoundary } from '@/components/WorkbenchErrorBoundary'
import { useExtensionViews } from './react'
import type { ExtensionViewProps, RegisteredExtensionView } from './types'

export function ExtensionViewHost(props: ExtensionViewProps) {
  const view = useExtensionViews().find((item) => item.id === props.viewId && item.location === props.location)
  if (!view || (view.scope === 'project' && !props.workspaceId)) return null
  return (
    <WorkbenchErrorBoundary key={`${view.id}:${view.activationId}:${view.rebindContext ? 'retained' : view.scope === 'project' ? props.workspaceId : 'application'}`}>
      <ExtensionViewContent {...props} view={view} />
    </WorkbenchErrorBoundary>
  )
}

/** Shared rendering; each container owns its error/retry controls. */
export function ExtensionViewContent({ view, ...props }: ExtensionViewProps & { view: RegisteredExtensionView }) {
  if (view.scope === 'project' && !props.workspaceId) return null
  const View = view.component
  return <View {...props} workspaceId={view.scope === 'project' ? props.workspaceId : null}
    workspacePath={view.scope === 'project' ? props.workspacePath : null} />
}
