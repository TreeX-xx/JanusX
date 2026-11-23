import type { RefObject } from 'react'
import { ArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './disclosure-return.css'

export function DisclosureReturn({ toggleRef }: { toggleRef: RefObject<HTMLButtonElement> }) {
  const { t } = useTranslation('terminal')
  const label = t('conversation.work.returnToToggle')

  const returnToToggle = () => {
    const toggle = toggleRef.current
    if (!toggle) return
    for (let parent = toggle.parentElement; parent; parent = parent.parentElement) {
      if (!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue
      parent.scrollBy({
        top: toggle.getBoundingClientRect().top - parent.getBoundingClientRect().top - parent.clientTop - 12,
        behavior: 'instant',
      })
      break
    }
    toggle.focus({ preventScroll: true })
  }

  return <div className="disclosure-return">
    <button type="button" className="disclosure-return-button" aria-label={label} title={label} onClick={returnToToggle}>
      <ArrowUp size={13} aria-hidden="true" />
    </button>
  </div>
}
