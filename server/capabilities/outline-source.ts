import type { OutlineSourceSelection, OutlineSourceSelectionInput } from '../../shared/types/outline-source.js';
import { getContinuationPack } from '../lib/db/continuation.js';

export class OutlineSourceSelectionError extends Error {
  constructor(public readonly code: 'OUTLINE_SOURCE_CROSS_NOVEL' | 'OUTLINE_SOURCE_REPORT_FORBIDDEN' | 'OUTLINE_SOURCE_OVER_BUDGET' | 'OUTLINE_SOURCE_INVALID', message: string) {
    super(`${code}: ${message}`);
  }
}

const REPORT_SIGNAL = /审稿|审查|审计|评审|批评|评分|报告|问题清单|review|critique|audit|score|issue list/i;

function isUnlabeledReport(document: NonNullable<ReturnType<typeof getContinuationPack>>['sourceDocuments'][number]): boolean {
  const metadata = document as unknown as Record<string, unknown>;
  if (metadata.role !== undefined) return false;
  return REPORT_SIGNAL.test([
    document.filename,
    document.excerpt,
    document.text.slice(0, 240),
  ].join('\n'));
}

export function selectOutlineSource(input: OutlineSourceSelectionInput): OutlineSourceSelection {
  const pack = getContinuationPack(input.continuationPackId);
  if (!pack || pack.novelId !== input.novelId) throw new OutlineSourceSelectionError('OUTLINE_SOURCE_CROSS_NOVEL', '所选资料不属于当前作品。');
  if (pack.status !== 'approved') throw new OutlineSourceSelectionError('OUTLINE_SOURCE_INVALID', '请先确认导入资料，再用于生成大纲。');
  const referenceIds = input.referenceDocumentIds || [];
  const ids = [input.primaryDocumentId, ...referenceIds];
  if (!input.primaryDocumentId || new Set(ids).size !== ids.length || referenceIds.length > 5) throw new OutlineSourceSelectionError('OUTLINE_SOURCE_INVALID', '所选大纲资料无效，请重新选择。');
  const docs = ids.map((id) => pack.sourceDocuments.find((document) => document.id === id));
  if (docs.some((document) => !document)) throw new OutlineSourceSelectionError('OUTLINE_SOURCE_INVALID', '所选资料不在当前导入包中，请重新选择。');
  const selected = docs as NonNullable<(typeof docs)[number]>[];
  const [primary, ...references] = selected;
  const primaryMetadata = primary as unknown as Record<string, unknown>;
  if (isUnlabeledReport(primary)) {
    throw new OutlineSourceSelectionError('OUTLINE_SOURCE_REPORT_FORBIDDEN', '审查报告不能作为主大纲来源，请选择大纲候选。');
  }
  if (primary.kind !== 'outline' || (primaryMetadata.role !== undefined && primaryMetadata.role !== 'outline-candidate'))
    throw new OutlineSourceSelectionError('OUTLINE_SOURCE_INVALID', '请选择大纲候选作为主来源。');
  if (selected.some((document) => {
    const metadata = document as unknown as Record<string, unknown>;
    return document !== primary && (isUnlabeledReport(document) || !['outline', 'world', 'characters'].includes(document.kind) || (metadata.role !== undefined && metadata.role !== 'outline-reference'));
  })) throw new OutlineSourceSelectionError('OUTLINE_SOURCE_REPORT_FORBIDDEN', '审查报告或正文资料不能作为大纲来源。');
  const content = [
    `【主大纲输入】\n${primary.text}`,
    ...references.map((document, index) => `【补充参考 ${index + 1}】\n${document.text}`),
  ].join('\n\n');
  if (content.length > 120_000) throw new OutlineSourceSelectionError('OUTLINE_SOURCE_OVER_BUDGET', '所选资料过长，请减少参考资料后重试。');
  return {
    novelId: input.novelId,
    kind: 'candidate',
    content,
    primaryDocumentId: input.primaryDocumentId,
    referenceDocumentIds: [...referenceIds],
    status: 'candidate',
    active: false,
  };
}
