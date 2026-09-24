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

/**
 * 生成侧收口：剥离模型误抄进正文的围栏标签。
 *
 * 背景（2026-09-24 真实 provider 复测）：资料包文本以
 * `<user_data label="续写资料·…">…</user_data>` 围栏注入 prompt，
 * Claude 与 Gemini 都会把这行标签当成正文抄出来（成稿里出现
 * `user_data label="续写资料·续写任务"`），被 critic 判为元数据污染。
 * 这里在文本出口做确定性剥离——围栏是给模型读的数据边界，不该出现在作品正文里。
 */
export function stripUntrustedFenceTags(text: string): string {
  return String(text ?? '')
    .replace(/&lt;\/?user_data\b[\s\S]*?&gt;/gi, '')
    .replace(/<\/?user_data\b[^>]*>/gi, '')
    .replace(/\buser_data\s+label\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}
