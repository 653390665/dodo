import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../logger';
import crypto from 'crypto';
import { DEFAULT_PROMPT_TEMPLATES, mergePromptTemplates, type PromptTemplates } from '../../shared/config/prompt-templates';
import type { PromptTemplateKey } from '../../shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.inkflow');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Machine-derived key for API key encryption at rest.
// Not as secure as OS keychain, but prevents casual inspection.
function deriveKey(): Buffer {
  const seed = `${os.hostname()}:${os.userInfo().username}:inkflow-v1`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptApiKey(plain: string): string {
  if (!plain) return '';
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptApiKey(encoded: string): string {
  if (!encoded) return '';
  if (!encoded.startsWith('enc:')) return encoded; // legacy plaintext — migrate on next save
  const parts = encoded.split(':');
  if (parts.length !== 4) return '';
  const key = deriveKey();
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  promptTemplates: PromptTemplates;
}

const defaults: AppConfig = {
  apiKey: process.env.API_KEY || '',
  baseUrl: process.env.API_BASE_URL || 'https://generativelanguage.googleapis.com',
  model: process.env.API_MODEL || 'gemini-2.5-pro',
  promptTemplates: DEFAULT_PROMPT_TEMPLATES,
};

const LEGACY_BUILTIN_PROMPTS: Partial<Record<PromptTemplateKey, string[]>> = {
  inspirationSystem: [
    '你是一个资深小说编辑和文学创作助手。你的回答应该具有文学性、逻辑性，并能激发作者的灵感。',
  ],
  storyCards: [
    `你是一个资深网文策划编辑。请根据用户的灵感种子和上下文，生成 3 张差异明确、可继续写的故事方案卡。

【灵感种子】
{{ideaSeed}}

【对话上下文】
{{chatContext}}

请严格输出 JSON：
{
  "cards": [
    {
      "id": "card-1",
      "hook": "一句话卖点",
      "protagonist": "主角设定摘要",
      "coreConflict": "核心冲突",
      "tone": "故事气质 / 文风",
      "whyItWorks": "为什么值得写",
      "starterSeeds": {
        "worldSeed": "世界观或背景种子",
        "relationshipSeed": "关键关系种子",
        "chapterOneSeed": "第一章起点种子"
      },
      "riskNote": "最容易写崩的点",
      "mixTags": ["标签1", "标签2"],
      "signals": {
        "tone": "grim | bright | lyrical | sharp",
        "conflictType": "冲突类型短语",
        "worldWeight": 0.7,
        "characterWeight": 0.6,
        "pacingPreference": "tight | balanced | slow-burn"
      }
    }
  ]
}

要求：
1. 三张卡必须方向不同，不能只是换同义词。
2. 不要输出正文片段，不要写成大段散文。
3. 每张卡都必须能直接映射到设定记忆页。`,
  ],
  editorAgent: [
    `{{PLANNER_SOUL}}

【当前任务】
请利用以下小说的信息记忆库，根据用户的创作意图，拆解出这一章的场景分镜（Scene Beats）。
包含3-5个场景，每个场景说明出场人物、核心冲突、道具运用和情绪转折。务必严格遵循全局大纲、人物设定和世界观，绝不偏离主线轨迹。

{{contextStr}}

【用户本章创作意图】
{{userIntent}}`,
  ],
};

function normalizePromptTemplate(text: string | undefined): string {
  return (text || '').replace(/\r\n/g, '\n').trim();
}

export function migrateLegacyPromptTemplates(partial?: Partial<PromptTemplates>): Partial<PromptTemplates> | undefined {
  if (!partial) return partial;

  const next = { ...partial };
  for (const key of Object.keys(LEGACY_BUILTIN_PROMPTS) as PromptTemplateKey[]) {
    const currentValue = partial[key];
    if (!currentValue) continue;

    const legacyCandidates = LEGACY_BUILTIN_PROMPTS[key] || [];
    const isLegacyBuiltin = legacyCandidates.some(
      (candidate) => normalizePromptTemplate(candidate) === normalizePromptTemplate(currentValue),
    );

    if (isLegacyBuiltin) {
      next[key] = DEFAULT_PROMPT_TEMPLATES[key];
    }
  }

  return next;
}

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

let lastConfigError: string | null = null;

export function getLastConfigError(): string | null {
  return lastConfigError;
}

export function loadConfig(): AppConfig {
  ensureDir();
  lastConfigError = null;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      // Decrypt API key at load time
      if (parsed.apiKey) {
        parsed.apiKey = decryptApiKey(parsed.apiKey);
      }
      const migratedPromptTemplates = migrateLegacyPromptTemplates(parsed.promptTemplates);
      return {
        ...defaults,
        ...parsed,
        promptTemplates: mergePromptTemplates(migratedPromptTemplates),
      };
    }
  } catch (e) {
    lastConfigError = e instanceof Error ? e.message : String(e);
    logger.error('Config file corrupt, using defaults', lastConfigError);
  }
  return { ...defaults };
}

export function saveConfig(config: AppConfig): void {
  ensureDir();
  const safeConfig = {
    ...config,
    apiKey: encryptApiKey(config.apiKey),
    promptTemplates: mergePromptTemplates(config.promptTemplates),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

export function reloadConfig(): AppConfig {
  cached = null;
  return getConfig();
}
