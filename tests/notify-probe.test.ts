import test from 'node:test';
import assert from 'node:assert/strict';

// 阈值在模块加载前设置（实现为惰性读取，测试内也可改，但提前设置更清晰）
process.env.INKFLOW_NOTIFY_PROBE_THRESHOLD = '3';

const { notify, subscribe, __notifyProbeTestHooks } = await import('../server/lib/db-instance');
const { logger } = await import('../server/logger');

test('notify probe logs a one-line summary when a window crosses the threshold', async (t) => {
  __notifyProbeTestHooks.reset();
  const originalInfo = logger.info;
  // 用数组收集日志：避免 TS 对「闭包赋值 + 断言收窄」链路的 never 窄化
  const captured: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  logger.info = (context: string, detail?: unknown) => {
    captured.push({ message: context, meta: detail as Record<string, unknown> | undefined });
  };
  t.after(() => {
    logger.info = originalInfo;
    __notifyProbeTestHooks.reset();
  });

  const unsubscribe = subscribe(() => {});
  try {
    // 窗口 1：t=0 起，3 次 notify（阈值 3）
    __notifyProbeTestHooks.setClock(() => 1_000_000);
    notify();
    notify();
    notify();
    assert.equal(captured.length, 0, '窗口未关闭前不应记日志');

    // 窗口 2 的第一次 notify 触发窗口 1 的汇总结算：3 ≥ 3 → 记一次
    __notifyProbeTestHooks.setClock(() => 1_000_000 + 60_001);
    notify();
    assert.equal(captured.length, 1, '跨窗后应输出一次汇总');
    assert.match(captured[0].message, /notify 负载观测/);
    assert.equal(captured[0].meta?.notificationsPerMinute as number, 3);
    assert.equal(captured[0].meta?.subscribers as number, 1);

    // 5 分钟去重窗内即使再次超阈也不再记（captured 停留在窗口 1 的汇总）
    const firstLogAt = 1_000_000 + 60_001;
    __notifyProbeTestHooks.setClock(() => firstLogAt + 60_001);
    notify();
    notify();
    notify();
    __notifyProbeTestHooks.setClock(() => firstLogAt + 120_002);
    notify();
    assert.equal(captured.length, 1, '去重窗内不重复记日志');
    assert.equal(
      __notifyProbeTestHooks.snapshot().lastLoggedAt,
      firstLogAt,
      'lastLoggedAt 停留在首次记录时刻',
    );
  } finally {
    unsubscribe();
  }
});
