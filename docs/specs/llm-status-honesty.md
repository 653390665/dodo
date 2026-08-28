# LLM 连接性与 API Key 状态的诚实容灾规范

> 触发分支：改动 LLM 可用性检测、API Key 状态定义或状态指示 UI（欢迎页、编辑器头部、设置弹窗）之前先读本文。

## 为什么
检测失败时用乐观硬编码回退（如 `.catch(() => setHasApiKey(true))`）伪装"已连接"，会让用户在离线时误以为 AI 可用。状态展示必须诚实。

## 规范
1. **三态标记**：密钥状态类型保留独立的 `'unknown'` 字面量（未配置 / 配置状态未知）。网络波动、抛错、异常捕获（catch）时统一标记为 `'unknown'`，不得回落为 `'connected'`。
2. **琥珀色降级视觉**：状态指示器对 `'unknown'` 渲染琥珀色视觉（而非绿色"已连接"或普通报错红色），文案使用 `LLM_AVAILABILITY_COPY.unknown`（"暂时无法确认" + 本地可继续写作的温和指引）。
3. **保底状态横幅**：页面附专属横幅，说明网络情况，并提供本地离线大纲与全流程降级写作指引。
4. **内部状态名不得直出**：`STATE_UNKNOWN`、`LOCAL_RESERVED` 等内部标识不得作为用户可见文案渲染（`src/tests/llm-availability.test.ts` 守护此点）。

## 现有实现与守护测试
- `src/lib/llm-availability.ts`：`LlmAvailabilityState = 'connected' | 'missing' | 'unknown'`；`deriveLlmAvailability` 在检测异常时映射为 `'unknown'`。
- 消费方：`src/components/WelcomeView.tsx`、`src/components/EditorHeader.tsx`、`src/components/SettingsModal.tsx`。
- 守护测试：`src/tests/llm-availability.test.ts`。
