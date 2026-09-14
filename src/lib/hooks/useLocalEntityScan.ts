import React from 'react';

/**
 * FNV-1a over the joined scan input — a cheap change detector so the debounced
 * scan only reruns when the cursor/content/entity set actually moved.
 */
function hashEntityScanInput(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

interface EntityNameSource {
  name: string;
}

interface UseLocalEntityScanOptions {
  contentRef?: React.RefObject<HTMLTextAreaElement | null>;
  currentChapter?: { id: string; content: string } | null;
  characters: EntityNameSource[];
  locations: EntityNameSource[];
  items: EntityNameSource[];
  factions: EntityNameSource[];
}

/**
 * Plan 222：主写作区实体扫描的去状态化 debounce hook。
 *
 * selection 事件不再 setState（每键重渲源）：监听器只标记脏并调度 400ms 防抖；
 * 定时器触发时直读 textarea 的 selectionStart/End 与当时全文做哈希比较，
 * 输入真变化才扫描。无 textarea 焦点/挂载时退化为全文扫描（与原实现一致）。
 */
export function useLocalEntityScan({
  contentRef,
  currentChapter,
  characters,
  locations,
  items,
  factions,
}: UseLocalEntityScanOptions): string[] {
  const [activeEntityNames, setActiveEntityNames] = React.useState<string[]>([]);
  const lastScanHashRef = React.useRef('');
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const schedule = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const textarea = contentRef?.current ?? null;
        const hash = hashEntityScanInput(
          [
            currentChapter?.id || '',
            currentChapter?.content || '',
            String(textarea?.selectionStart ?? -1),
            String(textarea?.selectionEnd ?? -1),
            ...characters.map((entity) => entity.name),
            ...locations.map((entity) => entity.name),
            ...items.map((entity) => entity.name),
            ...factions.map((entity) => entity.name),
          ].join('\u0000')
        );
        if (lastScanHashRef.current === hash) return;
        lastScanHashRef.current = hash;

        const fullText = currentChapter?.content || '';
        if (!currentChapter || !fullText) {
          setActiveEntityNames([]);
          return;
        }
        let textToScan = fullText;
        if (textarea) {
          const cursor = textarea.selectionStart || 0;
          textToScan = fullText.substring(
            Math.max(0, cursor - 1500),
            Math.min(fullText.length, cursor + 500)
          );
        }
        const matched: string[] = [];
        const collect = (entities: EntityNameSource[]) => {
          entities.forEach((entity) => {
            if (entity.name && textToScan.includes(entity.name)) matched.push(entity.name);
          });
        };
        collect(characters);
        collect(locations);
        collect(items);
        collect(factions);
        setActiveEntityNames(matched);
      }, 400);
    };

    schedule();
    const textarea = contentRef?.current;
    textarea?.addEventListener('select', schedule);
    textarea?.addEventListener('keyup', schedule);
    textarea?.addEventListener('mouseup', schedule);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      textarea?.removeEventListener('select', schedule);
      textarea?.removeEventListener('keyup', schedule);
      textarea?.removeEventListener('mouseup', schedule);
    };
  }, [contentRef, currentChapter, characters, locations, items, factions]);

  return activeEntityNames;
}
