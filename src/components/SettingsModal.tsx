import React, { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Monitor, Moon, RotateCcw, Save, Sparkles, Sun, X, Database, Download, Upload, AlertTriangle, ShieldCheck, Activity, Wifi, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_TEMPLATE_DEFINITIONS,
  type PromptTemplateKey,
  type PromptTemplates,
} from '../../shared/config/prompt-templates';
import { downloadDbBackup } from '../lib/download-client';
import { flushPendingEditorWrites } from '../lib/editor-write-queue';

export function SettingsModal({ isOpen, onClose, theme, onThemeChange }: { isOpen: boolean, onClose: () => void, theme?: string, onThemeChange?: (t: 'light' | 'dark' | 'system') => void }) {
  const isGlobalPremium = useAppStore(state => state.isGlobalPremium);
  const activateGlobalPremium = useAppStore(state => state.activateGlobalPremium);
  const deactivateGlobalPremium = useAppStore(state => state.deactivateGlobalPremium);

  const [activationInput, setActivationInput] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);

  const [config, setConfig] = useState({
    apiKey: '',
    baseUrl: '',
    model: '',
    promptGuardLevel: 'strict' as 'strict' | 'balanced' | 'disabled',
    promptTemplates: DEFAULT_PROMPT_TEMPLATES as PromptTemplates,
  });
  const [baselineConfig, setBaselineConfig] = useState({
    apiKey: '',
    baseUrl: '',
    model: '',
    promptGuardLevel: 'strict' as 'strict' | 'balanced' | 'disabled',
    promptTemplates: DEFAULT_PROMPT_TEMPLATES as PromptTemplates,
  });
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<PromptTemplateKey>('editorAgent');
  const [isTesting, setIsTesting] = useState(false);
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<null | { success: boolean; message: string }>(null);
  const [promptPreview, setPromptPreview] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'quick' | 'promptLab' | 'dataManage' | 'activation'>('quick');

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportData = async () => {
    try {
      await downloadDbBackup();
    } catch (err) {
      alert(`❌ 导出备份失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleImportDataClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const confirmRestore = window.confirm("⚠️ 警告：导入旧数据会完全覆盖当前系统的所有小说、设定和章节，且无法撤销。系统在覆盖前会自动为您创建一份安全灾难备份。您确定要执行覆盖恢复吗？");
    if (!confirmRestore) {
      e.target.value = '';
      return;
    }
    setSaving(true);
    try {
      await flushPendingEditorWrites();
      const response = await fetch('/api/db/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || '恢复数据失败');
      alert("🎉 数据恢复成功！页面即将自动刷新加载最新数据。");
      window.location.reload();
    } catch (err) {
      alert(`❌ 恢复数据失败，当前数据库未被替换: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
        .then(r => r.json())
        .then(data => {
          const nextConfig = {
            apiKey: '',
            baseUrl: data.baseUrl || '',
            model: data.model || '',
            promptGuardLevel: data.promptGuardLevel || 'strict',
            promptTemplates: {
              ...DEFAULT_PROMPT_TEMPLATES,
              ...(data.promptTemplates || {}),
            }
          };
          setConfig(nextConfig);
          setBaselineConfig(nextConfig);
          setHasExistingKey(!!data.hasApiKey);
          setSaveMessage('');
          setSaveError(null);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state on template change
    setTestOutput('');
    setTestError(null);
    setPromptPreview('');
  }, [selectedTemplateKey]);

  // Focus trap and Escape key handler for dialog a11y
  useEffect(() => {
    if (!isOpen) return;
    const previouslyActive = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusableElements = document.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]'
        );
        const modalElement = document.getElementById('settings-dialog-container');
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

    // Auto focus first interactive element with a small timeout to ensure DOM is ready
    const focusTimer = setTimeout(() => {
      const modalElement = document.getElementById('settings-dialog-container');
      if (modalElement) {
        const firstInput = modalElement.querySelector('input, select, textarea, button') as HTMLElement;
        if (firstInput) firstInput.focus();
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(focusTimer);
      if (previouslyActive && typeof previouslyActive.focus === 'function') {
        previouslyActive.focus();
      }
    };
  }, [isOpen, onClose]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (window.inkflow?.saveConfig) {
        const res = await window.inkflow.saveConfig(config);
        if (!res.success) {
          throw new Error(res.error || '保存配置失败');
        }
      } else {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
          throw new Error(data.error || '保存配置失败');
        }
      }
      setBaselineConfig(config);
      setSaveMessage('已写入本地配置，后续 AI 请求会直接读取这套模板。');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefault = () => {
    setConfig({
      ...config,
      promptTemplates: {
        ...config.promptTemplates,
        [selectedTemplateKey]: DEFAULT_PROMPT_TEMPLATES[selectedTemplateKey],
      },
    });
    setTestOutput('');
    setTestError(null);
  };

  const handleTestTemplate = async () => {
    setIsTesting(true);
    setTestError(null);
    setTestOutput('');
    setPromptPreview('');
    try {
      const response = await fetch('/api/prompt-template-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: selectedTemplateKey,
          template: config.promptTemplates[selectedTemplateKey],
        }),
      });
      const data = await response.json();
      setPromptPreview(data.promptPreview || '');
      if (!response.ok || data.error) {
        throw new Error(data.error || '模板试跑失败');
      }
      setTestOutput(data.text || '');
    } catch (error) {
      setTestError(error instanceof Error ? error.message : '模板试跑失败');
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const response = await fetch('/api/config/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        throw new Error(data.error || '测试连接失败');
      }
      setConnectionTestResult({
        success: true,
        message: data.message || '模型连接成功！',
      });
    } catch (error) {
      setConnectionTestResult({
        success: false,
        message: error instanceof Error ? error.message : '连接错误，请检查网络或配置。',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  if (!isOpen) return null;

  const selectedTemplate = PROMPT_TEMPLATE_DEFINITIONS.find((item) => item.key === selectedTemplateKey)!;
  const selectedTemplateText = config.promptTemplates[selectedTemplateKey];
  const missingVariables = selectedTemplate.variables.filter(
    (variable) => !selectedTemplateText.includes(`{{${variable}}}`),
  );
  const isModifiedFromDefault = selectedTemplateText !== DEFAULT_PROMPT_TEMPLATES[selectedTemplateKey];
  const hasUnsavedChanges = JSON.stringify(config) !== JSON.stringify(baselineConfig);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-6">
      <div
        id="settings-dialog-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className={`relative my-4 flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-3xl border border-theme-border bg-paper p-6 shadow-2xl transition-all duration-300 ${
          settingsTab === 'quick' || settingsTab === 'dataManage' || settingsTab === 'activation' ? 'max-w-xl' : 'max-w-6xl'
        }`}
      >
        <div className="flex justify-between items-center mb-6 relative z-10">
          <div className="space-y-1">
            <h2 id="settings-dialog-title" className="text-2xl font-serif text-theme-text">模型与提示词设置</h2>
            <p className="text-sm text-theme-muted">
              默认只处理模型接入；提示词实验室适合需要精修 AI 行为时再进入。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="p-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/50 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as 'quick' | 'promptLab' | 'dataManage' | 'activation')} className="flex flex-col flex-1 overflow-hidden relative z-10 min-h-0">
          <TabsList className="mb-5 self-start w-full max-w-lg shrink-0">
            <TabsTrigger value="quick" className="flex-1">快速模型设置</TabsTrigger>
            <TabsTrigger value="activation" className="flex-1">激活超级权限</TabsTrigger>
            <TabsTrigger value="promptLab" className="flex-1">提示词实验室</TabsTrigger>
            <TabsTrigger value="dataManage" className="flex-1">数据备份与管理</TabsTrigger>
          </TabsList>

          <TabsContent value="quick" className="m-0 outline-none focus:outline-none flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 relative pr-2 h-full overflow-y-auto">
              <div className="max-w-xl space-y-4 pb-4">
                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/50 p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-theme-text">快速模型配置</div>
                    <p className="text-[11px] text-theme-muted leading-relaxed">
                      配置兼容 OpenAI 接口规范的大模型 API。普通用户只需要完成这里。
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">API Key</label>
                    <div className="relative">
                      <input
                        type="password"
                        value={config.apiKey}
                        onChange={e => {
                          setConfig({...config, apiKey: e.target.value});
                          setConnectionTestResult(null);
                        }}
                        className="w-full px-3 py-2 bg-theme-bg border border-theme-border rounded-lg text-sm text-theme-text outline-none focus:border-theme-accent transition-colors font-mono"
                        placeholder={hasExistingKey ? '已配置；留空保留，输入新 Key 替换' : 'sk-...'}
                      />
                      {hasExistingKey && !config.apiKey && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-600 font-medium pointer-events-none">
                          已配置
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">Base URL</label>
                    <input
                      type="text"
                      value={config.baseUrl}
                      onChange={e => {
                        setConfig({...config, baseUrl: e.target.value});
                        setConnectionTestResult(null);
                      }}
                      className="w-full px-3 py-2 bg-theme-bg border border-theme-border rounded-lg text-sm text-theme-text outline-none focus:border-theme-accent transition-colors font-mono"
                      placeholder="https://api.deepseek.com"
                    />
                    <p className="text-[10px] text-theme-muted mt-1">兼容 OpenAI 接口规范的 API 地址，如 https://api.deepseek.com</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">Model</label>
                    <input
                      type="text"
                      value={config.model}
                      onChange={e => {
                        setConfig({...config, model: e.target.value});
                        setConnectionTestResult(null);
                      }}
                      className="w-full px-3 py-2 bg-theme-bg border border-theme-border rounded-lg text-sm text-theme-text outline-none focus:border-theme-accent transition-colors"
                      placeholder="deepseek-chat"
                    />
                    <p className="text-[10px] text-theme-muted mt-1">模型名称，如 deepseek-chat、gpt-4o、gemini-2.5-pro</p>
                  </div>

                  {/* 去 AI 味提示词质量守卫级别 (Prompt Guard Level) */}
                  <div className="pt-3 border-t border-theme-border/30">
                    <label className="block text-xs font-bold text-theme-text mb-2 uppercase tracking-wider">
                      去 AI 味提示词质量守卫级别
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, promptGuardLevel: 'strict' })}
                        className={`p-3 rounded-xl border text-left flex flex-col justify-between h-24 transition-all cursor-pointer ${
                          config.promptGuardLevel === 'strict'
                            ? 'bg-emerald-500/[0.04] border-emerald-500/50 text-theme-text'
                            : 'bg-theme-bg border-theme-border hover:border-theme-accent/40 text-theme-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-bold">严格纠错 🟢</span>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${
                            config.promptGuardLevel === 'strict' ? 'border-emerald-500 bg-emerald-500' : 'border-theme-border'
                          }`}>
                            {config.promptGuardLevel === 'strict' && <div className="w-1 h-1 rounded-full bg-white" />}
                          </div>
                        </div>
                        <span className="text-[10px] leading-relaxed">
                          完整质量守卫 + 自适应二次静默重试。效果极其精修。
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, promptGuardLevel: 'balanced' })}
                        className={`p-3 rounded-xl border text-left flex flex-col justify-between h-24 transition-all cursor-pointer ${
                          config.promptGuardLevel === 'balanced'
                            ? 'bg-amber-500/[0.04] border-amber-500/50 text-theme-text'
                            : 'bg-theme-bg border-theme-border hover:border-theme-accent/40 text-theme-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-bold">前置注入 🟡</span>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${
                            config.promptGuardLevel === 'balanced' ? 'border-amber-500 bg-amber-500' : 'border-theme-border'
                          }`}>
                            {config.promptGuardLevel === 'balanced' && <div className="w-1 h-1 rounded-full bg-white" />}
                          </div>
                        </div>
                        <span className="text-[10px] leading-relaxed">
                          仅注入前置规约规则，关闭评分纠错。最节省 API 额度。
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, promptGuardLevel: 'disabled' })}
                        className={`p-3 rounded-xl border text-left flex flex-col justify-between h-24 transition-all cursor-pointer ${
                          config.promptGuardLevel === 'disabled'
                            ? 'bg-theme-border/20 border-theme-text/40 text-theme-text'
                            : 'bg-theme-bg border-theme-border hover:border-theme-accent/40 text-theme-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-bold">关闭守卫 ⚪</span>
                          <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${
                            config.promptGuardLevel === 'disabled' ? 'border-theme-text/50 bg-theme-text/50' : 'border-theme-border'
                          }`}>
                            {config.promptGuardLevel === 'disabled' && <div className="w-1 h-1 rounded-full bg-white" />}
                          </div>
                        </div>
                        <span className="text-[10px] leading-relaxed">
                          不做任何质量干预，直接原味生成。速度极快无延迟。
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 分割线与测试连接 */}
                  <div className="pt-4 border-t border-theme-border/50 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-theme-muted">在保存前测试配置的连通性：</span>
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={isTestingConnection}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-border hover:border-theme-accent/40 hover:bg-theme-border/20 text-xs font-medium text-theme-text cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isTestingConnection ? (
                          <Activity size={12} className="animate-pulse" />
                        ) : (
                          <Wifi size={12} />
                        )}
                        {isTestingConnection ? '测试中...' : '测试连接'}
                      </button>
                    </div>

                    {/* Loading 状态反馈 */}
                    {isTestingConnection && (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-theme-border bg-theme-sidebar/35 text-[11px] text-theme-muted animate-pulse">
                        <Activity size={14} className="text-theme-accent animate-spin shrink-0" />
                        <span>📡 正在与大语言模型建立连接并发送握手请求，请稍候...</span>
                      </div>
                    )}

                    {/* 自适应结果横幅 */}
                    {connectionTestResult && (
                      <div
                        className={`flex items-start gap-2 px-3 py-3 rounded-xl border text-[11px] leading-relaxed transition-all ${
                          connectionTestResult.success
                            ? 'bg-emerald-500/[0.04] border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                            : 'bg-red-500/[0.04] border-red-500/20 text-red-600 dark:text-red-400'
                        }`}
                      >
                        {connectionTestResult.success ? (
                          <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <div className="font-bold mb-0.5">
                            {connectionTestResult.success ? '✅ 链接测试成功！' : '❌ 链接测试失败'}
                          </div>
                          <div className="break-all whitespace-pre-wrap">{connectionTestResult.message}</div>
                          {!connectionTestResult.success && (
                            <div className="mt-1 text-[10px] text-theme-muted leading-normal">
                              💡 排查建议：请检查 API Key 是否正确、Base URL 格式是否正确、本地代理连接是否正常，或该模型名在此 API 服务商中是否可用。
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>



                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/35 p-5 space-y-3">
                  <div className="text-sm font-bold text-theme-text">生效验证链</div>
                  <div className="space-y-2 text-[11px] text-theme-muted leading-relaxed">
                    <div><span className="font-bold text-theme-text">1.</span> 填写 API Key、Base URL 和模型名。</div>
                    <div><span className="font-bold text-theme-text">2.</span> 点“保存配置”后写入本地配置，并同步到当前服务端内存。</div>
                    <div><span className="font-bold text-theme-text">3.</span> 后续灵感、拆书、分镜、正文生成、审计都会使用这套模型配置。</div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="activation" className="m-0 outline-none focus:outline-none flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 relative pr-2 h-full overflow-y-auto">
              <div className="max-w-xl space-y-4 pb-4">
                {/* 内测专属高级全权限激活码模块 */}
                <div className={`rounded-2xl border p-5 space-y-4 transition-all duration-300 relative overflow-hidden ${
                  isGlobalPremium
                    ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-yellow-500/5 shadow-inner'
                    : 'border-theme-border bg-theme-sidebar/50'
                }`}>
                  {/* 背景金色微光修饰 */}
                  {isGlobalPremium && (
                    <div className="absolute -right-12 -top-12 w-24 h-24 bg-yellow-500/10 blur-2xl rounded-full" />
                  )}

                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-xl ${isGlobalPremium ? 'bg-amber-500/15 text-amber-600' : 'bg-theme-border/60 text-theme-muted'}`}>
                      <Sparkles size={16} className={isGlobalPremium ? 'animate-pulse' : ''} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-theme-text flex items-center gap-1.5">
                        <span>内测专属全权限激活</span>
                        {isGlobalPremium && (
                          <span className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded-full font-serif scale-90 font-medium">
                            Premium Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-theme-muted mt-0.5">
                        输入内测码一键免密解锁全部高级付费卡牌与爆款节奏包特权。
                      </p>
                    </div>
                  </div>

                  {!isGlobalPremium ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={activationInput}
                          onChange={(e) => {
                            setActivationInput(e.target.value);
                            setActivationError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const res = activateGlobalPremium(activationInput);
                              if (!res.success) {
                                setActivationError(res.error || '无效的激活码');
                              }
                            }
                          }}
                          placeholder="输入内测激活码"
                          className="flex-1 px-3 py-2 bg-theme-bg border border-theme-border rounded-lg text-xs text-theme-text outline-none focus:border-theme-accent transition-colors font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const res = activateGlobalPremium(activationInput);
                            if (!res.success) {
                              setActivationError(res.error || '无效的激活码');
                            }
                          }}
                          className="px-4 py-2 bg-theme-accent text-theme-bg text-xs font-bold rounded-lg hover:bg-theme-accent/90 transition-colors cursor-pointer"
                        >
                          立即激活
                        </button>
                      </div>
                      {activationError && (
                        <p className="text-[10px] text-red-600 font-medium">{activationError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-xl bg-amber-500/[0.06] border border-amber-500/20 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-400">
                        ✨ <strong>恭喜！全权限超级体验模式已成功激活！</strong> 
                        <div className="text-[11px] text-amber-700/80 dark:text-amber-500/80 mt-1">
                          系统已全面解除所有高级卡组、精品题材大纲和受限流程包的付费锁，后续所有 AI 创作功能已对您 100% 畅通无阻开放。
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-theme-muted">授权状态：永久有效（内测专享）</span>
                        <button
                          type="button"
                          onClick={() => {
                            deactivateGlobalPremium();
                            setActivationInput('');
                          }}
                          className="text-[10px] text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
                        >
                          撤销超级权限（重置为免费受限版）
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="promptLab" className="m-0 outline-none focus:outline-none flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 relative pr-2 h-full overflow-y-auto">
              <div className="rounded-2xl border border-theme-border bg-theme-sidebar/40 p-4 space-y-4 min-w-0 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-theme-text">提示词实验室</h3>
                    <p className="text-[11px] text-theme-muted mt-1 leading-relaxed max-w-2xl">
                      高级区域。这里会影响核心写作链路：灵感、拆书、分镜、正文生成、AI 审计与全局大纲。模板变量统一使用 <code>{'{{变量名}}'}</code>。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                      hasUnsavedChanges
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}>
                      {hasUnsavedChanges ? '存在未保存修改' : '当前修改已保存'}
                    </span>
                    {isModifiedFromDefault && (
                      <span className="px-2 py-1 rounded-full border border-theme-border bg-theme-sidebar text-[10px] text-theme-muted font-bold">
                        当前模板已偏离默认值
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4 min-h-[420px]">
                  <div className="rounded-2xl border border-theme-border bg-theme-sidebar/25 p-3 space-y-2 max-h-[580px] overflow-y-auto">
                    <div className="px-1">
                      <div className="text-xs font-bold text-theme-text">模板目录</div>
                      <div className="text-[10px] text-theme-muted mt-1">先选链路，再编辑右侧正文。</div>
                    </div>
                    {PROMPT_TEMPLATE_DEFINITIONS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setSelectedTemplateKey(item.key)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors cursor-pointer ${
                          selectedTemplateKey === item.key
                            ? 'border-theme-accent bg-theme-accent/5 text-theme-accent'
                            : 'border-theme-border bg-theme-bg text-theme-text hover:bg-theme-sidebar/30'
                        }`}
                      >
                        <div className="text-xs font-bold">{item.label}</div>
                        <div className="text-[10px] mt-1 text-theme-muted leading-relaxed">{item.description}</div>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3 min-w-0">
                    <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-theme-text">{selectedTemplate.label}</div>
                          <p className="text-[11px] text-theme-muted mt-1 leading-relaxed">{selectedTemplate.description}</p>
                        </div>
                        <div className="text-[10px] text-theme-muted leading-relaxed rounded-xl border border-theme-border bg-theme-sidebar/30 px-3 py-2">
                          会影响：
                          <div className="font-bold text-theme-text mt-1">{selectedTemplate.label} 对应的 AI 请求链路</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-3">
                        <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-3">
                          <div className="text-[11px] font-bold text-theme-text mb-2">变量与风险</div>
                          <div className="flex flex-wrap gap-2">
                            {selectedTemplate.variables.map((variable) => (
                              <span
                                key={variable}
                                className="px-2 py-1 rounded-full border border-theme-border bg-theme-bg text-[10px] text-theme-muted font-mono"
                              >
                                {`{{${variable}}}`}
                              </span>
                            ))}
                            {selectedTemplate.variables.length === 0 && (
                              <span className="text-[10px] text-theme-muted">这个模板没有必填变量。</span>
                            )}
                          </div>
                          {missingVariables.length > 0 && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-700 leading-relaxed">
                              缺少关键变量：
                              <span className="font-mono"> {missingVariables.map((item) => `{{${item}}}`).join('、')}</span>
                              。删掉它们后，这条链路会丢上下文。
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-3 text-[11px] text-theme-muted leading-relaxed">
                          <div className="font-bold text-theme-text mb-2">调试建议</div>
                          <div>1. 先改语气、步骤和约束，再决定要不要动结构段落。</div>
                          <div className="mt-1">2. 尽量保留变量占位符，否则你改的是“断链”不是“优化”。</div>
                          <div className="mt-1">3. 先试跑，再保存；试跑看即时输出，保存决定后续真实请求使用哪套模板。</div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] font-bold text-theme-text">模板正文</div>
                          <button
                            type="button"
                            onClick={handleRestoreDefault}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-theme-border text-xs font-bold text-theme-text hover:bg-theme-sidebar/40 transition-colors cursor-pointer"
                          >
                            <RotateCcw size={14} />
                            恢复默认
                          </button>
                        </div>
                        <textarea
                          value={selectedTemplateText}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              promptTemplates: {
                                ...config.promptTemplates,
                                [selectedTemplateKey]: event.target.value,
                              },
                            })
                          }
                          className="w-full min-h-[360px] rounded-2xl border border-theme-border px-4 py-3 text-xs bg-theme-sidebar resize-y outline-none focus:border-theme-accent transition-colors font-mono leading-6"
                        />
                      </div>
                    </div>

                      <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-bold text-theme-text">验证区</div>
                            <div className="text-[11px] text-theme-muted mt-1">试跑会直接使用当前编辑内容；保存后，后续真实 AI 请求才会统一使用这套模板。</div>
                          </div>
                          <button
                            type="button"
                            onClick={handleTestTemplate}
                            disabled={isTesting}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-text text-theme-bg text-xs font-bold hover:bg-theme-text/90 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Sparkles size={14} />
                            {isTesting ? '试跑中...' : '试跑当前模板'}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-2 min-h-[180px]">
                            <div className="text-xs font-bold text-theme-text">模板试跑输出</div>
                            {testError ? (
                              <div className="text-[11px] text-red-600 leading-relaxed">{testError}</div>
                            ) : testOutput ? (
                              <pre className="whitespace-pre-wrap text-[11px] leading-6 text-theme-text font-mono max-h-64 overflow-y-auto">
                                {testOutput}
                              </pre>
                            ) : (
                              <div className="text-[11px] text-theme-muted leading-relaxed">还没有试跑结果。先点一次“试跑当前模板”，看当前内容会如何影响输出。</div>
                            )}
                          </div>

                          <div className="rounded-2xl border border-theme-border bg-theme-sidebar/30 p-4 space-y-2 min-h-[180px]">
                            <div className="text-xs font-bold text-theme-text">送模前预览</div>
                            <div className="text-[11px] text-theme-muted leading-relaxed">
                              这里展示变量渲染后的最终提示词样本，便于检查结构、占位符和上下文拼接。
                            </div>
                            <pre className="whitespace-pre-wrap text-[11px] leading-6 text-theme-text font-mono max-h-64 overflow-y-auto">
                              {promptPreview || '尚未生成预览'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
            </div>
          </TabsContent>

          <TabsContent value="dataManage" className="m-0 outline-none focus:outline-none flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 relative pr-2 h-full overflow-y-auto">
              <div className="max-w-xl space-y-4 pb-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImportFileChange}
                  accept=".db"
                  className="hidden"
                />

                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/50 p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl">
                      <ShieldCheck size={20} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-theme-text">数据安全保障</div>
                      <p className="text-[11px] text-theme-muted leading-relaxed">
                        您的所有小说草稿、设定、大纲等均存储在本地。建议定期导出备份。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {/* 一键导出备份 */}
                  <div className="rounded-2xl border border-theme-border bg-theme-sidebar/35 p-5 space-y-4 hover:border-theme-accent/30 transition-all duration-300">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-theme-text flex items-center gap-2">
                        <Database size={16} className="text-theme-accent" />
                        一键备份导出
                      </div>
                      <p className="text-[11px] text-theme-muted leading-relaxed">
                        将当前的数据库完整导出为 <code>inkflow-data.db</code> 文件，妥善保存可随时用于数据恢复。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportData}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-theme-border bg-theme-bg hover:bg-theme-sidebar/50 text-xs font-bold text-theme-text hover:border-theme-accent transition-all cursor-pointer"
                    >
                      <Download size={14} />
                      立即导出备份数据
                    </button>
                  </div>

                  {/* 导入数据恢复 */}
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4 hover:border-amber-500/40 transition-all duration-300">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-amber-700 dark:text-amber-500 flex items-center gap-2">
                        <AlertTriangle size={16} />
                        导入数据恢复
                      </div>
                      <p className="text-[11px] text-amber-600/85 dark:text-amber-400/85 leading-relaxed">
                        ⚠️ <strong>极其危险</strong>：导入数据会完全<strong>覆盖并替换</strong>当前系统的所有数据且无法撤销！
                        系统会在执行覆盖前自动为您创建一份 <code>.pre-import-bak</code> 灾难备份。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleImportDataClick}
                      disabled={saving}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                    >
                      <Upload size={14} />
                      {saving ? '正在导入中...' : '选择备份文件并覆盖导入'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <div className="mt-6 border-t border-theme-border/70 pt-4 relative z-10 space-y-3 shrink-0">
          {/* Status Message / Info Row */}
          <div className="text-[11px]">
            {saveError ? (
              <span className="text-red-600 font-medium">{saveError}</span>
            ) : saveMessage ? (
              <span className="text-emerald-700 font-medium">{saveMessage}</span>
            ) : (
              <span className="text-theme-muted hidden sm:inline">保存后会立即写入本地配置，并被后续 AI 请求读取。</span>
            )}
          </div>

          {/* Action Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {onThemeChange ? (
              <div className="relative flex items-center bg-theme-sidebar/40 border border-theme-border/60 rounded-full p-[2px] h-8 select-none shrink-0">
                <div
                  className="absolute top-[2px] bottom-[2px] left-[2px] rounded-full bg-theme-accent shadow-sm transition-all duration-300 ease-out"
                  style={{
                    width: 'calc((100% - 4px) / 3)',
                    transform: `translate3d(${
                      theme === 'light' ? '0%' : theme === 'dark' ? '100%' : '200%'
                    }, 0, 0)`,
                  }}
                />
                {[
                  { value: 'light' as const, label: '亮色', icon: Sun },
                  { value: 'dark' as const, label: '暗色', icon: Moon },
                  { value: 'system' as const, label: '系统', icon: Monitor },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const isActive = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onThemeChange(opt.value)}
                      className={`relative z-10 flex items-center justify-center gap-1 px-3 h-full rounded-full text-[11px] font-bold transition-colors duration-200 cursor-pointer ${
                        isActive ? 'text-theme-bg' : 'text-theme-muted hover:text-theme-text'
                      }`}
                      style={{ width: '64px' }}
                    >
                      <Icon size={12} />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3 ml-auto">
              <button onClick={onClose} className="shrink-0 px-4 py-2 text-sm text-theme-muted hover:text-theme-accent">关闭</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex shrink-0 items-center justify-center gap-2 whitespace-nowrap px-6 py-2 bg-theme-accent text-theme-bg rounded-lg shadow hover:bg-theme-accent/90 transition-colors font-medium disabled:opacity-50"
              >
                <Save size={16} /> {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
