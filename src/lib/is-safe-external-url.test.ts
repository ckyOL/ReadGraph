import { describe, it, expect } from 'vitest'

import { isSafeExternalUrl } from '@/lib/is-safe-external-url'

describe('isSafeExternalUrl', () => {
  it('放行 https URL', () => {
    expect(isSafeExternalUrl('https://www.szlib.org.cn/opac/searchDetail?barcode=1')).toBe(true)
  })

  it('拒绝 javascript: scheme', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('拒绝 data: scheme', () => {
    expect(isSafeExternalUrl('data:text/html,<b>hi</b>')).toBe(false)
  })

  it('拒绝非 https scheme（http）', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
  })

  it('拒绝非 https scheme（ftp）', () => {
    expect(isSafeExternalUrl('ftp://example.com')).toBe(false)
  })

  it('拒绝 protocol-relative URL（无 base 解析失败）', () => {
    expect(isSafeExternalUrl('//example.com')).toBe(false)
  })

  it('拒绝空串', () => {
    expect(isSafeExternalUrl('')).toBe(false)
  })

  it('拒绝 null', () => {
    expect(isSafeExternalUrl(null)).toBe(false)
  })

  it('拒绝 undefined', () => {
    expect(isSafeExternalUrl(undefined)).toBe(false)
  })

  it('类型守卫：通过时收窄为 string', () => {
    const value: string | null | undefined = 'https://www.szlib.org.cn/opac/searchDetail?barcode=1'
    if (isSafeExternalUrl(value)) {
      expect(value.toUpperCase()).toBe('HTTPS://WWW.SZLIB.ORG.CN/OPAC/SEARCHDETAIL?BARCODE=1')
    } else {
      throw new Error('类型守卫未收窄')
    }
  })
})
