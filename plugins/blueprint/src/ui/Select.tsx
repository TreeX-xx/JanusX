import { Select as SharedSelect, type SelectProps } from '@janusx/ui'
import { t } from './i18n'
export type { SelectProps, SelectOption } from '@janusx/ui'
export function Select(props: SelectProps) { return <SharedSelect emptyLabel={t('暂无选项')} {...props} /> }
export default Select
