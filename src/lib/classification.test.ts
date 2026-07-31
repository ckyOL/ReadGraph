import { describe, it, expect } from 'vitest'

import {
  CLC_FIRST_LEVEL,
  DDC_FIRST_LEVEL,
  classificationCategory,
  classificationFirstLevel,
} from './classification'

describe('classificationCategory', () => {
  it('CLC 取首字母大写映射一级类目', () => {
    expect(classificationCategory('clc', 'I247.5')).toBe('文学')
    expect(classificationCategory('clc', 'TP312')).toBe('工业技术')
    expect(classificationCategory('clc', 'k248')).toBe('历史、地理')
    expect(classificationCategory('clc', 'J238.2')).toBe('艺术')
  })

  it('CLC 表内所有一级字母均可命中', () => {
    for (const [letter, name] of Object.entries(CLC_FIRST_LEVEL)) {
      expect(classificationCategory('clc', letter)).toBe(name)
      // 复码同样归并（如 TP312 → T）。
      expect(classificationCategory('clc', `${letter}1`)).toBe(name)
    }
  })

  it('CLC 未启用字母（L/M/W/Y）返回 null（中图法无此一级类）', () => {
    for (const letter of ['L', 'M', 'W', 'Y']) {
      expect(CLC_FIRST_LEVEL[letter]).toBeUndefined()
      expect(classificationCategory('clc', letter)).toBeNull()
    }
  })

  it('DDC 取首位数字映射主类', () => {
    expect(classificationCategory('ddc', '005.1')).toBe(
      'Computer science, information & general works',
    )
    expect(classificationCategory('ddc', '813')).toBe('Literature')
    expect(classificationCategory('ddc', '0')).toBe(
      'Computer science, information & general works',
    )
  })

  it('DDC 全表 0–9 均可命中', () => {
    for (const digit of '0123456789'.split('')) {
      expect(DDC_FIRST_LEVEL[digit]).toBeTypeOf('string')
      expect(classificationCategory('ddc', digit)).toBe(DDC_FIRST_LEVEL[digit])
    }
  })

  it('未知体系/非法 code 返回 null（不抛错）', () => {
    expect(classificationCategory('clc', '1')).toBeNull()
    expect(classificationCategory('ddc', 'X')).toBeNull()
    expect(classificationCategory('lcc', 'QA76')).toBeNull()
    expect(classificationCategory('clc', '')).toBeNull()
  })
})

describe('classificationFirstLevel', () => {
  it('CLC/DDC 归并到一级 code+category+name', () => {
    expect(classificationFirstLevel('clc', { system: 'clc', code: 'TP312' })).toEqual({
      code: 'T',
      category: '工业技术',
      name: '工业技术',
    })
    expect(classificationFirstLevel('ddc', { system: 'ddc', code: '005.1' })).toEqual({
      code: '0',
      category: 'Computer science, information & general works',
      name: 'Computer science, information & general works',
    })
  })

  it('lcc/udc/other 沿用条目原 code/category', () => {
    expect(
      classificationFirstLevel('lcc', { system: 'lcc', code: 'QA76', category: 'Mathematics' }),
    ).toEqual({ code: 'QA76', category: 'Mathematics', name: 'Mathematics' })
    expect(classificationFirstLevel('udc', { system: 'udc', code: '004' })).toEqual({
      code: '004',
      category: null,
      name: '004',
    })
  })

  it('不可用条目返回 null', () => {
    expect(classificationFirstLevel('clc', { system: 'clc', code: '1' })).toBeNull()
  })
})
