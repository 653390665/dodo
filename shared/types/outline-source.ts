export type OutlineSourceKind = 'project' | 'candidate' | 'continuation-pack' | 'report';

export interface OutlineSourceSelectionInput {
  readonly novelId: string;
  readonly continuationPackId: string;
  readonly primaryDocumentId: string;
  readonly referenceDocumentIds?: readonly string[];
}

export interface OutlineSourceSelection {
  readonly novelId: string;
  readonly kind: Exclude<OutlineSourceKind, 'report'>;
  readonly content: string;
  readonly primaryDocumentId: string;
  readonly referenceDocumentIds: readonly string[];
  readonly status: 'candidate';
  readonly active: false;
}
