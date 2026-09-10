import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Locks the drift between the hand-written import allowlists
// (server/lib/db-import.ts, previously inline in server/routes/db.ts) and the
// schema that server/lib/db-init.ts actually creates. When this test fails,
// sync the db.ts import lists or db-init — do not silence it.
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-schema-consistency-'));
const schemaDbPath = path.join(testDir, 'schema-consistency.test.db');

type IndexListRow = { name: string; unique: number; origin: string; partial: number };
type IndexXinfoRow = { name: string | null; desc: number; coll: string; key: number };
type ForeignKeyRow = {
  table: string;
  from: string;
  to: string | null;
  on_delete: string;
  on_update: string;
  match: string;
};

/** Mirrors normalizeIndexPredicate in server/lib/db-import.ts. */
function normalizeIndexPredicate(sql: string | null): string | null {
  if (!sql) return null;
  const match = sql.match(/\bWHERE\s+(.+)$/i);
  return match?.[1].replace(/\s+/g, ' ').trim().replace(/"/g, "'").toLowerCase() || null;
}

function foreignKeySignature(foreignKey: ForeignKeyRow): string {
  return [
    foreignKey.from,
    foreignKey.table,
    foreignKey.to,
    foreignKey.on_delete.toUpperCase(),
    foreignKey.on_update.toUpperCase(),
    foreignKey.match.toUpperCase(),
  ].join('\u0000');
}

test('import allowlists match the schema db-init actually creates', async (t) => {
  const { initDb, openReadOnlyDb } = await import('../server/lib/db-init');
  const { ALLOWED_IMPORT_INDEXES, ALLOWED_IMPORT_TABLES, EXPECTED_IMPORT_FOREIGN_KEYS } = await import('../server/lib/db-import');
  const { closeDb } = await import('../server/lib/db-instance');

  initDb(schemaDbPath);
  t.after(() => closeDb());

  const candidate = openReadOnlyDb(schemaDbPath);
  t.after(() => candidate.close());

  const syncMessage = '导入清单与 db-init 实际 schema 漂移：请同步 server/lib/db-import.ts（原 db.ts）的导入清单或 server/lib/db-init.ts 的 schema 定义。';

  // --- Indexes: set equality + per-index definition equality ---
  const actualIndexRows = candidate.prepare(`
    SELECT name, tbl_name AS tableName, sql
    FROM sqlite_master
    WHERE type = 'index' AND sql IS NOT NULL
  `).all() as Array<{ name: string; tableName: string; sql: string }>;

  const actualIndexNames = new Set(actualIndexRows.map((row) => row.name));
  const allowlistedIndexNames = new Set(ALLOWED_IMPORT_INDEXES.keys());

  const missingFromAllowlist = [...actualIndexNames].filter((name) => !allowlistedIndexNames.has(name));
  assert.deepEqual(
    missingFromAllowlist,
    [],
    `db-init 创建了导入清单未登记的索引: ${missingFromAllowlist.join(', ')}。${syncMessage}`,
  );
  const missingFromSchema = [...allowlistedIndexNames].filter((name) => !actualIndexNames.has(name));
  assert.deepEqual(
    missingFromSchema,
    [],
    `导入清单登记了 db-init 不再创建的索引: ${missingFromSchema.join(', ')}。${syncMessage}`,
  );

  for (const row of actualIndexRows) {
    const expectedIndex = ALLOWED_IMPORT_INDEXES.get(row.name);
    assert.ok(expectedIndex, `导入清单缺少索引定义: ${row.name}。${syncMessage}`);
    assert.equal(
      row.tableName,
      expectedIndex.tableName,
      `索引 ${row.name} 的所属表不一致（实际 ${row.tableName}，清单 ${expectedIndex.tableName}）。${syncMessage}`,
    );

    const indexDefinition = (candidate.pragma(`index_list(${expectedIndex.tableName})`) as IndexListRow[])
      .find((index) => index.name === row.name);
    assert.ok(indexDefinition, `实际库中找不到索引 ${row.name}（表 ${expectedIndex.tableName}）。${syncMessage}`);
    assert.equal(
      indexDefinition.unique === 1,
      Boolean(expectedIndex.unique),
      `索引 ${row.name} 的 UNIQUE 属性与导入清单不一致。${syncMessage}`,
    );

    const indexedColumns = (candidate.pragma(`index_xinfo(${row.name})`) as IndexXinfoRow[])
      .filter((column) => column.key === 1)
      .map((column) => column.name);
    assert.deepEqual(
      indexedColumns,
      expectedIndex.columns,
      `索引 ${row.name} 的列与导入清单不一致。${syncMessage}`,
    );

    assert.equal(
      normalizeIndexPredicate(row.sql),
      expectedIndex.predicate ? expectedIndex.predicate.toLowerCase() : null,
      `索引 ${row.name} 的 partial WHERE 谓词与导入清单不一致。${syncMessage}`,
    );
  }

  // --- Foreign keys: mirror the validator's per-table comparison ---
  for (const tableName of EXPECTED_IMPORT_FOREIGN_KEYS.keys()) {
    assert.ok(
      ALLOWED_IMPORT_TABLES.has(tableName),
      `EXPECTED_IMPORT_FOREIGN_KEYS 中的表 ${tableName} 不在 ALLOWED_IMPORT_TABLES 内。${syncMessage}`,
    );
  }

  for (const tableName of ALLOWED_IMPORT_TABLES) {
    const actualForeignKeys = (candidate.pragma(`foreign_key_list(${tableName})`) as ForeignKeyRow[])
      .map(foreignKeySignature)
      .sort();
    const expectedForeignKeys = (EXPECTED_IMPORT_FOREIGN_KEYS.get(tableName) || [])
      .map((foreignKey) => foreignKeySignature({
        table: foreignKey.parentTable,
        from: foreignKey.from,
        to: foreignKey.to,
        on_delete: foreignKey.onDelete,
        on_update: 'NO ACTION',
        match: 'NONE',
      }))
      .sort();
    assert.deepEqual(
      actualForeignKeys,
      expectedForeignKeys,
      `表 ${tableName} 的外键定义与 EXPECTED_IMPORT_FOREIGN_KEYS 不一致（实际 ${JSON.stringify(actualForeignKeys)}）。${syncMessage}`,
    );
  }
});
