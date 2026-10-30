import { describe, expect, it } from 'vitest'
import { DEFAULT_CPA_MANAGEMENT_URL, normalizeCpaManagementUrl, validateCpaManagementKey } from '../../plugins/cpa/src/shared/cpa'

describe('CPA page addresses', () => {
  it.each([
    ['localhost:8317', 'http://localhost:8317/management.html'],
    ['127.0.0.1:8317/', DEFAULT_CPA_MANAGEMENT_URL],
    ['[::1]:8317', 'http://[::1]:8317/management.html'],
    ['example.com', 'https://example.com/management.html'],
    [' https://example.com/panel/#/quota ', 'https://example.com/panel/#/quota'],
  ])('normalizes %s', (input, expected) => { expect(normalizeCpaManagementUrl(input)).toBe(expected) })

  it.each(['', 'file:///C:/secret', 'javascript:alert(1)', 'data:text/html,content', 'https://user:secret@example.com',
    'http://localhost:8317/?key=secret', 'https://', null, 42])('rejects non-page and credential-bearing input %j', (input) => {
    expect(() => normalizeCpaManagementUrl(input)).toThrow('invalid-cpa-url')
  })
})

describe('CPA management key validation', () => {
  it.each(['', 'short', ' leading', 'trailing ', 'a\r\nbcdefgh', '中文管理密钥123', 'x'.repeat(129), null])('rejects unusable header credentials without echoing them', (input) => {
    expect(() => validateCpaManagementKey(input)).toThrow(/^cpa-invalid-management-key$/)
  })
  it('accepts bounded printable credentials without modifying them', () => {
    expect(validateCpaManagementKey('My-Key_2026!')).toBe('My-Key_2026!')
    expect(validateCpaManagementKey('a'.repeat(128))).toHaveLength(128)
  })
})
