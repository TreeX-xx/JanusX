import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { macProxyEnvironment } from '../src/utils/mac-system-proxy'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const output = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 10.0.0.0/8
    2 : <local>
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
  HTTPSEnable : 1
  HTTPSProxy : ::1
  HTTPSPort : 8080
  __SCOPED__ : <dictionary> {
    en0 : <dictionary> {
      HTTPSProxy : ignored.example
    }
  }
}`

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('propagates active global routes and bypasses, honors explicit settings and notices system changes', () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }))
  vi.useFakeTimers()
  const read = vi.mocked(execFileSync)
  read.mockReturnValue(output)
  const original = { NO_PROXY: 'internal.example' }
  const env = macProxyEnvironment(original)
  expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7897')
  expect(env.HTTPS_PROXY).toBe('http://[::1]:8080')
  expect(env.no_proxy).toBe('internal.example,localhost,127.0.0.1,::1,*.local,10.0.0.0/8')
  expect(original).toEqual({ NO_PROXY: 'internal.example' })
  for (const override of [{ https_proxy: 'http://custom' }, { ALL_PROXY: 'http://custom' }]) {
    expect(macProxyEnvironment(override)).toBe(override)
  }
  vi.advanceTimersByTime(1001)
  read.mockReturnValue(output.replace('HTTPPort : 7897', 'HTTPPort : 8090').replace('HTTPSEnable : 1', 'HTTPSEnable : 0'))
  expect(macProxyEnvironment({})).toMatchObject({ HTTP_PROXY: 'http://127.0.0.1:8090' })
  expect(macProxyEnvironment({}).HTTPS_PROXY).toBeUndefined()
  vi.advanceTimersByTime(1001)
  read.mockReturnValue('<dictionary> {\n ProxyAutoConfigEnable : 1\n}')
  expect(macProxyEnvironment(original)).toBe(original)
  vi.advanceTimersByTime(1001)
  read.mockImplementation(() => { throw new Error('unavailable') })
  expect(macProxyEnvironment(original)).toBe(original)
})
