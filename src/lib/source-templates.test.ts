import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { ReadGraphDB } from '@/db/db'
import { createTestDB, closeTestDB } from '@/db/test-helpers'
import { SOURCE_TEMPLATES, sourceFromTemplate, ensureSourceFromTemplate } from './source-templates'

let db: ReadGraphDB
beforeEach(() => {
  db = createTestDB()
})
afterEach(async () => {
  await closeTestDB(db)
})

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

describe('ensureSourceFromTemplate', () => {
  it('无同 parserId 来源时创建并落库', async () => {
    const tpl = SOURCE_TEMPLATES[0]!
    const now = new Date('2026-07-31T00:00:00.000Z')
    const s = await ensureSourceFromTemplate(db, tpl, now)
    expect(await db.sources.get(s.id)).toEqual(s)
    expect(await db.sources.count()).toBe(1)
  })

  it('已有同 parserId 来源时复用而非重复写入（二次创建不触发 ConstraintError）', async () => {
    const tpl = SOURCE_TEMPLATES[0]!
    const first = await ensureSourceFromTemplate(
      db,
      tpl,
      new Date('2026-07-31T00:00:00.000Z'),
    )
    const second = await ensureSourceFromTemplate(
      db,
      tpl,
      new Date('2026-08-01T00:00:00.000Z'),
    )
    expect(second.id).toBe(first.id)
    expect(second.createdAt).toEqual(first.createdAt)
    expect(await db.sources.count()).toBe(1)
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
