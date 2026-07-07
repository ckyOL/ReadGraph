// Parser 注册表（§10.2）。
// 一个 parserId 对应一个 SourceParser（parser.id === source.parserId）。
// 提供默认全局注册表与 createRegistry（测试隔离用）。
import type { Source } from '@/types/entities'
import type { SourceParser } from './types'
import { szlibParser } from './szlib'

/** 注册表：按 parserId 查找与 validate 自动检测。 */
export interface ParserRegistry {
  register(parser: SourceParser): void
  unregister(parserId: string): void
  getParser(parserId: string): SourceParser
  matchParser(rawData: string | ArrayBuffer, sources?: Source[]): SourceParser | null
  size(): number
}

function createRegistryCore(): ParserRegistry {
  const byId = new Map<string, SourceParser>()

  function register(parser: SourceParser): void {
    byId.set(parser.id, parser)
  }
  function unregister(parserId: string): void {
    byId.delete(parserId)
  }
  function getParser(parserId: string): SourceParser {
    const p = byId.get(parserId)
    if (!p) throw new Error(`no parser registered for parserId="${parserId}"`)
    return p
  }
  function matchParser(rawData: string | ArrayBuffer, sources?: Source[]): SourceParser | null {
    const candidates = sources
      ? sources
          .map((s) => byId.get(s.parserId))
          .filter((p): p is SourceParser => p != null)
      : Array.from(byId.values())
    for (const p of candidates) {
      try {
        if (p.validate(rawData)) return p
      } catch {
        // validate 抛错视为不匹配，继续下一个。
      }
    }
    return null
  }
  function size(): number {
    return byId.size
  }
  return { register, unregister, getParser, matchParser, size }
}

/** 创建一个隔离注册表（测试用），与全局互不影响。 */
export function createRegistry(): ParserRegistry {
  return createRegistryCore()
}

/** 默认全局注册表，默认注册 szlibParser。 */
export const defaultRegistry: ParserRegistry = createRegistryCore()
defaultRegistry.register(szlibParser)

/** 便捷：在默认注册表查找。 */
export function getParser(parserId: string): SourceParser {
  return defaultRegistry.getParser(parserId)
}

/** 便捷：在默认注册表自动检测。 */
export function matchParser(rawData: string | ArrayBuffer, sources?: Source[]): SourceParser | null {
  return defaultRegistry.matchParser(rawData, sources)
}
