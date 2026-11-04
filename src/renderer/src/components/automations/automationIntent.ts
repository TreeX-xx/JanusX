/** Route explicit automation topics locally, before waiting for a model response. */
export function isAutomationRequest(text: string): boolean {
  return /自动化|定时(?:任务|提醒|通知)|自动(?:提醒|通知)|\bautomations?\b|\bschedul(?:e|ed|ing)\s+(?:(?:a|an|the)\s+)?(?:tasks?|reminders?|notifications?)\b/i.test(text)
    || (/每[^。！？\n]{0,24}(?:分钟|小时|天|周)/.test(text) && /提醒|通知/.test(text))
    || (/\bevery\s+(?:(?:\d+|one)\s+)?(?:minutes?|hours?|days?|weeks?)\b/i.test(text) && /\b(?:remind|reminders?|notify|notifications?)\b/i.test(text))
}
