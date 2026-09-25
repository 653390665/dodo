// Test-only environment seam.
//
// `server/lib/config.ts` snapshots `process.env` into `const defaults` at module
// load time (server/lib/config.ts:82-88), and reloadConfig() only re-runs
// loadConfig() on top of that frozen object. ESM evaluates side-effect imports
// in declaration order, so any test module that statically imports a server
// module (which transitively imports config) must import this file FIRST —
// otherwise the process is stuck with the built-in Google default
// (`https://generativelanguage.googleapis.com`, empty key) and every provider
// call fails with `ProviderError: configuration` before reaching fetch.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.API_KEY = 'semantic-recall-key';
process.env.API_BASE_URL = 'http://semantic-recall.local/v1';
