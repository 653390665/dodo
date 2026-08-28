import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestWorkspace {
  readonly directory: string;
  path(name: string): string;
  cleanup(): void;
}

export interface EnvSnapshotEntry {
  readonly existed: boolean;
  readonly value: string | undefined;
}

export type EnvSnapshot = Record<string, EnvSnapshotEntry>;

export function createTestWorkspace(prefix: string): TestWorkspace {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `inkflow-${prefix}-`));
  return {
    directory,
    path(name: string): string {
      return path.join(directory, name);
    },
    cleanup(): void {
      fs.rmSync(directory, { force: true, recursive: true });
    },
  };
}

export function captureEnv(keys: readonly string[]): EnvSnapshot {
  return Object.fromEntries(keys.map((key) => [
    key,
    {
      existed: Object.prototype.hasOwnProperty.call(process.env, key),
      value: process.env[key],
    },
  ]));
}

export function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, entry] of Object.entries(snapshot)) {
    if (entry.existed && entry.value !== undefined) {
      process.env[key] = entry.value;
    } else {
      delete process.env[key];
    }
  }
}
