/**
 * 外部链接 scheme 白名单守卫。
 *
 * 仅放行 `https:` URL；`new URL` 解析失败（如无 base 的
 * protocol-relative `//example.com`）或非 https scheme
 * （`javascript:`、`data:`、`http:`、`ftp:` 等）一律拒绝。
 *
 * 作为类型守卫使用：通过检查后值为 `string` 且必然是 https URL，
 * 可用于 `<a href>` 等渲染位置的 defense-in-depth。
 */
export function isSafeExternalUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
