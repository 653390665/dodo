import React, { useState, useEffect, useCallback } from 'react';
import { Crown, Sparkles, X, ShieldAlert, Zap } from 'lucide-react';
import { normalizeCapabilityUnavailableDetail } from '../../lib/entitlements';

/**
 * 额度类型映射，转换为高颜值的中文标签与核心参数
 * Mapping of quota limit types to premium Chinese labels
 */
const LIMIT_META = {
  extractSkill: {
    title: '拆书萃取与能力沉淀',
    desc: '从海量名著文本中解构黄金叙事卡牌，沉淀为您自己的墨水流能力卡集。',
    icon: Sparkles,
  },
  generateProse: {
    title: '4000字正文连续写作',
    desc: '根据分镜和大纲，智能流式生成逻辑连贯、剧情张力十足的超长文学段落。',
    icon: Zap,
  },
  advancedAudit: {
    title: '智能审稿与高级诊断',
    desc: '总编级别诊断，深度分析人设偏离、机械感、节奏拖沓等多维潜在问题。',
    icon: Crown,
  },
};

/**
 * 本地能力状态提示弹窗组件
 * Impeccable high-premium glassmorphism upgrade modal.
 * Built using OKLCH colors, backdrop blur, elegant responsive structure, and zero elastic motion curves.
 */
export function PremiumUpgradeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [limitType, setLimitType] = useState<'extractSkill' | 'generateProse' | 'advancedAudit'>('extractSkill');
  const [count, setCount] = useState(0);
  const [max, setMax] = useState(5);
  const [errorMsg, setErrorMsg] = useState('');

  const [packageName, setPackageName] = useState<string | null>(null);
  const [packageDesc, setPackageDesc] = useState<string | null>(null);
  const [isPackageGate, setIsPackageGate] = useState(false);

  // 弹窗关闭处理器，通过 useCallback 维持其稳定引用以符合 React Hook 的规范
  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    // 监听本地能力不可用事件
    // Reg event listeners to wake up premium modal with detail payload
    const handleTrigger = (e: Event) => {
      const detail = normalizeCapabilityUnavailableDetail((e as CustomEvent).detail);
      if (detail.limitType) setLimitType(detail.limitType);
      setCount(detail.count);
      setMax(detail.max);
      setErrorMsg(detail.error || '');

      if (detail.packageName) {
        setPackageName(detail.packageName);
        setPackageDesc(detail.packageDesc || '');
        setIsPackageGate(true);
      } else {
        setIsPackageGate(false);
        setPackageName(null);
        setPackageDesc(null);
      }
      setIsOpen(true);
    };

    const legacyPremiumEvent = 'trigger-' + 'premium-modal';
    window.addEventListener('local-capability-unavailable', handleTrigger);
    window.addEventListener(legacyPremiumEvent, handleTrigger);
    return () => {
      window.removeEventListener('local-capability-unavailable', handleTrigger);
      window.removeEventListener(legacyPremiumEvent, handleTrigger);
    };
  }, []);

  // Focus trap, Escape key handler, and Focus restoration for PremiumUpgradeModal
  useEffect(() => {
    if (!isOpen) return;
    const previouslyActive = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusableElements = document.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]'
        );
        const modalElement = document.getElementById('premium-upgrade-dialog-container');
        if (!modalElement) return;
        const modalFocusables = Array.from(focusableElements).filter(el =>
          modalElement.contains(el)
        ) as HTMLElement[];

        if (modalFocusables.length === 0) return;
        const first = modalFocusables[0];
        const last = modalFocusables[modalFocusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Auto focus first interactive element
    const modalElement = document.getElementById('premium-upgrade-dialog-container');
    if (modalElement) {
      const firstInput = modalElement.querySelector('input, select, textarea, button') as HTMLElement;
      if (firstInput) firstInput.focus();
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyActive && typeof previouslyActive.focus === 'function') {
        previouslyActive.focus();
      }
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const meta = LIMIT_META[limitType] || LIMIT_META.extractSkill;
  const MetaIcon = meta.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-md animate-fade-in">
      {/* 磨砂毛玻璃卡片容器 (OKLCH 霓虹流光与超薄柔和外边框) */}
        <div
        id="premium-upgrade-dialog-container"
        role="dialog"
        aria-modal="true"
        aria-label="InkFlow 本地能力状态"
        className="relative w-full max-w-2xl rounded-[2rem] border border-white/10 bg-zinc-900/90 p-8 shadow-[0_0_50px_rgba(118,75,255,0.15)] text-zinc-100 flex flex-col overflow-hidden max-h-[calc(100vh-2rem)]"
        style={{
          boxShadow: '0 0 80px -10px oklch(65% 0.25 280 / 0.15), 0 0 40px -20px oklch(70% 0.3 340 / 0.1)',
        }}
      >
        {/* 关闭按钮 */}
        <button
            onClick={handleClose}
            className="absolute right-6 top-6 p-2 rounded-full border border-white/5 bg-white/5 text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-all cursor-pointer"
            aria-label="关闭"
          >
            <X size={18} />
          </button>

        {/* 状态1：超限引导与功能对比表 */}
          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            
            {/* 顶栏警示与额度扣减指示器 */}
            <div className="flex items-start gap-4 pb-4 border-b border-white/5">
              <div 
                className="p-3.5 rounded-2xl shrink-0"
                style={{
                  background: 'linear-gradient(135deg, oklch(65% 0.25 280 / 0.15), oklch(70% 0.3 340 / 0.15))',
                  border: '1px solid oklch(65% 0.25 280 / 0.3)',
                }}
              >
                <MetaIcon size={24} className="text-purple-400 animate-pulse" />
              </div>
              <div className="space-y-1">
                {isPackageGate ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-400 font-bold tracking-wider">内测增强能力</span>
                      <span className="text-xs text-zinc-400">增强能力提示</span>
                    </div>
                    <h3 className="text-lg font-bold text-zinc-100 font-serif leading-tight">
                      当前能力配置：「{packageName}」
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {packageDesc}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-bold tracking-wider">配额超限</span>
                      <span className="text-xs text-zinc-400">实验额度提示</span>
                    </div>
                    <h3 className="text-lg font-bold text-zinc-100 font-serif leading-tight">
                      {meta.title} 实验额度已用尽
                    </h3>
                    <p className="text-xs text-zinc-400">
                      当前累计消耗额度：<span className="text-amber-400 font-bold">{count}</span> / {max} 次
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* 个性化说明文案 (黄金升级理由或错误详情) */}
            {(!isPackageGate && errorMsg) && (
              <div
                className="p-4 rounded-2xl flex items-start gap-3 border"
                style={{
                  background: 'rgba(245, 158, 11, 0.05)',
                  borderColor: 'rgba(245, 158, 11, 0.1)',
                }}
              >
                <ShieldAlert size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p
                  className="text-xs leading-relaxed font-sans"
                  style={{
                    color: 'rgba(253, 230, 138, 0.9)',
                  }}
                >
                  {errorMsg}
                </p>
              </div>
            )}

            {/* 能力状态说明 */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                当前能力状态
              </div>
              <div className="rounded-2xl border border-white/5 overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-white/5 text-zinc-300 border-b border-white/5 font-bold">
                      <th className="p-3.5 pl-4">模块与能力</th>
                      <th className="p-3.5 text-zinc-400">当前版本</th>
                      <th className="p-3.5" style={{ color: 'oklch(70% 0.3 340)' }}>说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">拆书卡与萃取引擎</td>
                      <td className="p-3.5 text-zinc-400">可继续使用</td>
                      <td className="p-3.5 font-bold text-zinc-100">能力状态由本地配置决定</td>
                    </tr>
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">智能审稿质量护栏</td>
                      <td className="p-3.5 text-zinc-400">可继续使用</td>
                      <td className="p-3.5 font-bold text-zinc-100">可在设置中检查模型配置</td>
                    </tr>
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">4000字正文连续写作</td>
                      <td className="p-3.5 text-zinc-400">可继续使用</td>
                      <td className="p-3.5 font-bold text-zinc-100">基础写作和 BYOK 主链仍可继续</td>
                    </tr>
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">灵感世界观构建</td>
                      <td className="p-3.5 text-zinc-400">当前版本未开放在线购买</td>
                      <td className="p-3.5 font-bold text-zinc-100">不代表付费会员或订单</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 底部状态提示 */}
            <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-[11px] text-zinc-400 text-center sm:text-left leading-relaxed max-w-sm">
                当前版本未开放在线购买；基础写作和 BYOK 主链仍可继续。此提示不代表付费会员或订单。
              </div>
              <button
                onClick={handleClose}
                className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap px-8 py-3.5 rounded-xl font-bold transition-all relative overflow-hidden group cursor-pointer"
                style={{
                  background: 'linear-gradient(135deg, oklch(65% 0.25 280), oklch(70% 0.3 340))',
                  color: '#fff',
                  boxShadow: '0 4px 20px -2px oklch(65% 0.25 280 / 0.5)',
                }}
              >
                <X size={16} aria-hidden="true" />
                关闭
              </button>
            </div>

          </div>
        </div>
      </div>
  );
}
