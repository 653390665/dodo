import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [config, setConfig] = useState({
    apiKey: '',
    baseUrl: '',
    model: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
        .then(r => r.json())
        .then(data => setConfig({
          apiKey: data.apiKey || '',
          baseUrl: data.baseUrl || '',
          model: data.model || ''
        }))
        .catch(() => {});
    }
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      onClose();
    } catch (e) {
      console.error('Save config failed', e);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-paper border border-theme-border rounded-3xl shadow-2xl p-6 relative overflow-hidden"
      >
        <div className="flex justify-between items-center mb-6 relative z-10">
          <h2 className="text-2xl font-serif text-theme-text">模型设置</h2>
          <button onClick={onClose} className="p-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/50 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 relative z-10">
          <p className="text-xs text-theme-muted mb-4 leading-relaxed">
            配置兼容 OpenAI 接口规范的大模型 API，支持任意厂商（DeepSeek、OpenAI、Gemini 等）。
          </p>

          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={e => setConfig({...config, apiKey: e.target.value})}
              className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors font-mono"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={e => setConfig({...config, baseUrl: e.target.value})}
              className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors font-mono"
              placeholder="https://api.deepseek.com"
            />
            <p className="text-[10px] text-theme-muted mt-1">兼容 OpenAI 接口规范的 API 地址，如 https://api.deepseek.com</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">Model</label>
            <input
              type="text"
              value={config.model}
              onChange={e => setConfig({...config, model: e.target.value})}
              className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors"
              placeholder="deepseek-chat"
            />
            <p className="text-[10px] text-theme-muted mt-1">模型名称，如 deepseek-chat、gpt-4o、gemini-2.5-pro</p>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3 relative z-10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-theme-muted hover:text-theme-accent">取消</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-theme-accent text-white rounded-lg shadow hover:bg-theme-accent/90 transition-all font-medium disabled:opacity-50"
          >
            <Save size={16} /> {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
