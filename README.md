<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# InkFlow 墨影 - 本地化小说创作平台

专为小说家设计的沉浸式创作环境，集成智能大纲、角色管理与大模型 AI 灵感辅助。

## 本地运行

**环境要求:** Node.js

1. 安装依赖:
   `npm install`
2. 在 [.env.local](.env.local) 中配置大模型 API:
   ```
   API_KEY=你的key
   API_BASE_URL=https://api.deepseek.com
   API_MODEL=deepseek-chat
   ```
   兼容 OpenAI 接口规范的任意大模型均可使用。
3. 启动应用:
   `npm run dev`
