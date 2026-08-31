// Chapter/Book PDF export via the browser print pipeline (plan A in
// docs/plans/chapter-pdf-export.md): zero dependencies, native CJK rendering.
// The user saves to PDF from the system print dialog.

interface PdfSource {
  title: string;
  content: string;
}

const PDF_STYLE = `
  @page { size: A4; margin: 2cm 2.5cm; }
  body { font-family: "Songti SC", "Noto Serif CJK SC", "SimSun", serif; color: #1a1a1a; line-height: 1.8; }
  h1 { font-size: 18pt; margin-bottom: 1.5em; }
  h2 { font-size: 15pt; margin: 1.2em 0 0.6em; }
  p { font-size: 12pt; text-indent: 2em; margin: 0 0 0.8em; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
`;

function buildPdfHtml(novelTitle: string, chapters: PdfSource[], bookMode: boolean): string {
  const body = chapters.map((chapter) => {
    const heading = bookMode ? `<h2>${escapeHtml(chapter.title)}</h2>` : `<h1>${escapeHtml(chapter.title)}</h1>`;
    const paragraphs = chapter.content
      .split(/\n\s*\n/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
      .join('');
    return `<section class="chapter">${heading}${paragraphs}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${escapeHtml(novelTitle)}</title><style>${PDF_STYLE}</style></head>
<body>${bookMode ? `<h1>${escapeHtml(novelTitle)}</h1>` : ''}${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printHtml(html: string): void {
  const printWindow = window.open('', '_blank', 'width=800,height=900');
  if (!printWindow) {
    window.alert('浏览器拦截了打印窗口，请允许弹窗后重试。');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  // Wait for the document to settle before invoking the native print dialog.
  const tryPrint = () => {
    if (printWindow.document.readyState === 'complete') {
      printWindow.focus();
      printWindow.print();
    } else {
      setTimeout(tryPrint, 100);
    }
  };
  setTimeout(tryPrint, 200);
}

export function exportChapterToPdf(chapter: PdfSource, novelTitle: string): void {
  printHtml(buildPdfHtml(novelTitle, [chapter], false));
}

export function exportBookToPdf(chapters: PdfSource[], novelTitle: string): void {
  printHtml(buildPdfHtml(novelTitle, chapters, true));
}