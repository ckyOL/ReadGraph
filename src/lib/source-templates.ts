// 预置来源模板注册表（docs/metadata/source.md SOURCE_TEMPLATES）。
// 用户创建新来源时可从模板挑选；模板提供默认 timezone/library 等配置，
// parserId 即来源唯一标识（source.parserId 二合一）。
// 模板为 Partial 形状，管理字段（id/createdAt 等）由 sourceFromTemplate 补齐。
import type { ReadGraphDB } from '@/db/db'
import { createRepositories } from '@/db/repositories'
import type { LibraryInfo, Source, SourceType } from '@/types/entities'
import { uuid } from '@/db/uuid'

export interface SourceTemplate {
  type: SourceType
  name: string
  parserId: string
  timezone: string
  library: LibraryInfo
}

/** 预置来源模板（对照 source.md「预置来源注册表」）。 */
export const SOURCE_TEMPLATES: SourceTemplate[] = [
  {
    type: 'library',
    name: '深圳图书馆',
    parserId: 'szlib',
    timezone: 'Asia/Shanghai',
    library: {
      libraryType: 'public',
      city: '深圳市',
      province: '广东省',
      website: 'https://www.szlib.org.cn',
      opacUrl: null,
      classificationSystem: 'clc',
    },
  },
]

/**
 * 从模板派生完整 Source：管理字段补齐（id=uuid、parserVersion/notes=null、
 * createdAt=调用方锚点、lastImportAt=null、totalImportedRecords=0）。
 * 时间由调用方传入而非 Date.now()，保证确定性可测。
 */
export function sourceFromTemplate(template: SourceTemplate, now: Date): Source {
  return {
    id: uuid(),
    type: template.type,
    name: template.name,
    parserId: template.parserId,
    parserVersion: null,
    timezone: template.timezone,
    library: template.library,
    notes: null,
    createdAt: now,
    lastImportAt: null,
    totalImportedRecords: 0,
  }
}

/**
 * 幂等创建来源：sources 表对 parserId 建唯一索引（&parserId，见 internal-schema），
 * 同一模板二次「创建并继续」直接 put 会触发 ConstraintError。
 * 已存在同 parserId 来源时复用该来源而非重复写入；
 * 并发双击下 put 仍可能唯一冲突，捕获 ConstraintError 后回查已有来源。
 * 时间由调用方传入而非 Date.now()，保证确定性可测。
 */
export async function ensureSourceFromTemplate(
  db: ReadGraphDB,
  template: SourceTemplate,
  now: Date,
): Promise<Source> {
  const existing = await db.sources.where('parserId').equals(template.parserId).first()
  if (existing) return existing
  const created = sourceFromTemplate(template, now)
  try {
    await createRepositories(db).sources.put(created)
    return created
  } catch (e) {
    if (e instanceof Error && e.name === 'ConstraintError') {
      const raced = await db.sources.where('parserId').equals(template.parserId).first()
      if (raced) return raced
    }
    throw e
  }
}
