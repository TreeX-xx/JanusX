import type { OfficeErrorCode } from '../../../../shared/office'
import { useI18n } from '@/i18n/useI18n'
import type { TFunction } from 'i18next'

const ERROR_KEY: Record<OfficeErrorCode, string> = {
  NOT_INSTALLED: 'editor:office.errorNotInstalled',
  INCOMPATIBLE: 'editor:office.errorIncompatible',
  TOO_MANY: 'editor:office.errorTooMany',
  START_FAILED: 'editor:office.errorStartFailed',
  PORT_TIMEOUT: 'editor:office.errorPortTimeout',
  NO_PORT: 'editor:office.errorNoPort',
  IO: 'editor:office.errorIo',
  NOT_OFFICE: 'editor:office.errorNotOffice',
  OUTSIDE_ROOT: 'editor:office.errorOutsideRoot',
  SCAN_LIMIT: 'editor:office.errorScanLimit',
  INVALID_REQUEST: 'editor:office.errorInvalidRequest',
  UNAUTHORIZED: 'editor:office.errorUnauthorized',
  UNAVAILABLE: 'editor:office.errorUnavailable',
}

export function buildOfficePreviewUrl(port: number | undefined): string | null {
  return Number.isInteger(port) && port! >= 1 && port! <= 65535 ? `http://127.0.0.1:${port}/` : null
}

interface Props {
  port?: number
  status: 'starting' | 'ready' | 'reloading' | 'error'
  errorCode?: OfficeErrorCode
  onRetry: () => void
  onClose: () => void
}

export function getOfficeErrorCopy(errorCode: OfficeErrorCode, t?: TFunction): string {
  return t ? t(ERROR_KEY[errorCode]) : ERROR_KEY[errorCode]
}

export function OfficePreviewFrame({ port, status, errorCode, onRetry, onClose }: Props) {
  const { t, currentLanguage } = useI18n('editor')
  const src = buildOfficePreviewUrl(port)
  if (status === 'error' || !src) {
    if (status !== 'error') return <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-[var(--shell-dim)]">
      <span className="product-spinner" aria-hidden="true" />
      <span>{t('editor:office.startingPreview')}</span>
    </div>
    return <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-xs text-[var(--shell-muted)]">
      <div>{getOfficeErrorCopy(errorCode ?? 'UNAVAILABLE', t)}</div>
      <div className="flex gap-2">
        <button className="rounded border border-[var(--shell-border)] px-2 py-1 hover:bg-[var(--shell-hover)]" onClick={onRetry}>{t('editor:office.retry')}</button>
        <button className="rounded border border-[var(--shell-border)] px-2 py-1 hover:bg-[var(--shell-hover)]" onClick={onClose}>{t('editor:office.close')}</button>
      </div>
    </div>
  }
  return <div className="relative h-full">
    {status === 'reloading' && <div className="absolute inset-x-0 top-0 z-10 bg-[var(--shell-chrome)] py-1 text-center text-[10px] text-[var(--shell-muted)]">{t('editor:office.reloading')}</div>}
    <iframe data-preview-frame="" title={t('editor:office.iframeTitle')} className="h-full w-full border-0 bg-white" src={`${src}?janusLanguage=${encodeURIComponent(currentLanguage)}`} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
  </div>
}
