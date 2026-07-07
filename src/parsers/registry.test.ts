import { describe, it, expect } from 'vitest'

import { createRegistry, defaultRegistry, getParser, matchParser } from './registry'
import { szlibParser } from './szlib'
import sample from '@/tests/fixtures/szlib-sample.json'

describe('parser registry', () => {
  it('getParser("szlib") 命中默认注册的 szlibParser', () => {
    expect(getParser('szlib')).toBe(szlibParser)
  })

  it('getParser 对未知 id 抛错（不静默回退）', () => {
    expect(() => getParser('nope')).toThrow(/no parser registered/)
  })

  it('matchParser 对合法 szlib JSON 命中 szlibParser', () => {
    expect(matchParser(JSON.stringify(sample))?.id).toBe('szlib')
  })

  it('matchParser 对错配数据返回 null', () => {
    expect(matchParser('not json{}')).toBeNull()
  })

  it('createRegistry 生成隔离实例，不影响默认注册表', () => {
    const r = createRegistry()
    expect(r.size()).toBe(0)
    expect(defaultRegistry.size()).toBeGreaterThanOrEqual(1)
    r.register(szlibParser)
    expect(r.getParser('szlib')).toBe(szlibParser)
  })
})
