import { Select as SharedSelect, type SelectProps } from '@janusx/ui'
import { useI18n } from '@/i18n/useI18n'
export type { SelectProps, SelectOption } from '@janusx/ui'

export function Select(props: SelectProps) {
  const { t } = useI18n('common')
  return <SharedSelect emptyLabel={t('common:select.empty')} {...props} />
}
export default Select
