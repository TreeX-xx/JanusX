// Note: .agents/notes/workbench/settings-layout.md — one UI implementation for host and plugins.
import { forwardRef, type ButtonHTMLAttributes, type FieldsetHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import './styles.css'
export { Select, type SelectProps, type SelectOption } from './Select.js'
export { settingsStyles } from './settings-styles.js'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'secondary' | 'primary' | 'ghost' | 'danger' | 'plain' | 'tab'
  size?: 'default' | 'small' | 'icon'
}>(function Button({ variant = 'secondary', size = 'default', type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} data-jx-control="button" data-jx-variant={variant} data-jx-size={size} />
})
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input {...props} ref={ref} data-jx-control="input" />
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <textarea {...props} ref={ref} data-jx-control="textarea" />
})
export const SettingsCheckbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function SettingsCheckbox(props, ref) {
  return <input {...props} ref={ref} type="checkbox" data-jx-control="checkbox" />
})

export function SettingsSurface({ as: Tag = 'div', ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'main' | 'section' }) {
  return <Tag {...props} data-jx-surface="settings" />
}
export function SettingsSection(props: HTMLAttributes<HTMLElement>) {
  return <section {...props} data-jx-section="" />
}
export function SettingsFieldset(props: FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  return <fieldset {...props} data-jx-section="" />
}
export function SettingsRow({ stacked, ...props }: HTMLAttributes<HTMLDivElement> & { stacked?: boolean }) {
  return <div {...props} data-jx-row={stacked ? 'stacked' : ''} />
}
export function SettingsLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} data-jx-row="" />
}
export function SettingsFooter({ sticky = true, ...props }: HTMLAttributes<HTMLDivElement> & { sticky?: boolean }) {
  return <div {...props} data-jx-footer={sticky ? 'sticky' : 'inline'} />
}
export function InputGroup({ as: Tag = 'div', ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'label' }) {
  return <Tag {...props} data-jx-group="" />
}
