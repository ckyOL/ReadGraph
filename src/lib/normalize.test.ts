import { describe, it, expect } from 'vitest'

import { normalize } from '@/lib/normalize'

describe('normalize', () => {
  it('全角转半角并转小写', () => {
    expect(normalize('Ａｂｃ１２３')).toBe('abc123')
  })

  it('去标点转小写一致（中英标点）', () => {
    expect(normalize('合成编程指南')).toBe('合成编程指南')
    expect(normalize('合成, 编程指南!')).toBe('合成编程指南')
    expect(normalize('Algorithm：an Intro.')).toBe('algorithmanintro')
  })

  it('空串/纯标点/纯空白归一等价键', () => {
    expect(normalize('')).toBe('')
    expect(normalize('，。？!；：')).toBe('')
    expect(normalize('   ')).toBe('')
  })

  it('等价键不依赖原文标点差异', () => {
    expect(normalize('合成, 绘本甲')).toBe(normalize('合成绘本甲'))
  })

  it('全角空格 U+3000 归一为普通空格再删除', () => {
    expect(normalize('合成　绘本甲')).toBe('合成绘本甲')
  })
})
