function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
  if (!match) return null;
  return decodeURIComponent(match[1].replace(/"/g, ''));
}

export async function downloadAuthenticatedFile(
  url: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: BodyInit;
    headers?: HeadersInit;
    fallbackFilename?: string;
  },
): Promise<void> {
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.headers,
    body: options?.body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(typeof err.error === 'string' ? err.error : `Download failed (${res.status})`);
  }

  const blob = await res.blob();
  const filename =
    parseContentDispositionFilename(res.headers.get('Content-Disposition')) ??
    options?.fallbackFilename ??
    'download';

  const objectUrl = URL.createObjectURL(blob);
  let downloadTriggered = false;
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    downloadTriggered = true;
  } finally {
    if (downloadTriggered) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } else {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export function downloadDbBackup(): Promise<void> {
  return downloadAuthenticatedFile('/api/db/export-file', {
    fallbackFilename: 'inkflow-data.db',
  });
}
