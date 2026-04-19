import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'txt']);

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isSupportedFile(ext: string, mimeType: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext) || SUPPORTED_MIME_TYPES.has(mimeType);
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

// ─── Text Extraction ──────────────────────────────────────────────────────────
async function extractText(buffer: Buffer, ext: string, mimeType: string): Promise<string | null> {

  // PDF extraction
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    try {
      // Dynamic require to prevent bundler issues with pdf-parse
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buffer);
      const text = (result.text || '').trim();
      return text.length > 30 ? text.slice(0, 8000) : null;
    } catch (e: any) {
      console.error('[Summarize] PDF parse error:', e.message);
      return null;
    }
  }

  // DOCX extraction
  if (ext === 'docx' || mimeType.includes('wordprocessingml')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const docFile = zip.file('word/document.xml');
      if (!docFile) return null;
      const xml = await docFile.async('string');
      const text = xml
        .replace(/<w:p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return text.length > 30 ? text.slice(0, 8000) : null;
    } catch (e: any) {
      console.error('[Summarize] DOCX parse error:', e.message);
      return null;
    }
  }

  // PPTX extraction
  if (ext === 'pptx' || mimeType.includes('presentationml')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
      if (!slideFiles.length) return null;
      let text = '';
      for (const slide of slideFiles.slice(0, 25)) {
        const xml = await slide.async('string');
        text += xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() + '\n';
      }
      return text.trim().length > 30 ? text.trim().slice(0, 8000) : null;
    } catch (e: any) {
      console.error('[Summarize] PPTX parse error:', e.message);
      return null;
    }
  }

  // Plain text
  if (ext === 'txt' || mimeType === 'text/plain') {
    try {
      const text = buffer.toString('utf-8').trim();
      return text.length > 30 ? text.slice(0, 8000) : null;
    } catch {
      return null;
    }
  }

  return null;
}

// ─── Gemini API Call ──────────────────────────────────────────────────────────
async function callGemini(text: string, fileName: string, apiKey: string): Promise<object | null> {
  const prompt = `You are a document analyst. Read the following content from "${fileName}" and return a JSON summary with exactly these fields:
{
  "title": "A concise title for the document",
  "overview": "2-3 sentence summary of the document",
  "keyPoints": ["key insight 1", "key insight 2", "key insight 3"],
  "highlights": [{"label": "Category", "value": "Key detail"}]
}
Respond with valid JSON only. No markdown, no code blocks.

Document content:
${text.slice(0, 5500)}`;

  // Try models in order of preference
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];

  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1024,
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[Summarize] Model ${model} HTTP ${res.status}:`, errText.slice(0, 200));
        continue;
      }

      const body = await res.json();
      const raw = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      
      if (!raw) {
        console.warn(`[Summarize] Empty response from ${model}`);
        continue;
      }

      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      
      console.log(`[Summarize] Success with model: ${model}`);
      return parsed;

    } catch (e: any) {
      clearTimeout(timeout);
      const reason = e.name === 'AbortError' ? 'Timeout after 28s' : e.message;
      console.warn(`[Summarize] Model ${model} error: ${reason}`);
      continue;
    }
  }

  return null;
}

// ─── Route Handler ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Parse form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError('Invalid request format.', 400);
    }

    // 2. Validate file presence
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return jsonError('No file uploaded.', 400);
    }

    // 3. Validate file size
    if (file.size === 0) {
      return jsonError('The uploaded file is empty.', 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return jsonError('File too large. Maximum size is 5MB.', 413);
    }

    // 4. Validate file type
    const ext = getExtension(file.name);
    const mimeType = file.type || '';
    
    if (!isSupportedFile(ext, mimeType)) {
      return jsonError('Unsupported file type. Please upload a PDF, DOCX, or PPTX file.', 415);
    }

    // 5. Check API key before processing
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[Summarize] GEMINI_API_KEY not configured');
      return jsonError('Unable to process document at the moment. Please try again.', 503);
    }

    // 6. Read file buffer
    let buffer: Buffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch {
      return jsonError('Failed to read the uploaded file. Please try again.', 422);
    }

    // 7. Extract text
    console.log(`[Summarize] Processing: ${file.name} (${file.size} bytes, ext: ${ext})`);
    const text = await extractText(buffer, ext, mimeType);

    if (!text) {
      return jsonError('Unable to extract readable text from this file. Please use a text-based PDF, DOCX, or PPTX.', 422);
    }

    console.log(`[Summarize] Extracted ${text.length} characters`);

    // 8. Call Gemini
    const summary = await callGemini(text, file.name, apiKey);

    if (!summary) {
      return jsonError('Unable to process document at the moment. Please try again.', 503);
    }

    // 9. Return success
    return NextResponse.json({ success: true, data: summary });

  } catch (e: any) {
    // Top-level catch — should never hit in normal operation
    console.error('[Summarize] Unhandled error:', e.message);
    return jsonError('Unable to process document at the moment. Please try again.', 500);
  }
}
