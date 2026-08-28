# InkFlow 开发归档

日期：2026-05-09
仓库：`/Users/Zhuanz/Documents/dodo-inkflow`

## 项目概况

- 产品：InkFlow，AI 辅助小说创作工具
- 技术栈：
  - 前端：React + TypeScript + Vite
  - 后端：Express + TypeScript
  - 本地存储：better-sqlite3
  - 桌面：Electron
- 常用运行命令：
  - 安装依赖：`npm install`
  - 启动开发：`npm run dev`
  - 类型检查：`npm run lint`

## 已完成的核心工作

### 1. 基础运行与前端可打开

- 修复了开发环境依赖问题，项目可在本地启动
- 修复了前端因 Node-only 配置被打进浏览器导致的黑屏问题
- 当前本地地址：`http://localhost:3000`

### 2. 创作舞台与智能管家

- 重构了创作舞台布局，减少右侧空白挤压
- 智能管家从“占宽度侧栏”改成“覆盖式抽屉”
- 修复了智能管家：
  - 打开后无法收回
  - 缺少关闭入口
  - 现在支持：
    - 顶部按钮关闭
    - 面板内收起按钮
    - 点击遮罩关闭
    - `Esc` 关闭

### 3. AI 模型接入与配置

- 接入了 MiniMax OpenAI 兼容接口
- 服务端统一承担大模型请求，避免前端直接持有密钥
- 配置支持通过设置页修改：
  - API Key
  - Base URL
  - Model

### 4. Prompt 设置页

- 把核心提示词模板从硬编码抽到设置页
- 支持修改、保存、试跑、恢复默认
- 已处理设置弹窗“内容显示不全”的布局问题
- 当前提示词工作台覆盖链路：
  - 灵感助手
  - 分镜生成
  - AI 审计
  - 正文生成
  - 正文生成内审
  - 拆书萃取
  - 全局大纲

### 5. 正文生成与审计链路

- 优化了 `orchestrateWriter`，增强：
  - 信息释出节奏
  - 台词承接
  - 动作兑现
  - 解释克制
- 优化了 `manualAudit` / `orchestrateCritic`
- 结构化审计已接入：
  - 服务端将模型返回的结构化审计转为可读 Markdown
  - 同时嵌入结构化 comment，供后续局部精修读取
- 修复了审计返回“近似合法 JSON 但内层引号未转义”时的解析失败问题

### 6. 审计驱动局部精修（方案 A）

- 已从“整章自由重写”切换为“局部手术式修补”
- 关键文件：
  - `src/lib/chapter-polish.ts`
  - `src/lib/rewrite-prompt.ts`
  - `server.ts`
  - `src/components/EditorView.tsx`
- 当前能力：
  - 从审计报告中提取重复目标与重写目标
  - 先做确定性去重
  - 再对最多 3 个可定位片段做局部 patch
  - 最后用护栏校验坏结果，避免污染正文

### 7. Skill 系统升级

- 技能仓库已支持：
  - 打开详情
  - 编辑
  - 保存当前版本
  - 保存为新版本
  - 版本谱系查看
  - 单卡试驾 / 版本对比 / 多卡组合试驾
- 创作舞台已支持：
  - `mountedSkillLoadout`
  - 3 槽装配
  - 拖拽替换
  - 适配得分
  - 冲突提示
  - 使用反馈记录与推荐排序

### 8. 拆书工厂结果层升级

- 当前前端已支持把“融合型 skill”按维度自动拆成多张卡
- 每张卡现在具备：
  - 维度类型
  - 建议装配位
  - 强度评分
  - 强度标签（高特征 / 推荐使用 / 可补位 / 弱信号）
- 相关文件：
  - `src/components/BookFactoryView.tsx`

## 当前已知状态

### Prompt 与质量链路

- 正文生成主链已能稳定输出完整内容
- 审计链已能稳定返回结构化结果
- `chapter-polish` 通过优先级增强后，回归章服务级结果已推进到约 `86/100`
- 但这个分数主要来自特定回归章节，仍需跨章节验证泛化能力

### Skill 与拆书链路

- 前端展示层已实现“按维度拆多卡”
- 但后端 `extract-skill` 仍不保证天然输出多张单职责卡
- 目前是“展示层自动拆卡”，不是“数据层原生多卡”

### UI / 交互

- 技能挂载区域已做成“上方固定卡槽 + 下方独立滚动卡组”
- 解决了技能卡太多时，拖拽过程中无法同时滚动导致的“拖拽失效体感”

## 当前待办建议

按优先级建议：

1. **拆书后端原生多卡化**
   - 让 `/api/extract-skill` 默认直接输出 `skills[]`
   - 每张卡只负责一个主维度或单一职责

2. **跨章节验证 chapter-polish**
   - 目前局部精修已在回归章效果很好
   - 需要对 2-3 个不同章节类型做泛化测试

3. **统一旧章节审计格式**
   - 当前新审计已结构化
   - 旧章节可能仍残留老式 `分子级审计报告`

4. **继续优化 Skill 评分公式**
   - 目前已有维度评分
   - 未来可以进一步接入：
     - 使用反馈
     - 冲突惩罚
     - 装配成功率

## 关键文件索引

- 运行与接口
  - `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/server-llm.ts`
- Prompt
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/config/prompt-templates.ts`
  - `/Users/Zhuanz/.inkflow/config.json`
- 审计与局部精修
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/audit-structured.ts`
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/chapter-polish.ts`
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/rewrite-prompt.ts`
- 创作舞台
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorView.tsx`
- 设置页
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/components/SettingsModal.tsx`
- 技能系统
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/skill-model.ts`
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/components/skills/SkillLoadoutBoard.tsx`
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/components/skills/SkillDetailDrawer.tsx`
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/components/SkillsStudioView.tsx`
- 拆书工厂
  - `/Users/Zhuanz/Documents/dodo-inkflow/src/components/BookFactoryView.tsx`

## 常用验证命令

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
PATH=/Users/Zhuanz/.local/share/fnm/node-versions/v22.22.1/installation/bin:$PATH npm run lint
./node_modules/.bin/tsx tests/chapter-polish.test.ts
./node_modules/.bin/tsx tests/audit-structured.test.ts
./node_modules/.bin/tsx tests/skill-model.test.ts
```
