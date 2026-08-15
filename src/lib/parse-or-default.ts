// Q-6 zod 默认值读路径兜底（M1 classCodes 同类）：
// zod `.default()` 只覆盖写路径（Repository validate）；useLiveQuery 直读旧记录
// 缺新字段（如 parallelTitles）时渲染直接崩溃（undefined 上渲染）。本模块提供
// 读取侧 parseOrDefault：从 schema 提取各字段默认值构造缺省对象，与记录浅合并。
//
// 语义（与 zod 解析一致）：
// - 只补缺字段（缺失 / undefined 触发默认值），已有字段（含 null）不覆盖；
// - 不校验——旧/松散数据不会被拒绝；不剥离未知字段；
// - 不执行派生 transform（catalogRecordSchema 的 classCodes 由写路径/存量回填负责）；
// - 与 schema 默认值同源：schema 新增 default 字段无需在本模块双维护。
import type { z } from 'zod'

/** zod v4 schema def 的最小结构（提取默认值所需；仅访问稳定字段）。 */
interface ZodDefLike {
  type: string
  innerType?: ZodDefLike
  defaultValue?: unknown
  in?: ZodDefLike
  shape?: Record<string, ZodSchemaLike>
}

interface ZodSchemaLike {
  def: ZodDefLike
}

type ZodShape = Record<string, ZodSchemaLike>

/**
 * 解包 schema def 链（pipe 的 transform 输入侧 / default / nullable / optional）
 * 到 object shape；非对象 schema → null。
 */
function shapeOf(schema: unknown): ZodShape | null {
  let d = (schema as ZodSchemaLike | null | undefined)?.def ?? null
  for (let i = 0; i < 8 && d != null; i++) {
    if (d.type === 'object') return d.shape ?? null
    if (d.type === 'pipe') {
      d = d.in ?? null
      continue
    }
    d = d.innerType ?? null
  }
  return null
}

/** 字段 schema 的默认值（仅 ZodDefault 有）；无默认值 → { has: false }。 */
function defaultOf(def: ZodDefLike): { has: true; value: unknown } | { has: false } {
  if (def.type !== 'default') return { has: false }
  const v = def.defaultValue
  return { has: true, value: typeof v === 'function' ? (v as () => unknown)() : v }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalize(schema: unknown, value: unknown): unknown {
  if (!isPlainObject(value)) return value
  const shape = shapeOf(schema)
  if (shape == null) return value
  let changed = false
  const out: Record<string, unknown> = { ...value }
  for (const key of Object.keys(shape)) {
    if (out[key] === undefined) {
      const d = defaultOf(shape[key]!.def)
      if (d.has) {
        out[key] = d.value
        changed = true
      }
    } else if (isPlainObject(out[key])) {
      // 嵌套对象字段：递归补其自身缺省字段（已有键不动）。
      const nested = normalize(shape[key], out[key])
      if (nested !== out[key]) {
        out[key] = nested
        changed = true
      }
    }
  }
  return changed ? out : value
}

/**
 * 读路径归一：以 schema 默认值为基准补齐 value 缺失字段，返回浅拷贝；
 * 未缺失任何默认字段时返回原引用（无无谓分配）。
 */
export function parseOrDefault<T>(schema: z.ZodType<T>, value: unknown): T {
  return normalize(schema, value) as T
}
