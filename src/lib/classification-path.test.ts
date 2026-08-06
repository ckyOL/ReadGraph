// 分类法层级解析 — 规格 §8 测试清单（classification-hierarchy）。
// 断言全部基于真实数据产物 src/data/classification/clc-tree.json（45,785 节点）。
import { describe, it, expect, beforeAll } from 'vitest'

import { resolveClassificationPath, buildClassificationChildren } from './classification-path'
import type { ClcNode, OverlayData } from './classification-path'

let tree: ClcNode[]
beforeAll(async () => {
  tree = (await import('@/data/classification/clc-tree.json')).default as unknown as ClcNode[]
})

const SEG = (p: { path: { code: string; name: string }[] }) => p.path

describe('静态树命中（tree / tree-partial）', () => {
  it('J218.2 完整解析到叶（漫画）', () => {
    const p = resolveClassificationPath('clc', 'J218.2', tree)
    expect(p.source).toBe('tree')
    expect(p.depth).toBe(5)
    expect(p.unresolvedSuffix).toBeUndefined()
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J2', name: '绘画' },
      { code: 'J21', name: '绘画技法' },
      { code: 'J218', name: '各种画技法：按用途分' },
      { code: 'J218.2', name: '漫画' },
    ])
  })

  it('TP312 / I247.5 / A119 逐段命中', () => {
    expect(SEG(resolveClassificationPath('clc', 'TP312', tree))).toEqual([
      { code: 'T', name: '工业技术' },
      { code: 'TP', name: '自动化技术、计算机技术' },
      { code: 'TP3', name: '计算技术、计算机技术' },
      { code: 'TP31', name: '计算机软件' },
      { code: 'TP312', name: '程序语言、算法语言' },
    ])
    expect(SEG(resolveClassificationPath('clc', 'I247.5', tree))).toEqual([
      { code: 'I', name: '文学' },
      { code: 'I2', name: '中国文学' },
      { code: 'I24', name: '小说' },
      { code: 'I247', name: '当代作品（1949年~）' },
      { code: 'I247.5', name: '新体长篇、中篇小说' },
    ])
    expect(SEG(resolveClassificationPath('clc', 'A119', tree))).toEqual([
      { code: 'A', name: '马克思主义、列宁主义、毛泽东思想、邓小平理论' },
      { code: 'A1', name: '马克思、恩格斯著作' },
      { code: 'A11', name: '选集、文集' },
      { code: 'A119', name: '选读' },
    ])
  })

  it('J238.2 → tree-partial：4 段止于 J238，unresolvedSuffix=.2，不产生「漫画」类名', () => {
    const p = resolveClassificationPath('clc', 'J238.2', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.depth).toBe(4)
    expect(p.unresolvedSuffix).toBe('.2')
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J2', name: '绘画' },
      { code: 'J23', name: '各国绘画作品' },
      { code: 'J238', name: '各种画：按用途分' },
    ])
    expect(p.path.some((s) => s.name.includes('漫画'))).toBe(false)
  })
})

describe('交错结构（§4.1：前缀候选匹配 + 父指针回溯）', () => {
  it('K248 完整解析 5 段（逐层下钻会错误断在 K2）', () => {
    const p = resolveClassificationPath('clc', 'K248', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K2', name: '中国史' },
      { code: 'K23', name: '封建社会（公元前475~公元1840年）' },
      { code: 'K24', name: '隋、唐至清前期（581~1840年）' },
      { code: 'K248', name: '明（1368~1663年）' },
    ])
  })

  it('K248.1 子层级可解析（K248 存在子级）', () => {
    const p = resolveClassificationPath('clc', 'K248.1', tree)
    expect(p.source).toBe('tree')
    expect(p.path.map((s) => s.code)).toEqual([
      'K', 'K2', 'K23', 'K24', 'K248', 'K248.1',
    ])
    expect(p.path.at(-1)).toEqual({
      code: 'K248.1',
      name: '洪武至宣德（1368~1435年）',
    })
  })

  it('K252（挂 K251 下）抽样完整解析', () => {
    const p = resolveClassificationPath('clc', 'K252', tree)
    expect(p.source).toBe('tree')
    expect(p.path.map((s) => s.code)).toEqual(['K', 'K2', 'K25', 'K251', 'K252'])
    expect(p.path.at(-1)?.name).toBe('清后期（1840~1911年）')
  })

  it('G633.52（挂 G633.51 下）抽样完整解析', () => {
    const p = resolveClassificationPath('clc', 'G633.52', tree)
    expect(p.source).toBe('tree')
    expect(p.path.map((s) => s.code)).toEqual([
      'G', 'G4', 'G63', 'G633', 'G633.5', 'G633.51', 'G633.52',
    ])
    expect(p.path.at(-1)?.name).toBe('世界历史')
  })

  it('Q969.431.2 深层交错（正确前缀 Q969.431 不存在，全码命中走真实父链）', () => {
    const p = resolveClassificationPath('clc', 'Q969.431.2', tree)
    expect(p.source).toBe('tree')
    expect(p.path.map((s) => s.code)).toEqual([
      'Q', 'Q96', 'Q969', 'Q969.2', 'Q969.42', 'Q969.42+3', 'Q969.431.1', 'Q969.431.2',
    ])
    expect(p.path.at(-1)?.name).toBe('刺蛾科')
  })
})

describe('clc-overlay 产物锁定（O-2，§7.2）', () => {
  it('overlay 空表起步；新增条目必须同步在本文件补解析行为测试锁定，避免无来源回退', async () => {
    const overlay = (await import('@/data/classification/clc-overlay.json')).default
    expect(overlay).toEqual({})
  })
})

describe('buildClassificationChildren（treemap 下钻数据派生）', () => {
  it('按下钻节点的直接子段分组计数', () => {
    const codes = ['J218.2', 'J238.2', 'J292', 'J624']
    expect(buildClassificationChildren('J', codes, tree)).toEqual([
      { code: 'J2', name: '绘画', value: 2 },
      { code: 'J29', name: '书法、篆刻', value: 1 },
      { code: 'J6', name: '音乐', value: 1 },
    ])
  })

  it('路径止于下钻节点的条目跳过（J238.2 下钻 J238 无子段）', () => {
    expect(buildClassificationChildren('J238', ['J238.2', 'J218.2'], tree)).toEqual([])
  })

  it('交错结构下钻（K248 系在 K24 下；K25 属 K2 不计入）', () => {
    expect(buildClassificationChildren('K24', ['K248', 'K248.1', 'K25'], tree)).toEqual([
      { code: 'K248', name: '明（1368~1663年）', value: 2 },
    ])
  })

  it('overlay 修正后生成真实子段（J238.2 → J238 下钻可见 overlay 段）', () => {
    const overlay: OverlayData = {
      'J238.2': { name: '漫画（编目展开）', source: 'test' },
    }
    expect(buildClassificationChildren('J238', ['J238.2'], tree, overlay)).toEqual([
      { code: 'J238.2', name: '漫画（编目展开）', value: 1 },
    ])
    // 无 overlay 时 J238.2 为 tree-partial（止于 J238）→ 无子段。
    expect(buildClassificationChildren('J238', ['J238.2'], tree)).toEqual([])
  })

  it('空输入 / 与下钻节点无关的 code → 空结果', () => {
    expect(buildClassificationChildren('J', [], tree)).toEqual([])
    expect(buildClassificationChildren('K24', ['J218.2'], tree)).toEqual([])
  })
})

describe('交替类目', () => {
  it('[J59] 去括号匹配与展示', () => {
    const p = resolveClassificationPath('clc', 'J59', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J59', name: '建筑艺术' },
    ])
  })
})

describe('入参归一（§4.2）', () => {
  it('括号复分剥离后解析', () => {
    const p = resolveClassificationPath('clc', 'J238.2(312.6)', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.2')
  })

  it('斜杠后缀兜底剥离', () => {
    const p = resolveClassificationPath('clc', 'J238.2/01', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.2')
  })

  it('范围类目斜杠号解析到容器层级（K833/837 → K81 传记）', () => {
    const p = resolveClassificationPath('clc', 'K833/837', tree)
    expect(p.source).toBe('tree')
    expect(p.depth).toBe(2)
    expect(p.unresolvedSuffix).toBeUndefined()
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K81', name: '传记' },
    ])
  })

  it('范围平级展开子节点命中（K834 非洲人物传记，无容器层）', () => {
    expect(SEG(resolveClassificationPath('clc', 'K834', tree))).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K81', name: '传记' },
      { code: 'K834', name: '非洲人物传记' },
    ])
  })

  it('范围展开号落到洲类目（K833.135.72 → K833 亚洲人物传记）', () => {
    const p = resolveClassificationPath('clc', 'K833.135.72', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.135.72')
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K81', name: '传记' },
      { code: 'K833', name: '亚洲人物传记' },
    ])
  })

  it('范围展开深层国家类目（F131.3 日本经济、D731.3 日本政治）', () => {
    expect(SEG(resolveClassificationPath('clc', 'F131.3', tree))).toEqual([
      { code: 'F', name: '经济' },
      { code: 'F1', name: '世界各国经济概况、经济史、经济地理' },
      { code: 'F13', name: '亚洲经济' },
      { code: 'F131.3', name: '日本经济' },
    ])
    expect(SEG(resolveClassificationPath('clc', 'D731.3', tree))).toEqual([
      { code: 'D', name: '政治、法律' },
      { code: 'D73', name: '亚洲各国政治' },
      { code: 'D731.3', name: '日本政治' },
    ])
  })

  it('范围区间承接未展开范围类目（D221.5 → D221/227；C829.35 → C829.3/.7）', () => {
    expect(SEG(resolveClassificationPath('clc', 'D221.5', tree)).at(-1)).toEqual({
      code: 'D221/227',
      name: '地方组织、会议及其文献',
    })
    expect(SEG(resolveClassificationPath('clc', 'C829.35', tree)).at(-1)).toEqual({
      code: 'C829.3/.7',
      name: '各国',
    })
    // 已展开的范围类目：展开子节点优先（D93.5 → D93 亚洲各国法律，而非 D93/97）。
    expect(SEG(resolveClassificationPath('clc', 'D93.5', tree)).at(-1)).toEqual({
      code: 'D93',
      name: '亚洲各国法律',
    })
    // 区间外：D9.2 不属 D93/97（92 < 93）。
    expect(SEG(resolveClassificationPath('clc', 'D9.2', tree)).at(-1)?.code).not.toBe('D93/97')
    // 位宽边界：D93.5 属 D93/97 法律，不属 D093/097 政治思想史（093 ≠ 93）。
    expect(SEG(resolveClassificationPath('clc', 'D93.5', tree)).at(-1)?.code).not.toBe('D093/097')
  })

  it('范围类目斜杠号解析到容器层级（F13/17 → F1），不被剥斜杠浅解抢占', () => {
    const p = resolveClassificationPath('clc', 'F13/17', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'F', name: '经济' },
      { code: 'F1', name: '世界各国经济概况、经济史、经济地理' },
    ])
  })

  it('索书号斜杠后缀取剥斜杠完整解（I247.5/123 → I247.5）', () => {
    const p = resolveClassificationPath('clc', 'I247.5/123', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p).at(-1)).toEqual({ code: 'I247.5', name: '新体长篇、中篇小说' })
  })

  it('范围区间边界与点号右端（D93.5 与 C829.35 归属范围类目）', () => {
    expect(SEG(resolveClassificationPath('clc', 'D93.5', tree)).at(-1)).toEqual({
      code: 'D93',
      name: '亚洲各国法律',
    })
    expect(SEG(resolveClassificationPath('clc', 'C829.35', tree)).at(-1)).toEqual({
      code: 'C829.3/.7',
      name: '各国',
    })
    // 区间外：D9 命中但 D93/97 不承接 D9.2（92 < 93）。
    const out = resolveClassificationPath('clc', 'D9.2', tree)
    expect(SEG(out).at(-1)?.code).not.toBe('D93/97')
  })

  it('小写归一', () => {
    const p = resolveClassificationPath('clc', 'j238.2', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.2')
    expect(SEG(resolveClassificationPath('clc', 'tp312', tree)).at(-1)).toEqual({
      code: 'TP312',
      name: '程序语言、算法语言',
    })
  })
})

describe('降级链（§4.3）', () => {
  const overlay: OverlayData = {
    'J238.2': { name: '漫画（编目展开）', source: 'test' },
    I37: { name: '日本文学', source: 'test' },
  }

  it('overlay 优先于静态树（同名节点替换类名）', () => {
    const p = resolveClassificationPath('clc', 'J238.2', tree, overlay)
    expect(p.source).toBe('overlay')
    expect(p.unresolvedSuffix).toBeUndefined()
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J2', name: '绘画' },
      { code: 'J23', name: '各国绘画作品' },
      { code: 'J238', name: '各种画：按用途分' },
      { code: 'J238.2', name: '漫画（编目展开）' },
    ])
  })

  it('overlay 补全树缺失节点（I37 缺录）并拼接树祖先链', () => {
    const p = resolveClassificationPath('clc', 'I37', tree, overlay)
    expect(p.source).toBe('overlay')
    expect(SEG(p)).toEqual([
      { code: 'I', name: '文学' },
      { code: 'I3', name: '亚洲文学' },
      { code: 'I37', name: '日本文学' },
    ])
  })

  it('树缺失（空表/加载前）→ 一级表兜底', () => {
    const p = resolveClassificationPath('clc', 'J238.2', [])
    expect(p.source).toBe('first-level')
    expect(p.depth).toBe(1)
    expect(SEG(p)).toEqual([{ code: 'J', name: '艺术' }])

    const d = resolveClassificationPath('ddc', '005.1', [])
    expect(d.source).toBe('first-level')
    expect(SEG(d)).toEqual([
      { code: '0', name: 'Computer science, information & general works' },
    ])
  })

  it('lcc/udc/other 无内置表 → none + 空路径', () => {
    for (const [system, code] of [
      ['lcc', 'QA76'],
      ['udc', '004'],
      ['other', 'X'],
    ] as const) {
      const p = resolveClassificationPath(system, code, tree)
      expect(p.source).toBe('none')
      expect(p.path).toEqual([])
      expect(p.depth).toBe(0)
    }
  })

  it('未知/非法 code → none + 空路径', () => {
    // 字母嵌码（Q 后跟 Z）非法，不做树/一级匹配。
    expect(resolveClassificationPath('clc', 'QZ9', tree).source).toBe('none')
    expect(resolveClassificationPath('clc', 'QZ9', tree).path).toEqual([])
    // L/M/W/Y 非中图法一级类。
    expect(resolveClassificationPath('clc', 'L1', tree).source).toBe('none')
    // 空 code。
    expect(resolveClassificationPath('clc', '', tree).source).toBe('none')
    expect(resolveClassificationPath('clc', '  ', tree).source).toBe('none')
  })
})
