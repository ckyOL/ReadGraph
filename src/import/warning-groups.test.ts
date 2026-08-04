import { describe, it, expect } from 'vitest'

import type { ParseWarning, ParseWarningType } from '@/types/entities'
import { groupWarnings } from './warning-groups'

function mk(type: ParseWarningType, i: number): ParseWarning {
  return { type, message: `msg-${i}`, recordRef: null }
}

describe('groupWarnings', () => {
  it('按类型归组：组间保持首见顺序，组内保持原顺序', () => {
    const input = [mk('duplicate', 1), mk('format_error', 2), mk('duplicate', 3), mk('missing_field', 4)]
    const groups = groupWarnings(input)

    expect(groups.map(([type]) => type)).toEqual([
      'duplicate',
      'format_error',
      'missing_field',
    ])
    expect(groups[0]![1].map((w) => w.message)).toEqual(['msg-1', 'msg-3'])
    expect(groups[1]![1]).toEqual([{ type: 'format_error', message: 'msg-2', recordRef: null }])
  })

  it('空输入 → 空数组', () => {
    expect(groupWarnings([])).toEqual([])
  })

  it('单条警告 → 单组单条', () => {
    const groups = groupWarnings([mk('duplicate', 1)])
    expect(groups).toHaveLength(1)
    expect(groups[0]![1]).toHaveLength(1)
  })
})
