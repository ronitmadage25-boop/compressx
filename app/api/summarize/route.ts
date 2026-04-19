import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
const pdf = require('pdf-parse');

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

async function extractTextFromFile(fileBuffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  // PDF
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    try {
      // Use pdf-parse for actual text extraction
      const data = await pdf(fileBuffer);
      const text = data.text.trim().slice(0, 8000);
      if (text.length > 50) return text;
      
      // Fallback if text is too sparse (might be scanned)
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      return `[PDF: ${fileName}, ${pdfDoc.getPageCount()} pages]. Content appears to be scanned or non-selectable. Unable to read this file. Try another document or a text-based PDF.`;
    } catch (err) {
      console.error('[Summarize API] PDF Extraction Error:', err);
      return `Unable to read this file. Try another document or a text-based PDF.`;
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
        return text || `Unable to read this file. Try another document or a text-based PDF.`;
      }
    } catch { }
    return `Unable to read this file. Try another document or a text-based PDF.`;
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
      return text.slice(0, 8000) || `Unable to read this file. Try another document or a text-based PDF.`;
    } catch { }
    return `Unable to read this file. Try another document or a text-based PDF.`;
  }

  // Plain text
  if (mimeType === 'text/plain' || ext === 'txt') {
    const text = fileBuffer.toString('utf-8').slice(0, 8000);
    return text.trim() || `Unable to read this file. Try another document or a text-based PDF.`;
  }

  // Image
  if (mimeType.startsWith('image/')) {
    return `[Image file: ${fileName}]. Please analyze the visual content and provide a summary of the likely text or purpose.`;
  }

  return `Unable to read this file. Try another document or a text-based PDF.`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Max 20MB for summarization.' }, { status: 413 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;

    let mimeType = file.type;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'pptx') mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (ext === 'pdf') mimeType = 'application/pdf';

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Extract text content
    console.log(`[Summarize API] Processing: ${file.name}`);
    const extractedText = await extractTextFromFile(fileBuffer, mimeType, file.name);
    console.log(`[Summarize API] Extracted text length: ${extractedText.length} bytes`);

    // If we couldn't extract enough meaningful text, return the friendly error directly
    if (extractedText.includes('Unable to read this file') || extractedText.length < 10) {
      return NextResponse.json({ 
        success: false, 
        error: "Unable to read this file. Try another document or a text-based PDF." 
      }, { status: 422 });
    }


    if (!geminiKey) {
      console.warn('[Summarize API] No GEMINI_API_KEY detected in env.');
      return NextResponse.json({ error: 'GEMINI_API_KEY missing. Please configure your environment variables.' }, { status: 500 });
    }

    // Connect to Official API
    console.log(`[Summarize API] GEMINI_API_KEY detected. Connecting to Gemini API...`);

    const systemPrompt = `You are an expert document analyst. Analyze the provided document content and return a structured JSON summary with these exact fields:
{
  "title": "Main topic/title of the document (one line)",
  "overview": "2-3 sentence overview of what this document is about",
  "keyPoints": ["point 1", "point 2", "point 3"], // 4-7 key points as strings
  "highlights": [{"label": "Category", "value": "Detail"}] // 3-5 important facts, dates, names, numbers
}
Be concise, professional, and focus on the most important information.`;

    const userPrompt = `Document: "${file.name}"\n\nContent:\n${extractedText.slice(0, 6000)}\n\nProvide a structured JSON summary.`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: systemPrompt + "\n\n" + userPrompt }]
          }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.3,
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('[Summarize API] Gemini Service Error:', errorData);
        let errorMessage = 'Something went wrong. Please try again.';
        if (response.status === 400 && errorData.includes('API key not valid')) errorMessage = 'Invalid Gemini API Key. Please verify .env.local configuration.';
        return NextResponse.json({ success: false, error: errorMessage }, { status: 502 });
      }

      const responseData = await response.json();
      const responseContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      const summary = JSON.parse(responseContent);

      console.log(`[Summarize API] Summarization Success!`);
      return NextResponse.json({
        success: true,
        fileName: file.name,
        summary,
      });

    } catch (apiError: any) {
      console.error('[Summarize API] Gemini Service Error:', apiError);
      return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 502 });
    }

  } catch (error) {
    console.error('[Summarize API] Outer Router Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Something went wrong. Please try again.',
    }, { status: 500 });
  }
}

