// 预置来源模板注册表（docs/metadata/source.md SOURCE_TEMPLATES）。
// 用户创建新来源时可从模板挑选；模板提供默认 timezone/library 等配置，
// parserId 即来源唯一标识（source.parserId 二合一）。
// 模板为 Partial 形状，管理字段（id/createdAt 等）由 sourceFromTemplate 补齐。
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
    name: '深圳图书馆（流通 API）',
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
