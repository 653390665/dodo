# Round 42 修复计划（基于三组子代理测试发现 + 历史遗留）

## 问题全景（三组子代理测试 + 历史累积，共 15 项未修）

### 批次一：P0 + 高影响 P1（阻塞核心链路）

| # | 问题 | 根因 | 修复方案 | 涉及文件 |
|---|------|------|----------|----------|
| F1 | DeepSeek json_object 兼容——大纲生成 100% 失败 | 大纲 prompt 不含"json"，DeepSeek 拒绝 response_format:{type:'json_object'}；降级链显式排除 DeepSeek | 方案A：大纲 prompt 模板保证含 "json"；方案B：降级链允许 DeepSeek 也丢弃 response_format 回退 plain | server/lib/server-llm.ts:366-375, 490-512, 1247-1267 |
| F2 | 审稿 invalid_json 无自动重试 | 首次审稿返回 invalid_json（五维合同未过），如实标 unknown 但不重试 | 在 ai-production-pipeline 的审稿步骤加一次自动重试（同参数重发） | server/helpers/ai-production-pipeline.ts |
| F3 | 分镜降级时用户意图原句拼进冲突条目产生残句 | 生产管线复用旧分镜时把意图原句直接拼入"核心冲突"字段 | 拼接前清洗意图文本：去掉句尾标点 remainder，补全语法 | server/helpers/ai-production-pipeline.ts 或分镜生成路径 |
| F4 | LLM 超时降级无用户沟通 | Planner/Writer 超时降级只打 server WARN，用户面对数分钟空窗无解释 | 前端在生产状态区域增加降级提示（当 run 的 plan/audit source 为 fallback 时显示"部分阶段使用模板降级"） | src/components/ProductionRunReview.tsx 或前端状态组件 |

### 批次二：P1 体验类

| # | 问题 | 修复方案 | 涉及文件 |
|---|------|----------|----------|
| F5 | 知识图谱入口不可发现 | 在设定页签的关系图谱按钮旁增加入口（或把"当前场景上下文图谱"提升为显式导航项） | src/components/WorldBibleView.tsx 或智能管家 |
| F6 | 建书 4 层确认过多 | 合并"治理规划立项"和"虚构资产清单"两层为一个确认步骤；术语换为用户语言 | 建书向导组件 |
| F7 | AI 连接状态口径矛盾 | 立项等待期的"连接恢复后再重试"改为与顶部状态栏一致的措辞 | 立项向导组件 |

### 批次三：P2

| # | 问题 | 修复方案 |
|---|------|----------|
| F8 | 能力中心"当前作品"上下文不稳定 | 排查 store 初始化时序，确保 selectedNovel 在能力中心路由时正确恢复 |
| F9 | 资料续写缺资料包管理入口 | 在资料续写页增加"查看已导入资料包"入口（链接到设定集→资料包管理） |
| F10 | "AI 协作"与"创作工作台"入口区分度弱 | "AI 协作"改为打开智能管家抽屉而非复制工作台视图 |
| F11 | 流式坏字节（"每��持续"） | 定位流式拼接的编码问题（可能在 SSE chunk 边界切割了多字节 UTF-8 字符） |

## 执行策略

- 批次一（F1-F4）：子代理 1 执行，P0 优先
- 批次二（F5-F7）：子代理 2 执行
- 批次三（F8-F11）：下轮处理或与批次二合并
- 每个修复独立 commit，配套测试
- 修完跑全量回归

## 依赖关系

- F1 是独立的（server-llm 层）
- F2 依赖 F1（大纲修好后才能测审稿链路）
- F3-F4 独立于 F1/F2
- F5-F7 独立
