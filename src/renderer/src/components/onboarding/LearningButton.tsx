import { BookOpen, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { useOnboardingStore } from '@/stores/onboarding'
import styles from './Onboarding.module.css'

export function LearningButton({ onOpen, variant = 'compact' }: { onOpen?: () => void; variant?: 'compact' | 'settings' }) {
  const { t } = useI18n('common')
  return (
    <button type="button" className={`${styles.entry} ${variant === 'settings' ? styles.settingsEntry : ''}`} data-onboarding="learning"
      onClick={() => { onOpen?.(); useOnboardingStore.getState().openCenter() }}>
      <BookOpen size={variant === 'settings' ? 16 : 14} strokeWidth={1.7} aria-hidden="true" />
      <span>{t('common:learning.title')}</span>
      {variant === 'settings' && <ChevronRight size={14} strokeWidth={1.7} aria-hidden="true" className={styles.entryArrow} />}
    </button>
  )
}
