import type { ContextReceipt } from './continuation.js';
import type { CapabilityStage } from './capability-execution.js';
import type { DraftQualityReport } from '../lib/quality-contract.js';

export interface CapabilityUtilityExecuteInput {
  readonly chapterId: string;
  readonly databaseGeneration: number;
  readonly stage?: CapabilityStage;
  readonly selection?: Readonly<{ start: number; end: number }>;
}

interface CapabilityUtilityResultBase {
  readonly capabilityId: string;
  readonly baselineHash: string;
  readonly contextReceipt: Readonly<ContextReceipt>;
  readonly readOnly: true;
  readonly resolvedAtGeneration?: number;
}

export interface CapabilityDiagnosticIssue {
  readonly category: string;
  readonly line: number;
  readonly snippet: string;
  readonly suggestion: string;
  readonly priority?: 'P0' | 'P1' | 'P2';
  readonly signal?: string;
  readonly range?: Readonly<{ start: number; end: number }>;
  readonly scope?: Readonly<{ paragraphStart: number; paragraphEnd: number; sentenceStart?: number; sentenceEnd?: number }>;
}

export interface CapabilityStructureSignal extends CapabilityDiagnosticIssue {
  readonly category: string;
}

export interface CapabilityDiagnosticResult extends CapabilityUtilityResultBase {
  readonly kind: 'diagnostic';
  readonly report: Readonly<{ issueCount: number; score?: number; issues: readonly CapabilityDiagnosticIssue[]; structureSignals?: readonly CapabilityStructureSignal[]; qualityMode?: 'deterministic' | string; needsContextRewrite?: boolean }>;
  readonly qualityMode?: 'deterministic' | string;
}

export interface CapabilityTransformPreviewResult extends CapabilityUtilityResultBase {
  readonly kind: 'transform-preview';
  readonly preview: string;
  readonly quality?: DraftQualityReport;
  readonly qualityMode?: 'deterministic-preview' | string;
  readonly structureSignals?: readonly CapabilityStructureSignal[];
  readonly contextRewrite?: Readonly<{
    readonly status: 'required' | 'not-required' | string;
    readonly retriable?: boolean;
    readonly originalTextRetained?: boolean;
  }>;
}

export type CapabilityUtilityResult = CapabilityDiagnosticResult | CapabilityTransformPreviewResult;
export type UtilityPreviewResponse = CapabilityUtilityResult;
export type UtilityResult = CapabilityUtilityResult;
