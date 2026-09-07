// 调试开关（debug-mode spec §3.1）：构建期常量 __DEBUG_MODE__ 门控 + localStorage
// verbose 位（'readgraph:debug'）。verbose 是开发者本机快捷位，非持久偏好，
// 不并入 readgraph:preferences、不导出（spec §2 D3）。
// __DEBUG_MODE__ 由 vite/vitest define 构建期静态注入；本地 ambient 声明同
// ai-client.ts 的 __AI_DEV_PROXY__ 先例（含 import 的声明文件不再全局）。
declare const __DEBUG_MODE__: boolean

/** verbose 位 storage 键（debug-mode spec §3.1：'readgraph:debug'）。 */
export const VERBOSE_STORAGE_KEY = 'readgraph:debug'

/**
 * 调试模式总开关：构建期常量直读。dev 构建（pnpm dev）为 true；
 * build/preview/vitest 由 define 注入 false，debug 分支被 minifier 剔除（D3/D5）。
 */
export function isDebugMode(): boolean {
  return __DEBUG_MODE__
}

/**
 * verbose 细分度：debug 开启且 localStorage 'readgraph:debug' === 'verbose'。
 * 容错：localStorage 缺失（node 测试环境）或访问抛错（Safari 隐私模式）回退关，不抛。
 */
export function isDebugVerbose(): boolean {
  if (!__DEBUG_MODE__) return false
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(VERBOSE_STORAGE_KEY) === 'verbose'
  } catch {
    return false
  }
}

/** 写（verbose=true）/清（false）verbose 位。同样容错：静默失败不抛。 */
export function writeVerboseFlag(verbose: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (verbose) {
      localStorage.setItem(VERBOSE_STORAGE_KEY, 'verbose')
    } else {
      localStorage.removeItem(VERBOSE_STORAGE_KEY)
    }
  } catch {
    // storage 不可用/配额/隐私模式：非致命，静默。
  }
}
