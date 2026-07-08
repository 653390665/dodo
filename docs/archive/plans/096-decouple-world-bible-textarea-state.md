# 096: 解耦世界观大文本输入状态

## 1. 目标描述 (Goal Description)
当前在小说“世界设定” (World Bible) 的“世界设定”标签页中，故事大纲 (`globalOutline`) 与世界观法则 (`worldRules`) 都是巨大的文本输入区域 (textarea)。原本的设计把这两个值作为状态直接绑定在顶层大组件 `WorldBibleView` 中：
```typescript
  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [worldRules, setWorldRules] = useState(novel.worldRules || '');
```
这会导致用户在 textarea 中打字的每次 `onChange` 触发，都会导致庞大的 `WorldBibleView` 组件及其下级所有 Tab 列表进行全面重新渲染 (re-render)。

本任务旨在把这两个大文本框受控状态收拢解耦到一个轻量级的子组件 `GlobalSetupTab` 中。从而将打字时的渲染范围局限在子组件内部，实现输入性能的根本提升（实现亚毫秒级无延迟输入），并在必要场景（Novel 切换、导入成功、点击保存）中与父组件完成数据同步。

## 2. 性能与解耦架构方案 (Performance & Decoupling Architecture)

### 2.1 渲染范围解耦对比
```
【重构前：每次打字重渲染全部 Tab 及父组件】
用户打字 ──> WorldBibleView (Re-render) ──> CharactersTab, LocationsTab, ItemsTab, etc. (全部重新计算与渲染)

【重构后：每次打字渲染仅局限在子组件内部】
用户打字 ──> GlobalSetupTab (仅本子组件 Re-render)  [对父组件及其他 Tab 零干扰]
```

### 2.2 数据同步与触发时机
1. **外部数据重置 (Top-down)**: 当父级传入的 `novel` 改变、或者文件上传解析成功导入新设定后，父组件的 `globalOutline/worldRules` 改变。子组件通过 `useEffect` 侦听这些变化，自动重置其本地 state 以保持一致。
2. **保存时同步 (Bottom-up)**: 用户点击“保存全局设定”按钮时，触发 `onSave(localOutline, localRules)`，在父组件中统一发起后端 `updateNovel`，随后更新父级的 state，保证生平生成 (`handleGenerateBio`) 等其余链路可拿到最新落盘的数据。

## 3. 具体修改设计 (Proposed Changes)

### 3.1 新建世界设定局部状态子组件
#### [NEW] [src/components/world-bible/GlobalSetupTab.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/world-bible/GlobalSetupTab.tsx)
```typescript
import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

interface GlobalSetupTabProps {
  initialGlobalOutline: string;
  initialWorldRules: string;
  isSaving: boolean;
  onSave: (outline: string, rules: string) => Promise<void>;
}

export function GlobalSetupTab({
  initialGlobalOutline,
  initialWorldRules,
  isSaving,
  onSave,
}: GlobalSetupTabProps) {
  const [globalOutline, setGlobalOutline] = useState(initialGlobalOutline);
  const [worldRules, setWorldRules] = useState(initialWorldRules);

  // 1. novel 切换或外部数据导入重置时，同步最新 props
  useEffect(() => {
    setGlobalOutline(initialGlobalOutline);
  }, [initialGlobalOutline]);

  useEffect(() => {
    setWorldRules(initialWorldRules);
  }, [initialWorldRules]);

  return (
    <div key="global" className="max-w-4xl mx-auto space-y-8">
      <div className="bg-theme-sidebar rounded-2xl p-6 shadow-sm border border-theme-border/50">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-theme-text">故事大纲 (Global Outline)</h2>
          <button
            onClick={() => onSave(globalOutline, worldRules)}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-theme-accent text-white rounded-lg text-sm transition-all hover:bg-theme-accent/90 shadow-sm"
          >
            {isSaving ? '保存中...' : <><Save size={16}/>保存全局设定</>}
          </button>
        </div>
        <textarea
          value={globalOutline}
          onChange={e => setGlobalOutline(e.target.value)}
          placeholder="描述小说的起承转合、主线任务、结局走向..."
          className="w-full h-64 p-4 rounded-xl border border-theme-border/50 focus:border-theme-accent outline-none font-serif resize-none"
        />
      </div>

      <div className="bg-theme-sidebar rounded-2xl p-6 shadow-sm border border-theme-border/50">
        <h2 className="text-lg font-bold text-theme-text mb-4">世界观法则 (World Rules)</h2>
        <textarea
          value={worldRules}
          onChange={e => setWorldRules(e.target.value)}
          placeholder="例如：修仙体系境界、魔法运转原理、科技文明等级..."
          className="w-full h-48 p-4 rounded-xl border border-theme-border/50 focus:border-theme-accent outline-none font-serif resize-none"
        />
      </div>
    </div>
  );
}
```

### 3.2 重构父组件
#### [MODIFY] [src/components/WorldBibleView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WorldBibleView.tsx)
- 导入新的子组件：
  ```typescript
  import { GlobalSetupTab } from './world-bible/GlobalSetupTab';
  ```
- 引入保存全局设定中转处理函数（保证保存后，父组件的 globalOutline/worldRules 属性也能立即更新同步，防范 `handleGenerateBio` 等使用了父级 state 的场景）：
  ```typescript
  const handleSaveGlobalInfo = async (outline: string, rules: string) => {
    setIsSaving(true);
    await updateNovel(novel.id, { globalOutline: outline, worldRules: rules });
    setGlobalOutline(outline);
    setWorldRules(rules);
    setIsSaving(false);
  };
  ```
- 替换 `activeTab === 'global'` 对应的渲染块：
  ```typescript
  {activeTab === 'global' && (
    <GlobalSetupTab
      initialGlobalOutline={globalOutline}
      initialWorldRules={worldRules}
      isSaving={isSaving}
      onSave={handleSaveGlobalInfo}
    />
  )}
  ```

## 4. 验证设计 (Verification Plan)

### 4.1 自动静态类型分析与测试
- 运行 `npm run typecheck`，验证重构后组件的 props 传参、局部变量及导入完全正确。
- 运行 `npm run test`，验证对 `updateNovel` 或原有大纲字段相关的数据库、API 测试无任何破坏。

### 4.2 手动功能核对清单
- **大纲输入体验**: 确认在“世界设定” Tab 打字没有迟钝感。
- **保存功能**: 点击“保存全局设定”按钮后，按钮展示“保存中...”，保存完毕后恢复，控制台/数据库中可查到该 Novel 的最新 `globalOutline` 与 `worldRules` 已被持久化。
- **角色生平联动**: 在世界设定中打字修改大纲，**保存设定**，再生成角色生平，能看到新生成的内容中引用了修改后的大纲，证明父子同步顺畅。
- **Novel 切换同步**: 切换不同的 Novel，确认子组件中显示的大纲与法则是新 Novel 对应的初始值，证明 `useEffect` 重置完全正确。
- **大纲导入重置**: 导入一个大纲和角色文档，解析成功后，确认页面中的“故事大纲”和“世界观法则”被立即重置为导入提取出的文本。
