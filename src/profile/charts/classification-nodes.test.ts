// 分类 treemap 数据选择/下钻判定纯逻辑测试（键盘等价路径）。
// 列表视图与 canvas option 同源：selectClassificationNodes 保证两视图层级数据一致。
import { describe, it, expect } from 'vitest'

import {
  selectClassificationNodes,
  canDrillClassification,
} from './classification-nodes'

const topNodes = [
  { name: '文学', code: 'I', value: 2 },
  { name: '哲学、宗教', code: 'B', value: 1 },
]
const children = [
  { name: '文学理论', code: 'I0', value: 1 },
  { name: '世界文学', code: 'I1', value: 1 },
]
const drill = { code: 'I', name: '文学', value: 2 }

describe('selectClassificationNodes', () => {
  it('根态返回一级 topNodes', () => {
    expect(
      selectClassificationNodes({ drill: null, drillChildren: null, topNodes }),
    ).toEqual(topNodes)
  })

  it('下钻态返回 drillChildren', () => {
    expect(
      selectClassificationNodes({ drill, drillChildren: children, topNodes }),
    ).toEqual(children)
  })

  it('叶子/无子级（空数组）回退为下钻节点自身', () => {
    expect(
      selectClassificationNodes({ drill, drillChildren: [], topNodes }),
    ).toEqual([drill])
  })

  it('子级加载中（null）回退为下钻节点自身，不空白', () => {
    expect(
      selectClassificationNodes({ drill, drillChildren: null, topNodes }),
    ).toEqual([drill])
  })
})

describe('canDrillClassification', () => {
  it('clc + 树已加载 + 字母开头 → 可下钻', () => {
    expect(canDrillClassification('I', { system: 'clc', treeLoaded: true })).toBe(
      true,
    )
  })

  it('未分类聚合项不可下钻', () => {
    expect(
      canDrillClassification('__unclassified__', { system: 'clc', treeLoaded: true }),
    ).toBe(false)
  })

  it('非 clc 体系不可下钻', () => {
    expect(canDrillClassification('I', { system: 'ddc', treeLoaded: true })).toBe(
      false,
    )
  })

  it('分类树未加载不可下钻', () => {
    expect(canDrillClassification('I', { system: 'clc', treeLoaded: false })).toBe(
      false,
    )
  })

  it('非字母开头 code 不可下钻', () => {
    expect(canDrillClassification('123', { system: 'clc', treeLoaded: true })).toBe(
      false,
    )
  })
})
