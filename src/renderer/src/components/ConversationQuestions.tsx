import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircleQuestion } from 'lucide-react'
import { validateConversationAnswer, type ConversationQuestionAnswer, type ConversationQuestionRequest } from '../../../shared/conversation-questions'
import styles from './ConversationQuestions.module.css'
import { QuestionAnswerInput } from './QuestionAnswerInput'

// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md — answer the waiting native request, never enqueue a prompt.
export function ConversationQuestions({ request, disabled, answer }: {
  request: ConversationQuestionRequest
  disabled: boolean
  answer: (value: ConversationQuestionAnswer) => void
}) {
  const { t } = useTranslation('terminal')
  const [values, setValues] = useState<ConversationQuestionAnswer['answers']>(() => request.questions.map(question => ({ id: question.id, selected: [], text: question.initialText ?? '' })))
  const [composing, setComposing] = useState(false)
  const submission = { answers: values.map(row => ({ id: row.id, selected: row.selected, ...(row.text?.trim() ? { text: row.text } : {}) })) }
  let valid = true
  try { validateConversationAnswer(request, submission) } catch { valid = false }
  const locked = disabled || request.status === 'submitting' || request.status === 'unknown'
  const update = (id: string, patch: Partial<ConversationQuestionAnswer['answers'][number]>) => setValues(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row))
  const submit = () => { if (!locked && valid && !composing) answer(submission) }
  return <form className={styles.request} aria-label={t('conversation.question.heading')} onSubmit={event => { event.preventDefault(); submit() }}>
    <div className={styles.heading}><MessageCircleQuestion size={17} aria-hidden="true" /><strong>{t('conversation.question.heading')}</strong></div>
    {request.questions.map(question => {
      const value = values.find(row => row.id === question.id)!
      const label = question.header || question.text
      return <fieldset key={question.id} disabled={locked} className={styles.question}>
        <legend>{question.header && <span className={styles.header}>{question.header}</span>}<span>{question.text}</span></legend>
        {question.detail && <pre className={styles.detail}>{question.detail}</pre>}
        {question.options.length > 0 && <div className={styles.options} role={question.multiple ? 'group' : 'radiogroup'} aria-label={label}>
          {question.options.map(option => <label className={styles.option} key={option.id} data-selected={value.selected.includes(option.id)}>
            <input type={question.multiple ? 'checkbox' : 'radio'} name={`${typeof request.id}:${request.id}:${question.id}`} checked={value.selected.includes(option.id)}
              onChange={() => update(question.id, { selected: question.multiple ? value.selected.includes(option.id) ? value.selected.filter(id => id !== option.id) : [...value.selected, option.id] : [option.id], ...(!question.multiple ? { text: '' } : {}) })} />
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          </label>)}
        </div>}
        {question.allowText && <label className={styles.custom}>
          <span>{question.options.length ? t('conversation.question.other') : t('conversation.question.answer')}</span>
          <QuestionAnswerInput value={value.text ?? ''} label={t('conversation.question.customAria', { question: label })}
            placeholder={question.placeholder ?? t('conversation.question.placeholder')} multiline={Boolean(question.multiline || question.options.length)} secret={question.secret}
            disabled={locked} onComposingChange={setComposing} onSubmit={submit}
            onChange={text => update(question.id, { text, ...(!question.multiple ? { selected: [] } : {}) })} />
        </label>}
      </fieldset>
    })}
    {request.status === 'unknown' && <p role="alert">{t('conversation.question.unknown')}</p>}
    <div className={styles.actions}>
      {request.cancelable && <button type="button" disabled={locked} onClick={() => answer({ cancelled: true, answers: [] })}>{t('conversation.question.cancel')}</button>}
      <button type="submit" className={styles.submit} disabled={locked || !valid || composing}>{t(request.status === 'submitting' ? 'conversation.question.submitting' : 'conversation.question.submit')}</button>
    </div>
  </form>
}
