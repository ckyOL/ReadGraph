import { describe, it, expect } from 'vitest'

import { IMPORT_MAX_FILE_SIZE, detectAndDecode } from './encoding'

describe('detectAndDecode', () => {
  it('UTF-8 文本原样解码并标注 utf-8', () => {
    const text = '{"date":"20260630"}'
    const buffer = new TextEncoder().encode(text).buffer
    const result = detectAndDecode(buffer)
    expect(result.text).toBe(text)
    expect(result.detectedEncoding).toBe('utf-8')
  })

  it('UTF-8 多字节（中文）正常解码', () => {
    const text = '合成绘本甲'
    const buffer = new TextEncoder().encode(text).buffer
    const result = detectAndDecode(buffer)
    expect(result.text).toBe(text)
    expect(result.detectedEncoding).toBe('utf-8')
  })

  it('GBK 字节序列回退解码并标注 gbk', () => {
    // "合成绘本甲" 的 GB2312/GBK 字节（python3 校验：BACF B3C9 BBE6 B1BE BCD7）。
    // Node/浏览器 TextDecoder('gbk') 均可解回原文。
    const buffer = Uint8Array.from([0xba, 0xcf, 0xb3, 0xc9, 0xbb, 0xe6, 0xb1, 0xbe, 0xbc, 0xd7]).buffer
    const result = detectAndDecode(buffer)
    expect(result.text).toBe('合成绘本甲')
    expect(result.detectedEncoding).toBe('gbk')
  })

  it('无效 UTF-8 字节触发回退而非抛错', () => {
    // 0x80 0x80 非合法 UTF-8 起始序列；按 GBK 双字节解释。
    const buffer = Uint8Array.from([0x80, 0x80]).buffer
    const result = detectAndDecode(buffer)
    expect(result.detectedEncoding).toBe('gbk')
    expect(result.text).toBeTypeOf('string')
  })

  it('空 buffer 返回空文本 utf-8', () => {
    const result = detectAndDecode(new ArrayBuffer(0))
    expect(result.text).toBe('')
    expect(result.detectedEncoding).toBe('utf-8')
  })
})

describe('IMPORT_MAX_FILE_SIZE', () => {
  it('上限为 50MB（ui-navigation §6 大文件阈值）', () => {
    expect(IMPORT_MAX_FILE_SIZE).toBe(50 * 1024 * 1024)
  })
})
