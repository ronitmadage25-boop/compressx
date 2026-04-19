import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
const pdf = require('pdf-parse');

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

async function extractTextFromFile(fileBuffer: Buffer, mimeType: string, fileName: string): Promise<{ text: string | null; error?: string }> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  // PDF
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    try {
      const data = await pdf(fileBuffer);
      const text = data.text.trim().slice(0, 8000);
      if (text.length > 50) return { text };
      
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      return { 
        text: null, 
        error: "No readable content found. This file appears to be scanned or non-selectable." 
      };
    } catch (err) {
      console.error('[Summarize API] PDF Extraction Error:', err);
      return { text: null, error: "Unable to read this file. Try a text-based document." };
    }
  }

  // DOCX
  if (mimeType.includes('wordprocessingml') || ext === 'docx') {
    try {
      const zip = await JSZip.loadAsync(fileBuffer);
      const docXml = zip.file('word/document.xml');
      if (docXml) {
        const xmlContent = await docXml.async('string');
        const text = xmlContent
          .replace(/<w:p[^>]*>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
        if (text) return { text };
      }
    } catch (err) {
      console.error('[Summarize API] DOCX Extraction Error:', err);
    }
    return { text: null, error: "No readable content found in this Word document." };
  }

  // PPTX
  if (mimeType.includes('presentationml') || ext === 'pptx') {
    try {
      const zip = await JSZip.loadAsync(fileBuffer);
      let text = '';
      const slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
      for (const slideFile of slideFiles.slice(0, 20)) {
        const xml = await slideFile.async('string');
        const slideText = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        text += slideText + '\n';
      }
      if (text.trim()) return { text: text.slice(0, 8000) };
    } catch (err) {
      console.error('[Summarize API] PPTX Extraction Error:', err);
    }
    return { text: null, error: "No readable content found in this PowerPoint." };
  }

  // Plain text
  if (mimeType === 'text/plain' || ext === 'txt') {
    const text = fileBuffer.toString('utf-8').slice(0, 8000);
    if (text.trim()) return { text: text.trim() };
    return { text: null, error: "This text file is empty." };
  }

  // Image
  if (mimeType.startsWith('image/')) {
    return { 
      text: `[Image file: ${fileName}]. Please analyze the visual content and provide a summary of the likely text or purpose.` 
    };
  }

  return { text: null, error: "File not supported. Try a PDF, Word, or text-based document." };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large. Max 20MB supported.' }, { status: 413 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;

    let mimeType = file.type;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'pptx') mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (ext === 'pdf') mimeType = 'application/pdf';

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Extract text content
    console.log(`[Summarize API] Processing: ${file.name} (${file.size} bytes)`);
    const extraction = await extractTextFromFile(fileBuffer, mimeType, file.name);

    if (extraction.error || !extraction.text) {
      console.warn(`[Summarize API] Extraction failed: ${extraction.error}`);
      return NextResponse.json({ 
        success: false, 
        error: extraction.error || "No readable content found." 
      }, { status: 422 });
    }

    if (!geminiKey) {
      console.error('[Summarize API] Missing GEMINI_API_KEY');
      return NextResponse.json({ success: false, error: 'Server configuration error, try again later.' }, { status: 500 });
    }

    const systemPrompt = `You are an expert document analyst. Analyze the provided document content and return a structured JSON summary with these exact fields:
{
  "title": "Main topic/title of the document (one line)",
  "overview": "2-3 sentence overview of what this document is about",
  "keyPoints": ["point 1", "point 2", "point 3"], // 4-7 key points as strings
  "highlights": [{"label": "Category", "value": "Detail"}] // 3-5 important facts, dates, names, numbers
}
Be concise, professional, and focus on the most important information.`;

    const userPrompt = `Document: "${file.name}"\n\nContent:\n${extraction.text.slice(0, 6000)}\n\nProvide a structured JSON summary.`;

    const models = ['gemini-3-flash', 'gemini-1.5-flash', 'gemini-pro'];
    let lastError = 'Server error, try again.';

    for (const modelName of models) {
      try {
        console.log(`[Summarize API] Attempting model: ${modelName}`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
          }),
          signal: AbortSignal.timeout(30000) // 30s timeout
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error?.message || response.statusText;
          console.warn(`[Summarize API] Model ${modelName} failed:`, response.status, errorMsg);
          
          if (response.status === 400 && errorMsg.includes('API key not valid')) {
             return NextResponse.json({ success: false, error: 'Invalid Gemini API Key. Please verify .env.local.' }, { status: 401 });
          }
          
          lastError = `Gemini Error (${modelName}): ${errorMsg}`;
          continue; // Try next model
        }

        const responseData = await response.json();
        const responseContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const summary = JSON.parse(responseContent);

        console.log(`[Summarize API] Success with ${modelName}`);
        return NextResponse.json({
          success: true,
          fileName: file.name,
          data: summary,
        });

      } catch (apiError: any) {
        console.error(`[Summarize API] Connection error with ${modelName}:`, apiError.message);
        lastError = `Connection Error: ${apiError.message}`;
        continue;
      }
    }

    return NextResponse.json({ success: false, error: lastError }, { status: 502 });

  } catch (error) {
    console.error('[Summarize API] Critical Failure:', error);
    return NextResponse.json({
      success: false,
      error: 'Server error, try again.',
    }, { status: 500 });
  }
}



