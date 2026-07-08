# Plan 023: API Key Encryption
> Commit: ca53899 | Status: TODO | Category: security | Priority: P1

## Why
LLM provider API keys are written unencrypted to `~/.inkflow/config.json`. Any process can read them.

## Changes
- `src/lib/config.ts`: use Electron's `safeStorage.encryptString()` in production, base64 fallback in dev
- `server.ts`: decrypt key on startup
- Add `keytar` or `safeStorage` dependency as needed

## Steps
1. Add `safeStorage` encrypt/decrypt wrapper in config.ts
2. Migrate existing plaintext keys on first run
3. Verify: key not readable in `cat ~/.inkflow/config.json`

## Done: API key encrypted at rest
