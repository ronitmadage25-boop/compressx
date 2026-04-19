import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
const pdf = require('pdf-parse');

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

async function extractTextFromFile(fileBuffer: Buffer, mimeType: string, fileName: string): Promise<{ text: string | null; error?: string; details?: string }> {
  try {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    
    // Lazy load pdf-parse inside the function to avoid top-level require issues
    const pdf = require('pdf-parse');

    // PDF
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      try {
        const data = await pdf(fileBuffer);
        const text = data.text.trim().slice(0, 8000);
        if (text.length > 50) return { text };
        return { text: null, error: "Unable to read this file. Use a text-based document." };
      } catch (err: any) {
        console.error('[Summarize API] PDF Error:', err.message);
        return { text: null, error: "Unable to read this file. Use a text-based document.", details: err.message };
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
      } catch (err: any) {
        console.error('[Summarize API] DOCX Error:', err.message);
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
      } catch (err: any) {
        console.error('[Summarize API] PPTX Error:', err.message);
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
  } catch (criticalErr: any) {
    console.error('[Summarize API] Extraction Critical Error:', criticalErr.message);
    return { text: null, error: "Unable to read this file. Use a text-based document.", details: criticalErr.message };
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
    console.log(`[Summarize API] Environment Check - GEMINI_API_KEY present: ${!!geminiKey}`);

    if (!geminiKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'AI service temporarily unavailable',
        details: 'GEMINI_API_KEY is missing from environment variables.'
      }, { status: 500 });
    }

    const mimeType = file.type;
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Extract text content
    const extraction = await extractTextFromFile(fileBuffer, mimeType, file.name || 'document');

    if (extraction.error || !extraction.text) {
      return NextResponse.json({ 
        success: false, 
        error: extraction.error || "Unable to read this file. Use a text-based document.",
        details: extraction.details
      }, { status: 422 });
    }

    const systemPrompt = `Analyze the document and return a JSON summary with fields: title, overview, keyPoints (array), and highlights (array of {label, value}). Focus on insights.`;
    const userPrompt = `Document: "${file.name}"\n\nContent:\n${extraction.text.slice(0, 6000)}\n\nProvide summary.`;

    const models = ['gemini-1.5-flash', 'gemini-pro'];
    let lastErrorDetails = '';

    for (const modelName of models) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.3 }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
           const errBody = await response.text().catch(() => 'No error body');
           console.warn(`[Summarize API] Model ${modelName} failed: ${response.status}`, errBody);
           lastErrorDetails = `Model ${modelName} failed with status ${response.status}: ${errBody}`;
           continue; 
        }

        const responseData = await response.json();
        const responseContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const summary = JSON.parse(responseContent);

        return NextResponse.json({ success: true, data: summary });

      } catch (apiError: any) {
        clearTimeout(timeoutId);
        console.error(`[Summarize API] API error with ${modelName}:`, apiError.name === 'AbortError' ? 'Timeout' : apiError.message);
        lastErrorDetails = `Connection with ${modelName} failed: ${apiError.message}`;
        continue;
      }
    }

    return NextResponse.json({ 
      success: false, 
      error: 'AI service temporarily unavailable',
      details: lastErrorDetails || 'All Gemini models failed to respond.'
    }, { status: 502 });

  } catch (error: any) {
    console.error('[Summarize API] Critical failure:', error.message);
    return NextResponse.json({
      success: false,
      error: 'AI service temporarily unavailable',
      details: `Critical crash: ${error.message}`
    }, { status: 500 });
  }
}





