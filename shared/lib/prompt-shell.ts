/**
 * 壳卡判定（Plan 261 修复⑧⑬，批次 B 迁至 shared 单一事实源）。
 *
 * 壳卡 = "[XX体] 围绕 X 执行"式引用壳（<80 字、无实际写作指导）。这类卡治理面标
 * isRuntimeReady=true，但内容只是对另一个不存在的提示词名的转投；装备为技法或注入
 * 阶段 prompt 都只会制造噪音，诱发模型抄录结构化材料。真卡（含 55-66 字短指令）实测零误伤。
 */
export function isShellTemplatePrompt(prompt: string | undefined): boolean {
  return Boolean(prompt && prompt.length < 80 && /^\[[^\]]{2,14}体\]/.test(prompt));
}
