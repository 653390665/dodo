import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-db-import-'));
const activeDbPath = path.join(testDir, 'active.test.db');
const importedDbPath = path.join(testDir, 'imported.test.db');
process.env.INKFLOW_DB_PATH = activeDbPath;

test('database import serialization and recovery', async (t) => {
  const { closeDb, getNovel, initDb } = await import('../server/lib/db');
  const { refundQuota, reserveQuota } = await import('../server/helpers/quota-guard');
  const {
    getDatabaseGeneration,
    getDb,
    runInSerializedWrite,
    runInSerializedWriteForGeneration,
  } = await import('../server/lib/db-instance');
  const {
    DB_IMPORT_BACKUP_MARKER,
    DB_IMPORT_TEMP_MARKER,
    MAX_IMPORT_BACKUPS,
    importDatabaseBuffer,
    pruneImportBackups,
    registerDbRoutes,
  } = await import('../server/routes/db');

  const importTempFiles = () => fs.readdirSync(testDir)
    .filter((name) => name.includes(DB_IMPORT_TEMP_MARKER));
  const importBackupFiles = () => fs.readdirSync(testDir)
    .filter((name) => name.includes(DB_IMPORT_BACKUP_MARKER) && name.endsWith('.bak'));

  const resetActiveDatabase = () => {
    closeDb();
    for (const filePath of [activeDbPath, `${activeDbPath}-wal`, `${activeDbPath}-shm`]) {
      fs.rmSync(filePath, { force: true });
    }
    initDb(activeDbPath);
    getDb().prepare(`
      INSERT INTO novels (id, title, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('protected-original', '不得被替换', 'local-user', Date.now(), Date.now());
  };

  const createCandidate = (
    name: string,
    mutate: (database: ReturnType<typeof getDb>) => void,
  ): Buffer => {
    closeDb();
    const candidatePath = path.join(testDir, name);
    fs.rmSync(candidatePath, { force: true });
    initDb(candidatePath);
    mutate(getDb());
    closeDb();
    const buffer = fs.readFileSync(candidatePath);
    fs.rmSync(candidatePath, { force: true });
    return buffer;
  };

  const assertRejectedWithoutReplacement = async (buffer: Buffer) => {
    resetActiveDatabase();
    await assert.rejects(importDatabaseBuffer(buffer));
    assert.ok(
      getDb().prepare('SELECT id FROM novels WHERE id = ?').get('protected-original'),
      'validation failure must leave the active database untouched',
    );
    assert.deepEqual(importTempFiles(), [], 'validation temporary files must always be removed');
  };

  const creativeArtifactTables = [
    'creative_artifact_cores',
    'creative_artifact_versions',
    'creative_artifact_candidates',
    'artifact_review_requirements',
    'creation_flow_sessions',
  ];
  const creativeArtifactIndexes = [
    'idx_creative_artifact_cores_identity',
    'idx_creative_artifact_versions_identity',
    'idx_creative_artifact_versions_novel',
    'idx_creative_artifact_candidates_status',
    'idx_creative_artifact_candidates_target',
    'idx_artifact_review_requirements_lookup',
    'idx_artifact_review_requirements_candidate',
    'idx_creation_flow_sessions_novel',
    'idx_creation_flow_sessions_one_active',
  ];
  const dropCreativeArtifactSchema = (database: ReturnType<typeof getDb>) => {
    database.pragma('foreign_keys = OFF');
    database.exec(`
      DROP TABLE creation_flow_sessions;
      DROP TABLE artifact_review_requirements;
      DROP TABLE creative_artifact_candidates;
      DROP TABLE creative_artifact_versions;
      DROP TABLE creative_artifact_cores;
    `);
  };

  try {
    await t.test('waits for old writes and prevents them from reaching the replacement', async () => {
      initDb(importedDbPath);
      getDb().prepare(`
        INSERT INTO novels (id, title, author_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('imported-novel', '导入库作品', 'local-user', Date.now(), Date.now());
      closeDb();
      const importedBuffer = fs.readFileSync(importedDbPath);

      initDb(activeDbPath);

      let releaseFirstWrite!: () => void;
      const firstWriteCanFinish = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      const order: string[] = [];

      const firstWrite = runInSerializedWrite(async () => {
        order.push('first-started');
        await firstWriteCanFinish;
        order.push('first-finished');
      });
      const queuedOldWrite = runInSerializedWrite(() => {
        getDb().prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('queued-old-novel', '旧库排队写入', 'local-user', Date.now(), Date.now());
        order.push('old-write-finished');
      });
      const importPromise = importDatabaseBuffer(importedBuffer).then(() => {
        order.push('import-finished');
      });

      releaseFirstWrite();
      await Promise.all([firstWrite, queuedOldWrite, importPromise]);

      assert.deepEqual(order, [
        'first-started',
        'first-finished',
        'old-write-finished',
        'import-finished',
      ]);
      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('imported-novel'));
      assert.equal(
        getDb().prepare('SELECT id FROM novels WHERE id = ?').get('queued-old-novel'),
        undefined,
        'a write queued against the old database must finish before replacement, not leak into it',
      );
    });

    await t.test('discards a delayed task that resumes after database replacement', async () => {
      const replacement = createCandidate('generation-replacement.db', (database) => {
        database.prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('generation-new', '代际新库', 'local-user', Date.now(), Date.now());
      });
      resetActiveDatabase();
      const oldGeneration = getDatabaseGeneration();

      await importDatabaseBuffer(replacement);
      const delayedWrite = await runInSerializedWriteForGeneration(oldGeneration, () => {
        getDb().prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('late-old-task', '旧任务幽灵写入', 'local-user', Date.now(), Date.now());
      });

      assert.equal(delayedWrite.executed, false);
      assert.equal(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('late-old-task'), undefined);
      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('generation-new'));
    });

    await t.test('restores the original database and cleans temporary files when initialization fails', async () => {
      closeDb();
      for (const filePath of [
        activeDbPath,
        `${activeDbPath}-wal`,
        `${activeDbPath}-shm`,
        `${activeDbPath}.pre-import-bak`,
      ]) {
        fs.rmSync(filePath, { force: true });
      }

      initDb(activeDbPath);
      getDb().prepare(`
        INSERT INTO novels (id, title, author_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('original-novel', '原数据库作品', 'local-user', Date.now(), Date.now());
      const reservation = await reserveQuota('original-novel', 'generateProse');
      assert.equal(reservation.allowed, true);
      assert.ok(reservation.reservationId);
      closeDb();

      fs.writeFileSync(`${activeDbPath}-wal`, 'stale wal');
      fs.writeFileSync(`${activeDbPath}-shm`, 'stale shm');
      const importedBuffer = fs.readFileSync(importedDbPath);
      let initializeCalls = 0;

      await assert.rejects(
        importDatabaseBuffer(importedBuffer, () => {
          initializeCalls += 1;
          assert.equal(fs.existsSync(`${activeDbPath}-wal`), false);
          assert.equal(fs.existsSync(`${activeDbPath}-shm`), false);
          if (initializeCalls === 1) {
            throw new Error('injected initialization failure');
          }
          initDb(activeDbPath);
        }),
        /injected initialization failure/,
      );

      assert.equal(initializeCalls, 2, 'rollback must reinitialize the restored database');
      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('original-novel'));
      assert.equal(
        getNovel('original-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount,
        1,
        'the restored backup includes the pre-import reservation increment',
      );
      assert.equal(await refundQuota(reservation.reservationId), true);
      assert.equal(
        getNovel('original-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount,
        0,
        'a failed import rollback must preserve the reservation refund path',
      );
      assert.equal(
        getDb().prepare('SELECT id FROM novels WHERE id = ?').get('imported-novel'),
        undefined,
        'failed replacement data must not remain active after rollback',
      );
      assert.equal(fs.existsSync(`${activeDbPath}.pre-import-bak`), false);
      assert.deepEqual(importTempFiles(), [], 'initialization rollback must clean import candidates');

      closeDb();
      assert.equal(fs.existsSync(`${activeDbPath}-wal`), false);
      assert.equal(fs.existsSync(`${activeDbPath}-shm`), false);
    });

    await t.test('rejects corrupt content before replacing the active database', async () => {
      await assertRejectedWithoutReplacement(Buffer.from('not a sqlite database'));
    });

    await t.test('accepts chapter completion schema and upgrades legacy backups', async () => {
      const currentBackup = createCandidate('chapter-completion-current.db', (database) => {
        database.prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('completion-current-novel', '当前完成态作品', 'local-user', Date.now(), Date.now());
      });

      resetActiveDatabase();
      await importDatabaseBuffer(currentBackup);
      assert.ok(getDb().prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'chapter_completion_attempts'));
      assert.ok(getDb().prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('index', 'idx_chapter_completion_attempts_novel_chapter'));
      const dismissalColumns = getDb().pragma('table_info(capability_recommendation_dismissals)') as Array<{ name: string; pk: number }>;
      assert.deepEqual(dismissalColumns.filter((column) => column.pk > 0).map((column) => column.name), ['novel_id', 'fingerprint', 'capability_id']);
      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('completion-current-novel'));

      const legacyBackup = createCandidate('chapter-completion-legacy.db', (database) => {
        database.exec('DROP INDEX idx_chapter_completion_attempts_novel_chapter; DROP TABLE chapter_completion_attempts;');
        database.prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('completion-legacy-novel', '旧完成态作品', 'local-user', Date.now(), Date.now());
      });

      resetActiveDatabase();
      await importDatabaseBuffer(legacyBackup);
      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('completion-legacy-novel'));
      assert.ok(getDb().prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'chapter_completion_attempts'));
      assert.ok(getDb().prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('index', 'idx_chapter_completion_attempts_novel_chapter'));
    });

    await t.test('returns only a generic validation error to the import client', async () => {
      const express = (await import('express')).default;
      const app = express();
      registerDbRoutes(app);
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));

      try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const response = await fetch(`http://127.0.0.1:${address.port}/api/db/import-file`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: Buffer.from('not a sqlite database'),
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          error: '数据库导入失败，请确认备份文件有效',
        });
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => {
          if (error) reject(error);
          else resolve();
        }));
      }
      assert.deepEqual(importTempFiles(), []);
    });

    await t.test('rejects forged same-name tables with an incompatible core schema', async () => {
      const forgedBuffer = createCandidate('forged.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          DROP TABLE chapters;
          DROP TABLE novels;
          CREATE TABLE novels (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE TABLE chapters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            title TEXT,
            content TEXT,
            "order" INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);
      });
      await assertRejectedWithoutReplacement(forgedBuffer);
    });

    await t.test('rejects a backup missing a non-migratable required column', async () => {
      const missingColumnBuffer = createCandidate('missing-column.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec('ALTER TABLE chapters DROP COLUMN content');
      });
      await assertRejectedWithoutReplacement(missingColumnBuffer);
    });

    await t.test('rejects foreign-key violations before replacing the active database', async () => {
      const invalidForeignKeyBuffer = createCandidate('invalid-foreign-key.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.prepare(`
          INSERT INTO chapters (id, novel_id, title, content, "order", created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('orphan-chapter', 'missing-novel', '孤儿章节', '', 0, Date.now(), Date.now());
      });
      await assertRejectedWithoutReplacement(invalidForeignKeyBuffer);
    });

    await t.test('rejects a database carrying another application identifier', async () => {
      const foreignApplicationBuffer = createCandidate('foreign-application.db', (database) => {
        database.pragma('application_id = 123456');
      });
      await assertRejectedWithoutReplacement(foreignApplicationBuffer);
    });

    await t.test('rejects executable schema objects such as malicious triggers', async () => {
      const maliciousTriggerBuffer = createCandidate('malicious-trigger.db', (database) => {
        database.exec(`
          CREATE TRIGGER erase_other_chapters_after_update
          AFTER UPDATE OF content ON chapters
          BEGIN
            DELETE FROM chapters WHERE id <> NEW.id;
          END;
        `);
      });
      await assertRejectedWithoutReplacement(maliciousTriggerBuffer);
    });

    await t.test('rejects unknown unique, partial, and expression indexes', async () => {
      const maliciousIndexBuffer = createCandidate('malicious-index.db', (database) => {
        database.exec(`
          CREATE UNIQUE INDEX unexpected_chapter_title_expression
          ON chapters(lower(title))
          WHERE title <> '';
        `);
      });
      await assertRejectedWithoutReplacement(maliciousIndexBuffer);
    });

    await t.test('rejects table-level UNIQUE constraints hidden behind sqlite_autoindex', async () => {
      const implicitUniqueBuffer = createCandidate('implicit-unique-index.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          DROP TABLE chapters;
          CREATE TABLE chapters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_name TEXT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            "order" INTEGER DEFAULT 0,
            word_count INTEGER DEFAULT 0,
            scene_beats TEXT,
            critique TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (novel_id) ON CONFLICT REPLACE,
            FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
          );
        `);
      });
      await assertRejectedWithoutReplacement(implicitUniqueBuffer);
    });

    await t.test('rejects a known index name with a modified definition', async () => {
      const forgedKnownIndexBuffer = createCandidate('forged-known-index.db', (database) => {
        database.exec(`
          DROP INDEX idx_chapters_novel;
          CREATE INDEX idx_chapters_novel ON chapters(novel_id DESC, title);
        `);
      });
      await assertRejectedWithoutReplacement(forgedKnownIndexBuffer);
    });

    await t.test('accepts governance schema and rejects incomplete or forged governance indexes', async () => {
      const valid = createCandidate('governance-valid.db', () => {});
      resetActiveDatabase();
      await importDatabaseBuffer(valid);
      assert.equal((getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'idx_outline_artifacts_one_active_master'").get() as { name?: string } | undefined)?.name, 'idx_outline_artifacts_one_active_master');
      assert.deepEqual(
        (getDb().prepare('PRAGMA table_info(outline_artifacts)').all() as Array<{ name: string }>).map((column) => column.name)
          .filter((name) => ['core_json', 'source_capability_versions'].includes(name)).sort(),
        ['core_json', 'source_capability_versions'],
      );
      assert.deepEqual(
        (getDb().prepare('PRAGMA table_info(canon_patches)').all() as Array<{ name: string }>).map((column) => column.name)
          .filter((name) => name === 'source_capability_versions'),
        ['source_capability_versions'],
      );

      const wrongColumns = createCandidate('governance-wrong-columns.db', (database) => {
        database.exec('DROP INDEX idx_outline_artifacts_one_active_master; CREATE UNIQUE INDEX idx_outline_artifacts_one_active_master ON outline_artifacts(status) WHERE level = \'master\' AND status = \'active\';');
      });
      await assertRejectedWithoutReplacement(wrongColumns);

      const wrongPredicate = createCandidate('governance-wrong-predicate.db', (database) => {
        database.exec('DROP INDEX idx_outline_artifacts_one_active_master; CREATE UNIQUE INDEX idx_outline_artifacts_one_active_master ON outline_artifacts(novel_id) WHERE level = \'master\' AND status = \'candidate\';');
      });
      await assertRejectedWithoutReplacement(wrongPredicate);

      const unknownPartial = createCandidate('governance-unknown-partial.db', (database) => {
        database.exec("CREATE UNIQUE INDEX idx_unknown_partial ON outline_artifacts(novel_id) WHERE status = 'active';");
      });
      await assertRejectedWithoutReplacement(unknownPartial);

      const incomplete = createCandidate('governance-incomplete.db', (database) => {
        database.exec('DROP INDEX idx_outline_artifacts_one_active_master;');
      });
      await assertRejectedWithoutReplacement(incomplete);

      const missingCanon = createCandidate('governance-missing-canon.db', (database) => {
        database.exec('DROP TABLE canon_patches;');
      });
      await assertRejectedWithoutReplacement(missingCanon);

      const missingOutlineAndIndex = createCandidate('governance-missing-outline.db', (database) => {
        database.exec('DROP INDEX idx_outline_artifacts_one_active_master; DROP TABLE outline_artifacts;');
      });
      await assertRejectedWithoutReplacement(missingOutlineAndIndex);

      const legacyWithoutGovernance = createCandidate('governance-legacy-absent.db', (database) => {
        database.exec('DROP INDEX idx_outline_artifacts_one_active_master; DROP TABLE outline_artifacts; DROP TABLE canon_patches;');
      });
      resetActiveDatabase();
      await importDatabaseBuffer(legacyWithoutGovernance);
      assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'outline_artifacts'").get());
      assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'canon_patches'").get());
      assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'idx_outline_artifacts_one_active_master'").get());
    });

    await t.test('accepts the complete creative artifact governance schema', async () => {
      const currentBackup = createCandidate('creative-artifacts-current.db', () => {});

      resetActiveDatabase();
      await importDatabaseBuffer(currentBackup);

      const schemaObjects = new Set((getDb().prepare(`
        SELECT name FROM sqlite_master
        WHERE type IN ('table', 'index')
      `).all() as Array<{ name: string }>).map((row) => row.name));
      for (const name of [...creativeArtifactTables, ...creativeArtifactIndexes]) {
        assert.ok(schemaObjects.has(name), `current import should retain ${name}`);
      }
    });

    await t.test('rejects incomplete creation flow schema', async () => {
      const missingIndex = createCandidate('creation-flow-missing-index.db', (database) => {
        database.exec('DROP INDEX idx_creation_flow_sessions_one_active;');
      });
      await assertRejectedWithoutReplacement(missingIndex);
    });

    await t.test('rejects partial creative artifact governance tables or indexes', async () => {
      const missingTable = createCandidate('creative-artifacts-missing-table.db', (database) => {
        database.exec('DROP INDEX idx_artifact_review_requirements_candidate; DROP INDEX idx_artifact_review_requirements_lookup; DROP TABLE artifact_review_requirements;');
      });
      await assertRejectedWithoutReplacement(missingTable);

      const missingIndex = createCandidate('creative-artifacts-missing-index.db', (database) => {
        database.exec('DROP INDEX idx_creative_artifact_candidates_target;');
      });
      await assertRejectedWithoutReplacement(missingIndex);
    });

    await t.test('rejects incompatible creative artifact columns and defaults', async () => {
      const missingColumn = createCandidate('creative-artifacts-missing-column.db', (database) => {
        database.exec(`
          DROP INDEX idx_creative_artifact_versions_identity;
          DROP INDEX idx_creative_artifact_versions_novel;
          ALTER TABLE creative_artifact_versions DROP COLUMN provenance_json;
          CREATE UNIQUE INDEX idx_creative_artifact_versions_identity
            ON creative_artifact_versions(novel_id, artifact_kind, artifact_id, version);
          CREATE INDEX idx_creative_artifact_versions_novel
            ON creative_artifact_versions(novel_id, artifact_kind, artifact_id);
        `);
      });
      await assertRejectedWithoutReplacement(missingColumn);

      for (const [name, coreJsonDeclaration] of [
        ['wrong-type', 'BLOB NOT NULL'],
        ['wrong-nullability', 'TEXT'],
      ] as const) {
        const incompatibleColumn = createCandidate(`creative-artifacts-${name}.db`, (database) => {
          database.pragma('foreign_keys = OFF');
          database.exec(`
            DROP INDEX idx_creative_artifact_cores_identity;
            DROP TABLE creative_artifact_cores;
            CREATE TABLE creative_artifact_cores (
              id TEXT PRIMARY KEY,
              novel_id TEXT NOT NULL,
              artifact_kind TEXT NOT NULL,
              artifact_id TEXT NOT NULL,
              version INTEGER NOT NULL,
              core_json ${coreJsonDeclaration},
              readable_content TEXT,
              provenance_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX idx_creative_artifact_cores_identity
              ON creative_artifact_cores(novel_id, artifact_kind, artifact_id);
          `);
        });
        await assertRejectedWithoutReplacement(incompatibleColumn);
      }

      const expressionDefault = createCandidate('creative-artifacts-expression-default.db', (database) => {
        database.exec('ALTER TABLE creative_artifact_cores ADD COLUMN imported_nonce INTEGER DEFAULT (random());');
      });
      await assertRejectedWithoutReplacement(expressionDefault);
    });

    await t.test('rejects forged creative artifact indexes and foreign keys', async () => {
      const wrongOrder = createCandidate('creative-artifacts-wrong-index-order.db', (database) => {
        database.exec(`
          DROP INDEX idx_creative_artifact_candidates_target;
          CREATE INDEX idx_creative_artifact_candidates_target
            ON creative_artifact_candidates(artifact_kind, novel_id, artifact_id);
        `);
      });
      await assertRejectedWithoutReplacement(wrongOrder);

      const wrongUniqueness = createCandidate('creative-artifacts-wrong-index-uniqueness.db', (database) => {
        database.exec(`
          DROP INDEX idx_creative_artifact_cores_identity;
          CREATE INDEX idx_creative_artifact_cores_identity
            ON creative_artifact_cores(novel_id, artifact_kind, artifact_id);
        `);
      });
      await assertRejectedWithoutReplacement(wrongUniqueness);

      const wrongForeignKeyAction = createCandidate('creative-artifacts-wrong-foreign-key.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          DROP INDEX idx_artifact_review_requirements_lookup;
          DROP INDEX idx_artifact_review_requirements_candidate;
          DROP TABLE artifact_review_requirements;
          CREATE TABLE artifact_review_requirements (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            artifact_kind TEXT NOT NULL,
            artifact_id TEXT NOT NULL,
            artifact_version INTEGER NOT NULL,
            source_candidate_id TEXT,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            resolved_at INTEGER,
            FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
            FOREIGN KEY (source_candidate_id) REFERENCES creative_artifact_candidates(id) ON DELETE CASCADE
          );
          CREATE INDEX idx_artifact_review_requirements_lookup
            ON artifact_review_requirements(novel_id, artifact_kind, artifact_id, status);
          CREATE INDEX idx_artifact_review_requirements_candidate
            ON artifact_review_requirements(source_candidate_id);
        `);
      });
      await assertRejectedWithoutReplacement(wrongForeignKeyAction);
    });

    await t.test('keeps rejecting executable objects attached to creative artifact tables', async () => {
      const unexpectedView = createCandidate('creative-artifacts-view.db', (database) => {
        database.exec('CREATE VIEW creative_artifact_core_ids AS SELECT id FROM creative_artifact_cores;');
      });
      await assertRejectedWithoutReplacement(unexpectedView);
    });

    await t.test('accepts a legacy backup and initializes creative artifact schema without changing rows', async () => {
      let expectedNovel: unknown;
      let expectedCharacter: unknown;
      const legacyBackup = createCandidate('creative-artifacts-legacy.db', (database) => {
        database.prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('legacy-artifact-novel', '旧库作品', 'legacy-author', 100, 200);
        database.prepare(`
          INSERT INTO characters (id, novel_id, name, bio, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('legacy-artifact-character', 'legacy-artifact-novel', '旧库角色', '原始设定', 300, 400);
        expectedNovel = database.prepare('SELECT * FROM novels WHERE id = ?').get('legacy-artifact-novel');
        expectedCharacter = database.prepare('SELECT * FROM characters WHERE id = ?').get('legacy-artifact-character');
        dropCreativeArtifactSchema(database);
      });

      resetActiveDatabase();
      await importDatabaseBuffer(legacyBackup);

      assert.deepEqual(getDb().prepare('SELECT * FROM novels WHERE id = ?').get('legacy-artifact-novel'), expectedNovel);
      assert.deepEqual(getDb().prepare('SELECT * FROM characters WHERE id = ?').get('legacy-artifact-character'), expectedCharacter);
      for (const tableName of creativeArtifactTables) {
        assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
      }
    });

    await t.test('rejects extra CHECK constraints', async () => {
      const checkedColumnBuffer = createCandidate('checked-column.db', (database) => {
        database.exec(`
          ALTER TABLE chapters
          ADD COLUMN imported_guard INTEGER CHECK (imported_guard IN (0, 1));
        `);
      });
      await assertRejectedWithoutReplacement(checkedColumnBuffer);
    });

    await t.test('rejects generated columns', async () => {
      const generatedColumnBuffer = createCandidate('generated-column.db', (database) => {
        database.exec(`
          ALTER TABLE chapters
          ADD COLUMN normalized_title TEXT GENERATED ALWAYS AS (lower(title)) VIRTUAL;
        `);
      });
      await assertRejectedWithoutReplacement(generatedColumnBuffer);
    });

    await t.test('rejects expression defaults', async () => {
      const expressionDefaultBuffer = createCandidate('expression-default.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          DROP TABLE chapters;
          CREATE TABLE chapters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_name TEXT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            "order" INTEGER DEFAULT 0,
            word_count INTEGER DEFAULT 0,
            scene_beats TEXT,
            critique TEXT,
            imported_nonce INTEGER DEFAULT (random()),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
          );
          CREATE INDEX idx_chapters_novel ON chapters(novel_id);
        `);
      });
      await assertRejectedWithoutReplacement(expressionDefaultBuffer);
    });

    await t.test('rejects extra foreign keys', async () => {
      const extraForeignKeyBuffer = createCandidate('extra-foreign-key.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          DROP TABLE chapters;
          CREATE TABLE chapters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_name TEXT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            "order" INTEGER DEFAULT 0,
            word_count INTEGER DEFAULT 0,
            scene_beats TEXT,
            critique TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
            FOREIGN KEY (title) REFERENCES novels(id) ON DELETE SET NULL
          );
          CREATE INDEX idx_chapters_novel ON chapters(novel_id);
        `);
      });
      await assertRejectedWithoutReplacement(extraForeignKeyBuffer);
    });

    await t.test('rejects modified foreign-key update actions', async () => {
      const modifiedUpdateBuffer = createCandidate('modified-foreign-key-action.db', (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          DROP TABLE chapters;
          CREATE TABLE chapters (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            volume_name TEXT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            "order" INTEGER DEFAULT 0,
            word_count INTEGER DEFAULT 0,
            scene_beats TEXT,
            critique TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (novel_id) REFERENCES novels(id)
              ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE INDEX idx_chapters_novel ON chapters(novel_id);
        `);
      });
      await assertRejectedWithoutReplacement(modifiedUpdateBuffer);
    });

    await t.test('accepts an older valid backup and lets initialization migrate optional columns', async () => {
      const oldBackupBuffer = createCandidate('old-valid.db', (database) => {
        database.prepare(`
          INSERT INTO novels (id, title, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('old-backup-novel', '旧备份作品', 'local-user', Date.now(), Date.now());
        database.exec('ALTER TABLE novels DROP COLUMN mounted_skill_loadout');
        database.pragma('application_id = 0');
      });

      resetActiveDatabase();
      const backupsBefore = new Set(importBackupFiles());
      await importDatabaseBuffer(oldBackupBuffer);

      assert.ok(getDb().prepare('SELECT id FROM novels WHERE id = ?').get('old-backup-novel'));
      const columns = getDb().pragma('table_info(novels)') as Array<{ name: string }>;
      assert.ok(
        columns.some((column) => column.name === 'mounted_skill_loadout'),
        'initDb should migrate optional columns after preflight succeeds',
      );
      assert.deepEqual(importTempFiles(), []);
      const createdBackups = importBackupFiles().filter((name) => !backupsBefore.has(name));
      assert.equal(createdBackups.length, 1, 'successful replacement must preserve a timestamped old database backup');
    });

    await t.test('retains only the newest bounded set of pre-import backups', () => {
      const prefix = `${path.basename(activeDbPath)}${DB_IMPORT_BACKUP_MARKER}`;
      for (let index = 0; index < MAX_IMPORT_BACKUPS + 3; index += 1) {
        const backupPath = path.join(testDir, `${prefix}${index}.bak`);
        fs.writeFileSync(backupPath, `backup-${index}`);
        const modifiedAt = new Date(Date.now() + index * 1000);
        fs.utimesSync(backupPath, modifiedAt, modifiedAt);
      }

      pruneImportBackups();

      const remaining = importBackupFiles();
      assert.equal(remaining.length, MAX_IMPORT_BACKUPS);
      assert.ok(remaining.includes(`${prefix}${MAX_IMPORT_BACKUPS + 2}.bak`));
      assert.equal(remaining.includes(`${prefix}0.bak`), false);
    });
  } finally {
    closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
