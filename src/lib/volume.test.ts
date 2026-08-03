// review 规格 §7：卷号解析纯函数单测。
import { describe, it, expect } from 'vitest'

import { parseVolumeFromTitle, stripVolumeSuffix } from './volume'

describe('parseVolumeFromTitle — 末尾卷号段', () => {
  it('. N（阿拉伯数字）', () => {
    expect(parseVolumeFromTitle('合成书目052 : 合成副题 52 . 3')).toBe('3')
    expect(parseVolumeFromTitle('合成书目053 : 合成副题 53 . 4')).toBe('4')
    expect(parseVolumeFromTitle('大秦帝国 . 2')).toBe('2')
  })

  it('. N（全角点号与 CJK 数字）', () => {
    expect(parseVolumeFromTitle('史记．二')).toBe('二')
    expect(parseVolumeFromTitle('史记 . 三')).toBe('三')
  })

  it('(N) / 〔N〕 / 【N】括号族', () => {
    expect(parseVolumeFromTitle('三国演义（三）')).toBe('三')
    expect(parseVolumeFromTitle('射雕英雄传〔二〕')).toBe('二')
    expect(parseVolumeFromTitle('哈利波特【7】')).toBe('7')
    expect(parseVolumeFromTitle('三体（2）')).toBe('2')
  })

  it('N卷/册/集/部 同族（含 CJK 数字）', () => {
    expect(parseVolumeFromTitle('魔戒第二部')).toBe('二')
    expect(parseVolumeFromTitle('平凡的世界 第3部')).toBe('3')
    expect(parseVolumeFromTitle('资治通鉴卷三')).toBe('三')
    expect(parseVolumeFromTitle('全集2册')).toBe('2')
  })

  it('汉字卷标：上/中/下/前/后 与 上册/中册/下册', () => {
    expect(parseVolumeFromTitle('红楼梦 上')).toBe('上')
    expect(parseVolumeFromTitle('大秦帝国. 下')).toBe('下')
    expect(parseVolumeFromTitle('平凡的世界（上）')).toBeNull() // 括号内非数字不算（人工填写）
    expect(parseVolumeFromTitle('三体前')).toBe('前')
    expect(parseVolumeFromTitle('三国演义上册')).toBe('上')
    expect(parseVolumeFromTitle('三国演义中册')).toBe('中')
    expect(parseVolumeFromTitle('三国演义下册')).toBe('下')
  })

  it('末尾空白容忍', () => {
    expect(parseVolumeFromTitle(' 合成书目052 . 3 ')).toBe('3')
  })
})

describe('parseVolumeFromTitle — 不提取', () => {
  it('非尾部数字不提取（1984 不作卷号）', () => {
    expect(parseVolumeFromTitle('1984')).toBeNull()
    expect(parseVolumeFromTitle('明朝那些事儿 3')).toBeNull()
    expect(parseVolumeFromTitle('北京1984')).toBeNull()
  })

  it('卷号段不在末尾不提取', () => {
    expect(parseVolumeFromTitle('（三）三国演义')).toBeNull()
    expect(parseVolumeFromTitle('三体 2 . 4 序')).toBeNull()
  })

  it('无卷号段 → null', () => {
    expect(parseVolumeFromTitle('合成城市笔记 : 地名故事')).toBeNull()
    expect(parseVolumeFromTitle('')).toBeNull()
    expect(parseVolumeFromTitle('   ')).toBeNull()
  })

  it('「（上）」「（第一部）」括号内容非纯数字 → null（人工填写）', () => {
    expect(parseVolumeFromTitle('呐喊（上）')).toBeNull()
    expect(parseVolumeFromTitle('平凡的世界（第一部）')).toBeNull()
  })
})

describe('stripVolumeSuffix — 去卷号段（套装表单公共前缀建议）', () => {
  it('去掉末尾卷号段', () => {
    expect(stripVolumeSuffix('合成书目052 : 合成副题 52 . 3')).toBe(
      '合成书目052 : 合成副题 52',
    )
    expect(stripVolumeSuffix('三国演义（三）')).toBe('三国演义')
    expect(stripVolumeSuffix('红楼梦 上')).toBe('红楼梦')
    expect(stripVolumeSuffix('魔戒第二部')).toBe('魔戒')
    expect(stripVolumeSuffix('平凡的世界 第3部')).toBe('平凡的世界')
  })

  it('无卷号段原样返回（trim 后）', () => {
    expect(stripVolumeSuffix('1984')).toBe('1984')
    expect(stripVolumeSuffix('  合成城市笔记 : 地名故事  ')).toBe(
      '合成城市笔记 : 地名故事',
    )
  })
})
