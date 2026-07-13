import fs from 'fs';
import JSZip from 'jszip';
import mammoth from 'mammoth';

async function extractUploadedText(filename: string, filedata: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    return Buffer.from(filedata, 'base64').toString('utf8');
  }
  if (lower.endsWith('.docx')) {
    const buffer = Buffer.from(filedata, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (lower.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(Buffer.from(filedata, 'base64'));
    const texts: string[] = [];
    for (const [relativePath, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const name = relativePath.toLowerCase();
      if (name.includes('__macosx') || name.startsWith('.') || name.includes('/.')) continue;
      if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json')) {
        const textContent = await file.async('string');
        texts.push(textContent);
      } else if (name.endsWith('.docx')) {
        const docxBuffer = await file.async('nodebuffer');
        const docxBase64 = docxBuffer.toString('base64');
        try {
          const textContent = await extractUploadedText(relativePath, docxBase64);
          texts.push(textContent);
        } catch (e) {
          console.warn(`Failed to extract text from docx file ${relativePath} inside zip: ${e}`);
        }
      }
    }
    return texts.join('\n\n');
  }
  throw new Error('Unsupported file type.');
}

async function main() {
  const zipPath = '/Users/Zhuanz/Downloads/小说/左道指南/左道指南_完整资料包(1).zip';
  console.log(`Reading ZIP file from ${zipPath}...`);
  if (!fs.existsSync(zipPath)) {
    console.error('File does not exist!');
    return;
  }
  const fileBuffer = fs.readFileSync(zipPath);
  const base64Data = fileBuffer.toString('base64');
  console.log('ZIP file read. Size:', fileBuffer.length, 'bytes');

  console.log('Extracting text inside ZIP using extractUploadedText...');
  const text = await extractUploadedText('左道指南_完整资料包(1).zip', base64Data);
  console.log('Extracted text length:', text.length, 'characters');
  console.log('First 500 characters of extracted text:');
  console.log('--------------------------------------------------');
  console.log(text.slice(0, 500));
  console.log('--------------------------------------------------');
}

main().catch(console.error);
