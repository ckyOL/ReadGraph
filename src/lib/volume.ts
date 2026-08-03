// 卷号解析（review 规格 §7）。纯函数、无外部依赖。
// 只匹配题名**末尾**卷号段（由后往前）：`. N` / `(N)` / `〔N〕` / `【N】`
// （N 为阿拉伯或 CJK 数字）、「N卷/册/集/部」同族、汉字卷标 `上/中/下/前/后`
// 与 `上册/中册/下册`。非尾部数字不提取（`1984` 不作卷号）；解析失败 → null
// （人工填写）。卷号值为数字/CJK 数字/汉字卷标本身（如 `"3"`/`"上"`）。

/** 阿拉伯（含全角）或 CJK 数字。 */
const NUM = '[0-9０-９]+|[〇一二三四五六七八九十]+'
const NUM_RE = new RegExp(`^${NUM}$`)

/** 末尾卷号段候选（按特异性降序：括号族 → 点号 → 单位 → 汉字卷标）。
 * numeralOnly：括号族内容为自由字符，须另行校验纯数字；其余模式捕获即约束。 */
const SUFFIX_PATTERNS: Array<{
  re: RegExp
  volume: (m: RegExpExecArray) => string
  numeralOnly?: boolean
}> = [
  { re: /〔\s*([^〕]+?)\s*〕$/, volume: (m) => m[1]!, numeralOnly: true },
  { re: /【\s*([^】]+?)\s*】$/, volume: (m) => m[1]!, numeralOnly: true },
  { re: /（\s*([^）]+?)\s*）$/, volume: (m) => m[1]!, numeralOnly: true },
  { re: /\(\s*([^)]+?)\s*\)$/, volume: (m) => m[1]!, numeralOnly: true },
  { re: new RegExp(`[.．]\\s*(${NUM})$`), volume: (m) => m[1]! },
  { re: new RegExp(`第?(${NUM})[卷册集部]$`), volume: (m) => m[1]! },
  { re: new RegExp(`[卷册集部](${NUM})$`), volume: (m) => m[1]! },
  { re: /(上|中|下)册$/, volume: (m) => m[1]! },
  { re: /(上|中|下|前|后)$/, volume: (m) => m[1]! },
]

interface VolumeMatch {
  volume: string
  /** 命中的末尾段原文（含分隔符），供去尾。 */
  suffix: string
}

function matchVolumeSuffix(title: string): VolumeMatch | null {
  const trimmed = title.trim()
  for (const { re, volume, numeralOnly } of SUFFIX_PATTERNS) {
    const m = re.exec(trimmed)
    if (!m) continue
    const v = volume(m)
    // 括号族内容必须是纯数字（阿拉伯或 CJK）：「（上）」「（第一部）」非卷号段。
    if (numeralOnly && !NUM_RE.test(v.trim())) continue
    return { volume: v.trim(), suffix: m[0] }
  }
  return null
}

/** 从题名末尾提取卷号；无匹配 → null（由用户在 /review 人工填写）。 */
export function parseVolumeFromTitle(title: string): string | null {
  return matchVolumeSuffix(title)?.volume ?? null
}

/**
 * 去掉题名末尾卷号段（套装表单 Book.title 公共前缀建议）。
 * 无卷号段时原样返回（trim 后）。
 */
export function stripVolumeSuffix(title: string): string {
  const trimmed = title.trim()
  const m = matchVolumeSuffix(trimmed)
  if (!m) return trimmed
  return trimmed.slice(0, trimmed.length - m.suffix.length).trim()
}
