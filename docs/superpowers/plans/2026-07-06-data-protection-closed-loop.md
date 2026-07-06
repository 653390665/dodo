# T1：数据保护最小闭环设计与实施计划 (Data Protection Closed-Loop Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 实现一键备份导出、本地导入恢复及数据库启动备份，为 InkFlow 提供坚实的数据安全与高可用容灾能力。
**Architecture:** 
1. **启动双机制同步**: 数据库启动时，自动将当前 `.db` 物理文件备份为 `.bak`。
2. **API 数据隔离与恢复**: 后端注册 `/api/db/export-file` 和 `/api/db/import-file`。导入时进行魔术字校验，并优雅断开连接、清除 WAL/SHM 日志文件后覆盖，并带有自动异常回滚恢复旧库的安全围栏。
3. **极简精致管理 UI**: 前端 SettingsModal 整合“数据备份与管理”模块，完美符合 OKLCH 美学设计与操作风险防范。
**Tech Stack:** TypeScript, React, Express, better-sqlite3, Node.js fs, Lucide React

---

## 1. 架构图 (Architecture Diagram)

```mermaid
graph TD
    subgraph Frontend [前端 UI (SettingsModal)]
        A[数据备份与管理 Tab] --> B1(一键备份导出按钮)
        A --> B2(导入恢复数据按钮)
        B1 -->|GET /api/db/export-file| C1[浏览器文件下载]
        B2 -->|文件选取确认| C2[fetch POST /api/db/import-file]
    end

    subgraph Backend [后端 Express 服务 (db.ts)]
        C1 -->|下载请求| D1[res.download DB_PATH]
        C2 -->|Octet-Stream 二进制| D2[express.raw 中间件]
        D2 --> E{校验魔术字 SQLite format 3}
        E -->|不匹配| F1[返回 400 报错]
        E -->|匹配| F2[优雅关闭 closeDb]
        F2 --> G1[备份旧库 DB_PATH.pre-import-bak]
        G1 --> G2[清理旧 WAL / SHM 临时日志]
        G2 --> H1[写入二进制数据 writeFileSync]
        H1 --> H2{尝试 initDb}
        H2 -->|成功| I1[返回 success: true]
        H2 -->|失败 Catch| I2[回滚: closeDb, 用 pre-import-bak 还原 DB_PATH, 清理 WAL/SHM, initDb 恢复旧库]
        I2 --> I3[返回 500 报错]
    end

    subgraph Database_Init [数据库启动与初始化 (db-init.ts)]
        J[initDb 启动时] --> K{检查 DB_PATH 是否存在}
        K -->|存在| L[同步复制为 data.db.bak]
        K -->|不存在| M[正常初始化并创建新库]
    end
```

---

## 2. 安全性审计报告 (Security Audit Report)

| 审计维度 | 威胁模型及潜在漏洞 | 缓解与安全加固设计 |
| :--- | :--- | :--- |
| **身份认证与暴露面** | 未授权的外部客户端拉取敏感的本地小说、人物大纲及设定文件 | 该应用定位为单机/局域网部署工具。当前只在本地进行文件读写且默认无公网出口。若未来部署至多租户云端，该系列接口必须受统一的 JWT/Session 鉴权守卫保护。 |
| **恶意文件上传与写入** | 客户端上传任意脚本、大文件或非法格式导致磁盘爆满或触发任意代码执行 (RCE) | 1. 接口设置 `limit: '100mb'` 严控上传体积。<br>2. 解析二进制 Buffer 前 15 字节，必须匹配 SQLite 标准魔术字 `SQLite format 3`。若不匹配直接中断拒绝写入，防止任意文件写覆盖。 |
| **路径遍历漏洞 (Path Traversal)**| 通过文件名参数中含有 `../` 物理覆盖系统底层文件 | 接口全硬编码绑定私有目录 `DB_PATH`，不接受客户端指定的文件名或路径参数，完全杜绝了路径遍历覆写。 |
| **物理一致性损坏 (Corruption)** | 连接开启时并发覆盖 `.db` 物理文件，导致 SQLite 底层 Page Header 乱序、锁死或连接句柄崩溃 | 1. 物理写入前主动调用 `closeDb()` 优雅释放句柄与锁。<br>2. 覆盖文件后立刻重新调用 `initDb()` 干净建立新连接。 |
| **辅助日志干扰 (WAL/SHM)** | WAL 模式下的 `-wal` 临时写日志及 `-shm` 共享内存文件在新库写入后残留，造成物理映射冲突 | 同步调用 `unlinkSync` 干净切除可能存在的 `-wal` 与 `-shm`，防范干扰。 |
| **高可用与事务原子性** | 替换过程中由于电源故障、写入异常或上传的 SQLite 损坏（通过了魔术字检测但 Schema 错乱）导致应用永久损坏 | 写入新库前自动保存当前的 `pre-import-bak`。如果在 `initDb()` 阶段抛出任何 SQLite 错误，在 Catch 分支立刻自动恢复旧库并清空残留，确保原子性高可用。 |

---

## 3. 实施步骤 (Detailed Execution Steps)

### Task 1: 启动备份机制建立 (Database Startup Backup)
- **Files:**
  - `server/lib/db-init.ts` (Modify)
- **Steps:**
  - [ ] 1. 从 `fs` 导入 `copyFileSync`。
  - [ ] 2. 导出 `DB_PATH`（改为 `export const DB_PATH`）。
  - [ ] 3. 在 `initDb` 中，实例化 `new Database` 前（约第 46 行），检查 `targetPath = dbPath || DB_PATH` 文件是否存在。
  - [ ] 4. 若存在，则调用 `copyFileSync(targetPath, targetPath + '.bak')` 自动做安全冷备。
- **Code Change Preview:**
  ```typescript
  // 头部引入
  import { existsSync, mkdirSync, copyFileSync } from 'fs';
  
  // 导出常量
  export const DB_PATH = path.join(DB_DIR, 'data.db');

  // initDb 方法修改
  export function initDb(dbPath?: string): void {
    if (isDbInitialized()) return;

    if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

    const targetPath = dbPath || DB_PATH;
    if (existsSync(targetPath)) {
      copyFileSync(targetPath, targetPath + '.bak');
    }

    const _db = new Database(targetPath, { nativeBinding: nativeBindingPath });
    setDb(_db);
    // ... 后续代码保持一致 ...
  ```

---

### Task 2: 后端导出/导入 API 路由 (Backend Database Admin Routes)
- **Files:**
  - `server/routes/db.ts` (Modify)
- **Steps:**
  - [ ] 1. 导入 `express`，导入 `fs` 相关的 `existsSync`, `unlinkSync`, `copyFileSync`, `writeFileSync`。
  - [ ] 2. 导入 `server/lib/db-init.ts` 中的 `DB_PATH` 及 `initDb`，导入 `server/lib/db-instance.ts` 中的 `closeDb`。
  - [ ] 3. 注册 `GET /api/db/export-file`：一键冷备下载。
  - [ ] 4. 注册 `POST /api/db/import-file`：处理大文件上传 (100MB) 及严格回滚保障。
- **Code Change Preview:**
  ```typescript
  import express from 'express';
  import { existsSync, unlinkSync, copyFileSync, writeFileSync } from 'fs';
  import { DB_PATH, initDb } from '../lib/db-init';
  import { closeDb } from '../lib/db-instance';

  // 并在 registerDbRoutes(app: Express) 内：
  export function registerDbRoutes(app: Express) {
    // ... 保持原有路由不变 ...

    // 一键导出备份
    app.get('/api/db/export-file', (req, res) => {
      try {
        if (existsSync(DB_PATH)) {
          res.download(DB_PATH, 'inkflow-data.db');
        } else {
          res.status(404).json({ error: '数据文件不存在，请先运行或初始化系统。' });
        }
      } catch (e) {
        logger.error('导出数据库失败:', e);
        res.status(500).json({ error: '导出数据库失败' });
      }
    });

    // 导入还原备份
    app.post(
      '/api/db/import-file',
      express.raw({ limit: '100mb', type: 'application/octet-stream' }),
      (req, res) => {
        const buffer = req.body;
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
          return res.status(400).json({ error: '接收到的数据库文件为空' });
        }

        // 校验 SQLite 魔术字（15 字节）
        const magic = buffer.toString('utf8', 0, 15);
        if (magic !== 'SQLite format 3') {
          return res.status(400).json({ error: '无效的 SQLite 数据库文件格式' });
        }

        const backupPath = DB_PATH + '.pre-import-bak';

        try {
          // 优雅断开当前底层连接
          closeDb();

          // 安全暂存原物理库
          if (existsSync(DB_PATH)) {
            copyFileSync(DB_PATH, backupPath);
          }

          // 同步物理裁剪并删除 WAL / SHM 文件以防干扰
          const walPath = DB_PATH + '-wal';
          const shmPath = DB_PATH + '-shm';
          if (existsSync(walPath)) unlinkSync(walPath);
          if (existsSync(shmPath)) unlinkSync(shmPath);

          // 物理写入新库
          writeFileSync(DB_PATH, buffer);

          // 重建底层连接
          initDb();

          res.json({ success: true });
        } catch (err: any) {
          logger.error('还原数据库失败，正在执行容灾回滚:', err);
          try {
            closeDb();
            // 回滚：用 pre-import-bak 拷回 DB_PATH
            if (existsSync(backupPath)) {
              copyFileSync(backupPath, DB_PATH);
            }
            // 再次清理残留
            const walPath = DB_PATH + '-wal';
            const shmPath = DB_PATH + '-shm';
            if (existsSync(walPath)) unlinkSync(walPath);
            if (existsSync(shmPath)) unlinkSync(shmPath);
            
            // 重新初始化旧库连接
            initDb();
          } catch (rollbackErr) {
            logger.error('极其严重：容灾回滚失败！', rollbackErr);
          }
          res.status(500).json({ error: err instanceof Error ? err.message : '还原数据失败，已自动回撤' });
        }
      }
    );
  }
  ```

---

### Task 3: 前端数据管理 UI (Frontend Administration View)
- **Files:**
  - `src/components/SettingsModal.tsx` (Modify)
- **Steps:**
  - [ ] 1. 扩充 `settingsTab` 状态类型至 `'quick' | 'promptLab' | 'dataManage'`。
  - [ ] 2. 扩充 lucide-react 的图标引用，添加 `Database`, `Download`, `Upload`, `AlertTriangle`, `ShieldCheck`。
  - [ ] 3. 更新 modal 容器 max-width 尺寸过渡表达式，使 `quick` 和 `dataManage` 保持紧凑的 `max-w-xl`（576px），给用户高级紧凑的视觉回馈。
  - [ ] 4. 在 `TabsList` 插入 `TabsTrigger` 触发节点。
  - [ ] 5. 实现 `fileInputRef` 引用及 `handleExportData`, `handleImportDataClick`, `handleImportFileChange` 核心控制交互。
  - [ ] 6. 渲染精致的 `<TabsContent value="dataManage">` 面板。
- **Code Change Preview:**
  - 见下文详细文件修改。

---

## 4. 验证与质量控制 (Verification Criteria)

1. **类型检查及 Lint 校验**:
   ```bash
   npm run typecheck
   npm run lint
   ```
2. **自动化测试**:
   由于我们在底层进行了修改，我们可以执行现有测试来验证系统没有发生任何退化：
   ```bash
   npm run test
   ```
   特别是执行与数据库初始、交互相关的测试（如 `tests/db-client.test.ts` ）。
