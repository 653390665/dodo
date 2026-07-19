# InkFlow 协作创作模型黄金基准评测案例库

本文件定义了 InkFlow 大模型与 Prompt Runtime 在各类创作和精修场景下的物理测评用例基准。凡涉及 Prompt 调整或模型升级，必须以此评测用例集进行局部或全量回归检验，杜绝依靠“体感”和“玄学”调优。

---

## 🎯 一、 评测案例字典 (Evaluation Case Dictionary)

### Case 1: Welcome & Guest Orientation (游客欢迎与导引)
* **评测阶段**：Welcome / Onboarding
* **输入 Context**：
  - 用户无 Novel 记录（游客状态），未绑定 `novelId`
  - 触发 `/api/orchestrate-draft` 请求
* **预期成功信号 (Success Signals)**：
  - 看门狗服务 (`QuotaGuard`) 判定 `novelId` 为 `undefined` 自动进入豁免降级，允许请求直接放行
  - 模型生成友好的欢迎文风：包含对新作品创作灵感的快速发散和对核心长篇/番茄向导工作流的醒目导引
* **失败红牌信号 (Red Flags)**：
  - 拦截器报错或返回 `403 QuotaExceeded`
  - 模型开始硬编码输出某一特定长篇小说的局部细节
  - 出现 “null”、“undefined” 或无意义的空白回复

---

### Case 2: World Building & Setting Extraction (世界观与设定萃取)
* **评测阶段**：World Onboarding / Deconstruction
* **输入 Context**：
  - 长文本灵感素材：“在极夜纪元中，人类依靠发光的深海灵矿提供生存光热，通过灵矿中的高能辐射淬炼机械肉体，称为「深海矿徒」。”
  - 目标卡牌：`worldview-card` (世界设定卡)
* **预期成功信号 (Success Signals)**：
  - 拆书卡萃取打分评估 (`evaluateDeconstructionCard`) $\ge 90$（S级）
  - 成功萃取出“力量层级体系”、“核心世界背景”等标准 XML 段落
  - 去污染审计：未提及类似“萧炎”、“唐三”等外部网文名人实体，也未提及“林天凡”等默认占位符
* **失败红牌信号 (Red Flags)**：
  - 萃取结果空洞无物，仅含有口水车枯辘词（如“本卡世界设定丰富，文笔流畅，引人入胜”）
  - FewShots 示例字符数少于 20，未提供具体世界设定证据
  - 出现外部名人实体泄露，去污染打分大幅滑落至 C 级（<60分）

---

### Case 3: Character Confrontation Tension (人物对峙张力萃取)
* **评测阶段**：Character Onboarding / Deconstruction
* **输入 Context**：
  - 目标卡牌：`character-card` (人物设定卡)
  - 原始段落：“沈寒舟把玩着暗金铜扣，眸光冷冽，没有多说一个字。而对面的副局长却早已大汗淋漓，手指在桌角微颤。”
* **预期成功信号 (Success Signals)**：
  - 提炼出人物特有的“对话习惯（沉默、惜字如金）”和“试探动作（把玩铜扣）”
  - 生成卡牌不含对剧情的具体占位描写，而是高泛化度的写法语向
* **失败红牌信号 (Red Flags)**：
  - 实体混淆：将主角沈寒舟和对立面副局长的人设融合成了一个人
  - 输出格式损坏：JSON 或 XML 标签未闭环

---

### Case 4: Detail Pacing & Scene Beats Generation (大纲到本章分镜拆分)
* **评测阶段**：Workspace Beats Planning
* **输入 Context**：
  - 章节意图：沈寒舟在黑市灵矿交易中，偶遇了正在兜售假深海灵矿的神秘少女叶轻灵。
  - 大纲信息：“第一章沈寒舟需查证矿难真相，锁定黑市线索。”
* **预期成功信号 (Success Signals)**：
  - 生成标准 3 幕场景（Scene Beats）
  - 场景 1 聚焦“异动入场”；场景 2 聚焦“冲突与对峙”；场景 3 聚焦“悬念收束并留下退场钩子”
  - 每个场景结构规范：标明【核心冲突】、【关键动作链】及【退场钩子】
* **失败红牌信号 (Red Flags)**：
  - 拆分动作缺失，生成成了直接的正文段落而非分镜
  - 三幕场景内容高度同质化（例如：三幕都在讲偶遇）
  - 场景中出现大段无法被编辑器解析的 markdown markdown 特异标记

---

### Case 5: Workspace Continuity Drafting (正文无缝续写)
* **评测阶段**：Workspace Draft Generation
* **输入 Context**：
  - 已写前文：沈寒舟拉低了风帽，逆着黑市的冷雾，走到了 7 号矿摊前。
  - 本章分镜：沈寒舟发现少女兜售的并非劣质假矿，而是极为精纯、被禁运的「荧惑生矿」。
  - 装配技能：`worldview-card`（深海灵矿设定） + `style-card`（冷峻短句风格，5字-15字短句，低解释，画面优先）
* **预期成功信号 (Success Signals)**：
  - 生成正文与前文无缝衔接，无突兀的时间或空间跳跃
  - 叙事细节完美融入荧惑生矿的特征
  - 文风极其冷峻：短句居多，画面感强，无口水 AI 腔
* **失败红牌信号 (Red Flags)**：
  - 出现严重幻觉：主角名字突然改变，或者前文环境（7号矿摊）突变
  - AI 腔大爆发：使用大量套路虚词（如“沈寒舟心中暗自思忖”、“可以说，这正是……”）
  - 风格完全背离：出现大段说教式、高解释度的长篇大论

---

### Case 6: Chapter Quality Audit & Dimension Feedback (五维审稿与诊断)
* **评测阶段**：Chapter Review & Audit
* **输入 Context**：
  - 待审正文：包含明显的 AI 腔（“一言以蔽之，沈寒舟的深沉让人过目不忘。”）和明显的重复描写。
* **预期成功信号 (Success Signals)**：
  - 审稿模块精准定位“机械感”与“内容重复”的瑕疵
  - 给出包含数字打分的 feedback（如：“文风诊断：82 分（A级）”）
  - 在 Critique 字段中生成能指导精修的明确片段定位和修补建议
* **失败红牌信号 (Red Flags)**：
  - 评分机制失效：给出满分 100 分但实际上未能检测到明显的机械腔
  - 建议模糊空洞（如“建议修改不好的词汇”，未指明哪一句话不好）

---

### Case 7: Surgical Patch Patching (外科手术式局部精修)
* **评测阶段**：Chapter Polish / Rewrite
* **输入 Context**：
  - 原始段落：“荧惑生矿的冷光在叶轻灵眼中闪烁。她看着沈寒舟，沈寒舟也看着她。一言以蔽之，沈寒舟的深沉让人过目不忘。”
  - 审计 Critique 定位：“一言以蔽之，沈寒舟的深沉让人过目不忘。” 机械解释腔严重。
* **预期成功信号 (Success Signals)**：
  - 精修算法 (`handlePolishChapterFromAudit`) 外科手术式精准剪裁掉该坏段落
  - 替换后的文字保持冷峻短句风格且情节连续（如：“叶轻灵咬着下唇，手指在麻袋上攥得生疼。沈寒舟只是立在阴影里，像一尊石雕。”）
  - 采纳反馈 `recordSkillUsage` 成功上报
* **失败红牌信号 (Red Flags)**：
  - 越界大改：不仅修了该段，还把前面正常的 2000 字正文全部清空了
  - 语义撕裂：改写出来的部分 and 上下文完全接不上，甚至改变了说话人的立场

---

## 🔁 二、 提示词调整标准 SOP (Prompt Optimization SOP)

任何对 `shared/config/prompt-templates.ts` 或 `server/helpers/prompt-helpers.ts` 提示词模板的修改，都必须严格执行以下四步闭环：

```
[步骤 1: 契约测试] ➡ [步骤 2: 物理基准跑测] ➡ [步骤 3: 异常分布统计] ➡ [步骤 4: 绿灯合并]
```

1. **步骤 1：跑通 Contract 契约测试**
   - 运行 `npm run test` 以确保所有的数据库存储结构和物理类型无 Regression。
2. **步骤 2：在测试集上对比 Regression**
   - 在控制台中模拟新 prompt 调用。
   - 对比 Case 5、Case 6、Case 7 的 Success 信号是否提升，Red Flags 数量是否下降。
3. **步骤 3：统计 Fallback 原因和分布**
   - 在测试时监控后端控制台：是否有因 prompt 修改导致的 XML 解析失败或者 json parse fallback？
   - 确保 Fallback 发生率控制在 $1\%$ 以下。
4. **步骤 4：无 Regression 物理合并**
   - 只有当上述三个门槛全部通过，且在不引入 speculative 新 any 类型债务的情况下，才允许将 Prompt 修改提交合并。
