// 非书设备流通类型判定（device-borrows 规格 §2）。
//
// 独立模块：`isDeviceCirtype` 被 szlib parser（parse 期标记）与存量回填
// （backfill-device-kind，应用启动期）共用。独立成模块使 szlib parser 的
// 完整解析逻辑（parse/validate/filterRows，仅导入流程使用）不随启动路径
// 进入首屏入口链——回填只依赖本判定函数（性能硬化 P-1）。
const DEVICE_CIRTYPES: Record<string, true> = { 电子设备外借: true }

/**
 * 非书设备借阅判定：cirtype 精确匹配「电子设备外借」。
 * 设备以普通编目进入 OPAC（如 metaid=5952182 电子书阅读器），借还记录与
 * 图书同构；此标记使其 Book 材料类型可区分，阅读画像统计不纳入设备。
 * parse 与回填共用（单一事实来源）。
 */
export function isDeviceCirtype(cirtype: string | undefined): boolean {
  return cirtype != null && DEVICE_CIRTYPES[cirtype] === true
}
