import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [keys, setKeys] = useState({
    gemini: '',
    openai: '',
    deepseek: '',
    anthropic: ''
  });

  useEffect(() => {
    if (isOpen) {
      setKeys({
        gemini: localStorage.getItem('api_key_gemini') || '',
        openai: localStorage.getItem('api_key_openai') || '',
        deepseek: localStorage.getItem('api_key_deepseek') || '',
        anthropic: localStorage.getItem('api_key_anthropic') || ''
      });
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('api_key_gemini', keys.gemini);
    localStorage.setItem('api_key_openai', keys.openai);
    localStorage.setItem('api_key_deepseek', keys.deepseek);
    localStorage.setItem('api_key_anthropic', keys.anthropic);
    onClose();
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
          <p className="text-xs text-theme-muted italic mb-4">填写您的自有大模型 API Key（留空则默认使用系统自带 Gemini 服务）。</p>
          
          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">Gemini API Key</label>
            <input type="password" value={keys.gemini} onChange={e => setKeys({...keys, gemini: e.target.value})} className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors" placeholder="AI Studio 默认集成，此项可选"/>
          </div>
          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">DeepSeek API Key</label>
            <input type="password" value={keys.deepseek} onChange={e => setKeys({...keys, deepseek: e.target.value})} className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors" placeholder="sk-..."/>
          </div>
          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">OpenAI API Key</label>
            <input type="password" value={keys.openai} onChange={e => setKeys({...keys, openai: e.target.value})} className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors" placeholder="sk-..."/>
          </div>
          <div>
            <label className="block text-xs font-bold text-theme-text mb-1 uppercase tracking-wider">Anthropic API Key</label>
            <input type="password" value={keys.anthropic} onChange={e => setKeys({...keys, anthropic: e.target.value})} className="w-full px-3 py-2 bg-white border border-theme-border rounded-lg text-sm outline-none focus:border-theme-accent transition-colors" placeholder="sk-ant-..."/>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3 relative z-10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-theme-muted hover:text-theme-accent">取消</button>
          <button onClick={handleSave} className="flex items-center gap-2 px-6 py-2 bg-theme-accent text-white rounded-lg shadow hover:bg-theme-accent/90 transition-all font-medium">
            <Save size={16} /> 保存配置
          </button>
        </div>
      </motion.div>
    </div>
  );
}
