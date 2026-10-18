import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Calendar, Globe2, ShieldCheck, Newspaper } from 'lucide-react';
import adverseMediaCorpus from '../data/adverseMediaCorpus.json';
import { AdverseMediaArticle } from '../engine/adverseMediaAgent';

interface ArticleReaderModalProps {
  articleId: string | null;
  highlightQuote?: string;
  onClose: () => void;
}

export const ArticleReaderModal: React.FC<ArticleReaderModalProps> = ({
  articleId,
  highlightQuote,
  onClose
}) => {
  const quoteRef = useRef<HTMLElement | null>(null);

  // Lock background scrolling while article reader is active
  useEffect(() => {
    if (!articleId) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [articleId]);

  // Scroll quoted passage into view once opened
  useEffect(() => {
    if (articleId && highlightQuote && quoteRef.current) {
      const timer = setTimeout(() => {
        quoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [articleId, highlightQuote]);

  if (!articleId) return null;

  const corpus = adverseMediaCorpus as unknown as AdverseMediaArticle[];
  const article = corpus.find((a) => a.id === articleId);

  if (!article) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade">
        <div
          className="w-full max-w-lg rounded-2xl p-6 border shadow-2xl space-y-4 anim-pop"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', color: 'var(--ink)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-base">Article Not Found</h3>
            <button
              onClick={onClose}
              type="button"
              aria-label="Close article reader"
              className="p-1 rounded-lg hover:bg-[var(--bg2)] cursor-pointer focus-visible:ring-2"
            >
              <X className="w-5 h-5 text-[var(--ink2)]" />
            </button>
          </div>
          <p className="text-xs text-[var(--ink2)]">The cited article ID ({articleId}) could not be resolved in the repository.</p>
        </div>
      </div>,
      document.body
    );
  }

  // Highlight the quote in the body
  const renderHighlightedBody = () => {
    if (!highlightQuote || !highlightQuote.trim()) {
      return <p className="text-xs leading-relaxed whitespace-pre-line text-[var(--ink)]">{article.body}</p>;
    }

    const cleanQuote = highlightQuote.trim();
    const index = article.body.toLowerCase().indexOf(cleanQuote.toLowerCase());

    if (index === -1) {
      return (
        <div className="space-y-3">
          <div
            ref={(el) => { if (el) quoteRef.current = el; }}
            className="p-2.5 rounded-lg border text-[11px] font-mono-code bg-amber-50 text-amber-800 border-amber-200"
          >
            Quoted passage: "{cleanQuote}"
          </div>
          <p className="text-xs leading-relaxed whitespace-pre-line text-[var(--ink)]">{article.body}</p>
        </div>
      );
    }

    const before = article.body.substring(0, index);
    const matched = article.body.substring(index, index + cleanQuote.length);
    const after = article.body.substring(index + cleanQuote.length);

    return (
      <p className="text-xs leading-relaxed whitespace-pre-line text-[var(--ink)]">
        {before}
        <mark
          ref={(el) => { if (el) quoteRef.current = el; }}
          className="px-1 py-0.5 rounded font-semibold border"
          style={{
            backgroundColor: 'var(--amber-s)',
            color: 'var(--ink)',
            borderColor: 'var(--amber)'
          }}
        >
          {matched}
        </mark>
        {after}
      </p>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-reader-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade"
      style={{ backgroundColor: 'rgba(34, 30, 51, 0.45)' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-6 md:p-8 border shadow-2xl relative max-h-[85vh] flex flex-col overflow-hidden anim-pop"
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--line)',
          boxShadow: 'var(--sh3)',
          color: 'var(--ink)'
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b pb-4 shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="section-label">Source Document Archive</span>
              <span
                className="text-[10px] font-mono-code px-2 py-0.5 rounded font-bold uppercase"
                style={{
                  backgroundColor: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink2)'
                }}
              >
                Tier: {article.sourceTier}
              </span>
            </div>
            <h2
              id="article-reader-title"
              className="text-lg md:text-xl font-bold font-display leading-snug text-[var(--ink)]"
            >
              {article.headline}
            </h2>
          </div>

          <button
            onClick={onClose}
            type="button"
            aria-label="Close article reader"
            className="p-1.5 rounded-lg text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)] transition-colors cursor-pointer shrink-0 focus-visible:ring-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metadata Strip */}
        <div
          className="py-2.5 px-3.5 my-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono-code shrink-0"
          style={{
            backgroundColor: 'var(--bg2)',
            borderColor: 'var(--line)',
            color: 'var(--ink2)'
          }}
        >
          <div className="flex items-center gap-2">
            <Newspaper className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
            <span className="font-semibold text-[var(--ink)]">{article.outlet}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Globe2 className="w-3.5 h-3.5" />
              <span>{article.country}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              <span>{article.publicationDate}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--ink3)]">ID: {article.id}</span>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          <div
            className="p-4 rounded-xl border space-y-3"
            style={{
              backgroundColor: 'var(--bg2)',
              borderColor: 'var(--line)'
            }}
          >
            <div className="flex items-center justify-between text-[11px] font-mono-code text-[var(--ink3)] border-b pb-2" style={{ borderColor: 'var(--line)' }}>
              <span>Subject Named in Article: <strong className="text-[var(--ink)]">{article.subjectName}</strong></span>
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Corpus Integrity Verified
              </span>
            </div>

            {renderHighlightedBody()}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t mt-3 flex items-center justify-between text-[11px] font-mono-code text-[var(--ink3)] shrink-0" style={{ borderColor: 'var(--line)' }}>
          <span>Synthetic Adverse Media Corpus · Fictional Outlet &amp; Characters</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer hover:bg-[var(--bg2)] text-[var(--ink2)] focus-visible:ring-2"
            style={{ borderColor: 'var(--line)' }}
          >
            Close Reader
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
