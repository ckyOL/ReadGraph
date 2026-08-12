// 分类法层级解析 — 规格 §8 测试清单（classification-hierarchy）。
// 断言基于内联 fixture 树（模拟契约 JSON 产物：含 src/status/redirect 字段、交错挂载、
// 范围展开子级/保留容器、显式复分节点）；真实产物（45k+ 节点）由 数据侧/tools/validate.py 校验。
import { describe, it, expect } from 'vitest'

import { resolveClassificationPath, buildClassificationChildren } from './classification-path'
import type { ClcNode, OverlayData, AuxiliaryData } from './classification-path'

const tree: ClcNode[] = [
  {
    id: 'A',
    desc: '马克思主义、列宁主义、毛泽东思想、邓小平理论',
    src: 'p22',
    children: [
      {
        id: 'A1',
        desc: '马克思、恩格斯著作',
        src: 'p22',
        children: [
          { id: 'A11', desc: '选集、文集', src: 'p22', children: [{ id: 'A119', desc: '选读', src: 'p22' }] },
        ],
      },
    ],
  },
  {
    id: 'B',
    desc: '哲学、宗教',
    src: 'p23',
    children: [
      { id: 'B81', desc: '逻辑学', src: 'p28', children: [{ id: 'B81-09', desc: '逻辑学史', src: 'p28' }] },
      { id: 'B84', desc: '心理学', src: 'p28', children: [{ id: 'B849', desc: '应用心理学', src: 'p28' }] },
    ],
  },
  {
    id: 'D',
    desc: '政治、法律',
    children: [
      { id: 'D2', desc: '中国政治', children: [{ id: 'D221/227', desc: '各国政治', src: 'p50' }] },
      {
        id: 'D9',
        desc: '法律',
        children: [
          { id: 'D93', desc: '各国法律', children: [] },
          { id: 'D093/097', desc: '法律（地区表）', src: 'p52' },
        ],
      },
    ],
  },
  {
    id: 'G',
    desc: '文化、科学、教育、体育',
    children: [
      {
        id: 'G4',
        desc: '教育',
        children: [
          {
            id: 'G6',
            desc: '各级教育',
            children: [
              {
                id: 'G63',
                desc: '中等教育',
                children: [
                  {
                    id: 'G633',
                    desc: '各科教学法',
                    children: [
                      { id: 'G633.5', desc: '物理', children: [{ id: 'G633.52', desc: '物理学', src: 'p300' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { id: 'G8', desc: '体育', children: [{ id: 'G89', desc: '文体活动', children: [{ id: 'G898', desc: '游戏', children: [] }] }] },
    ],
  },
  {
    id: 'I',
    desc: '文学',
    children: [
      {
        id: 'I2',
        desc: '中国文学',
        children: [
          {
            id: 'I24',
            desc: '小说',
            children: [{ id: 'I247', desc: '当代作品（1949年~）', children: [{ id: 'I247.5', desc: '新体长篇、中篇小说' }] }],
          },
        ],
      },
    ],
  },
  {
    id: 'J',
    desc: '艺术',
    src: 'p120',
    children: [
      {
        id: 'J2',
        desc: '绘画',
        children: [
          {
            id: 'J21',
            desc: '绘画技法',
            children: [{ id: 'J218', desc: '各种画技法：按用途分', children: [{ id: 'J218.2', desc: '漫画', src: 'p55' }] }],
          },
          { id: 'J23', desc: '各国绘画作品', children: [{ id: 'J238', desc: '各种画：按用途分', children: [{ id: 'J238.2', desc: '漫画', src: 'p56' }] }] },
          { id: '[J59]', desc: '建筑艺术', src: 'p58', status: 'alternate', redirect: 'J5' },
          { id: 'J29', desc: '书法、篆刻', children: [{ id: 'J292', desc: '中国书法、篆刻' }] },
          { id: 'J6', desc: '音乐', children: [{ id: 'J62', desc: '器乐理论与演奏法', children: [{ id: 'J624', desc: '键盘、簧乐理论和演奏法' }] }] },
        ],
      },
    ],
  },
  {
    id: 'K',
    desc: '历史、地理',
    children: [
      { id: 'K0', desc: '史学理论', children: [{ id: 'K02', desc: '社会发展理论' }] },
      {
        id: 'K2',
        desc: '中国史',
        children: [
          { id: 'K24', desc: '明清史', children: [{ id: 'K248', desc: '明', children: [{ id: 'K248.1', desc: '洪武至宣德' }] }] },
          {
            id: 'K25',
            desc: '半殖民地半封建社会',
            children: [{ id: 'K251', desc: '旧民主主义革命时期' }, { id: 'K252', desc: '清后期' }],
          },
        ],
      },
      { id: 'K81', desc: '传记', children: [{ id: 'K833', desc: '亚洲人物传记', src: 'expansion:K833/837' }] },
    ],
  },
  {
    id: 'T',
    desc: '工业技术',
    children: [
      {
        id: 'TP',
        desc: '自动化技术、计算机技术',
        children: [
          {
            id: 'TP3',
            desc: '计算技术、计算机技术',
            children: [{ id: 'TP31', desc: '计算机软件', children: [{ id: 'TP312', desc: '程序语言、算法语言' }] }],
          },
        ],
      },
    ],
  },
]

const overlay: OverlayData = { I3: { name: '各国文学', source: 'fixture' } }

const auxiliary: AuxiliaryData = {
  '-39': '信息化建设、新技术的应用',
  '-49': '普及读物',
  '-64': '表解、图解、图册、谱录、数据、公式、地图',
}

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

  it('J238.2 → tree：纸本「仿J218分」注释有据（§11 修正 §2.4），路径 5 段含漫画', () => {
    const p = resolveClassificationPath('clc', 'J238.2', tree)
    expect(p.source).toBe('tree')
    expect(p.depth).toBe(5)
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J2', name: '绘画' },
      { code: 'J23', name: '各国绘画作品' },
      { code: 'J238', name: '各种画：按用途分' },
      { code: 'J238.2', name: '漫画' },
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

  it('J239.5 → tree-partial：止于 J23，unresolvedSuffix=9.5', () => {
    const p = resolveClassificationPath('clc', 'J239.5', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.depth).toBe(3)
    expect(p.unresolvedSuffix).toBe('9.5')
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J2', name: '绘画' },
      { code: 'J23', name: '各国绘画作品' },
    ])
  })
})

describe('交错/十进制挂载（§4.1：父指针回溯）', () => {
  it('K248 完整解析 4 段（十进制挂载：K › K2 › K24 › K248）', () => {
    const p = resolveClassificationPath('clc', 'K248', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K2', name: '中国史' },
      { code: 'K24', name: '明清史' },
      { code: 'K248', name: '明' },
    ])
  })

  it('K248.1 子层级可解析（K248 存在子级）', () => {
    const p = resolveClassificationPath('clc', 'K248.1', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K2', name: '中国史' },
      { code: 'K24', name: '明清史' },
      { code: 'K248', name: '明' },
      { code: 'K248.1', name: '洪武至宣德' },
    ])
  })

  it('K252（与 K251 平级挂 K25）抽样完整解析', () => {
    expect(SEG(resolveClassificationPath('clc', 'K252', tree))).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K2', name: '中国史' },
      { code: 'K25', name: '半殖民地半封建社会' },
      { code: 'K252', name: '清后期' },
    ])
  })

  it('G633.52（十进制挂载：G › G4 › G6 › G63 › G633 › G633.5 › G633.52）', () => {
    expect(SEG(resolveClassificationPath('clc', 'G633.52', tree))).toEqual([
      { code: 'G', name: '文化、科学、教育、体育' },
      { code: 'G4', name: '教育' },
      { code: 'G6', name: '各级教育' },
      { code: 'G63', name: '中等教育' },
      { code: 'G633', name: '各科教学法' },
      { code: 'G633.5', name: '物理' },
      { code: 'G633.52', name: '物理学' },
    ])
  })
})

describe('范围类目（§4.1：区间归属 / 平级展开子级）', () => {
  it('K833/837 输入 → 归属容器层级 K › K81 传记', () => {
    const p = resolveClassificationPath('clc', 'K833/837', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K81', name: '传记' },
    ])
  })

  it('K833.135.72 → tree-partial 止于 K833 亚洲人物传记 + .135.72', () => {
    const p = resolveClassificationPath('clc', 'K833.135.72', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.135.72')
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K81', name: '传记' },
      { code: 'K833', name: '亚洲人物传记' },
    ])
  })

  it('K833.135.72=6 → 时代区分号剥离后同 K833.135.72（§10.2）', () => {
    const withEra = resolveClassificationPath('clc', 'K833.135.72=6', tree)
    const plain = resolveClassificationPath('clc', 'K833.135.72', tree)
    expect(withEra).toEqual(plain)
  })

  it('D221.5 → 未展开容器 D221/227 区间兜底 + .5', () => {
    const p = resolveClassificationPath('clc', 'D221.5', tree)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.5')
    expect(SEG(p)).toEqual([
      { code: 'D', name: '政治、法律' },
      { code: 'D2', name: '中国政治' },
      { code: 'D221/227', name: '各国政治' },
    ])
  })

  it('位宽边界 D93.5 不误入 D093/097', () => {
    const p = resolveClassificationPath('clc', 'D93.5', tree)
    expect(p.source).toBe('tree-partial')
    expect(SEG(p)).toEqual([
      { code: 'D', name: '政治、法律' },
      { code: 'D9', name: '法律' },
      { code: 'D93', name: '各国法律' },
    ])
    expect(p.unresolvedSuffix).toBe('.5')
  })

  it('索书号斜杠 I247.5/123 → 剥斜杠取完整解（不误判为范围 id）', () => {
    const p = resolveClassificationPath('clc', 'I247.5/123', tree)
    expect(p.source).toBe('tree')
    expect(p.depth).toBe(5)
    expect(SEG(p)).toEqual([
      { code: 'I', name: '文学' },
      { code: 'I2', name: '中国文学' },
      { code: 'I24', name: '小说' },
      { code: 'I247', name: '当代作品（1949年~）' },
      { code: 'I247.5', name: '新体长篇、中篇小说' },
    ])
  })
})

describe('交替类目', () => {
  it('[J59] 匹配与展示去括号', () => {
    const p = resolveClassificationPath('clc', 'J59', tree)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'J', name: '艺术' },
      { code: 'J2', name: '绘画' },
      { code: 'J59', name: '建筑艺术' },
    ])
  })
})

describe('入参归一（§4.2）', () => {
  it('小写 j238.2 归一后完整解析', () => {
    expect(resolveClassificationPath('clc', 'j238.2', tree)).toEqual(resolveClassificationPath('clc', 'J238.2', tree))
  })

  it('括号复分 J238.2(312.6) 剥离后完整解析', () => {
    const p = resolveClassificationPath('clc', 'J238.2(312.6)', tree)
    expect(p.source).toBe('tree')
    expect(p.depth).toBe(5)
  })
})

describe('降级链（§4.3）', () => {
  it('overlay > tree：I3 命中 overlay，树补足其余段', () => {
    const p = resolveClassificationPath('clc', 'I3', tree, overlay)
    expect(p.source).toBe('overlay')
    expect(SEG(p)).toEqual([
      { code: 'I', name: '文学' },
      { code: 'I3', name: '各国文学' },
    ])
  })

  it('未知 code QZ9 → none、path 空', () => {
    const p = resolveClassificationPath('clc', 'QZ9', tree)
    expect(p.source).toBe('none')
    expect(p.path).toEqual([])
  })

  it('树空（未提供数据）→ first-level 兜底', () => {
    const p = resolveClassificationPath('clc', 'B84', [])
    expect(p.source).toBe('first-level')
    expect(SEG(p)).toEqual([{ code: 'B', name: '哲学、宗教' }])
  })

  it('树空 + 未知首字母 → none', () => {
    expect(resolveClassificationPath('clc', 'QZ9', []).source).toBe('none')
  })
})

describe('复分号（总论复分表，§10）', () => {
  it('K02-39 → tree 主类 + auxiliary {-39, 信息化建设、新技术的应用}', () => {
    const p = resolveClassificationPath('clc', 'K02-39', tree, overlay, auxiliary)
    expect(p.source).toBe('tree')
    expect(p.unresolvedSuffix).toBeUndefined()
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K0', name: '史学理论' },
      { code: 'K02', name: '社会发展理论' },
    ])
    expect(p.auxiliary).toEqual({ code: '-39', name: '信息化建设、新技术的应用' })
  })

  it('B84-49 → tree 主类 + {-49, 普及读物}', () => {
    const p = resolveClassificationPath('clc', 'B84-49', tree, overlay, auxiliary)
    expect(p.source).toBe('tree')
    expect(SEG(p)).toEqual([
      { code: 'B', name: '哲学、宗教' },
      { code: 'B84', name: '心理学' },
    ])
    expect(p.auxiliary).toEqual({ code: '-49', name: '普及读物' })
  })

  it('树内显式复分节点 B81-09 → 完整命中，auxiliary 缺省（不重复）', () => {
    const p = resolveClassificationPath('clc', 'B81-09', tree, overlay, auxiliary)
    expect(p.source).toBe('tree')
    expect(p.auxiliary).toBeUndefined()
    expect(SEG(p)).toEqual([
      { code: 'B', name: '哲学、宗教' },
      { code: 'B81', name: '逻辑学' },
      { code: 'B81-09', name: '逻辑学史' },
    ])
  })

  it('表外复分号 K02-99 → 主类 tree-partial + unresolvedSuffix=-99，无 auxiliary（不造名）', () => {
    // 实现语义：主类 tree 但存在未解析后缀 → source 降为 tree-partial（§3.3
    // 「unresolvedSuffix 仅属 tree-partial」契约）；规格 §10.5 示例记 tree，以实现为准。
    const p = resolveClassificationPath('clc', 'K02-99', tree, overlay, auxiliary)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('-99')
    expect(p.auxiliary).toBeUndefined()
    expect(SEG(p)).toEqual([
      { code: 'K', name: '历史、地理' },
      { code: 'K0', name: '史学理论' },
      { code: 'K02', name: '社会发展理论' },
    ])
  })

  it('G898.3-64 → 主类 tree-partial 止于 G898 + {-64}', () => {
    const p = resolveClassificationPath('clc', 'G898.3-64', tree, overlay, auxiliary)
    expect(p.source).toBe('tree-partial')
    expect(p.unresolvedSuffix).toBe('.3')
    expect(SEG(p)).toEqual([
      { code: 'G', name: '文化、科学、教育、体育' },
      { code: 'G8', name: '体育' },
      { code: 'G89', name: '文体活动' },
      { code: 'G898', name: '游戏' },
    ])
    expect(p.auxiliary).toEqual({ code: '-64', name: '表解、图解、图册、谱录、数据、公式、地图' })
  })

  it('一级兜底：树空时 B84-49 → first-level', () => {
    const p = resolveClassificationPath('clc', 'B84-49', [], overlay, auxiliary)
    expect(p.source).toBe('first-level')
    expect(SEG(p)).toEqual([{ code: 'B', name: '哲学、宗教' }])
  })
})

describe('buildClassificationChildren（treemap 下钻数据派生）', () => {
  it('下钻 K2：子段 K24/K25 分组计数，无法解析的跳过', () => {
    const children = buildClassificationChildren('K2', ['K248.1', 'K248', 'K252', 'QZ9'], tree, overlay, auxiliary)
    expect(children).toEqual([
      { code: 'K24', name: '明清史', value: 2 },
      { code: 'K25', name: '半殖民地半封建社会', value: 1 },
    ])
  })

  it('下钻叶节点（无子段）→ 空数组', () => {
    expect(buildClassificationChildren('K02', ['K02'], tree, overlay, auxiliary)).toEqual([])
  })

  it('下钻 K02 时复分号作为其子段聚合（§10.5）', () => {
    expect(buildClassificationChildren('K02', ['K02-39', 'K02-49'], tree, overlay, auxiliary)).toEqual([
      { code: '-39', name: '信息化建设、新技术的应用', value: 1 },
      { code: '-49', name: '普及读物', value: 1 },
    ])
  })
})
