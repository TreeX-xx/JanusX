import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { insertConversationNewline } from '../lib/conversation-input'
import styles from './QuestionAnswerInput.module.css'

/** Text answers use the same typing contract in native conversations and SuperAgent. */
export function QuestionAnswerInput({ value, onChange, onSubmit, label, placeholder, className = '', multiline = true, secret = false, disabled = false, onComposingChange }: {
  value: string
  onChange(value: string): void
  onSubmit(): void
  label: string
  placeholder: string
  className?: string
  multiline?: boolean
  secret?: boolean
  disabled?: boolean
  onComposingChange?(value: boolean): void
}) {
  const { t } = useTranslation('terminal')
  const composing = useRef(false)
  const props = {
    value, disabled, maxLength: 32000, spellCheck: false, autoComplete: 'off',
    className: `${styles.input} ${className}`, 'aria-label': label, placeholder,
    title: multiline && !secret ? t('conversation.inputHint') : undefined, 'data-question-answer-input': '',
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    onCompositionStart: () => { composing.current = true; onComposingChange?.(true) },
    onCompositionEnd: () => { composing.current = false; onComposingChange?.(false) },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
        if (event.key === 'Enter') event.preventDefault()
        event.stopPropagation()
        return
      }
      if (insertConversationNewline(event, onChange)) return
      if (event.key !== 'Enter') return
      event.stopPropagation()
      if (event.shiftKey || event.altKey) {
        if (!multiline || secret) event.preventDefault()
        return
      }
      event.preventDefault()
      if (!disabled && !event.repeat) onSubmit()
    },
  }
  return multiline && !secret ? <textarea {...props} rows={3} /> : <input {...props} type={secret ? 'password' : 'text'} />
}
