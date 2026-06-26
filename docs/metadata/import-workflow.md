# Import Workflow 导入流程规范

> AI Agent 指引：本文档定义了系统接受外部数据导入的通用约束、整体生命周期以及编码处理规范。

## 通用约束

- 文件编码：UTF-8（必须支持 GBK/GB2312 自动检测和转码，中国图书馆系统常用）
- 文件大小限制：前端处理，建议单文件不超过 50MB
- 支持格式：JSON, CSV（可扩展 XLSX）

## 导入流程规范

```text
Agent 实现要点：

1. 文件选择
   - 用户选择文件或拖拽上传
   - 前端检测文件编码（使用 TextDecoder 尝试 UTF-8，失败后尝试 GBK）
   - 自动检测文件格式（JSON/CSV）

2. 来源选择
   - 用户选择或创建 Source
   - 系统使用 parser.validate() 自动推荐匹配的 Parser

3. 预览与确认
   - 解析前 10 条记录展示预览
   - 显示字段映射结果
   - 显示检测到的警告

4. 导入执行
   - 全量解析原始数据
   - 借还配对
   - 去重合并（基于 ISBN 或 条码号+来源）
   - 写入 IndexedDB

5. 导入报告
   - 新增书籍数
   - 新增借阅周期数
   - 跳过的记录数
   - 警告列表
```

## 编码检测

```typescript
/**
 * Agent 实现要点：中国图书馆系统导出的文件经常使用 GBK 编码
 * 需要自动检测并转换
 */
async function detectAndDecode(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  
  // 1. 尝试 UTF-8
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch {
    // 2. Fallback 到 GBK
    const decoder = new TextDecoder('gbk');
    return decoder.decode(buffer);
  }
}
```
