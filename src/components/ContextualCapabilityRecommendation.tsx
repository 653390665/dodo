import React from 'react';
import type { CapabilityRecommendationResult } from '../../shared/types/capability-recommendation';

export interface ContextualCapabilityRecommendationProps {
  result: CapabilityRecommendationResult;
  onSelect?: (capabilityId: string) => void;
  onDismiss?: () => void;
  onOpenStore?: () => void;
}

export function ContextualCapabilityRecommendation({ result, onSelect, onDismiss, onOpenStore }: ContextualCapabilityRecommendationProps) {
  if (!result.primary) return null;
  const render = result.primary;
  const modeLabel = render.usageMode === 'persistent-rule' ? '持续规则' : render.usageMode === 'flow-step' ? '创作流程' : '单次能力';
  return <section aria-label="上下文能力推荐" className="rounded border border-theme-border bg-theme-sidebar p-3">
    <div className="text-sm font-medium">诊断问题</div>
    <p className="mt-1 text-sm text-theme-muted">{render.diagnosis || render.reason}</p>
    <div className="mt-2 text-sm">预期产物变化：{render.expectedArtifactChange || render.manifest.artifactContract?.output || render.manifest.output}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => onSelect?.(render.capabilityId)}>{modeLabel}：使用 {render.capabilityId}</button>
      {result.alternatives.map((entry) => <button type="button" key={entry.capabilityId} onClick={() => onSelect?.(entry.capabilityId)}>{entry.usageMode === 'persistent-rule' ? '持续规则' : entry.usageMode === 'flow-step' ? '创作流程' : '单次能力'}：使用 {entry.capabilityId}</button>)}
      {onDismiss ? <button type="button" onClick={onDismiss}>暂不推荐</button> : null}
      {onOpenStore ? <button type="button" onClick={onOpenStore}>前往能力商店</button> : null}
    </div>
  </section>;
}

export default ContextualCapabilityRecommendation;
