'use client';
// components/features/AISummarizer.tsx
// AI Smart Summarizer — center feature with glow and typing animation

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Sparkles, RefreshCw, FileText, Star, ChevronRight } from 'lucide-react';

interface SummaryHighlight { label: string; value: string; }
interface SummaryResult {
  title: string;
  overview: string;
  keyPoints: string[];
  highlights: SummaryHighlight[];
}

function TypedText({ text, onDone }: { text: string; onDone?: () => void }) {
  const [displayed, setDisplayed] = useState('');
  const idx = useRef(0);

  useEffect(() => {
    setDisplayed('');
    idx.current = 0;
    const interval = setInterval(() => {
      if (idx.current < text.length) {
        setDisplayed(text.slice(0, idx.current + 1));
        idx.current++;
      } else {
        clearInterval(interval);
        onDone?.();
      }
    }, 10);
    return () => clearInterval(interval);
  }, [text]);

  return <span>{displayed}<span className="typing-cursor" /></span>;
}

export default function AISummarizer() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'thinking' | 'typing' | 'done'>('idle');
  const [revealedPoints, setRevealedPoints] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('ai-summary-portal'));
  }, []);

  const handleFile = useCallback((f: File) => {
    if (f.size > 5 * 1024 * 1024) {
      setError("File too large. Max 5MB");
      setFile(null);
      return;
    }
    setFile(f);
    setSummary(null);
    setError(null);
    setPhase('idle');
    setRevealedPoints(0);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleSummarize = async () => {
    if (!file) {
      setError("No file uploaded");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("File too large. Max 5MB");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSummary(null);
    setRevealedPoints(0);
    setPhase('extracting');

    try {
      const formData = new FormData();
      formData.append('file', file);

      await new Promise(r => setTimeout(r, 600));
      setPhase('thinking');

      const res = await fetch('/api/summarize', { 
        method: 'POST', 
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
      
      const contentType = res.headers.get("content-type");
      let data;
      
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      }

      if (!res.ok) {
        const msg = data?.error || `Server error (${res.status})`;
        throw new Error(msg);
      }

      if (!data || !data.success) {
        throw new Error(data?.error || 'Summarization failed');
      }

      setSummary(data.data);
      setPhase('typing');

      // Reveal points loop
      setTimeout(() => {
        const interval = setInterval(() => {
          setRevealedPoints(prev => {
            const next = prev + 1;
            const pointsCount = data.data.keyPoints?.length ?? 0;
            if (next >= pointsCount) {
              clearInterval(interval);
              setPhase('done');
            }
            return next;
          });
        }, 350);
      }, 1200);

      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    } catch (err: any) {
      console.error("[AISummarizer] Error:", err);
      setError(err instanceof Error ? err.message : 'AI service temporarily unavailable');
      setPhase('idle');
    } finally {
      setIsLoading(false);
    }
  };



  const reset = () => {
    setFile(null);
    setSummary(null);
    setError(null);
    setPhase('idle');
    setRevealedPoints(0);
  };

  const ACCEPTED = '.pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg,.webp';

  return (
    <>
      <div className="feature-card feature-card--center">
        {/* Glow ring */}
        <div className="ai-glow-ring" />

        {/* Header */}
        <div className="feature-card-header">
          <div className="feature-card-icon ai-icon-glow">
            <Sparkles size={20} style={{ color: '#00ffb3' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="feature-card-title" style={{ fontSize: '1.05rem' }}>
              AI Smart Summarizer
            </div>
            <div className="feature-card-sub">Powered by Gemini AI — Instant insights</div>
          </div>
        </div>

        {/* Upload Zone */}
        <div
          className={`ai-dropzone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => !file && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <AnimatePresence mode="wait">
            {file ? (
              <motion.div
                key="file"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ textAlign: 'center' }}
              >
                <FileText size={28} style={{ color: 'var(--neon)', margin: '0 auto 0.5rem' }} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--neon)', marginBottom: '0.2rem', fontWeight: 600 }}>
                  {file.name.length > 30 ? file.name.slice(0, 30) + '…' : file.name}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)' }}>
                  {(file.size / 1024).toFixed(1)} KB · Ready to analyze
                </div>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center' }}>
                <Upload size={24} style={{ color: 'var(--neon)', margin: '0 auto 0.6rem', opacity: 0.7 }} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Drop PDF, DOCX, PPTX, or Image
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--muted)', opacity: 0.6, marginTop: '0.3rem' }}>
                  Up to 20MB supported
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Phase indicator */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="ai-phase-bar"
            >
              <motion.div
                className="ai-phase-dot"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--neon)' }}>
                {phase === 'extracting' ? 'Extracting content…' : 'AI is thinking…'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {error && <div className="feature-error">{error}</div>}

        {/* Summarize Button */}
        <motion.button
          whileHover={file && !isLoading ? { scale: 1.015, y: -2 } : {}}
          whileTap={file && !isLoading ? { scale: 0.98 } : {}}
          onClick={handleSummarize}
          disabled={!file || isLoading}
          className="ai-summarize-btn"
          style={{ marginTop: '0.75rem', marginBottom: summary ? '1rem' : 0 }}
        >
          {isLoading ? (
            <>
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                <RefreshCw size={16} />
              </motion.div>
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Summarize with AI
            </>
          )}
          {!isLoading && file && <div className="btn-shimmer" />}
        </motion.button>
      </div>

      {portalTarget && createPortal(
        <AnimatePresence>
          {summary && (
            <motion.div
              ref={resultsRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="ai-result-container"
              style={{ marginTop: '1.5rem' }}
            >
              {/* AI bubble — title */}
              <div className="ai-bubble">
                <div className="ai-bubble-avatar">
                  <Star size={10} style={{ color: 'var(--neon)' }} />
                </div>
                <div className="ai-bubble-content">
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.4rem', color: 'var(--neon)' }}>
                    {phase === 'typing' || phase === 'done'
                      ? <TypedText text={summary.title} />
                      : summary.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', lineHeight: 1.55, color: 'var(--muted)' }}>
                    {summary.overview}
                  </div>
                </div>
              </div>

              {/* Key Points */}
              {(phase === 'typing' || phase === 'done') && summary.keyPoints?.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--neon2)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.5rem', marginTop: '0.75rem' }}>
                    Key Points
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {summary.keyPoints.slice(0, revealedPoints).map((point, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="ai-key-point"
                      >
                        <ChevronRight size={12} style={{ color: 'var(--neon)', flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', color: 'var(--text)', lineHeight: 1.5 }}>{point}</span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Highlights */}
              {phase === 'done' && summary.highlights?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  style={{ marginTop: '0.75rem' }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--neon2)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Key Details
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                    {summary.highlights.map((h, i) => (
                      <div key={i} className="ai-highlight-chip">
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--neon2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h.label}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, marginTop: '0.15rem' }}>{h.value}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* New Summary button */}
              {phase === 'done' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} style={{ marginTop: '0.75rem' }}>
                  <button onClick={reset} className="feature-btn feature-btn-ghost" style={{ width: '100%', fontSize: '0.75rem' }}>
                    Summarize Another File
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        portalTarget
      )}
    </>
  );
}
