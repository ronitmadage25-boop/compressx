import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
const pdf = require('pdf-parse');

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

async function extractTextFromFile(fileBuffer: Buffer, mimeType: string, fileName: string): Promise<{ text: string | null; error?: string }> {
  try {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

    // PDF
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      try {
        const data = await pdf(fileBuffer);
        const text = data.text.trim().slice(0, 8000);
        if (text.length > 50) return { text };
        return { text: null, error: "Unable to read this file. Use a text-based document." };
      } catch (err) {
        console.error('[Summarize API] PDF Extraction Error:', err);
        return { text: null, error: "Unable to read this file. Use a text-based document." };
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
        console.error('[Summarize API] DOCX Error:', err);
      }
      return { text: null, error: "Unable to read this file. Use a text-based document." };
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
        console.error('[Summarize API] PPTX Error:', err);
      }
      return { text: null, error: "Unable to read this file. Use a text-based document." };
    }

    // Plain text
    if (mimeType === 'text/plain' || ext === 'txt') {
      const text = fileBuffer.toString('utf-8').slice(0, 8000);
      if (text.trim()) return { text: text.trim() };
      return { text: null, error: "Unable to read this file. Use a text-based document." };
    }

    // Image
    if (mimeType.startsWith('image/')) {
      return { 
        text: `[Image file: ${fileName}]. Please analyze the visual content and provide a summary of its purpose.` 
      };
    }

    return { text: null, error: "Unable to read this file. Use a text-based document." };
  } catch (criticalErr) {
    console.error('[Summarize API] Extraction Critical Error:', criticalErr);
    return { text: null, error: "Unable to read this file. Use a text-based document." };
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large. Max 5MB' }, { status: 413 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      console.error('[Summarize API] GEMINI_API_KEY missing');
      return NextResponse.json({ success: false, error: 'AI service temporarily unavailable' }, { status: 500 });
    }

    const mimeType = file.type;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Extract text content
    const extraction = await extractTextFromFile(fileBuffer, mimeType, file.name || 'document');

    if (extraction.error || !extraction.text) {
      return NextResponse.json({ success: false, error: extraction.error || "Unable to read this file. Use a text-based document." }, { status: 422 });
    }

    const systemPrompt = `Analyze the document and return a JSON summary with fields: title, overview, keyPoints (array), and highlights (array of {label, value}). Focus on insights.`;
    const userPrompt = `Document: "${file.name}"\n\nContent:\n${extraction.text.slice(0, 6000)}\n\nProvide summary.`;

    const models = ['gemini-1.5-flash', 'gemini-pro'];
    let lastError = 'AI service temporarily unavailable';

    for (const modelName of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
          }),
          signal: AbortSignal.timeout(25000) // 25s timeout for Gemini
        });

        if (!response.ok) {
           console.warn(`[Summarize API] Model ${modelName} failed`);
           continue; 
        }

        const responseData = await response.json();
        const responseContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const summary = JSON.parse(responseContent);

        return NextResponse.json({
          success: true,
          data: summary,
        });

      } catch (apiError: any) {
        console.error(`[Summarize API] API error with ${modelName}:`, apiError.message);
        continue;
      }
    }

    return NextResponse.json({ success: false, error: 'AI service temporarily unavailable' }, { status: 502 });

  } catch (error) {
    console.error('[Summarize API] Critical failure:', error);
    return NextResponse.json({
      success: false,
      error: 'AI service temporarily unavailable',
    }, { status: 500 });
  }
}




