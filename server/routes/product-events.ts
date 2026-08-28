import type { Express } from 'express';
import { z } from 'zod';
import { validate } from '../validation.js';
import { clearProductEvents, createProductEvent, getProductEventMetrics, listProductEvents } from '../lib/db/product-events.js';
import { PRODUCT_EVENT_NAMES, PRODUCT_EVENT_STAGES } from '../../shared/types/product-events.js';

export const productEventSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  eventId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  sessionId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  occurredAt: z.number().int().nonnegative().optional(),
  eventName: z.enum(PRODUCT_EVENT_NAMES),
  stage: z.enum(PRODUCT_EVENT_STAGES),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  result: z.enum(['success','failure','unknown']),
  qualityStatus: z.enum(['pass','fail','unknown']).optional(),
  errorCode: z.string().max(200).optional(),
  novelId: z.string().min(1).max(200).optional(),
  chapterId: z.string().min(1).max(200).optional(),
  objectId: z.string().min(1).max(200).optional(),
  sourceType: z.enum(['built-in', 'plaza', 'licensed', 'book-extracted', 'unknown']).optional(),
  action: z.string().min(1).max(100).optional(),
  count: z.number().int().nonnegative().max(1_000_000).optional(),
  fingerprint: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
}).strict();

export function registerProductEventRoutes(app: Express) {
  app.post('/api/product-events', validate(productEventSchema), (req, res) => {
    try { return res.status(201).json(createProductEvent(req.body)); }
    catch { return res.status(500).json({ error: 'Failed to record product event' }); }
  });
  app.get('/api/product-events/metrics', (req, res) => {
    const parsed = z.coerce.number().int().min(1).max(365).optional().safeParse(req.query.days);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid days' });
    try { return res.json(getProductEventMetrics(parsed.data ?? 30)); }
    catch { return res.status(500).json({ error: 'Failed to load product event metrics' }); }
  });
  app.get('/api/product-events/export', (_req, res) => {
    try { res.attachment('inkflow-product-events.json').type('application/json').send(JSON.stringify(listProductEvents())); }
    catch { res.status(500).json({ error: 'Failed to export product events' }); }
  });
  app.delete('/api/product-events', (_req, res) => {
    try { clearProductEvents(); return res.json({ ok: true }); }
    catch { return res.status(500).json({ error: 'Failed to clear product events' }); }
  });
}
