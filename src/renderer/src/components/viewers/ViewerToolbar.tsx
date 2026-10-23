import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './viewer-controls.css'

// Hosts provide one content toolbar; standalone viewers keep a local toolbar.
export const ViewerToolbarTarget = createContext<HTMLElement | null>(null)
export const ViewerActive = createContext(true)

export function ViewerToolbar({ children, target }: { children: ReactNode; target?: HTMLElement | null }) {
  const host = useContext(ViewerToolbarTarget)
  const destination = target ?? host
  const controls = <div className="viewer-tool-group">{children}</div>
  return destination ? createPortal(controls, destination) : <div className="viewer-toolbar">{controls}</div>
}
