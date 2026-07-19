import React, { useState } from 'react';
import { Save } from 'lucide-react';

/**
 * GlobalSetupTab 组件的属性接口定义
 */
interface GlobalSetupTabProps {
  /** 初始故事大纲（自父组件/小说数据传入） */
  initialGlobalOutline: string;
  /** 初始世界观法则 */
  initialWorldRules: string;
  /** 当前父组件是否正在执行保存操作的 Loading 状态 */
  isSaving: boolean;
  /** 点击保存按钮时的回调函数，将最新输入的大纲与法则回传父组件 */
  onSave: (outline: string, rules: string) => Promise<void>;
}

/**
 * GlobalSetupTab 子组件
 * 用于解耦世界设定 Tab 页面的大文本输入状态，防止高频打字触发整个 WorldBibleView 重渲染。
 */
export function GlobalSetupTab({
  initialGlobalOutline,
  initialWorldRules,
  isSaving,
  onSave,
}: GlobalSetupTabProps) {
  // 1. 在子组件本地维护输入框的状态，打字时仅触发子组件局部渲染
  const [globalOutline, setGlobalOutline] = useState(initialGlobalOutline);
  const [worldRules, setWorldRules] = useState(initialWorldRules);

  // 2. 存储历史的传入属性以便在渲染时同步
  const [prevInitialGlobalOutline, setPrevInitialGlobalOutline] = useState(initialGlobalOutline);
  const [prevInitialWorldRules, setPrevInitialWorldRules] = useState(initialWorldRules);

  // 3. 在渲染时无 Effect 级联损耗地进行重置同步（React 官方推荐的高级性能优化模式，完美规避 set-state-in-effect 警告）
  if (initialGlobalOutline !== prevInitialGlobalOutline) {
    setGlobalOutline(initialGlobalOutline);
    setPrevInitialGlobalOutline(initialGlobalOutline);
  }

  if (initialWorldRules !== prevInitialWorldRules) {
    setWorldRules(initialWorldRules);
    setPrevInitialWorldRules(initialWorldRules);
  }

  return (
    <div key="global" className="max-w-4xl mx-auto space-y-8">
      {/* 故事大纲编辑区域 */}
      <div className="bg-theme-sidebar rounded-2xl p-6 shadow-sm border border-theme-border/50">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-theme-text">故事大纲 (Global Outline)</h2>
          {/* 保存按钮：调用父组件传入的保存回调，统一执行落盘 */}
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

      {/* 世界观法则编辑区域 */}
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
