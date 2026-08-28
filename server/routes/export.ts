import type { Express } from 'express';
import type { Novel, Chapter } from '../../shared/types';
import * as db from '../lib/db';
import { logger } from '../logger';
import { validate, exportSchema } from '../validation';

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function buildEpub(novel: Novel, chapters: Chapter[]): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const escTitle = escXml(novel.title);

  // mimetype (must be first, uncompressed)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const sorted = [...chapters].sort((a, b) => a.order - b.order);

  // content.opf
  const manifestItems = sorted.map((_, i) =>
    `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`
  ).join('\n');
  const spineItems = sorted.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escTitle}</dc:title>
    <dc:creator>InkFlow</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="book-id">urn:inkflow:${novel.id}</dc:identifier>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>${spineItems}</spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  // Navigation
  const navLinks = sorted.map((ch, i) =>
    `<li><a href="ch${i}.xhtml">第${ch.order ?? '?'}章 ${escXml(ch.title)}</a></li>`
  ).join('\n');
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><h2>目录</h2><ol>${navLinks}</ol></nav></body>
</html>`;
  zip.file('OEBPS/nav.xhtml', nav);

  // Chapter files
  for (let i = 0; i < sorted.length; i++) {
    const ch = sorted[i];
    const escChapterTitle = escXml(ch.title);
    const paragraphs = (ch.content || '').split('\n').map((line: string) =>
      `<p>${line ? escXml(line) : '&nbsp;'}</p>`
    ).join('\n');
    const html = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第${ch.order ?? '?'}章 ${escChapterTitle}</title></head>
<body><h2>第${ch.order ?? '?'}章 ${escChapterTitle}</h2>
${paragraphs}
</body>
</html>`;
    zip.file(`OEBPS/ch${i}.xhtml`, html);
  }

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function registerExportRoutes(app: Express) {
  app.post('/api/export', validate(exportSchema), async (req, res) => {
    try {
      const { novelId, format } = req.body;

      const novel = db.getNovel(novelId);
      if (!novel) return res.status(404).json({ error: '作品不存在，请刷新项目后重试。' });

      const chapters = db.listChapters(novelId);
      if (format === 'epub') {
        const buf = await buildEpub(novel, chapters);
        res.setHeader('Content-Type', 'application/epub+zip');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.epub"`);
        res.send(buf);
      } else {
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
    } catch (e) {
      logger.error('Export failed:', e);
      res.status(500).json({ error: '作品导出失败，请稍后重试。' });
    }
  });
}
