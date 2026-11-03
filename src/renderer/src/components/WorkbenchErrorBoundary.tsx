import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'

interface WorkbenchErrorBoundaryProps {
  children: ReactNode
}

export interface WorkbenchErrorBoundaryState {
  failed: boolean
  retryKey: number
}

export function retryWorkbenchErrorBoundary(
  state: WorkbenchErrorBoundaryState,
): WorkbenchErrorBoundaryState {
  return { failed: false, retryKey: state.retryKey + 1 }
}

function WorkbenchErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n('common')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-deep)] text-[var(--text)]" role="alert">
      <div className="text-sm font-medium">{t('common:errorBoundary.workbenchFailed')}</div>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-2 rounded border border-[var(--shell-border)] bg-[var(--shell-hover)] px-3 text-xs hover:bg-[var(--shell-hover)]"
        onClick={onRetry}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {t('common:errorBoundary.remount')}
      </button>
    </div>
  )
}

export class WorkbenchErrorBoundary extends Component<
  WorkbenchErrorBoundaryProps,
  WorkbenchErrorBoundaryState
> {
  state: WorkbenchErrorBoundaryState = { failed: false, retryKey: 0 }

  static getDerivedStateFromError(): Partial<WorkbenchErrorBoundaryState> {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workbench renderer failed', error, info)
  }

  retry = () => {
    this.setState(retryWorkbenchErrorBoundary)
  }

  render() {
    if (this.state.failed) {
      return <WorkbenchErrorFallback onRetry={this.retry} />
    }

    return <div key={this.state.retryKey} className="h-full"><>{this.props.children}</></div>
  }
}
