/**
 * Plan 201 — 手写正文的章级语义索引回填编排（进程内防抖队列）。
 *
 * 设计定稿（Step 1 勘察结论，详见 plans/201-cmdk-index-backfill.md Maintenance notes）：
 * - 挂点：`updateChapter`（content 变化时）与 `deleteChapter`（清理）在 server/lib/db/chapters.ts
 *   的序列化写完成后同步入队即返回——正文保存路径零 await、零 embedding 依赖，
 *   embedding 失败绝不阻塞/失败正文保存（硬性规则）。
 * - 节流：60s 防抖窗口聚合脏章节（同章去重、只保留最新意图），窗口到期后串行回填，
 *   避免 autosave 风暴下的 embedding 写放大。
 * - 内容新鲜度：队列只携带章节 id 与读取闭包，flush 时重新读当前库的最新内容；
 *   章节已删除 → 清理残留 chunk；内容短于阈值 → 跳过；与已索引文本一致 → 跳过（防重复 embed）。
 * - 失败语义：embedding 失败 / 数据库代际更替（VectorIndexGenerationMismatchError）
 *   只记日志，不重试不抛出；下次保存自动重新入队。
 */
import { logger } from '../logger';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from './db-instance';
import { deleteChapterChunks, getChapterChunkText, upsertChapterChunk } from '../vector-store';

/** flush 时调用，返回该章在【当前库】的最新内容；章节已删除返回 undefined。 */
export type ChapterIndexReader = () => { novelId: string; content: string } | undefined;

const DEFAULT_DEBOUNCE_MS = 60_000;
const DEFAULT_MIN_CONTENT_CHARS = 100;

function backfillDebounceMs(): number {
  const raw = Number(process.env.INKFLOW_INDEX_BACKFILL_DEBOUNCE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DEBOUNCE_MS;
}

function minContentChars(): number {
  const raw = Number(process.env.INKFLOW_INDEX_BACKFILL_MIN_CHARS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_CONTENT_CHARS;
}

type QueueEntry = { kind: 'upsert'; reader: ChapterIndexReader } | { kind: 'remove' };

interface QueueItem {
  novelId: string;
  chapterId: string;
  entry: QueueEntry;
}

// 同一章去重（key = novelId:chapterId），后到的意图覆盖先到的。
const dirty = new Map<string, QueueItem>();
let timer: NodeJS.Timeout | null = null;
let flushing = false;

function scheduleFlush(): void {
  if (timer) return;
  // 测试环境默认不启动真实定时回填（避免无关测试文件在 60s 窗口后触发真实网络
  // embedding）；需要验证定时行为的测试显式设置 INKFLOW_INDEX_BACKFILL_DEBOUNCE_MS，
  // 其余测试用 __chapterIndexTestHooks.flushNow() 显式排干。
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.INKFLOW_INDEX_BACKFILL_DEBOUNCE_MS === undefined
  ) {
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, backfillDebounceMs());
  // 不阻塞进程退出（测试、CLI 等短生命周期进程丢弃未到期的回填是可接受的）
  timer.unref();
}

/**
 * 手写正文（updateChapter 挂点）入队：窗口到期后按最新内容 upsert 章级 chunk。
 * reader 延迟到 flush 时才读取，天然规避「队列携带旧内容」与跨库（导入替换）问题。
 */
export function scheduleChapterIndexBackfill(
  novelId: string,
  chapterId: string,
  reader: ChapterIndexReader
): void {
  if (!novelId || !chapterId) return;
  dirty.set(`${novelId}:${chapterId}`, { novelId, chapterId, entry: { kind: 'upsert', reader } });
  scheduleFlush();
}

/** 单章删除（deleteChapter 挂点）入队：窗口到期后清理该章残留 chunk。 */
export function scheduleChapterIndexRemoval(novelId: string, chapterId: string): void {
  if (!novelId || !chapterId) return;
  dirty.set(`${novelId}:${chapterId}`, { novelId, chapterId, entry: { kind: 'remove' } });
  scheduleFlush();
}

async function purgeChapterChunks(novelId: string, chapterId: string): Promise<void> {
  // 换库（导入替换）后旧代际的清理任务直接丢弃
  const guarded = await runInSerializedWriteForGeneration(getDatabaseGeneration(), () =>
    deleteChapterChunks(novelId, chapterId)
  );
  if (!guarded.executed) {
    logger.info('章级索引清理因数据库代际更替被丢弃', { chapterId });
  }
}

async function processEntry(item: QueueItem): Promise<void> {
  const { novelId, chapterId, entry } = item;
  try {
    if (entry.kind === 'remove') {
      await purgeChapterChunks(novelId, chapterId);
      return;
    }
    const chapter = entry.reader();
    if (!chapter) {
      // 章节已删除（或换库后不存在）→ 清理残留 chunk，防止孤儿命中
      await purgeChapterChunks(novelId, chapterId);
      return;
    }
    if (chapter.novelId !== novelId) {
      // id 撞库的防御性跳过：不清理、不索引
      logger.warn('章级索引回填跳过：章节归属与任务不符', { chapterId });
      return;
    }
    const content = chapter.content || '';
    if (content.replace(/\s/g, '').length < minContentChars()) return;
    if (getChapterChunkText(novelId, chapterId, 0) === content) return;
    await upsertChapterChunk(novelId, chapterId, content);
  } catch (error) {
    if (error instanceof Error && error.name === 'VectorIndexGenerationMismatchError') {
      logger.info('章级语义索引回填因数据库替换被丢弃', { chapterId });
      return;
    }
    // 正文已保存成功；embedding 失败只记日志（下次保存会再次入队）
    logger.warn('章级语义索引回填失败（不影响正文保存）', {
      chapterId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    // 处理期间新入队的脏章节也顺带排干，避免依赖下一个窗口
    for (;;) {
      const batch = [...dirty.values()];
      if (batch.length === 0) break;
      dirty.clear();
      for (const item of batch) {
        await processEntry(item);
      }
    }
  } finally {
    flushing = false;
  }
}

/** 测试钩子：立即排干队列 / 查看待处理数 / 清空队列与定时器。 */
export const __chapterIndexTestHooks = {
  flushNow: (): Promise<void> => flush(),
  pendingCount: (): number => dirty.size,
  reset: (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    dirty.clear();
  },
};
