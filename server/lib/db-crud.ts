import { getDb, notify } from './db-instance.js';

export interface CrudConfig<T, TRow> {
  tableName: string;
  rowToEntity: (row: any) => T;
  entityToRow: (entity: T) => TRow;
  insertColumns: string[];
  updateColumns: string[];
  listQuery?: string;
  listFilterKey?: string;
  listOrderBy?: string;
}

export function createCrudHelpers<T, TRow extends Record<string, any>>(config: CrudConfig<T, TRow>) {
  const {
    tableName,
    rowToEntity,
    entityToRow,
    insertColumns,
    updateColumns,
    listQuery,
    listFilterKey,
    listOrderBy,
  } = config;

  const insertSql = `
    INSERT INTO ${tableName} (${insertColumns.join(', ')})
    VALUES (${insertColumns.map((c) => `@${c.replace(/['"]/g, '')}`).join(', ')})
  `;

  const updateSql = `
    UPDATE ${tableName}
    SET ${updateColumns.map((c) => `${c}=@${c.replace(/['"]/g, '')}`).join(', ')}
    WHERE id=@id
  `;

  const selectAllSql =
    listQuery ||
    `
    SELECT * FROM ${tableName}
    ${listFilterKey ? `WHERE ${listFilterKey} = ?` : ''}
    ${listOrderBy ? `ORDER BY ${listOrderBy}` : ''}
  `;

  const selectOneSql = `SELECT * FROM ${tableName} WHERE id = ?`;
  const deleteSql = `DELETE FROM ${tableName} WHERE id = ?`;

  return {
    list(filterVal?: any): T[] {
      const db = getDb();
      if (listFilterKey && filterVal === undefined) {
        const fallbackSql = `
          SELECT * FROM ${tableName}
          ${listOrderBy ? `ORDER BY ${listOrderBy}` : ''}
        `;
        return db.prepare(fallbackSql).all().map(rowToEntity);
      }
      const rows =
        filterVal !== undefined
          ? db.prepare(selectAllSql).all(filterVal)
          : db.prepare(selectAllSql).all();
      return rows.map(rowToEntity);
    },

    get(id: string): T | undefined {
      const row = getDb().prepare(selectOneSql).get(id);
      return row ? rowToEntity(row) : undefined;
    },

    create(entity: T): void {
      getDb().prepare(insertSql).run(entityToRow(entity));
      notify();
    },

    update(id: string, data: Partial<T>): void {
      const existingRow = getDb().prepare(selectOneSql).get(id);
      if (!existingRow) return;

      const merged = {
        ...rowToEntity(existingRow),
        ...data,
        id,
        updatedAt: Date.now(),
      };

      getDb().prepare(updateSql).run(entityToRow(merged));
      notify();
    },

    delete(id: string): void {
      getDb().prepare(deleteSql).run(id);
      notify();
    },
  };
}
