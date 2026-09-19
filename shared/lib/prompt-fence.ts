/**
 * Prompt 注入围栏（Plan 253 单源）。
 *
 * 书籍导入、续写包、拆书卡等不可信文本此前被裸拼接进生成 prompt，
 * 其中的指令性文字会被模型当作高优先级约束执行。本模块把「XML 转义 +
 * 数据围栏」逻辑收敛到 shared 单源，供 server 与 shared 两侧复用。
 */

/** 转义五个标记分隔字符，使文本失去标记/围栏语义，只能作为纯数据被读取。 */
export function escapePromptText(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 将不可信文本标记为纯数据，防止其被模型当作 prompt 指令执行。 */
export function fenceUntrustedText(label: string, text: string): string {
  return `<user_data label="${escapePromptText(label)}">\n${escapePromptText(text)}\n</user_data>`;
}
