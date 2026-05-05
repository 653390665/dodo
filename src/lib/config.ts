import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.inkflow');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const defaults: AppConfig = {
  apiKey: process.env.API_KEY || '',
  baseUrl: process.env.API_BASE_URL || 'https://generativelanguage.googleapis.com',
  model: process.env.API_MODEL || 'gemini-2.5-pro',
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): AppConfig {
  ensureDir();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch { /* ignore corrupt config */ }
  return { ...defaults };
}

export function saveConfig(config: AppConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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
