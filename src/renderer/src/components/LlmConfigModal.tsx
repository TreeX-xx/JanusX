import { Button as SettingsButton } from '@janusx/ui'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import styles from './LlmConfigModal.module.css'
import { ModalCloseButton } from './ModalCloseButton'
import { CliSyncSection } from './CliSyncSection'
import { getLlmRuntimeStatus } from '@/services/llm'
import { useI18n } from '@/i18n/useI18n'
import type { LlmRuntimeStatus } from '../../../shared/ipc/llm'

interface LlmConfigModalProps {
  isOpen?: boolean
  onClose?: () => void
  embedded?: boolean
}

export function LlmConfigModal({ isOpen = false, onClose, embedded = false }: LlmConfigModalProps) {
  const { t } = useI18n('llm')
  const modalRootRef = useRef<HTMLDivElement | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<LlmRuntimeStatus | null>(null)
  const [runtimeChecking, setRuntimeChecking] = useState(false)

  const refreshRuntimeStatus = useCallback(async () => {
    setRuntimeChecking(true)
    try {
      setRuntimeStatus(await getLlmRuntimeStatus())
    } catch (error) {
      console.error('Failed to detect LLM runtime status:', error)
    } finally {
      setRuntimeChecking(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen || embedded) {
      void refreshRuntimeStatus()
    }
  }, [isOpen, embedded, refreshRuntimeStatus])

  // Janus 终端配置变化后重检内部默认模型的可用性
  useEffect(() => {
    if (!isOpen && !embedded) return
    const onChanged = () => {
      void refreshRuntimeStatus()
    }
    window.addEventListener('janus:llm-config-changed', onChanged)
    return () => window.removeEventListener('janus:llm-config-changed', onChanged)
  }, [isOpen, embedded, refreshRuntimeStatus])

  if (!isOpen && !embedded) return null

  const panel = (
    <div className={`${styles.llmConfigPanel} ${embedded ? styles.embeddedPanel : ''}`}>
      {!embedded && (
        <div className={styles.configHeader}>
          <div className={styles.configTitle}>
            <i className={styles.statusDot}></i>
            {t('llm:title.label')} <span className={styles.titleMeta}>{t('llm:title.meta')}</span>
          </div>
          {onClose && <ModalCloseButton onClose={() => { onClose() }} />}
        </div>
      )}

      <div className={styles.configBody}>
        {runtimeStatus && (
          <div className={styles.runtimeStatus} data-state={runtimeStatus.connection.state}>
            <span className={styles.runtimeIndicator} />
            <div>
              <strong>{runtimeStatus.connection.state === 'available'
                ? t('llm:runtime.available')
                : runtimeStatus.connection.state === 'unavailable'
                  ? t('llm:runtime.unavailable')
                  : runtimeStatus.connection.state === 'unconfigured'
                    ? t('llm:runtime.unconfigured')
                    : t('llm:runtime.detecting')}</strong>
              <span>{runtimeStatus.profileSync.state === 'synchronized'
                ? t('llm:runtime.synced', { count: runtimeStatus.profileSync.importedProviderCount })
                : runtimeStatus.profileSync.state === 'unchanged'
                  ? t('llm:runtime.unchanged')
                  : runtimeStatus.profileSync.state === 'source-missing'
                    ? t('llm:runtime.sourceMissing')
                    : runtimeStatus.profileSync.state === 'failed'
                      ? t('llm:runtime.failed')
                      : t('llm:runtime.formal')}
                {runtimeStatus.connection.latency !== undefined
                  ? t('llm:runtime.latencySuffix', { latency: runtimeStatus.connection.latency })
                  : ''}
              </span>
              {runtimeStatus.connection.error && <small>{runtimeStatus.connection.error}</small>}
            </div>
            <SettingsButton variant="ghost" size="icon" type="button" onClick={() => void refreshRuntimeStatus()} disabled={runtimeChecking} aria-label={t('llm:runtime.refreshTitle')} title={t('llm:runtime.refreshTitle')}>
              <RefreshCw size={13} className={runtimeChecking ? styles.spinning : undefined} />
            </SettingsButton>
          </div>
        )}

        <CliSyncSection />
      </div>
    </div>
  )

  if (embedded) {
    return (
      <div ref={modalRootRef} className={styles.embeddedRoot}>
        {panel}
      </div>
    )
  }

  return createPortal(
    <div ref={modalRootRef} className={`${styles.modalBackdrop} ${isOpen ? styles.show : ''}`}>
      {panel}
    </div>,
    document.body,
  )
}
