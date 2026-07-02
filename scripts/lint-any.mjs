import fs from 'fs';
import path from 'path';

const dirsToScan = ['src', 'server', 'shared'];
const ignorePatterns = [
  /node_modules/,
  /dist/,
  /dist-electron/,
  /\.git/,
  /\.test\.ts$/,
  /db-crud\.ts/, // Ignored generic framework wrappers
];

let totalAnyCount = 0;
const details = [];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (ignorePatterns.some((pattern) => pattern.test(fullPath))) {
      continue;
    }
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Match explicit any as type or assertion
      // 1. : any
      // 2. <any>
      // 3. as any
      // 4. (x: any)
      const matches = content.match(/\bany\b/g) || [];
      if (matches.length > 0) {
        const count = matches.length;
        totalAnyCount += count;
        details.push({
          file: path.relative(process.cwd(), fullPath),
          count,
        });
      }
    }
  }
}

for (const dir of dirsToScan) {
  if (fs.existsSync(dir)) {
    scanDir(dir);
  }
}

console.log('=== InkFlow Type Safety Debt (Explicit any count) ===');
details.sort((a, b) => b.count - a.count);
for (const detail of details) {
  console.log(`- ${detail.file}: ${detail.count} occurrences`);
}
console.log('----------------------------------------------------');
console.log(`Total explicit 'any' count: ${totalAnyCount}`);

const MAX_ANY_LIMIT = 55;
if (totalAnyCount > MAX_ANY_LIMIT) {
  console.error(`\n❌ Type safety audit failed! Total 'any' count (${totalAnyCount}) exceeds maximum allowed limit (${MAX_ANY_LIMIT}).`);
  process.exit(1);
} else {
  console.log(`\n✅ Type safety audit passed! (${totalAnyCount}/${MAX_ANY_LIMIT} allowed)`);
}
