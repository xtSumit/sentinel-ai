/**
 * Sentinel AI — Adverse Media Dossier View (Phase 4b)
 * Complete compliance intelligence dossier covering:
 * 1. Subject Header
 * 2. Risk Score & Traceable Calculation
 * 3. Chronological Interactive Timeline
 * 4. Legal-Stage Matrix (Alleged vs Convicted distinction)
 * 5. Typology Breakdown
 * 6. Jurisdiction Exposure
 * 7. Source Quality & Corroboration
 * 8. Conflicting Reports Side-by-Side
 * 9. Source of Wealth
 * 10. Different Individual (Excluded disambiguation)
 * + Right-side grounded Q&A panel with citation chips
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  BodsPerson,
  CorporateGroupSeed
} from '../types/bods';
import {
  AdverseMediaFinding,
  AdverseMediaLegalStage,
  AdverseMediaTypology,
  runAdverseMediaScreening
} from '../engine/adverseMediaAgent';
import {
  scoreAdverseMediaFindings,
  AdverseMediaDossierScoreResult,
  AdverseMediaRiskBand
} from '../engine/adverseMediaScoring';
import { ArticleReaderModal } from './ArticleReaderModal';
import adverseMediaCorpus from '../data/adverseMediaCorpus.json';
import { bodsRepository } from '../data/repository';
import { resolveBeneficialOwnership, formatEffectiveRange } from '../engine/uboEngine';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  Scale,
  Sparkles,
  Send,
  Loader2,
  Calendar,
  Building2,
  Globe2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Clock,
  Layers,
  FileQuestion,
  ExternalLink,
  Info
} from 'lucide-react';

interface AdverseMediaDossierViewProps {
  person: BodsPerson;
  onBack: () => void;
  cachedFindings?: AdverseMediaFinding[];
}

interface QaMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations: string[];
  isAiGenerated?: boolean;
}

const LEGAL_STAGE_COLORS: Record<AdverseMediaLegalStage, string> = {
  allegation: 'var(--ink3)',
  investigation: 'var(--amber)',
  charge: 'var(--coral)',
  'regulatory finding': 'var(--rose)',
  conviction: 'var(--rose)',
  cleared: 'var(--emerald)'
};

const BAND_COLORS: Record<AdverseMediaRiskBand, string> = {
  LOW: 'var(--emerald)',
  MEDIUM: 'var(--amber)',
  HIGH: 'var(--coral)',
  SEVERE: 'var(--rose)'
};

const SUGGESTED_QUESTIONS = [
  'What are the most serious matters?',
  'Has anything been proven?',
  'What is reported about their source of wealth?',
  'Do any reports contradict each other?'
];

export const AdverseMediaDossierView: React.FC<AdverseMediaDossierViewProps> = ({
  person,
  onBack,
  cachedFindings
}) => {
  const { user, profile } = useAuth();
  const [findings, setFindings] = useState<AdverseMediaFinding[]>(cachedFindings || []);
  const [loading, setLoading] = useState<boolean>(!cachedFindings || cachedFindings.length === 0);
  const [showFormulaDetails, setShowFormulaDetails] = useState(false);

  // Article Reader Modal state
  const [readerArticleId, setReaderArticleId] = useState<string | null>(null);
  const [readerQuote, setReaderQuote] = useState<string | undefined>(undefined);

  // Q&A Panel State
  const [questionInput, setQuestionInput] = useState('');
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

  // Load findings if not cached
  useEffect(() => {
    let isMounted = true;
    if (!cachedFindings || cachedFindings.length === 0) {
      setLoading(true);
      runAdverseMediaScreening(person).then((res) => {
        if (isMounted) {
          setFindings([...res.matchedFindings, ...res.excludedFindings]);
          setLoading(false);
        }
      });
    } else {
      setFindings(cachedFindings);
      setLoading(false);
    }
    return () => {
      isMounted = false;
    };
  }, [person.id, cachedFindings]);

  // Compute dossier score and matters
  const scoreResult: AdverseMediaDossierScoreResult = useMemo(() => {
    return scoreAdverseMediaFindings(findings);
  }, [findings]);

  // Separate matched and excluded
  const matchedFindings = useMemo(() => findings.filter((f) => f.isMatchingIdentity), [findings]);
  const excludedFindings = useMemo(() => findings.filter((f) => !f.isMatchingIdentity), [findings]);

  // UBO holdings across groups for this person
  const uboHoldings = useMemo(() => {
    const groups = bodsRepository.getGroups();
    const holdings: Array<{ group: CorporateGroupSeed; classification: string; range: string }> = [];

    groups.forEach((g) => {
      const res = resolveBeneficialOwnership(g, 25);
      const found = res.persons.find((p) => p.person.id === person.id);
      if (found) {
        holdings.push({
          group: g,
          classification: found.classification,
          range: formatEffectiveRange(found.totalMinPct, found.totalMaxPct)
        });
      }
    });
    return holdings;
  }, [person.id]);

  // Conflicting pairs detection
  const conflictingPairs = useMemo(() => {
    const pairs: Array<{ matter: string; accounts: AdverseMediaFinding[] }> = [];
    const matterMap = new Map<string, AdverseMediaFinding[]>();

    matchedFindings.forEach((f) => {
      const list = matterMap.get(f.matterLabel) || [];
      list.push(f);
      matterMap.set(f.matterLabel, list);
    });

    matterMap.forEach((list, matter) => {
      const hasCharge = list.some((f) => f.legalStage === 'charge' || f.legalStage === 'allegation');
      const hasCleared = list.some((f) => f.legalStage === 'cleared');
      if (hasCharge && hasCleared && list.length >= 2) {
        pairs.push({
          matter,
          accounts: list.slice(0, 2)
        });
      }
    });

    return pairs;
  }, [matchedFindings]);

  // Source of Wealth findings
  const sowFindings = useMemo(() => {
    return matchedFindings.filter((f) => Boolean(f.sourceOfWealthStatement));
  }, [matchedFindings]);

  // Typology counts
  const typologies = useMemo(() => {
    const counts: Record<string, number> = {};
    matchedFindings.forEach((f) => {
      counts[f.typology] = (counts[f.typology] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [matchedFindings]);

  // Jurisdiction exposure
  const jurisdictions = useMemo(() => {
    const counts: Record<string, number> = {};
    matchedFindings.forEach((f) => {
      f.jurisdictions.forEach((j) => {
        counts[j] = (counts[j] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [matchedFindings]);

  // Source quality tier counts
  const sourceTiers = useMemo(() => {
    const counts = { regulator: 0, tier1: 0, established: 0, blog: 0 };
    matchedFindings.forEach((f) => {
      if (counts[f.sourceTier] !== undefined) counts[f.sourceTier]++;
    });
    return counts;
  }, [matchedFindings]);

  // Legal-Stage Matrix
  const legalStageMatrix = useMemo(() => {
    const stages: AdverseMediaLegalStage[] = [
      'allegation',
      'investigation',
      'charge',
      'regulatory finding',
      'conviction',
      'cleared'
    ];
    const typologyList: AdverseMediaTypology[] = [
      'fraud',
      'money laundering',
      'bribery or corruption',
      'sanctions or AML',
      'tax',
      'other'
    ];

    const matrix: Record<string, Record<string, { count: number; maxSeverity: string }>> = {};

    typologyList.forEach((t) => {
      matrix[t] = {};
      stages.forEach((s) => {
        matrix[t][s] = { count: 0, maxSeverity: 'none' };
      });
    });

    matchedFindings.forEach((f) => {
      const t = typologyList.includes(f.typology) ? f.typology : 'other';
      if (matrix[t] && matrix[t][f.legalStage]) {
        matrix[t][f.legalStage].count++;
        matrix[t][f.legalStage].maxSeverity = f.severity;
      }
    });

    return { stages, typologies: typologyList, matrix };
  }, [matchedFindings]);

  // Q&A handler
  const handleAskQuestion = async (qText: string) => {
    const cleanQ = qText.trim();
    if (!cleanQ || asking) return;

    if (!user) {
      setQaError('Authentication required to query adverse media model.');
      return;
    }

    setQaError(null);
    setAsking(true);

    const userMsg: QaMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'user',
      text: cleanQ,
      citations: []
    };

    setQaMessages((prev) => [...prev, userMsg]);
    setQuestionInput('');

    // Gather all verified articles for this subject (excluding disambiguation targets for different individuals)
    const corpusList = (adverseMediaCorpus as any[]) || [];
    const subjectArticles = corpusList.filter(
      (a) => a.subjectName === person.name && !a.isDisambiguationTarget
    );

    const articleMap = new Map<string, any>();
    for (const sa of subjectArticles) {
      articleMap.set(sa.id, {
        id: sa.id,
        headline: sa.headline,
        outlet: sa.outlet,
        date: sa.date,
        country: sa.country,
        body: sa.body
      });
    }

    for (const f of matchedFindings) {
      if (!articleMap.has(f.articleId)) {
        const full = corpusList.find((a) => a.id === f.articleId);
        articleMap.set(f.articleId, {
          id: f.articleId,
          headline: full?.headline || f.title,
          outlet: full?.outlet || f.outlet,
          date: full?.date || f.date,
          country: full?.country || f.jurisdictions[0] || 'Unknown',
          body: full?.body || f.quote
        });
      }
    }

    const payloadArticles = Array.from(articleMap.values());

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/adverse-media/qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          personId: person.id,
          personName: person.name,
          question: cleanQ,
          matchedArticles: payloadArticles,
          findings: matchedFindings
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 429 || errJson.rateLimited || String(errJson.error || '').includes('rate-limit')) {
          throw new Error(errJson.error || 'AI features are temporarily rate-limited. Please try again later.');
        }
        throw new Error(errJson.error || `Server returned error ${res.status}`);
      }

      const data = await res.json();
      const botMsg: QaMessage = {
        id: `msg-${Date.now()}-a`,
        sender: 'assistant',
        text: data.answer || "The available articles don't cover this.",
        citations: data.citations || [],
        isAiGenerated: data.isAiGenerated
      };

      setQaMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      setQaError(err?.message || 'Error executing grounded question.');
    } finally {
      setAsking(false);
    }
  };

  const bandColor = BAND_COLORS[scoreResult.band];

  return (
    <div className="h-full w-full overflow-y-auto px-6 md:px-8 py-7 anim-vin select-text">
      {/* Article Reader Modal */}
      <ArticleReaderModal
        articleId={readerArticleId}
        highlightQuote={readerQuote}
        onClose={() => {
          setReaderArticleId(null);
          setReaderQuote(undefined);
        }}
      />

      <div className="max-w-[1360px] mx-auto space-y-6">
        {/* Breadcrumb & Navigation */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
          <div className="flex items-center gap-2 text-xs font-mono-code text-[var(--ink3)]">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 hover:text-[var(--primary)] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <span>/</span>
            <span className="text-[var(--ink)]">Adverse Media Intelligence Dossier</span>
          </div>

          <span
            className="px-2 py-0.5 rounded text-[10px] font-mono-code font-semibold border"
            style={{
              backgroundColor: 'var(--bg2)',
              borderColor: 'var(--line)',
              color: 'var(--ink2)'
            }}
          >
            Synthetic data
          </span>
        </div>

        {/* Top Split: Main Dossier Cards (Left) + Grounded Q&A Panel (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: 10 Intelligence Cards (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* CARD 1: Subject Header */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-12 h-12 rounded-full sig-gradient-bg flex items-center justify-center text-white font-bold font-display text-base shadow-sm"
                  >
                    {person.name
                      .split(' ')
                      .map((p: string) => p[0])
                      .slice(0, 2)
                      .join('')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="font-display font-bold text-xl text-[var(--ink)]">
                        {person.name}
                      </h1>
                      {person.pepStatus !== 'none' && (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-bold uppercase tracking-wider"
                          style={{ backgroundColor: 'var(--amber-s)', color: 'var(--amber)' }}
                        >
                          PEP ({person.pepStatus})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--ink2)] flex items-center gap-2 mt-0.5">
                      <span>Nationality: {person.nationality}</span>
                      <span>·</span>
                      <span>Born: {person.yearOfBirth || 'Unknown'}</span>
                      <span>·</span>
                      <span className="font-mono-code text-[11px] text-[var(--ink3)]">ID: {person.id}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right text-xs font-mono-code text-[var(--ink3)]">
                  <div>Screening run date: {new Date().toLocaleDateString('en-GB')}</div>
                  <div className="text-emerald-700 font-semibold flex items-center justify-end gap-1 mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Corpus Verified</span>
                  </div>
                </div>
              </div>

              {/* UBO customer linkages */}
              {uboHoldings.length > 0 && (
                <div className="pt-2 border-t flex flex-wrap items-center gap-2 text-xs" style={{ borderColor: 'var(--line2)' }}>
                  <span className="text-[var(--ink3)] text-[11px] font-mono-code">Beneficial Ownership Linkages:</span>
                  {uboHoldings.map((h) => (
                    <span
                      key={h.group.id}
                      className="px-2 py-0.5 rounded-md border text-[11px] flex items-center gap-1.5"
                      style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}
                    >
                      <Building2 className="w-3 h-3 text-[var(--primary)]" />
                      <strong className="text-[var(--ink)]">{h.group.name}</strong>
                      <span className="font-mono-code text-[var(--ink2)]">({h.range} · {h.classification})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* CARD 2: Risk Score & Traceable Calculation */}
            <div
              className="p-5 rounded-2xl border space-y-4 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="section-label">Adverse Media Risk Score</span>
                  <div className="flex items-baseline gap-3 mt-1">
                    <div className="font-display font-extrabold text-3xl tabular-nums" style={{ color: bandColor }}>
                      {scoreResult.score} <span className="text-sm font-sans font-medium text-[var(--ink3)]">/ 100</span>
                    </div>
                    <div
                      className="px-2.5 py-0.5 rounded-full text-xs font-mono-code font-bold uppercase tracking-wider border"
                      style={{
                        backgroundColor: `${bandColor}15`,
                        borderColor: bandColor,
                        color: bandColor
                      }}
                    >
                      {scoreResult.band} RISK
                    </div>
                  </div>
                  <p className="text-xs text-[var(--ink2)] mt-1">
                    Evaluated across {scoreResult.totalMatters} distinct matter(s) · {scoreResult.corroboratedMattersCount} corroborated, {scoreResult.resolvedMattersCount} resolved.
                  </p>
                </div>

                {/* Semicircular Gauge SVG */}
                <div className="relative w-28 h-16 flex items-center justify-center">
                  <svg className="w-28 h-16" viewBox="0 0 100 55">
                    {/* Background track arc */}
                    <path
                      d="M 10 50 A 40 40 0 0 1 90 50"
                      fill="none"
                      stroke="var(--line)"
                      strokeWidth="9"
                      strokeLinecap="round"
                    />
                    {/* Animated foreground arc */}
                    <path
                      d="M 10 50 A 40 40 0 0 1 90 50"
                      fill="none"
                      stroke={bandColor}
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray="126"
                      strokeDashoffset={126 - (126 * Math.min(100, scoreResult.score)) / 100}
                      style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                    />
                  </svg>
                  <span className="absolute bottom-0 font-display font-bold text-sm text-[var(--ink)]">
                    {scoreResult.score}%
                  </span>
                </div>
              </div>

              {/* Expandable "How this was calculated" */}
              <div className="pt-2 border-t" style={{ borderColor: 'var(--line2)' }}>
                <button
                  type="button"
                  onClick={() => setShowFormulaDetails(!showFormulaDetails)}
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
                >
                  <span>How this was calculated</span>
                  {showFormulaDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showFormulaDetails && (
                  <div className="mt-3 p-3.5 rounded-xl border text-xs space-y-2 anim-fadeIn" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                    <div className="font-mono-code text-[11px] text-[var(--ink3)]">
                      Formula: Points = severity × stage × sourceTier × recency · Score = min(100, round(5 × sum(Points)))
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {scoreResult.matters.map((m, idx) => (
                        <div key={idx} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded border bg-[var(--card)]" style={{ borderColor: 'var(--line)' }}>
                          <span className="font-medium text-[var(--ink)]">{m.matterLabel}</span>
                          <span className="font-mono-code text-[11px] text-[var(--ink2)]">
                            {m.isResolvedCleared ? (
                              <span className="text-emerald-700 font-semibold">Latest Cleared (0.00 pts)</span>
                            ) : (
                              `${m.severityMultiplier} (sev) × ${m.stageMultiplier} (stg) × ${m.sourceTierMultiplier} (tier) × ${m.recencyMultiplier} (rec) = ${m.rawPoints.toFixed(2)} pts`
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* CARD 3: Timeline */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center justify-between">
                <span className="section-label">Chronological Findings Timeline</span>
                <span className="text-[11px] font-mono-code text-[var(--ink3)]">
                  Click point to open article reader
                </span>
              </div>

              {matchedFindings.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--ink3)]">No timeline events recorded.</div>
              ) : (
                <div className="relative pt-6 pb-2 overflow-x-auto">
                  {/* Horizontal line */}
                  <div className="absolute top-9 left-2 right-2 h-0.5 bg-[var(--line)]" />
                  <div className="flex items-start justify-between min-w-[500px] px-2 relative z-10">
                    {matchedFindings
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map((f, idx) => {
                        const dotColor = LEGAL_STAGE_COLORS[f.legalStage] || 'var(--ink3)';
                        return (
                          <div
                            key={f.articleId + idx}
                            onClick={() => {
                              setReaderArticleId(f.articleId);
                              setReaderQuote(f.quote);
                            }}
                            className="flex flex-col items-center cursor-pointer group px-2 max-w-[120px]"
                            title={`${f.title} (${f.date}) — Click to read`}
                          >
                            <div
                              className="w-4 h-4 rounded-full border-2 transition-transform duration-200 group-hover:scale-150 shadow-sm"
                              style={{
                                backgroundColor: dotColor,
                                borderColor: 'var(--card)',
                                boxShadow: `0 0 6px ${dotColor}`
                              }}
                            />
                            <span className="text-[10px] font-mono-code font-bold mt-2 text-[var(--ink)]">
                              {f.date.slice(0, 4)}
                            </span>
                            <span className="text-[9.5px] text-center line-clamp-2 text-[var(--ink2)] group-hover:text-[var(--primary)] transition-colors mt-0.5">
                              {f.legalStage}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* CARD 4: Legal-Stage Matrix (Alleged vs Convicted) */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div>
                <span className="section-label">Legal-Stage Matrix · Allegation vs. Conviction</span>
                <p className="text-xs text-[var(--ink2)] mt-0.5">
                  Distinguishes between unproven allegations, active inquiries, charges, and formal convictions.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-[10px] uppercase font-mono-code text-[var(--ink3)]" style={{ borderColor: 'var(--line)' }}>
                      <th className="py-2 pr-3">Typology</th>
                      {legalStageMatrix.stages.map((s) => (
                        <th key={s} className="py-2 px-2 text-center capitalize">{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y text-xs font-mono-code" style={{ borderColor: 'var(--line2)' }}>
                    {legalStageMatrix.typologies.map((typ) => {
                      const row = legalStageMatrix.matrix[typ] || {};
                      return (
                        <tr key={typ} className="hover:bg-[var(--bg2)] transition-colors">
                          <td className="py-2 pr-3 capitalize font-sans font-medium text-[var(--ink)]">{typ}</td>
                          {legalStageMatrix.stages.map((stg) => {
                            const cell = row[stg] || { count: 0 };
                            const hasHits = cell.count > 0;
                            const isConvictionOrFinding = stg === 'conviction' || stg === 'regulatory finding';
                            return (
                              <td key={stg} className="py-2 px-2 text-center">
                                {hasHits ? (
                                  <span
                                    className="inline-block px-2 py-0.5 rounded font-bold"
                                    style={{
                                      backgroundColor: isConvictionOrFinding ? 'var(--rose-s)' : 'var(--bg2)',
                                      color: isConvictionOrFinding ? 'var(--rose)' : 'var(--ink)',
                                      border: '1px solid var(--line)'
                                    }}
                                  >
                                    {cell.count}
                                  </span>
                                ) : (
                                  <span className="text-[var(--ink3)] opacity-40">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Split Row: CARD 5 (Typology Breakdown) & CARD 6 (Jurisdiction Exposure) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* CARD 5: Typology Breakdown */}
              <div
                className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
                style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
              >
                <span className="section-label">Typology Distribution</span>
                {typologies.length === 0 ? (
                  <p className="text-xs text-[var(--ink3)]">No typologies recorded.</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {typologies.map(([typ, cnt]) => {
                      const pct = Math.round((cnt / matchedFindings.length) * 100);
                      return (
                        <div key={typ} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-mono-code">
                            <span className="capitalize font-sans font-medium text-[var(--ink)]">{typ}</span>
                            <span className="text-[var(--ink2)]">{cnt} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[var(--line)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--primary)] transition-all duration-1000"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CARD 6: Jurisdiction Exposure */}
              <div
                className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
                style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
              >
                <span className="section-label">Jurisdiction Exposure</span>
                {jurisdictions.length === 0 ? (
                  <p className="text-xs text-[var(--ink3)]">No jurisdictions recorded.</p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {jurisdictions.map(([jur, cnt]) => (
                      <div
                        key={jur}
                        className="p-2.5 rounded-xl border flex items-center justify-between text-xs"
                        style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}
                      >
                        <div className="flex items-center gap-2">
                          <Globe2 className="w-3.5 h-3.5 text-[var(--primary)]" />
                          <span className="font-semibold text-[var(--ink)]">{jur}</span>
                        </div>
                        <span className="font-mono-code font-bold text-[var(--ink2)]">
                          {cnt} matter(s)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* CARD 7: Source Quality & Corroboration */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center justify-between">
                <span className="section-label">Source Quality &amp; Multi-Outlet Corroboration</span>
                <span className="text-[11px] font-mono-code text-[var(--ink3)]">
                  {scoreResult.corroboratedMattersCount} corroborated · {scoreResult.singleSourceMattersCount} single-source
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl border" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  <div className="text-[10px] font-mono-code text-[var(--ink3)]">REGULATOR TIER</div>
                  <div className="font-bold font-display text-lg mt-0.5 text-[var(--ink)]">{sourceTiers.regulator}</div>
                </div>
                <div className="p-3 rounded-xl border" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  <div className="text-[10px] font-mono-code text-[var(--ink3)]">TIER 1 OUTLETS</div>
                  <div className="font-bold font-display text-lg mt-0.5 text-[var(--ink)]">{sourceTiers.tier1}</div>
                </div>
                <div className="p-3 rounded-xl border" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  <div className="text-[10px] font-mono-code text-[var(--ink3)]">ESTABLISHED</div>
                  <div className="font-bold font-display text-lg mt-0.5 text-[var(--ink)]">{sourceTiers.established}</div>
                </div>
                <div className="p-3 rounded-xl border" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  <div className="text-[10px] font-mono-code text-[var(--ink3)]">BLOGS / LOW-CONF</div>
                  <div className="font-bold font-display text-lg mt-0.5 text-[var(--ink)]">{sourceTiers.blog}</div>
                </div>
              </div>
            </div>

            {/* CARD 8: Conflicting Reports Side-by-Side */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div>
                <span className="section-label">Conflicting Reports Analysis</span>
                <p className="text-xs text-[var(--ink2)] mt-0.5">
                  Surfaces direct evidentiary contradictions where two outlets present conflicting accounts of the same underlying matter.
                </p>
              </div>

              {conflictingPairs.length === 0 ? (
                <div className="p-4 rounded-xl border text-xs text-[var(--ink2)]" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  No conflicting reports found. Publications report consistent narratives for each identified matter.
                </div>
              ) : (
                <div className="space-y-4">
                  {conflictingPairs.map((pair, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="text-xs font-bold font-display text-[var(--ink)]">{pair.matter}</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {pair.accounts.map((acc, aIdx) => (
                          <div
                            key={aIdx}
                            onClick={() => {
                              setReaderArticleId(acc.articleId);
                              setReaderQuote(acc.quote);
                            }}
                            className="p-3 rounded-xl border text-xs space-y-1.5 cursor-pointer hover:border-[var(--primary)] transition-colors"
                            style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-semibold text-[var(--ink)] truncate mr-3 min-w-0 flex-1">{acc.outlet}</span>
                              <span
                                className="px-2.5 py-0.5 rounded text-[10px] font-mono-code font-bold uppercase shrink-0 tracking-wide"
                                style={{
                                  backgroundColor: acc.legalStage === 'cleared' ? 'var(--emerald-s)' : 'var(--coral-s)',
                                  color: acc.legalStage === 'cleared' ? 'var(--emerald)' : 'var(--coral)'
                                }}
                              >
                                {acc.legalStage}
                              </span>
                            </div>
                            <p className="italic text-[11px] text-[var(--ink2)]">"{acc.quote}"</p>
                            <div className="text-[10px] font-mono-code text-[var(--ink3)]">{acc.date} · Tier: {acc.sourceTier}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CARD 9: Source of Wealth */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center justify-between">
                <span className="section-label">Source of Wealth Provenance</span>
                <span className="text-[10px] font-mono-code text-[var(--ink3)]">Reported in media · Not verified</span>
              </div>

              {sowFindings.length === 0 ? (
                <div className="p-4 rounded-xl border text-xs text-[var(--ink3)]" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  Not enough information in the available articles regarding commercial wealth provenance.
                </div>
              ) : (
                <div className="space-y-3">
                  {sowFindings.map((s, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setReaderArticleId(s.articleId);
                        setReaderQuote(s.quote);
                      }}
                      className="p-3.5 rounded-xl border text-xs space-y-1.5 cursor-pointer hover:border-[var(--primary)] transition-colors"
                      style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono-code">
                        <span className="font-semibold text-[var(--ink)]">{s.outlet}</span>
                        <span className="text-[var(--ink3)]">{s.date}</span>
                      </div>
                      <p className="text-[var(--ink)] leading-relaxed font-medium">
                        {s.sourceOfWealthStatement}
                      </p>
                      <p className="text-[11px] italic text-[var(--ink2)]">"{s.quote}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CARD 10: Different Individual (Excluded disambiguation) */}
            <div
              className="p-5 rounded-2xl border space-y-3.5 anim-slin shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              <div>
                <span className="section-label">Excluded Individuals · Identity Disambiguation</span>
                <p className="text-xs text-[var(--ink2)] mt-0.5">
                  Articles excluded from scoring because chronological age, nationality, or professional domain confirm they concern someone else with the same name.
                </p>
              </div>

              {excludedFindings.length === 0 ? (
                <div className="p-3.5 rounded-xl border text-xs text-[var(--ink3)]" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  No same-name articles excluded. All retrieved items matched candidate identity.
                </div>
              ) : (
                <div className="space-y-3">
                  {excludedFindings.map((ex, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border text-xs space-y-1.5"
                      style={{
                        backgroundColor: 'var(--bg2)',
                        borderColor: 'var(--line)'
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-[var(--ink)]">{ex.title}</div>
                        <span className="text-[10px] font-mono-code px-2 py-0.5 rounded font-bold uppercase bg-amber-50 text-amber-800 border border-amber-200">
                          Excluded
                        </span>
                      </div>
                      <p className="text-xs text-[var(--ink2)]">{ex.identityEvidence}</p>
                      <div className="text-[10px] font-mono-code text-[var(--ink3)]">
                        {ex.outlet} · {ex.date} · Jurisdiction: {ex.jurisdictions.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Grounded Q&A Panel (4 cols) */}
          <div className="lg:col-span-4">
            <div
              className="p-5 rounded-2xl border flex flex-col h-[780px] sticky top-6 shadow-sm"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
            >
              {/* Header */}
              <div className="border-b pb-3.5 mb-3 shrink-0" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-display font-bold text-sm text-[var(--ink)]">
                    Ask About This Person
                  </h3>
                </div>
                <p className="text-[11px] text-[var(--ink2)] mt-0.5">
                  Grounded exclusively in {matchedFindings.length} verified articles for {person.name}. Every answer cites article sources.
                </p>
              </div>

              {/* Suggested Questions */}
              <div className="space-y-1.5 mb-3 shrink-0">
                <span className="text-[10px] uppercase font-mono-code text-[var(--ink3)]">Suggested Inquiries</span>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTED_QUESTIONS.map((sq, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={asking}
                      onClick={() => handleAskQuestion(sq)}
                      className="text-left text-[11px] p-2 rounded-lg border hover:bg-[var(--bg2)] text-[var(--ink)] transition-colors cursor-pointer disabled:opacity-50"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat Message Stream */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs mb-3">
                {qaMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[var(--ink3)] space-y-2">
                    <FileQuestion className="w-6 h-6 opacity-60" />
                    <p className="text-[11px]">Select a suggested query above or type a specific compliance question below.</p>
                  </div>
                ) : (
                  qaMessages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-3 rounded-xl border space-y-1.5 ${
                        m.sender === 'user' ? 'ml-6' : 'mr-2'
                      }`}
                      style={{
                        backgroundColor: m.sender === 'user' ? 'var(--primary-s)' : 'var(--bg2)',
                        borderColor: m.sender === 'user' ? 'rgba(1, 110, 253, 0.3)' : 'var(--line)',
                        color: 'var(--ink)'
                      }}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono-code text-[var(--ink3)]">
                        <span>{m.sender === 'user' ? 'Analyst Inquiry' : 'Grounded Model Response'}</span>
                        {m.isAiGenerated && <span className="text-[var(--primary)] font-semibold">AI Grounded</span>}
                      </div>

                      <p className="leading-relaxed whitespace-pre-line text-xs">{m.text}</p>

                      {/* Citation chips */}
                      {m.citations && m.citations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[var(--line)]">
                          <span className="text-[10px] font-mono-code text-[var(--ink3)]">Sources:</span>
                          {m.citations.map((cid) => (
                            <button
                              key={cid}
                              type="button"
                              onClick={() => {
                                const art = matchedFindings.find((f) => f.articleId === cid);
                                const corpusItem = (adverseMediaCorpus as any[]).find((a) => a.id === cid);
                                setReaderArticleId(cid);
                                setReaderQuote(art?.quote || corpusItem?.headline);
                              }}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono-code font-bold bg-[var(--card)] border hover:bg-[var(--primary-s)] text-[var(--primary)] transition-colors cursor-pointer"
                              style={{ borderColor: 'var(--line)' }}
                              title="Click to view article passage in source reader"
                            >
                              [{cid}]
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {asking && (
                  <div className="p-3 rounded-xl border flex items-center gap-2 text-xs text-[var(--ink2)] bg-[var(--bg2)]" style={{ borderColor: 'var(--line)' }}>
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)]" />
                    <span>Cross-referencing verified corpus...</span>
                  </div>
                )}
              </div>

              {qaError && (
                <div className="p-2 mb-2 rounded border text-[11px] text-[var(--rose)] bg-[var(--rose-s)] border-[var(--rose)] shrink-0">
                  {qaError}
                </div>
              )}

              {/* Question Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskQuestion(questionInput);
                }}
                className="shrink-0 space-y-1.5"
              >
                <div className="relative">
                  <textarea
                    rows={2}
                    maxLength={500}
                    disabled={asking}
                    value={questionInput}
                    onChange={(e) => setQuestionInput(e.target.value)}
                    placeholder="Ask a question about this person's adverse media (max 500 chars)..."
                    className="w-full p-2.5 pr-9 text-xs rounded-xl border outline-none transition-colors focus-visible:ring-2 disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--bg2)',
                      borderColor: 'var(--line)',
                      color: 'var(--ink)'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={asking || !questionInput.trim()}
                    aria-label="Send question"
                    className="absolute right-2.5 bottom-3 text-[var(--primary)] hover:opacity-80 disabled:opacity-40 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono-code text-[var(--ink3)]">
                  <span>Rate limit: 20 queries / 10m</span>
                  <span>{questionInput.length} / 500</span>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
