# InkFlow Unified Creation Workflow Design

**Date:** 2026-08-13
**Status:** Confirmed product design
**Scope:** Repeatable chapter creation, structured creative artifacts, story memory, and capability orchestration

## Decision

InkFlow will provide one repeatable professional writing workflow from project creation or import through starting the next chapter. Authors make creative decisions; the system owns memory, validation, orchestration, versioning, and recovery.

The first delivery ends when both a new-project author and an imported-project author can complete one chapter and create the next chapter. Whole-book typesetting, commercial publication, and a general graph database are outside this delivery.

## Product Principles

1. Only creative decisions appear as primary workflow actions.
2. System maintenance runs in the background and surfaces only exceptions.
3. No AI output modifies manuscript text or Canon without author confirmation.
4. Existing manuscript text is evidence of what happened; later planning cannot silently rewrite it.
5. Structured facts support validation; readable prose remains available for author expression.
6. Every applied candidate is versioned, attributable, and reversible.
7. AI unavailability never blocks manual writing, saving, or chapter creation.
8. A capability is an atomic execution unit; a flow is a versioned orchestration of capabilities.

## Target Users

The primary users are serious fiction authors and commercial web-fiction authors who need reliable output, long-form continuity, and controllable AI assistance. New writers enter the same professional model through progressive guidance; InkFlow will not maintain separate beginner and professional creation models.

## Author Journey

```text
Create project or import material
  -> Confirm world, characters, and master outline
  -> State the current chapter goal
  -> Generate or edit chapter outline / scene beats
  -> Confirm the plan before AI prose generation
  -> Generate a prose preview or write manually
  -> Accept the prose
  -> Complete chapter
       -> deterministic checks
       -> one AI quality/continuity review when available
       -> local revision previews for evidenced issues
       -> accept fixes or explicitly accept risk
  -> Confirm chapter fact candidates
  -> Create next chapter
```

The Editor presents one state-derived primary action:

```text
Generate plan -> Generate prose -> Complete chapter -> Resolve issues -> Create next chapter
```

Audit, foreshadowing scans, context synchronization, character-state updates, and capability-store navigation are not peer-level primary actions.

## Domain Model

### Creative Artifacts

Every governed artifact has a structured core, readable content, version, provenance, and lifecycle state.

```ts
type CreativeArtifactKind =
  | 'world'
  | 'character'
  | 'master-outline'
  | 'volume-outline'
  | 'chapter-outline'
  | 'scene-beats';

type CreativeArtifactStatus = 'candidate' | 'active' | 'archived';

interface CreativeArtifactRef {
  kind: CreativeArtifactKind;
  id: string;
  version: number;
}
```

The existing `outline_artifacts` model remains the outline storage boundary. Its readable `content` is preserved. Structured outline cores are additive and are never inferred as accepted truth without confirmation.

Authority is explicit:

- The active master `outline_artifacts` row is the authoritative master outline.
- `Novel.globalOutline` is a compatibility mirror updated transactionally when the active master changes.
- Active scoped outline artifacts are authoritative for their volume/chapter scope.
- A candidate or Canon Patch is never authoritative until accepted.
- If the active master and compatibility mirror differ, the system reports an integrity error; it does not choose the newer string silently.

### Structured Outline Core

```ts
interface OutlineNode {
  id: string;
  parentNodeId?: string;
  type: 'premise' | 'conflict' | 'turn' | 'climax' | 'resolution' | 'character-arc' | 'foreshadowing';
  title: string;
  intent: string;
  order: number;
  characterIds: string[];
  foreshadowingIds: string[];
}

interface StructuredOutlineCore {
  schemaVersion: 1;
  nodes: OutlineNode[];
}
```

Lower-level outline nodes reference upstream node IDs. This makes loss, contradiction, premature revelation, and stale downstream plans detectable without relying only on free-text interpretation.

### Structured World Core

```ts
interface StructuredWorldCore {
  schemaVersion: 1;
  hardRules: Array<{ id: string; statement: string }>;
  powerConstraints: Array<{ id: string; statement: string; cost?: string }>;
  prohibitions: Array<{ id: string; statement: string }>;
  factionConstraints: Array<{ id: string; factionId: string; statement: string }>;
}
```

The existing `Novel.worldRules` text remains readable source material. The structured core is activated only through a reviewed candidate.

### Structured Character Core

```ts
interface CharacterCore {
  schemaVersion: 1;
  desire: string;
  externalGoal: string;
  internalNeed: string;
  fear: string;
  woundOrFalseBelief: string;
  strengths: string[];
  flaws: string[];
  contradictions: string[];
  speechPattern: string;
  habitualActions: string[];
  decisionPattern: string;
  relationshipTensions: Array<{ characterId: string; tension: string }>;
  arc: {
    start: string;
    turns: string[];
    target: string;
  };
  immutableFacts: string[];
}
```

`Character.bio` remains author-readable prose. Imported facts are Canon and cannot be overwritten by a capability. A character capability produces an additive or corrective candidate with field-level provenance.

## Story Memory

### Authority and Projection

The story-memory layer is not a second copy of Canon.

- Existing domain records remain authoritative: characters, items, timeline events, foreshadowings, chapters, and relationships.
- A story-memory graph projects nodes and edges from those records.
- Editing a projected node updates its authoritative domain record through the existing candidate/confirmation boundary.
- No duplicate foreshadowing state is stored in `entity_relationships`.

The current relationship graph expands into a story-memory view:

```text
Nodes: characters, locations, items, factions, chapters, timeline events, narrative promises
Edges: relates-to, appears-in, holds, occurs-in, planted-in, hinted-in, paid-off-in, supports-outline-node
```

### Narrative Promises

Foreshadowing is modeled as a narrative promise with separate plan and evidence state.

```ts
interface NarrativePromisePlan {
  intent: string;
  revealConstraint?: string;
  plannedPlantRange?: { from: number; to: number };
  plannedHintRanges: Array<{ from: number; to: number }>;
  plannedPayoffRange?: { from: number; to: number };
  sourceOutlineNodeIds: string[];
}

interface NarrativePromiseEvidence {
  chapterId: string;
  action: 'plant' | 'hint' | 'payoff';
  quote: string;
  location?: string;
  confirmedAt: number;
}

interface NarrativePromiseCore {
  schemaVersion: 1;
  plan: NarrativePromisePlan;
  evidence: NarrativePromiseEvidence[];
}
```

The existing `Foreshadowing.status` remains a compatibility projection. It is derived from confirmed evidence, not from an outline's planned action.

### Cross-Level Validation

Validation checks must be deterministic where possible and AI-assisted only where semantic judgment is required.

1. Master outline defines why a promise exists and its final purpose.
2. Volume outline assigns plant, reinforce, misdirect, and payoff windows.
3. Chapter outline assigns the current chapter action.
4. Manuscript evidence records what actually occurred.
5. A missed planned window becomes overdue or deferred, never silently paid off.
6. A newly discovered manuscript promise becomes a chapter fact candidate and an upstream outline-impact candidate.
7. Changing an upstream outline marks linked downstream artifacts for review; it does not rewrite them.

## Candidate and Impact Model

World, character, outline, scene-beat, Canon, and manuscript transformations share one lifecycle.

```ts
type ArtifactOperation = 'diagnose' | 'generate' | 'restructure' | 'optimize' | 'validate';

interface ArtifactCandidate<T = unknown> {
  id: string;
  novelId: string;
  target: CreativeArtifactRef;
  operation: ArtifactOperation;
  goal: string;
  baseFingerprint: string;
  sourceCapabilityVersions: Array<{ capabilityId: string; version: string }>;
  proposedCore: T;
  proposedContent?: string;
  diff: ArtifactDiff;
  impactReport: ArtifactImpactReport;
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
}
```

Candidate application requirements:

- Database generation and base fingerprint must still match.
- The candidate must target the current novel and artifact version.
- Canon-affecting changes are confirmed field by field or as an explicitly reviewed group.
- Applying creates a new version and preserves the previous version.
- Downstream artifacts identified by the impact report are marked `review-required`.
- Existing manuscript conflicts require an explicit choice: revise the proposal or create a separate manuscript revision candidate.

No candidate application automatically rewrites accepted manuscript text.

### Storage Adapters

The lifecycle is unified at the contract and service level, not forced into one duplicate database table.

- Outline generation continues to use candidate `outline_artifacts`; outline changes continue to use `canon_patches` and their existing base fingerprint.
- Manuscript previews continue to use chapter production runs and versions.
- Chapter fact changes extend the existing continuity patch preview but stop applying Canon during prose acceptance.
- World/character structured candidates use the new generic artifact-candidate persistence because no equivalent accepted candidate store exists today.
- All adapters expose the same candidate envelope, decision states, stale checks, diff, impact report, and provenance.

No adapter stores a second authoritative copy of an outline, manuscript, foreshadowing, or character record.

## Capability Model

### Three Usage Semantics

```ts
type CapabilityUsageMode = 'single-run' | 'persistent-rule' | 'flow-step';
```

1. **Single-run capability:** performs one diagnosis, generation, restructuring, optimization, or validation.
2. **Persistent rule:** participates automatically at project or chapter scope.
3. **Creation flow:** orders atomic capabilities and records dependencies and completion.

### Capability Contract

Every executable capability declares:

```ts
interface ArtifactCapabilityContract {
  artifactKinds: CreativeArtifactKind[];
  operations: ArtifactOperation[];
  allowedScopes: Array<'project' | 'volume' | 'chapter' | 'selection' | 'single-run'>;
  requiredInputs: CreativeArtifactKind[];
  output: 'diagnostic' | 'artifact-candidate' | 'transform-preview' | 'configuration';
  canonEffect: 'none' | 'candidate-only';
}
```

An incompatible capability cannot execute against the current artifact. Taking a capability out of a flow is allowed when all required inputs exist. Missing inputs produce a precise gap and recovery action, not a fabricated result.

### Creation Flow

A flow references capability IDs and frozen versions. It owns ordering, prerequisites, optionality, and stage gates; it never embeds a copy of capability implementation.

```ts
interface CreationFlowStep {
  id: string;
  capabilityId: string;
  capabilityVersion: string;
  dependsOn: string[];
  requiredArtifactKinds: CreativeArtifactKind[];
  producedArtifactKind: CreativeArtifactKind;
  required: boolean;
}
```

A step completes only when a compatible output has been accepted and its artifact version is recorded. Capability upgrades create a migration candidate; they never alter an active flow silently.

Flows primarily support zero-to-one creation. Imported or mature projects enter at the first stage whose required artifacts are missing or stale.

### Recommendations

Recommendations are contextual and deduplicated by issue fingerprint plus artifact version.

- Show one primary recommendation and at most two alternatives.
- Explain the problem solved before card metadata.
- Ignoring a recommendation suppresses it for the current artifact version.
- It can reappear only after content/upstream changes or risk escalation.
- Full capability browsing remains an advanced management action.

### Capability Composition

When more than one capability targets the same artifact, the runtime resolves one bounded composition before model execution.

```ts
interface CapabilityCompositionConflict {
  field: string;
  capabilityIds: string[];
  rules: string[];
  resolution: 'author-choice-required' | 'compatible';
}
```

- Compatible rules form one frozen execution snapshot and one candidate.
- Conflicting rules are shown before execution; application order cannot silently choose a winner.
- The system preselects the diagnosed optimization goal, and the author may change it without visiting the store.
- The resulting candidate records every capability version and the chosen conflict resolutions.

## Chapter Completion Orchestrator

### Quality Layers

Generation-time Critic and chapter completion review have different roles.

- Generation-time Critic is an internal draft-quality loop with bounded retries.
- Chapter completion review validates the accepted manuscript, including manual edits.
- A separate user-facing audit step is not required when a current trusted review already exists.

### Completion State

```ts
type ChapterCompletionGate =
  | 'drafting'
  | 'review-required'
  | 'needs-action'
  | 'ready'
  | 'accepted-risk';
```

`Complete chapter` performs:

1. Flush pending editor writes.
2. Persist an immutable chapter version.
3. Run deterministic validation.
4. Reuse a current trusted production review, or run one AI review when available.
5. Store explicit pass, fail, or unknown state bound to the manuscript and plan hash.
6. Produce local revision candidates only for issues with manuscript evidence and a bounded target.
7. Produce one combined chapter-fact candidate: character, item, timeline, location, power, and narrative-promise changes.
8. Allow fixes, explicit accepted risk, or return to editing.
9. Enable `Create next chapter` only after the author records a completion decision.

AI failure leaves the chapter as `review-required` or `unknown`; manual writing, saving, and explicit risk acceptance remain available. Partial AI output is preview-only and cannot become a successful review or Canon update.

Long-running completion work records its last durable phase (`writes-flushed`, `version-created`, `deterministic-checked`, `ai-reviewed`, `facts-proposed`). A retry resumes from the last valid phase when the bound manuscript/plan hash and database generation still match; otherwise it starts a new completion attempt without deleting the failed record.

## User Interface

### Editor

- One state-derived primary action.
- Lightweight quality state: passed, issues found, or AI check incomplete.
- Details and evidence are collapsed by default.
- Revision candidates show a diff and never overwrite on generation.
- Chapter fact candidates are combined into one confirmation surface.
- The advanced tools area contains manual re-scan, full audit reports, memory maintenance, and capability management.

### Planning and World Views

- Each artifact shows current version and upstream freshness.
- Contextual capability recommendations appear beside the current artifact, not as a forced store detour.
- Candidate review uses the same status and diff language across world, character, and outline artifacts.
- Story memory graph initially adds chapter and narrative-promise nodes to the existing entity graph.

## Legacy Data

Existing text fields are never destructively migrated.

1. Legacy outline content, world rules, character Bio, scene beats, and foreshadowing records remain readable and active.
2. The system may generate a structured candidate from legacy text.
3. The candidate is not active until the author confirms it.
4. No AI parser output becomes Canon merely because migration ran.
5. Existing chapters without current trusted review metadata appear as `review-required`; their text is unchanged.

## Data Integrity and Safety

- Schema changes are additive only.
- Every write validates novel ownership and database generation.
- Candidate apply uses a transaction and stale base fingerprint rejection.
- Tests use `:memory:` or isolated temporary databases, never the running `data.db`.
- No new dependency is required.
- SQLite WAL export continues to use the native backup API and existing cleanup guarantees.
- Model/API-key detection keeps the configured/not-configured/unknown truth model.

## Delivery Phases

### Phase 1: Foundations

Add versioned structured artifact cores, narrative-promise plan/evidence, capability contracts, candidates, impacts, and legacy read behavior. No broad UI change.

### Phase 2: Planning and Character Governance

Connect master/volume/chapter outlines, characters, world rules, and contextual capability candidates. Add cross-level validation and Canon protection.

### Phase 3: Story Memory

Project chapters and narrative promises into the existing graph. Add combined chapter-fact candidates and remove foreshadowing scanning from the primary workflow.

### Phase 4: Chapter Completion

Unify production Critic, accepted manuscript review, local revisions, accepted risk, and next-chapter readiness behind one Editor primary action.

### Phase 5: Migration and Journey Gate

Offer opt-in structured candidates for legacy text and verify new-project and imported-project end-to-end journeys.

## Acceptance

The design is complete only when current evidence proves:

1. A new project reaches a confirmed first chapter and creates chapter two.
2. An imported project preserves source Canon, accepts selected improvements, completes a chapter, and creates the next chapter.
3. Planning changes produce impacts rather than silent downstream rewrites.
4. Narrative-promise plan and manuscript evidence cannot be confused.
5. Character capability output cannot overwrite imported Canon without confirmation.
6. A flow step and the same capability used independently share one implementation and contract.
7. AI failure leaves local writing and explicit continuation available with honest status.
8. Existing project data remains readable and unchanged until a candidate is accepted.

## Non-Goals

- Whole-book layout, EPUB compilation, or commercial publishing.
- Replacing SQLite with a graph database.
- Automatically rewriting all downstream artifacts after an upstream change.
- Automatically applying inferred Canon or character facts.
- Running AI diagnosis on every keystroke.
- Forcing capability selection before writing.
- Maintaining separate beginner and professional creation engines.
