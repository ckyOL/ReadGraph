// 大文件导入 Worker（ui-navigation §6/§9：≥50MB 下放 Web Worker）。
// 只 import 纯函数（importPipeline + registry），不拉 UI 依赖（bundle-barrel-imports）。
// 输入/输出均结构化可克隆（rows/source/existing/meta → PipelineResult）。
import { expose } from 'comlink'

import type { ExistingState, ImportMeta, PipelineResult } from '@/parsers/pipeline'
import { importPipeline } from '@/parsers/pipeline'
import { getParser } from '@/parsers/registry'
import type { RawRecord, Source } from '@/types/entities'

export interface ImportWorkerInput {
  rows: RawRecord[]
  source: Source
  existing: ExistingState
  meta: ImportMeta
}

export interface ImportWorkerApi {
  run(input: ImportWorkerInput): Promise<PipelineResult>
}

const api: ImportWorkerApi = {
  async run({ rows, source, existing, meta }) {
    return importPipeline(rows, source, getParser(source.parserId), existing, meta)
  },
}

expose(api)
