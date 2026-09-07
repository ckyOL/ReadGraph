// 大文件导入 Worker（ui-navigation §6/§9：≥50MB 下放 Web Worker）。
// 只 import 纯函数（importPipeline + registry），不拉 UI 依赖（bundle-barrel-imports）。
// 输入/输出均结构化可克隆（rows/source/existing/meta → PipelineResult）；
// trace 为会话态普通对象（debug-mode spec §5.4，D6：Comlink 结构化克隆支持）。
import { expose } from 'comlink'

import type { ExistingState, ImportMeta, PipelineResult, TraceOptions } from '@/parsers/pipeline'
import { importPipeline } from '@/parsers/pipeline'
import { getParser } from '@/parsers/registry'
import type { ImportTrace } from '@/parsers/trace'
import type { RawRecord, Source } from '@/types/entities'

export interface ImportWorkerInput {
  rows: RawRecord[]
  source: Source
  existing: ExistingState
  meta: ImportMeta
  /** trace 收集开关（debug-mode spec §5.4；缺省 → 零收集、trace 回传 null）。 */
  traceOptions?: TraceOptions
}

export interface ImportWorkerOutput {
  result: PipelineResult
  trace: ImportTrace | null
}

export interface ImportWorkerApi {
  run(input: ImportWorkerInput): Promise<ImportWorkerOutput>
}

export const api: ImportWorkerApi = {
  async run({ rows, source, existing, meta, traceOptions }): Promise<ImportWorkerOutput> {
    // traceOptions 缺省 → 管线零收集（D5）；存在时 Worker 内 performance.now
    // 同源可用，差值填 trace.durationMs（spec §4.2：跨线程不合并 mark）。
    const started = traceOptions ? performance.now() : 0
    const result = importPipeline(
      rows,
      source,
      getParser(source.parserId),
      existing,
      meta,
      traceOptions,
    )
    if (traceOptions && result.trace != null) {
      result.trace.durationMs = performance.now() - started
    }
    return { result, trace: result.trace ?? null }
  },
}

expose(api)
