import { describe, it, expect } from 'vitest'

import { SOURCE_TEMPLATES, sourceFromTemplate } from './source-templates'

describe('SOURCE_TEMPLATES', () => {
  it('含深圳图书馆模板，parserId=szlib、Asia/Shanghai、CLC', () => {
    const tpl = SOURCE_TEMPLATES.find((t) => t.parserId === 'szlib')
    expect(tpl).toBeDefined()
    expect(tpl!.type).toBe('library')
    expect(tpl!.timezone).toBe('Asia/Shanghai')
    expect(tpl!.library?.classificationSystem).toBe('clc')
    expect(tpl!.library?.city).toBe('深圳市')
  })

  it('模板为 Partial 形状（无 id/createdAt 等管理字段）', () => {
    for (const t of SOURCE_TEMPLATES) {
      expect(t).not.toHaveProperty('id')
      expect(t).not.toHaveProperty('createdAt')
      expect(t.name).toBeTypeOf('string')
      expect(t.parserId).toBeTypeOf('string')
      expect(t.timezone).toBeTypeOf('string')
    }
  })
})

describe('sourceFromTemplate', () => {
  it('产出完整 Source：管理字段由调用方派生时间补齐', () => {
    const tpl = SOURCE_TEMPLATES[0]!
    const now = new Date('2026-07-31T00:00:00.000Z')
    const s = sourceFromTemplate(tpl, now)
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(s.parserId).toBe(tpl.parserId)
    expect(s.timezone).toBe(tpl.timezone)
    expect(s.createdAt).toBe(now)
    expect(s.lastImportAt).toBeNull()
    expect(s.totalImportedRecords).toBe(0)
    expect(s.parserVersion).toBeNull()
    expect(s.notes).toBeNull()
    expect(s.library).toEqual(tpl.library)
  })
})
