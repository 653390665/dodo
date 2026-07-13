# Plan 118: Batch metadata loading in Library view (DEFERRED)

> **Note**: This plan is DEFERRED. Plan 115 already resolved the primary issue
> (Library was fetching full `Chapter[]` with content; now uses `ChapterMetadata[]`
> without content). The remaining optimization (N individual metadata requests →
> 1 batch request) is a marginal improvement with MED risk and low ROI. Revisit
> if Library load time becomes a measured bottleneck with 50+ novels.

## Status

- **Priority**: P3 (downgraded from P1)
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `a90ff4bb`, 2026-07-10
- **Status**: DEFERRED

## Why deferred

1. Plan 115 eliminated the content payload (~100KB per chapter) by switching from `listChapters` to `listChaptersMetadata`. The metadata response is tiny (~200 bytes per chapter).
2. With 20 novels × 5 chapters average, the N+1 metadata requests total ~20KB — negligible.
3. A batch endpoint would reduce HTTP round-trips but adds server-side complexity (new function, whitelist entry, client function) for marginal gain.
4. The real N+1 concern was payload size, not request count — and that's already fixed.

## Original problem (for reference)

The Library view called `listChaptersMetadata(novelId)` and `listContinuationPacks(novelId)` once per novel. With 50+ novels, this generated 100+ individual requests through the `/api/db` proxy. Plan 115 fixed the payload issue; this plan would fix the request-count issue.

## When to revisit

- If a user reports slow Library loading with 100+ novels
- If continuation pack counts grow significantly
- If the SSE-driven `subscribeToChanges → loadMetadata` refresh is measured to cause UI jank