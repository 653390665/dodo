import type { Express } from 'express';
import * as db from '../../src/lib/db';
import { buildChapterProductionTitle } from '../../src/lib/chapter-production';

export function registerExportRoutes(app: Express) {
  app.post('/api/export', async (req, res) => {
    try {
      const { novelId, format } = req.body;
      if (!novelId) return res.status(400).json({ error: 'Missing novelId' });

      const novel = db.getNovel(novelId);
      if (!novel) return res.status(404).json({ error: 'Novel not found' });

      const chapters = db.listChapters(novelId);
      if (format === 'epub') {
        // EPUB export logic stays here for now
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        // ... (preserve existing EPUB logic from server.ts lines 2722-2824)
        // For now, delegate to the existing implementation
        res.status(501).json({ error: 'EPUB export not yet migrated' });
      } else {
        // TXT export
        const lines: string[] = [];
        lines.push(`${novel.title}`);
        lines.push(`作者: ${novel.authorId}`);
        lines.push('');
        for (const chapter of chapters.sort((a, b) => a.order - b.order)) {
          lines.push(`${chapter.title}`);
          lines.push('');
          lines.push(chapter.content || '');
          lines.push('');
          lines.push('---');
          lines.push('');
        }
        const content = lines.join('\n');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.txt"`);
        res.send(content);
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
