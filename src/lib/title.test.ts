import { describe, it, expect } from 'vitest'

import { parseTitle } from '@/lib/title'
import sample from '@/tests/fixtures/szlib-sample.json'

type SzRow = { title: string }
// 去重保留 9 个非空唯一 title（sample.json 含续借/查询/还回等重复行）。
const uniqueTitles = Array.from(new Set((sample as SzRow[]).map((r) => r.title))).filter((t) => t !== '')

describe('parseTitle', () => {
  it('合成绘本甲 = Synthetic story/ (日)合成作者著;合成译者译', () => {
    expect(parseTitle('合成绘本甲 = Synthetic story/ (日)合成作者著;合成译者译')).toEqual({
      title: '合成绘本甲',
      parallelTitles: ['Synthetic story'],
      authors: ['合成作者'],
      translators: ['合成译者'],
      isPlaceholder: false,
    })
  })

  it('合成编程指南 : 第7版/ (美)合成作者甲著;合成译者甲译（不再切副题名）', () => {
    expect(parseTitle('合成编程指南 : 第7版/ (美)合成作者甲著;合成译者甲译')).toEqual({
      title: '合成编程指南 : 第7版',
      parallelTitles: [],
      authors: ['合成作者甲'],
      translators: ['合成译者甲'],
      isPlaceholder: false,
    })
  })

  it('合成算法论 = Introduction to algorithms/ 合成作者等著;合成译者译', () => {
    expect(
      parseTitle('合成算法论 = Introduction to algorithms/ 合成作者等著;合成译者译'),
    ).toEqual({
      title: '合成算法论',
      parallelTitles: ['Introduction to algorithms'],
      authors: ['合成作者等'],
      translators: ['合成译者'],
      isPlaceholder: false,
    })
  })

  it('合成深度学/ (美)合成作者等著;合成译者等译', () => {
    expect(parseTitle('合成深度学/ (美)合成作者等著;合成译者等译')).toEqual({
      title: '合成深度学',
      parallelTitles: [],
      authors: ['合成作者等'],
      translators: ['合成译者等'],
      isPlaceholder: false,
    })
  })

  it('合成图解手册/ (日)合成作者乙著;合成译者乙译', () => {
    expect(parseTitle('合成图解手册/ (日)合成作者乙著;合成译者乙译')).toEqual({
      title: '合成图解手册',
      parallelTitles: [],
      authors: ['合成作者乙'],
      translators: ['合成译者乙'],
      isPlaceholder: false,
    })
  })

  it('合成亲密论/ (美)合成作者著;合成译者译', () => {
    expect(parseTitle('合成亲密论/ (美)合成作者著;合成译者译')).toEqual({
      title: '合成亲密论',
      parallelTitles: [],
      authors: ['合成作者'],
      translators: ['合成译者'],
      isPlaceholder: false,
    })
  })

  it('合成漫画 : 漫画版/ 合成作者著（无译者，不再切副题名）', () => {
    expect(parseTitle('合成漫画 : 漫画版/ 合成作者著')).toEqual({
      title: '合成漫画 : 漫画版',
      parallelTitles: [],
      authors: ['合成作者'],
      translators: [],
      isPlaceholder: false,
    })
  })

  it('丛书分册不切分：合成城市笔记 : 地名故事 → 完整题名', () => {
    expect(parseTitle('合成城市笔记 : 地名故事/ 合成作者丙著')).toEqual({
      title: '合成城市笔记 : 地名故事',
      parallelTitles: [],
      authors: ['合成作者丙'],
      translators: [],
      isPlaceholder: false,
    })
  })

  it('福田图书馆读者自选图书 → 占位短路', () => {
    expect(parseTitle('福田图书馆读者自选图书')).toEqual({
      title: '福田图书馆读者自选图书',
      parallelTitles: [],
      authors: [],
      translators: [],
      isPlaceholder: true,
    })
  })

  it('无条码测试书/ 无条码作者著（无 ISBN 测试）', () => {
    expect(parseTitle('无条码测试书/ 无条码作者著')).toEqual({
      title: '无条码测试书',
      parallelTitles: [],
      authors: ['无条码作者'],
      translators: [],
      isPlaceholder: false,
    })
  })

  it('空串短路返回 isPlaceholder=true', () => {
    expect(parseTitle('')).toEqual({
      title: '',
      parallelTitles: [],
      authors: [],
      translators: [],
      isPlaceholder: true,
    })
  })

  it('角色词覆盖：主编/编著/绘/编 归 authors，译/校/校译 归 translators', () => {
    expect(parseTitle('A书/ 甲主编;乙译').authors).toEqual(['甲'])
    expect(parseTitle('A书/ 甲主编;乙译').translators).toEqual(['乙'])
    expect(parseTitle('B书/ 丙绘').authors).toEqual(['丙'])
    expect(parseTitle('C书/ 丁校译').translators).toEqual(['丁'])
  })

  it('多组 ; 切分', () => {
    expect(parseTitle('书名/ 甲主编;乙校;丙绘').authors).toEqual(['甲', '丙'])
  })

  it('无角色词第一组默认归 authors（整名保留）', () => {
    expect(parseTitle('书名/ 某某人').authors).toEqual(['某某人'])
  })

  it('等 保留于姓名字符串（不在 parseTitle 剥离）', () => {
    expect(parseTitle('书名/ A等著').authors).toEqual(['A等'])
  })

  it('同一输入两次调用深等价', () => {
    expect(parseTitle('合成绘本甲 = Synthetic story/ (日)合成作者著;合成译者译')).toEqual(
      parseTitle('合成绘本甲 = Synthetic story/ (日)合成作者著;合成译者译'),
    )
  })

  it('sample.json 的 9 个非空唯一 title 全部可解析', () => {
    expect(uniqueTitles.length).toBeGreaterThanOrEqual(9)
    for (const t of uniqueTitles) {
      const r = parseTitle(t)
      expect(typeof r.title).toBe('string')
      expect(Array.isArray(r.authors)).toBe(true)
      expect(Array.isArray(r.translators)).toBe(true)
      if (t === '福田图书馆读者自选图书') expect(r.isPlaceholder).toBe(true)
      else expect(r.isPlaceholder).toBe(false)
    }
  })

  it('不调用 normalize（无依赖）——紧贴半角冒号（如 J238.2）不误切', () => {
    // J238.2 是分类号而非分隔符；` : ` 只要求两侧空格，紧贴冒号天然安全。
    expect(parseTitle('J238.2/ 某作者著').title).toBe('J238.2')
  })
})
