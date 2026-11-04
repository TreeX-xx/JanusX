import { describe, expect, it } from 'vitest'
import { isAutomationRequest } from '../../src/renderer/src/components/automations/automationIntent'

describe('Island automation intent', () => {
  for (const text of ['生成一个自动化流程，每一分钟提醒我检查一下手机，以通知的形式', '查看自动化任务', '创建定时任务', '定时提醒我休息', '每一分钟提醒我看手机', '提醒我每一小时站起来', 'Create an automation', 'Show my automations', 'Schedule a notification', 'Remind me every minute to check my phone', 'Every 2 hours notify me']) {
    it(`recognizes ${text}`, () => expect(isAutomationRequest(text)).toBe(true))
  }
  for (const text of ['', '帮我解释这段代码', '自动保存文件', '每分钟处理多少请求', 'Show the notification settings', 'Explain this workflow']) {
    it(`keeps ordinary chat in place: ${text}`, () => expect(isAutomationRequest(text)).toBe(false))
  }
})
