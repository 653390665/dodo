# Plan 109: InkFlow V3 创作自适应管线与极致美学重构图纸 (Universal Modernization Blueprint)

## 1. 战役背景 & 重构宗旨
根据 **Jobs 极致减法、Musk 第一性原理** 与 **PM 商业自适应链路** 审计发现，InkFlow 目前存在：
1. **假雷达欺骗**：`WritingSurface.tsx` 中定位写死的 CSS 呼吸球，假冒“上下文记忆雷达”，无实际数据。
2. **设定孤岛**：原生弹簧物理 `RelationshipGraph` 关系图谱功能完备，但在全局 `WorldBibleView` 中竟然无一级 Tab 渲染。
3. **货架自嗨**：独立货架式 `SkillsStudioView` 脱离网文生命周期流程，用户不知如何装配。
4. **Shadcn UI 滥用**：大量 `space-y-*` 导致隐藏渲染时高度塌陷，写死硬编码中性灰（如 `#94a3b8`）破坏玻璃质感。

本图纸（Plan 109）旨在提供**高精度、零占位符、100% 循证可落地**的物理重构规范。

---

## 2. 战役 1：造土壤 · 真实多维雷达图（NovelDiagnosticRadar）落地

### 2.1 待修改文件
* [`/src/components/WritingSurface.tsx`](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx)

### 2.2 数据源解析算法 (Parse Critique Scores)
利用 `shared/lib/audit-structured` 里的 Zod 结构与 markdown 数据。若 `currentChapter?.critique` 存在，前端使用正则表达式与 `extractStructuredAudit` 进行联合脱水解析：

```typescript
// 1. 维度与默认分定义
export interface DiagnosticScore {
  prose: number;       // 文笔
  narrative: number;   // 叙事
  character: number;   // 角色
  setting: number;     // 设定
  pacing: number;      // 节奏
  readerPull: number;  // 追读力
}

// 2. 诚实容灾的多维分数抓取函数
export function parseDimensionScores(critiqueText: string | undefined): DiagnosticScore {
  const scores: DiagnosticScore = {
    prose: 0,
    narrative: 0,
    character: 0,
    setting: 0,
    pacing: 0,
    readerPull: 0,
  };
  
  if (!critiqueText || critiqueText.trim() === '') {
    return scores;
  }

  // A. 首先使用正则表达式拉取 Markdown 表格中的评分
  // 匹配格式: | prose | 8/10 | prose reason | 或 | 文笔 | 8.5/10 | 原因 |
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\/\s*10\s*\|/g;
  let match;
  while ((match = rowRegex.exec(critiqueText)) !== null) {
    const dimLabel = match[1].trim().toLowerCase();
    const score = parseFloat(match[2]);
    
    if (dimLabel === 'prose' || dimLabel === '文笔') scores.prose = score;
    else if (dimLabel === 'narrative' || dimLabel === '叙事') scores.narrative = score;
    else if (dimLabel === 'character' || dimLabel === '角色') scores.character = score;
    else if (dimLabel === 'setting' || dimLabel === '设定') scores.setting = score;
    else if (dimLabel === 'pacing' || dimLabel === '节奏') scores.pacing = score;
    else if (dimLabel === 'readerpull' || dimLabel === '追读力') scores.readerPull = score;
  }

  return scores;
}
```

### 2.3 原生 SVG 雷达图组件 `NovelDiagnosticRadar` 实现
在 `WritingSurface.tsx` 的同级或文件内部编写高颜值、自适应 brand-color 的原生 SVG 雷达图组件：

```tsx
import React from 'react';

interface RadarProps {
  scores: DiagnosticScore;
  hasCritique: boolean;
}

export function NovelDiagnosticRadar({ scores, hasCritique }: RadarProps) {
  const dimensions = [
    { key: 'prose', label: '文笔' },
    { key: 'narrative', label: '叙事' },
    { key: 'character', label: '角色' },
    { key: 'setting', label: '设定' },
    { key: 'pacing', label: '节奏' },
    { key: 'readerPull', label: '追读力' },
  ] as const;

  const width = 220;
  const height = 180;
  const center = { x: width / 2, y: height / 2 - 5 };
  const radius = 55;
  const totalLevels = 3; // 对应 3.3, 6.6, 10 环线

  // 计算多边形顶点的角步长 (6等分)
  const angleStep = (Math.PI * 2) / 6;

  // 1. 计算每个网格环的顶点 (同心六边形)
  const getGridPoints = (level: number) => {
    const r = (level / totalLevels) * radius;
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = i * angleStep - Math.PI / 2; // 从 12 点钟方向顺时针计算
      const x = center.x + Math.cos(angle) * r;
      const y = center.y + Math.sin(angle) * r;
      points.push(`${x},${y}`);
    }
    return points.join(' ');
  };

  // 2. 计算实际的分数填充区域顶点
  const actualPoints = dimensions.map((dim, i) => {
    // 诚实降维: 如果没有审稿评分，渲染默认 0.5 作为淡雅环，防止视觉空洞
    const scoreVal = hasCritique ? (scores[dim.key as keyof DiagnosticScore] || 0) : 0;
    const valRadius = (scoreVal / 10) * radius;
    const angle = i * angleStep - Math.PI / 2;
    const x = center.x + Math.cos(angle) * valRadius;
    const y = center.y + Math.sin(angle) * valRadius;
    return { x, y, score: scoreVal };
  });

  const actualPointsStr = actualPoints.map(p => `${p.x},${p.y}`).join(' ');

  // 3. 计算文本标签定位 (微调 padding 防止文字出界)
  const getLabelCoords = (i: number) => {
    const angle = i * angleStep - Math.PI / 2;
    const textRadius = radius + 15;
    const x = center.x + Math.cos(angle) * textRadius;
    const y = center.y + Math.sin(angle) * textRadius;
    return { x, y };
  };

  return (
    <div className="relative w-full py-4 flex flex-col items-center justify-center bg-theme-sidebar/25 border border-theme-border/30 rounded-2xl overflow-hidden shadow-inner backdrop-blur-sm">
      <svg width={width} height={height} className="overflow-visible">
        {/* 定义渐变与网格滤镜 */}
        <defs>
          <radialGradient id="radar-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--theme-accent)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--theme-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 1. 同心六边形背景线 */}
        {[1, 2, 3].map((level) => (
          <polygon
            key={level}
            points={getGridPoints(level)}
            fill="none"
            stroke="var(--theme-border)"
            strokeWidth="0.8"
            strokeDasharray={level === 3 ? "none" : "3, 3"}
            opacity={level === 3 ? "0.6" : "0.35"}
          />
        ))}

        {/* 2. 极轴轴线 */}
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const targetX = center.x + Math.cos(angle) * radius;
          const targetY = center.y + Math.sin(angle) * radius;
          return (
            <line
              key={i}
              x1={center.x}
              y1={center.y}
              x2={targetX}
              y2={targetY}
              stroke="var(--theme-border)"
              strokeWidth="0.8"
              opacity="0.35"
            />
          );
        })}

        {/* 3. 实际分数多边形填充和描边 (仅在有 critique 且不为 0 时渲染，否则渲染幽灵底网) */}
        {hasCritique ? (
          <>
            <polygon
              points={actualPointsStr}
              fill="url(#radar-glow)"
              stroke="var(--theme-accent)"
              strokeWidth="1.5"
              className="transition-all duration-500 ease-out"
            />
            {/* 4. 顶点发光脉冲圆点 */}
            {actualPoints.map((pt, i) => {
              if (pt.score === 0) return null;
              return (
                <g key={i}>
                  <circle cx={pt.x} cy={pt.y} r="3" fill="var(--theme-accent)" />
                  <circle cx={pt.x} cy={pt.y} r="6" fill="var(--theme-accent)" className="animate-ping" opacity="0.4" />
                </g>
              );
            })}
          </>
        ) : (
          /* 幽灵占位网: 灰暗点画虚线，代表空状态 */
          <polygon
            points={getGridPoints(1.2)}
            fill="none"
            stroke="var(--theme-muted)"
            strokeWidth="1"
            strokeDasharray="2, 2"
            opacity="0.25"
          />
        )}

        {/* 5. 渲染顶点文本和数字 */}
        {dimensions.map((dim, i) => {
          const coords = getLabelCoords(i);
          const scoreVal = hasCritique ? (scores[dim.key as keyof DiagnosticScore] || 0) : 0;
          const isTopOrBottom = i === 0 || i === 3;
          const isLeft = i === 4 || i === 5;
          const textAnchor = isTopOrBottom ? 'middle' : isLeft ? 'end' : 'start';

          return (
            <text
              key={dim.key}
              x={coords.x}
              y={coords.y}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              className="text-[10px] font-sans transition-all duration-300 select-none"
              fill={hasCritique && scoreVal > 0 ? "var(--theme-text)" : "var(--theme-muted)"}
              opacity={hasCritique && scoreVal > 0 ? "1" : "0.55"}
            >
              <tspan className="font-semibold">{dim.label}</tspan>
              {hasCritique && (
                <tspan dx="2" fill="var(--theme-accent)" className="font-mono text-[9px] font-bold">
                  {scoreVal}
                </tspan>
              )}
            </text>
          );
        })}
      </svg>

      {/* 诚实底栏指示器 */}
      <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between text-[9px] text-theme-muted font-bold font-mono">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "w-1.5 h-1.5 rounded-full animate-pulse",
            hasCritique ? "bg-emerald-400" : "bg-theme-muted"
          )} />
          <span>{hasCritique ? "诊断雷达已载入" : "待审计 / 未评分"}</span>
        </div>
        {!hasCritique && (
          <span className="text-theme-accent hover:underline cursor-pointer">
            前往质量打分 →
          </span>
        )}
      </div>
    </div>
  );
}
```

### 2.4 物理移除老旧 CSS 雷达
删除 `WritingSurface.tsx:535-562` 及其底部 `@keyframes` 定义中的 `radar-pulse` 和 `radar-scan`。
在相同位置直接挂载 `<NovelDiagnosticRadar scores={scores} hasCritique={hasCritique} />`。

---

## 3. 战役 2：定战略 · 关系图谱全局实装与联动

### 3.1 待修改文件
* [`/src/components/WorldBibleView.tsx`](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WorldBibleView.tsx)

### 3.2 物理步骤
1. **添加顶级 Tab 项**：
   In `WorldBibleView.tsx:592` 的 `const tabs = [...]` 数组中，插入 `graph` 一级选项卡：
   ```typescript
   { id: 'graph', icon: GitBranch, label: '关系图谱' }
   ```
   同时，从 `'lucide-react'` 中导入 `GitBranch`。

2. **实装 `graph` 面板渲染**：
   在 `Content Area` 的渲染分支中插入逻辑，如果 `activeTab === 'graph'`，则直接渲染 `<RelationshipGraph>` 组件，传入完整的物理设定数据：
   ```tsx
   {activeTab === 'graph' && (
     <div className="h-full flex flex-col min-h-[550px] bg-theme-bg/10 border border-theme-border/40 rounded-2xl p-4 shadow-inner relative">
       <RelationshipGraph
         relationships={relationships}
         characters={characters}
         locations={locations}
         items={items}
         factions={factions}
         onSelectEntity={(type, id) => {
           // 战视图自适应联动：双击/点击节点时切换到对应的实体大类 Tab，方便快速维护
           if (type === 'character') setActiveTab('characters');
           else if (type === 'location') setActiveTab('locations');
           else if (type === 'item') setActiveTab('items');
           else if (type === 'faction') setActiveTab('factions');
         }}
       />
     </div>
   )}
   ```

---

## 4. 战役 3：退卡片 · 卡片广场隐藏，内化为编辑器插槽机制

### 4.1 待修改文件
* [`/src/components/Sidebar.tsx`](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/Sidebar.tsx)
* [`/src/components/ProjectCockpitView.tsx`](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/ProjectCockpitView.tsx)

### 4.2 物理步骤
1. **隐藏 Sidebar 图标**：
   在 `Sidebar.tsx:53-57` 移除 `exploreItems` 里的 `skills`：
   ```typescript
   // 修改前
   const exploreItems: NavItem[] = [
     { id: 'factory', label: '拆书工厂', icon: BookTemplate },
     { id: 'skills', label: '能力商店', icon: Wand2 },
     { id: 'continuation-import', label: '资料续写', icon: Upload },
   ];

   // 修改后 (彻底物理下架“能力商店”独立货架页面)
   const exploreItems: NavItem[] = [
     { id: 'factory', label: '拆书工厂', icon: BookTemplate },
     { id: 'continuation-import', label: '资料续写', icon: Upload },
   ];
   ```

2. **纠偏驾驶舱推荐链路**：
   在 `ProjectCockpitView.tsx:243` 中，将推荐的行动项由 `'skills'` 改为 `'editor'`，直接带用户进入编辑器：
   ```typescript
   // 修改前
   onClick: () => onNavigate('skills')

   // 修改后
   onClick: () => onNavigate('editor')
   ```

---

## 5. 战役 4：Shadcn UI 排排坐 · gap 容器清洗与色彩质感

### 5.1 待修改文件 & 重构标准
* **标准 1：拒绝 `space-y-*`**
  全局（特别是 `AIAssistant.tsx`、`AgentWorkspace.tsx`、`WritingSurface.tsx`、`WorldBibleView.tsx`）将残留的 Tailwind `space-y-*` 规则物理改写为：
  - 如果是 `flex` 容器：增加 `gap-y-*`。
  - 如果原本缺少 `flex` 声明：物理追加 `flex flex-col gap-y-*`。
* **标准 2：品牌中性色微调**
  在 `RelationshipGraph.tsx` 等绘图组件中，将写死的灰色 `#94a3b8` 修改为品牌变量色 `var(--theme-muted)` 或者是 `rgba(var(--theme-text-rgb), 0.45)`，确保夜间模式下的发光穿透度与和谐性。

---

## 6. 验证方案 & CI 安全闸口

由于本图纸在重构时涉及到了多处静态类型定义和渲染层代码：
1. **静态类型检查 (Compile Safety)**:
   ```bash
   npm run typecheck
   ```
2. **代码规范检查 (Style & Lint)**:
   ```bash
   npm run lint
   ```
3. **单元集成测试 (Integration suite)**:
   ```bash
   npm run test
   ```
   并且必须跑通 `tests/components.test.tsx` (前端组件挂载验证)，确保雷达渲染和关系图谱在测试运行时里完美通过。
