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

## 运行时自检（可选）

`npm run dev` 后，**首次冷启动**时 Vite 可能要接近一分钟才会出现 `Server running` 并真正监听端口。

另开终端，在项目根目录执行：

```bash
npm run smoke:runtime
```

若 dev 使用的不是 `http://localhost:3000`，请指定基址：

```bash
INKFLOW_BASE_URL=http://127.0.0.1:<端口> npm run smoke:runtime
```

期望依次输出三条 `ok ...`。若失败，终端会打印 `cause`（例如 `ECONNREFUSED`）与简短提示，便于确认服务是否已启动、端口是否正确。
