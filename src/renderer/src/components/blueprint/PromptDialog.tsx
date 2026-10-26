/**
 * @file 最小化输入对话框组件
 * @description
 *  用于替代 Electron BrowserWindow 中不可用的 window.prompt。
 *  自带遮罩层 + 居中对话框，支持回车提交 / Esc 取消 / 点击遮罩取消。
 *  样式见 ./PromptDialog.css（.prompt-dialog 前缀）。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import './PromptDialog.css'
import { useI18n } from '@/i18n/useI18n'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'

export interface PromptDialogProps {
  open: boolean
  title: string
  label?: string
  placeholder?: string
  defaultValue?: string
  description?: ReactNode
  confirmOnly?: boolean
  /** 仅展示确认按钮(用于错误告知类对话框) */
  hideCancel?: boolean
  tone?: 'primary' | 'danger'
  confirmText?: string
  cancelText?: string
  onConfirm: (value: string) => void
  onCancel: () => void
  validate?: (value: string) => string | null
}

export function PromptDialog({
  open,
  title,
  label,
  placeholder,
  defaultValue,
  description,
  confirmOnly = false,
  hideCancel = false,
  tone = 'primary',
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  validate
}: PromptDialogProps) {
  useBrowserOcclusion(open)
  const { t } = useI18n('common')
  const resolvedConfirmText = confirmText ?? t('common:action.ok')
  const resolvedCancelText = cancelText ?? t('common:action.cancel')
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // open 切到 true 时：重置为 defaultValue 并在下一帧 focus + 全选
  useEffect(() => {
    if (!open) return
    setValue(defaultValue ?? '')
  }, [open, defaultValue])

  // 无输入框时把焦点放到对话框容器上（而不是确认按钮）：
  // 程序化 focus 按钮会触发 :focus-visible，让危险按钮意外出现高亮光圈
  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      } else {
        dialogRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(t)
  }, [open])

  if (!open) return null

  const trimmed = value.trim()
  const validationMsg = validate ? validate(trimmed) : null
  const canConfirm = confirmOnly || (trimmed.length > 0 && !validationMsg)

  const submit = () => {
    if (!canConfirm) return
    onConfirm(trimmed)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && confirmOnly) {
      e.preventDefault()
      submit()
    }
  }

  // 遮罩点击：仅当点击的是遮罩本身（而非内部对话框）时才取消
  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div className="prompt-dialog__overlay" onMouseDown={onOverlayClick}>
      <div
        ref={dialogRef}
        className="prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <div className="prompt-dialog__title">{title}</div>

        {description ? <div className="prompt-dialog__description">{description}</div> : null}
        {!confirmOnly && label ? <label className="prompt-dialog__label">{label}</label> : null}

        {!confirmOnly ? (
          <input
            ref={inputRef}
            className="prompt-dialog__input"
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
        ) : null}

        {validationMsg ? <div className="prompt-dialog__error">{validationMsg}</div> : null}

        <div className="prompt-dialog__actions">
          {!hideCancel && (
            <button type="button" className="blueprint-btn" onClick={onCancel}>
              {resolvedCancelText}
            </button>
          )}
          <button
            type="button"
            className={`blueprint-btn ${tone === 'danger' ? 'blueprint-btn--danger' : 'blueprint-btn--primary'}`}
            onClick={submit}
            disabled={!canConfirm}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
