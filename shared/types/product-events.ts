export const PRODUCT_EVENT_NAMES = [
  'continuation_parse', 'continuation_confirm', 'continuation_conflict', 'world_sync',
  'scene_plan', 'draft_preview', 'critic_review', 'draft_accept', 'audit', 'polish', 'next_chapter', 'advanced_tools_open', 'factory_start', 'factory_complete', 'skill_equip',
  'editor_enter', 'first_content_input', 'content_save', 'continuation_skip',
  'assistant_request', 'assistant_success', 'assistant_empty_response', 'assistant_failure', 'assistant_retry', 'assistant_recovered',
  'writing_style_required', 'writing_style_confirmed', 'writing_style_stale',
  'writing_style_panel_opened', 'writing_style_panel_recovered', 'writing_style_panel_error',
  'deconstruction_card_stack', 'deconstruction_card_unstack', 'deconstruction_card_skip',
  'deconstruction_card_trial', 'deconstruction_card_restore',
  'capability_view', 'capability_assemble', 'capability_preview', 'capability_apply',
  'capability_cancel', 'capability_stale', 'capability_return', 'capability_artifact_accept',
  'capability_viewed', 'technique_favorited', 'skill_card_added', 'skill_deck_applied',
  'capability_config_cancelled', 'fusion_previewed', 'fusion_saved', 'chapter_overlay_used',
  'diagnostic_run', 'capability_returned_to_editor', 'technique_used',
  'capability_package_expanded', 'capability_package_component_selected', 'capability_package_result_launched',
] as const;
export type ProductEventName = typeof PRODUCT_EVENT_NAMES[number];

export const PRODUCT_EVENT_STAGES = ['import', 'review', 'sync', 'planning', 'drafting', 'audit', 'polish', 'next_chapter', 'advanced', 'assistant'] as const;
export type ProductEventStage = typeof PRODUCT_EVENT_STAGES[number];
export type ProductEventResult = 'success' | 'failure' | 'unknown';
export type ProductEventSourceType = 'built-in' | 'plaza' | 'licensed' | 'book-extracted' | 'unknown';

export interface ProductEventInput {
  schemaVersion?: 1;
  eventId?: string;
  sessionId?: string;
  occurredAt?: number;
  eventName: ProductEventName;
  stage: ProductEventStage;
  durationMs?: number;
  result: ProductEventResult;
  qualityStatus?: 'pass' | 'fail' | 'unknown';
  errorCode?: string;
  novelId?: string;
  chapterId?: string;
  objectId?: string;
  sourceType?: ProductEventSourceType;
  action?: string;
  count?: number;
  fingerprint?: string;
}

export interface ProductEvent extends ProductEventInput {
  id: string;
  createdAt: number;
}

export interface ProductEventMetrics {
  rangeDays: number;
  northStar: { acceptedChapters: number; activeNovels: number };
  rates: { previewAcceptance: RateMetric; syncCompletion: RateMetric; criticUnknown: RateMetric; conflict: RateMetric };
  generationLatencyMs: { p50: number | null; p95: number | null };
  sampleSize: number;
  stageCompletions: Array<{ stage: ProductEventStage; count: number }>;
  advancedAdoption: Array<{ eventName: 'advanced_tools_open' | 'factory_start' | 'factory_complete' | 'skill_equip'; count: number }>;
  assistant: AssistantMetrics;
  writingActivation: WritingActivationMetrics;
  writingStyle: WritingStyleMetrics;
  capabilities: CapabilityLifecycleMetrics;
}
export interface RateMetric { value: number | null; numerator: number; denominator: number; }
export interface WritingActivationMetrics {
  /** Distinct novels with a successful editor entry in the selected range. */
  editorEntries: number;
  /** Distinct novels with a successful first-content event in the selected range. */
  firstInputs: number;
  /** Distinct novels with a successful content-save event in the selected range. */
  contentSaves: number;
  /** Distinct novels with a successful continuation-skip event in the selected range. */
  continuationSkips: number;
  entryToFirstInput: RateMetric;
  skipToFirstInput: RateMetric;
  firstAiAssistCompletion: RateMetric;
}
export interface AssistantMetrics {
  requests: number;
  successes: number;
  emptyResponses: number;
  failures: number;
  retries: number;
  recovered: number;
  emptyResponseRate: RateMetric;
  failureRate: RateMetric;
  retryWithin5mRate: RateMetric;
  recoveryLatencyMs: { p50: number | null; p95: number | null };
  recoveredChapterAcceptance: RateMetric;
  successRate: RateMetric;
  retrySuccessRate: RateMetric;
}
export interface WritingStyleMetrics {
  confirmationCompletion: RateMetric;
  confirmationToDraftLatencyMs: { p50: number | null; p95: number | null };
  confirmedChapterAcceptance: RateMetric;
}

export interface CapabilityLifecycleMetrics {
  configurationCompletion: RateMetric;
  configurationViewChanges: number;
  conflictCancellation: RateMetric;
  storeToEditorReturn: RateMetric;
  cardDraftAcceptance: RateMetric;
  oneShotPreviewApplication: RateMetric;
  /** @deprecated Use oneShotPreviewApplication. */
  diagnosticPreviewApplication: RateMetric;
}
