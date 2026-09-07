import { create } from 'zustand';
import type { WritingStyleCandidate, WritingStyleResolution } from '../../shared/types';

/**
 * 005-S4：写法确认域的展示状态归属。
 *
 * 分工（与 production-store 同约定）：
 * - store 只存 resolution/candidates/error 三个展示态；
 * - 留存化的命令式守卫（请求竞态序号、confirmedWritingStyleFingerprint、
 *   requiredWritingStyleFingerprints、pendingWritingStyleAction）保留在
 *   EditorView 的 refs 里，它们是写法确认留存化的核心比对逻辑，不是跨组件状态；
 * - confirm/resolve/generate 等副作用仍由 EditorView 的回调承担。
 */
export interface WritingStyleState {
  resolution: WritingStyleResolution | null;
  candidates: WritingStyleCandidate[];
  error: string | null;
  setWritingStyleResolution: (resolution: WritingStyleResolution | null) => void;
  setWritingStyleCandidates: (candidates: WritingStyleCandidate[]) => void;
  setWritingStyleError: (error: string | null) => void;
}

export const useWritingStyleStore = create<WritingStyleState>((set) => ({
  resolution: null,
  candidates: [],
  error: null,
  setWritingStyleResolution: (resolution) => set({ resolution }),
  setWritingStyleCandidates: (candidates) => set({ candidates }),
  setWritingStyleError: (error) => set({ error }),
}));
