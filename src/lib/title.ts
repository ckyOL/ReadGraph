// 书目标题结构化解析（§10.13、szlib-parser §2.A）。
// 纯函数、无外部依赖；不调用 normalize。

/** szlib-parser §5 占位书名清单（当前唯一占位）。 */
const PLACEHOLDER_TITLES = new Set<string>(['福田图书馆读者自选图书'])

/** parseTitle 输出形状。 */
export interface ParsedTitle {
  /**
   * 正题名（去并列/责任；占位书名时原样）。
   * 深图流通数据中 ` : ` 既可能是丛书:分册（合成城市笔记 : 地名故事），
   * 也可能是正题名:副题名（合成欲望社会 : "丧失大志时代"的新·国富论），
   * 语法上无法可靠区分，故不再切分，` : ` 段并入正题名（§10.13）。
   */
  title: string
  /** ` = ` 右侧各段；空数组 */
  parallelTitles: string[]
  /** 著/编/主编/绘 命中或无角色词默认；不含 normalize */
  authors: string[]
  /** 译/校/校译 命中 */
  translators: string[]
  /** 占位书名短路标记 */
  isPlaceholder: boolean
}

/** 责任者角色词 → 所属字段。按更长优先匹配以防「主编」误判为「编」。 */
const ROLE_AUTHORS = new Set(['主编', '编著', '著', '编', '绘'])
const ROLE_TRANSLATORS = new Set(['校译', '译', '校'])
// 全部候选，逐人末尾匹配（按长度降序避免「编」吃掉「主编」）。
const ALL_ROLES = Array.from(new Set([...ROLE_AUTHORS, ...ROLE_TRANSLATORS])).sort(
  (a, b) => b.length - a.length,
)

/** 去国别前缀 `(一两个字)` 紧贴姓名开头时去。 */
function stripNationality(person: string): string {
  return person.replace(/^\([^\u0000-\u007f]{1,2}\)/, '')
}

/** 返回去掉末尾角色词后的姓名与命中字段。 */
function splitRole(
  person: string,
): { name: string; field: 'authors' | 'translators' | null } {
  const trimmed = person.trim()
  for (const role of ALL_ROLES) {
    if (trimmed.endsWith(role)) {
      const name = trimmed.slice(0, trimmed.length - role.length).trim()
      const field: 'authors' | 'translators' | null = ROLE_AUTHORS.has(role)
        ? 'authors'
        : ROLE_TRANSLATORS.has(role)
          ? 'translators'
          : null
      return { name: stripNationality(name), field }
    }
  }
  return { name: stripNationality(trimmed), field: null }
}

/** 以 `，/,/，` 拆同一责任声明组内的多人。 */
export function splitPersons(group: string): string[] {
  return group
    .split(/[，/,/，]/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/**
 * 按 §10.13 把原始编目 title 串解析为结构化字段。
 * 占位书名（选书帮等）与空串短路返回 isPlaceholder=true。
 */
export function parseTitle(rawTitle: string): ParsedTitle {
  const placeholder: ParsedTitle = {
    title: rawTitle,
    parallelTitles: [],
    authors: [],
    translators: [],
    isPlaceholder: rawTitle === '' || PLACEHOLDER_TITLES.has(rawTitle),
  }
  if (placeholder.isPlaceholder) return placeholder

  // 1. 切责任区：首个 `/` 为硬分隔。
  const slashIdx = rawTitle.indexOf('/')
  const titleZone = slashIdx === -1 ? rawTitle : rawTitle.slice(0, slashIdx).trim()
  const respZone = slashIdx === -1 ? '' : rawTitle.slice(slashIdx + 1).trim()

  // 2. 题名区拆 ` = ` → 正题名段 + 并列题名各段。
  const titleParts = titleZone.split(' = ')
  const mainPart = titleParts[0] ?? ''
  const parallelTitles = titleParts.slice(1)

  // 3. 正题名段整体保留（不再按 ` : ` 切分副题名，见接口注释）：
  //    丛书分册（合成城市笔记 : 地名故事）与正题名副题名（合成欲望社会 : …）同构不可辨，
  //    切分会让书库列表里系列各册同名；` : ` 段并入 title 保证列表可区分。
  const title = mainPart.trim()

  // 4. 责任区以 `;` 切责任声明组；每组建/译归属。
  const authors: string[] = []
  const translators: string[] = []
  let defaultAssigned = false
  if (respZone !== '') {
    const groups = respZone.split(';')
    for (const g of groups) {
      const persons = splitPersons(g)
      for (const p of persons) {
        const { name, field } = splitRole(p)
        if (name === '') continue
        if (field === 'authors') {
          authors.push(name)
        } else if (field === 'translators') {
          translators.push(name)
        } else if (!defaultAssigned) {
          // 无角色词的第一组默认归 authors。
          authors.push(name)
          defaultAssigned = true
        } else {
          // 后续无角色词的个人仍默认归 authors（保持出现顺序）。
          authors.push(name)
        }
      }
    }
  }

  return { title, parallelTitles, authors, translators, isPlaceholder: false }
}
