import { useTranslation } from 'react-i18next'

/** Shared labels for defaults and live Workers; unknown native identifiers remain readable. */
export function useWorkerSettingsText() {
  const { t } = useTranslation('settings')
  const effortLabel = (value: string | null | undefined) => value == null
    ? t('workerDefaults.native') : t(`workerDefaults.efforts.${value}`, { defaultValue: value })
  const errors = [
    ['Invalid Worker idle timeout', 'workerDefaults.errors.idleTimeout'],
    ['Invalid Worker settings', 'workerDefaults.errors.invalidSettings'],
    ['Unsupported Worker backend', 'workerDefaults.errors.backend'],
    ['Invalid Worker model ID', 'workerDefaults.errors.modelId'],
    ['Invalid Worker reasoning effort', 'workerDefaults.errors.effortId'],
    ['Unsupported reasoning effort for this Codex model', 'workerDefaults.errors.unsupportedEffort'],
    ['Unsupported reasoning effort for this model', 'workerDefaults.errors.unsupportedEffort'],
    ['Model is not in the current Worker catalog; refresh the Worker model catalog', 'workerDefaults.errors.missingModel'],
    ['Model is not in the current Codex catalog', 'workerDefaults.errors.missingModel'],
    ['Worker is unavailable', 'workerDefaults.errors.unavailable'],
    ['Worker settings are still loading', 'workerDefaults.errors.loading'],
    ['Worker settings changed; retry on the current execution', 'workerDefaults.errors.changed'],
    ['Native Worker configuration was not confirmed', 'workerDefaults.errors.unconfirmed'],
    ['Worker settings are unavailable for this execution', 'workerDefaults.errors.unavailable'],
  ] as const
  const errorText = (value: unknown) => {
    const raw = String(value)
    const match = errors.find(([message]) => raw.endsWith(message))
    return match ? t(match[1]) : raw
  }
  return { effortLabel, errorText }
}
