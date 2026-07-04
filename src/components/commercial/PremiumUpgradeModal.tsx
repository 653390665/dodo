import React, { useState, useEffect } from 'react';
import { Crown, Sparkles, X, ShieldAlert, CheckCircle, Zap } from 'lucide-react';
import { getNovel, updateNovel } from '../../lib/novel-client';
import type { ProjectPreferenceProfile } from '../../../shared/types';

/**
 * 额度类型映射，转换为高颜值的中文标签与核心参数
 * Mapping of quota limit types to premium Chinese labels
 */
const LIMIT_META = {
  extractSkill: {
    title: '拆书萃取与能力沉淀',
    desc: '从海量名著文本中解构黄金叙事卡牌，沉淀为您自己的墨水流技能书。',
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
 * 极简高端 Premium 升舱弹窗组件
 * Impeccable high-premium glassmorphism upgrade modal.
 * Built using OKLCH colors, backdrop blur, elegant responsive structure, and zero elastic motion curves.
 */
export function PremiumUpgradeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [limitType, setLimitType] = useState<'extractSkill' | 'generateProse' | 'advancedAudit'>('extractSkill');
  const [count, setCount] = useState(0);
  const [max, setMax] = useState(5);
  const [errorMsg, setErrorMsg] = useState('');
  const [novelId, setNovelId] = useState<string | null>(null);

  const [isUpgrading, setIsUpgrading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    // 注册全局事件监听，用于无缝唤起升舱引导
    // Reg event listeners to wake up premium modal with detail payload
    const handleTrigger = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail || {};
      if (detail.limitType) {
        setLimitType(detail.limitType);
      }
      setCount(detail.count ?? 0);
      setMax(detail.max ?? 5);
      setErrorMsg(detail.error || '');
      setNovelId(detail.novelId || null);
      
      // 重置升级状态
      setIsSuccess(false);
      setIsUpgrading(false);
      setIsOpen(true);
    };

    window.addEventListener('trigger-premium-modal', handleTrigger);
    return () => {
      window.removeEventListener('trigger-premium-modal', handleTrigger);
    };
  }, []);

  // 弹窗关闭处理器
  const handleClose = () => {
    if (isUpgrading) return; // 升级中禁止中途关闭，保证写入事务安全
    setIsOpen(false);
  };

  // 立即升级核心动作
  // Executes instant SQLite persistence and triggers premium glow transition
  const handleUpgrade = async () => {
    if (!novelId) {
      // 若无关联小说，则执行纯前端演示模式
      setIsUpgrading(true);
      setTimeout(() => {
        setIsSuccess(true);
        setIsUpgrading(false);
      }, 1000);
      return;
    }

    setIsUpgrading(true);
    try {
      // 1. 获取已有小说配置，防范无意覆盖
      // Retrieve original project preference to prevent overriding other fields
      const novel = await getNovel(novelId);
      const existingProfile = (novel?.projectPreferenceProfile || {}) as ProjectPreferenceProfile;

      // 2. 更新 SQLite，升级 commercialMode 为 paid
      // Zero Migration upgrade: lock commercialMode to paid
      await updateNovel(novelId, {
        projectPreferenceProfile: {
          ...existingProfile,
          commercialMode: 'paid',
        },
      });

      // 3. 展现成功激活界面
      setIsSuccess(true);
    } catch (err) {
      alert('激活 Premium 失败，请检查数据库连接后重试：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsUpgrading(false);
    }
  };

  if (!isOpen) return null;

  const meta = LIMIT_META[limitType] || LIMIT_META.extractSkill;
  const MetaIcon = meta.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-md animate-fade-in">
      {/* 磨砂毛玻璃卡片容器 (OKLCH 霓虹流光与超薄柔和外边框) */}
      <div 
        className="relative w-full max-w-2xl rounded-[2rem] border border-white/10 bg-zinc-900/90 p-8 shadow-[0_0_50px_rgba(118,75,255,0.15)] text-zinc-100 flex flex-col overflow-hidden max-h-[calc(100vh-2rem)]"
        style={{
          boxShadow: '0 0 80px -10px oklch(65% 0.25 280 / 0.15), 0 0 40px -20px oklch(70% 0.3 340 / 0.1)',
        }}
      >
        {/* 关闭按钮 (在未进行升级事务时可用) */}
        {!isUpgrading && (
          <button
            onClick={handleClose}
            className="absolute right-6 top-6 p-2 rounded-full border border-white/5 bg-white/5 text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-all cursor-pointer"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        )}

        {/* 状态1：超限引导与功能对比表 */}
        {!isSuccess ? (
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
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-bold tracking-wider">配额超限</span>
                  <span className="text-xs text-zinc-400">免费体验版限制</span>
                </div>
                <h3 className="text-lg font-bold text-zinc-100 font-serif leading-tight">
                  {meta.title} 免费配额已用尽
                </h3>
                <p className="text-xs text-zinc-400">
                  当前累计消耗额度：<span className="text-amber-400 font-bold">{count}</span> / {max} 次
                </p>
              </div>
            </div>

            {/* 个性化额度超限说明文案 */}
            {errorMsg && (
              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
                <ShieldAlert size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/90 leading-relaxed font-sans">
                  {errorMsg}
                </p>
              </div>
            )}

            {/* 核心权益对比表 (Free vs Premium) */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                InkFlow 付费权益对比
              </div>
              <div className="rounded-2xl border border-white/5 overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-white/5 text-zinc-300 border-b border-white/5 font-bold">
                      <th className="p-3.5 pl-4">模块与特权能力</th>
                      <th className="p-3.5 text-zinc-400">InkFlow 免费版</th>
                      <th className="p-3.5" style={{ color: 'oklch(70% 0.3 340)' }}>Premium 尊享版</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">拆书卡与萃取引擎</td>
                      <td className="p-3.5 text-zinc-400">基础 5 次 / 限 A 级卡</td>
                      <td className="p-3.5 font-bold text-zinc-100">无限次 / 全量解锁 S 级卡</td>
                    </tr>
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">智能审稿质量护栏</td>
                      <td className="p-3.5 text-zinc-400">限 5 次 / 单章 1k 字</td>
                      <td className="p-3.5 font-bold text-zinc-100">无限次 / 支持超长诊断</td>
                    </tr>
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">4000字正文连续写作</td>
                      <td className="p-3.5 text-zinc-400">限 10 次 / 基础参数</td>
                      <td className="p-3.5 font-bold text-zinc-100">无限次 / 支持多维精修</td>
                    </tr>
                    <tr className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 pl-4 font-medium text-zinc-200">灵感世界观构建</td>
                      <td className="p-3.5 text-zinc-400">常规通道容易拥堵</td>
                      <td className="p-3.5 font-bold text-zinc-100">高并发极速专属 VIP 专线</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 底部升舱激活区 */}
            <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-[11px] text-zinc-400 text-center sm:text-left leading-relaxed max-w-sm">
                点击下方按钮即可模拟发起升舱交易。系统会自动重写 SQLite 中的商业授权，解锁无尽写作潜能。
              </div>
              <button
                onClick={handleUpgrade}
                disabled={isUpgrading}
                className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap px-8 py-3.5 rounded-xl font-bold transition-all relative overflow-hidden group cursor-pointer"
                style={{
                  background: 'linear-gradient(135deg, oklch(65% 0.25 280), oklch(70% 0.3 340))',
                  color: '#fff',
                  boxShadow: '0 4px 20px -2px oklch(65% 0.25 280 / 0.5)',
                }}
              >
                <Crown size={16} className="group-hover:rotate-12 transition-transform duration-300" />
                {isUpgrading ? '正在重写授权协议...' : '立即升舱 Premium'}
              </button>
            </div>

          </div>
        ) : (
          /* 状态2：升级成功微动画 */
          <div className="flex-1 flex flex-col items-center justify-center py-10 space-y-6 text-center animate-scale-up">
            <div 
              className="p-5 rounded-full"
              style={{
                background: 'linear-gradient(135deg, oklch(65% 0.25 280 / 0.1), oklch(70% 0.3 340 / 0.1))',
                border: '2px solid oklch(70% 0.3 340)',
              }}
            >
              <CheckCircle size={48} className="text-emerald-400 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold font-serif bg-clip-text text-transparent bg-gradient-to-r from-[oklch(65%_0.25_280)] to-[oklch(70%_0.3_340)]">
                恭喜！InkFlow Premium 权限已激活
              </h2>
              <p className="text-sm text-zinc-300 max-w-md mx-auto leading-relaxed">
                全量总编诊断权限、无限制拆书卡装配、无限次 4000 字正文写作特权已注入当前小说数据库。请点下方按钮重新载入，开启创作新纪元！
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-10 py-3.5 rounded-xl font-bold transition-all hover:scale-105 cursor-pointer text-sm"
              style={{
                background: 'linear-gradient(135deg, oklch(65% 0.25 280), oklch(70% 0.3 340))',
                color: '#fff',
                boxShadow: '0 4px 20px oklch(65% 0.25 280 / 0.4)',
              }}
            >
              立即开启体验
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
