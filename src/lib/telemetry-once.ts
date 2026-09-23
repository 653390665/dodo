/**
 * 一次性产品埋点去重（跨页面生命周期）。
 *
 * 背景：`writing_style_required` / `first_content_input` 语义上是「某个事实首次发生」，
 * 但去重此前只放在组件 ref（随卸载/刷新重置），在开发态热重载下同一事实被重复上报
 * （2026-09 复核实测：313 条 writing_style_required 只对应 19 个指纹）。
 * 这里把去重键持久化到 localStorage，让事件流回到「一个事实一条」。
 *
 * 纯本地、无网络；localStorage 不可用（隐私模式/配额）时退化为进程内存去重，
 * 埋点本身仍照常发送，不改变任何用户行为。
 */
const memoryKeys = new Set<string>();
const STORAGE_PREFIX = 'inkflow.telemetry.once.';

/**
 * 尝试「认领」一个一次性埋点键：
 * - 返回 true 表示这是首次认领，调用方应当上报；
 * - 返回 false 表示本进程或本浏览器此前已认领过，调用方应跳过上报。
 */
export function claimProductEventOnce(key: string): boolean {
  if (memoryKeys.has(key)) return false;
  memoryKeys.add(key);
  try {
    const storage = globalThis.localStorage;
    if (!storage) return true;
    const storageKey = `${STORAGE_PREFIX}${key}`;
    if (storage.getItem(storageKey)) return false;
    storage.setItem(storageKey, '1');
  } catch {
    // localStorage 不可用（隐私模式、配额、非浏览器环境）时仅依赖内存去重。
  }
  return true;
}

/** 仅测试用：清空进程内去重记忆。 */
export function resetProductEventOnceMemory(): void {
  memoryKeys.clear();
}

/** 仅测试用：清空 localStorage 中本模块写入的去重键（不影响其它 key）。 */
export function resetProductEventOnceStorage(): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // 非浏览器环境或 localStorage 不可用时无需清理。
  }
}
