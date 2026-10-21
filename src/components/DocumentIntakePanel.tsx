/**
 * Sentinel AI — Document Intake & Review Table (Phase 5)
 * Conforms to:
 * - Threat Model: Binary file signature validation (magic bytes), 10 MB limit, untrusted text
 * - Dual Adapters: Preview (Gemini) vs Production (Document AI Form Parser)
 * - Analyst Confirmation Gate: Editable review table with field confidence
 * - Group 5 Sample PDF generation with pdf-lib
 */

import React, { useState } from 'react';
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Download,
  Trash2,
  Plus,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { validateFileSignature, ExtractedShareholderRow, normalizeExtractedRow } from '../types/documentAi';
import { generateSampleDocumentPdf, triggerBrowserDownload } from '../lib/sampleDocumentGenerator';
import { writeAuditRecord } from '../lib/firebase';

interface DocumentIntakePanelProps {
  gap: any;
  groupId: string;
  customerId: string;
  groupName: string;
  onClose: () => void;
  onConfirmExtraction: (data: {
    gapId: string;
    extractionId: string;
    fileName: string;
    confirmedRows: ExtractedShareholderRow[];
  }) => void;
}

export const DocumentIntakePanel: React.FC<DocumentIntakePanelProps> = ({
  gap,
  groupId,
  customerId,
  groupName,
  onClose,
  onConfirmExtraction
}) => {
  const { user, profile } = useAuth();

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractorMode, setExtractorMode] = useState<string>('Preview extraction (Gemini)');
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [extractedRows, setExtractedRows] = useState<ExtractedShareholderRow[]>([]);
  const [isExtracted, setIsExtracted] = useState(false);

  // Confirming state
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const gapId = gap.id || gap.gap?.id || 'gap-unknown';
  const gapLabel = gap.label || gap.gap?.label || 'Ownership Opacity Gap';
  const isGroup5 = groupId === 'grp-05-obsidian' || gapId.includes('g5') || gapId.includes('nominee') || gapId.includes('trust');

  // 1. Download Sample Document
  const handleDownloadSample = async () => {
    try {
      const { bytes, filename } = await generateSampleDocumentPdf(gapId);
      triggerBrowserDownload(bytes, filename);

      if (user) {
        await writeAuditRecord({
          actorUid: user.uid,
          actorType: 'HUMAN',
          actorName: profile?.displayName || 'Analyst',
          action: 'SAMPLE_DOCUMENT_GENERATED',
          summary: `Generated synthetic sample PDF evidence ${filename} for gap ${gapId}.`,
          groupId,
          customerId: customerId || null,
          details: { gapId, filename, synthetic: true }
        });
      }
    } catch (err: any) {
      console.error('Failed to generate sample PDF:', err);
      setFileError('Could not generate sample PDF: ' + err.message);
    }
  };

  // 2. Handle File Selection with Magic Byte Validation
  const handleFileChange = async (file: File) => {
    setFileError(null);
    setIsExtracted(false);
    setExtractedRows([]);

    // Size limit: 10 MB
    if (file.size > 10 * 1024 * 1024) {
      setFileError('File exceeds the 10 MB maximum upload limit.');
      return;
    }

    // Read bytes for magic byte verification
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const sigCheck = validateFileSignature(bytes, file.type || 'application/pdf');
    if (!sigCheck.valid) {
      setSelectedFile(null);
      setFileBase64(null);
      setFileError(sigCheck.error || 'Invalid file format.');
      return;
    }

    // Convert to base64
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    setSelectedFile(file);
    setFileBase64(base64);

    // Auto-trigger extraction
    handleExtract(file.name, file.type || 'application/pdf', base64);
  };

  // 3. Extract Document via Server Route
  const handleExtract = async (fileName: string, fileMimeType: string, base64Data: string) => {
    if (!user) return;
    setExtracting(true);
    setFileError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/documents/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          fileName,
          fileMimeType,
          fileBase64: base64Data,
          gapId,
          groupId,
          customerId,
          gapContext: {
            label: gapLabel,
            description: gap.description || gap.gap?.description || '',
            declaredShare: gap.declaredShare || gap.gap?.declaredShare
          }
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 429 || errJson.rateLimited || String(errJson.error || '').includes('rate-limit')) {
          throw new Error('AI features are temporarily rate-limited. Please try again later.');
        }
        throw new Error(errJson.error || `Server extraction failed with status ${res.status}`);
      }

      const data = await res.json();
      setExtractionId(data.extractionId);
      setExtractorMode(data.extractor);
      setExtractedRows((data.rows || []).map((r: any, i: number) => normalizeExtractedRow(r, i)));
      setIsExtracted(true);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setFileError(err.message || 'Extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  // 4. Update row values in the review table
  const handleRowChange = (index: number, field: keyof ExtractedShareholderRow, val: any) => {
    setExtractedRows((prev) => {
      const copy = [...prev];
      const updated = { ...copy[index], [field]: val };
      if (field === 'shareValue' || field === 'shareExact') {
        updated.shareExact = val;
        updated.shareValue = val;
        updated.shareMin = null;
        updated.shareMax = null;
      }
      copy[index] = normalizeExtractedRow(updated, index);
      return copy;
    });
  };

  const handleAddRow = () => {
    const newRow = normalizeExtractedRow({
      id: `row-${extractedRows.length + 1}`,
      holderName: 'New Beneficial Holder',
      holderType: 'person',
      shareKind: 'exact',
      shareExact: 10,
      shareClass: 'Ordinary Shares',
      asOfDate: new Date().toISOString().slice(0, 10),
      sourcePage: 1,
      confidence: 1.0,
      fieldConfidences: {
        holderName: 1.0,
        share: 1.0,
        shareClass: 1.0,
        asOfDate: 1.0
      }
    }, extractedRows.length);
    setExtractedRows((prev) => [...prev, newRow]);
  };

  const handleDeleteRow = (index: number) => {
    setExtractedRows((prev) => prev.filter((_, i) => i !== index));
  };

  // 5. Confirm and Apply to Live Graph
  const handleConfirm = async () => {
    if (!user || !extractionId || extractedRows.length === 0) return;
    setConfirming(true);
    setConfirmError(null);

    const normalizedToConfirm = extractedRows.map((r, i) => normalizeExtractedRow(r, i));

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/documents/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          extractionId,
          confirmedRows: normalizedToConfirm,
          gapId,
          groupId,
          customerId: customerId || null
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to confirm document extraction.');
      }

      onConfirmExtraction({
        gapId,
        extractionId,
        fileName: selectedFile?.name || 'Verified Client Document',
        confirmedRows: normalizedToConfirm
      });
    } catch (err: any) {
      console.error('Confirmation error:', err);
      setConfirmError(err.message || 'Failed to confirm extraction.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-4 text-xs select-text">
      {/* Target Data Gap Header */}
      <div
        className="p-3.5 rounded-xl border space-y-1.5"
        style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center justify-between">
          <span className="section-label">Target Data Gap</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono-code font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Open Opacity Gap
          </span>
        </div>
        <div className="font-bold text-[var(--ink)] text-xs">{gapLabel}</div>
        <p className="text-[11px] text-[var(--ink2)] leading-relaxed">
          {gap.description || gap.gap?.description || 'Statutory filing opacity requires verifiable documentary evidence.'}
        </p>
      </div>

      {/* Synthetic Sample Generator Link (Group 5 gaps) */}
      {isGroup5 && (
        <div
          className="p-3 rounded-xl border flex items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[var(--primary-s)] text-[var(--primary)] flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-[var(--ink)] text-[11.5px]">Sample Legal Evidence</div>
              <div className="text-[10.5px] text-[var(--ink3)]">Synthetic register matching graph percentages</div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadSample}
            className="py-1 px-2.5 rounded-lg text-[11px] font-semibold text-[var(--primary)] border hover:bg-[var(--primary-s)] flex items-center gap-1.5 transition-colors cursor-pointer"
            style={{ borderColor: 'var(--line)' }}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Sample PDF</span>
          </button>
        </div>
      )}

      {/* Upload Zone */}
      {!isExtracted && (
        <div className="space-y-2">
          <label
            className="border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-colors hover:border-[var(--primary)] group"
            style={{ borderColor: fileError ? 'var(--rose)' : 'var(--line)', backgroundColor: 'var(--card)' }}
          >
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileChange(e.target.files[0]);
                }
              }}
              className="hidden"
            />
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--bg2)] group-hover:bg-[var(--primary-s)] group-hover:text-[var(--primary)] transition-colors mb-2 text-[var(--ink2)]">
              <Upload className="w-5 h-5" />
            </div>
            <div className="font-semibold text-xs text-[var(--ink)]">
              Drop document here or click to browse
            </div>
            <div className="text-[10.5px] font-mono-code text-[var(--ink3)] mt-0.5">
              PDF, PNG, JPEG up to 10 MB · Validated by binary signature
            </div>
          </label>

          {fileError && (
            <div className="p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs bg-rose-50 border-rose-200 text-rose-800">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <div className="space-y-0.5">
                  <div className="font-bold">Extraction / Reading Failed</div>
                  <div className="leading-relaxed">{fileError}</div>
                </div>
              </div>
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => handleFileChange(selectedFile)}
                  disabled={extracting}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border shrink-0 bg-white hover:bg-rose-100 text-rose-800 transition-colors cursor-pointer"
                  style={{ borderColor: 'var(--coral)' }}
                >
                  {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Retry</span>
                </button>
              )}
            </div>
          )}

          {extracting && (
            <div
              className="p-3.5 rounded-xl border flex items-center gap-3 animate-pulse"
              style={{ backgroundColor: 'var(--primary-s)', borderColor: 'rgba(1, 110, 253, 0.3)', color: 'var(--primary)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <div className="space-y-0.5">
                <div className="font-semibold text-xs">{extractorMode}</div>
                <div className="text-[10.5px] font-mono-code text-[var(--ink2)]">
                  Parsing tables, shareholdings, and beneficiary schedules...
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Review Table (Analyst Confirmation Gate) */}
      {isExtracted && (
        <div className="space-y-3 anim-fadeIn">
          <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2">
              <span className="section-label">Extracted Shareholder Records</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono-code font-bold bg-[var(--bg2)] text-[var(--ink)] border" style={{ borderColor: 'var(--line)' }}>
                {extractorMode}
              </span>
            </div>

            <button
              type="button"
              onClick={handleAddRow}
              className="text-[11px] font-semibold text-[var(--primary)] flex items-center gap-1 hover:underline cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add row</span>
            </button>
          </div>

          <p className="text-[11px] text-[var(--ink3)]">
            Review and edit extracted values below (scroll horizontally to view all fields). Nothing enters the live graph until confirmed.
          </p>

          <div className="overflow-x-auto rounded-xl border scrollbar-thin" style={{ borderColor: 'var(--line)' }}>
            <table className="w-full min-w-[680px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b text-[10px] uppercase font-mono-code text-[var(--ink3)]" style={{ backgroundColor: 'var(--bg2)', borderColor: 'var(--line)' }}>
                  <th className="py-2 px-2.5 min-w-[150px] whitespace-nowrap">Holder Name</th>
                  <th className="py-2 px-2 min-w-[80px] whitespace-nowrap">Type</th>
                  <th className="py-2 px-2 min-w-[75px] whitespace-nowrap">Share %</th>
                  <th className="py-2 px-2 min-w-[210px] whitespace-nowrap font-bold text-[var(--ink)]">Share Class</th>
                  <th className="py-2 px-2 min-w-[100px] whitespace-nowrap">As-of Date</th>
                  <th className="py-2 px-2 min-w-[55px] whitespace-nowrap">Conf</th>
                  <th className="py-2 px-1 text-center w-8 min-w-[32px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--line2)' }}>
                {extractedRows.map((row, idx) => {
                  const confPct = Math.round(row.confidence * 100);
                  const confColor = confPct >= 90 ? 'var(--emerald)' : confPct >= 75 ? 'var(--amber)' : 'var(--coral)';

                  return (
                    <tr key={row.id} className="hover:bg-[var(--bg2)] transition-colors">
                      <td className="py-2 px-2.5 min-w-[150px]">
                        <input
                          type="text"
                          value={row.holderName}
                          onChange={(e) => handleRowChange(idx, 'holderName', e.target.value)}
                          className="w-full min-w-[140px] p-1.5 text-xs rounded border outline-none font-medium text-[var(--ink)] bg-[var(--card)] focus-visible:ring-1"
                          style={{ borderColor: 'var(--line)' }}
                        />
                      </td>

                      <td className="py-2 px-2 min-w-[80px]">
                        <select
                          value={row.holderType}
                          onChange={(e) => handleRowChange(idx, 'holderType', e.target.value)}
                          className="w-full p-1.5 text-xs rounded border outline-none font-mono-code bg-[var(--card)] text-[var(--ink)]"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <option value="person">Person</option>
                          <option value="entity">Entity</option>
                        </select>
                      </td>

                      <td className="py-2 px-2 min-w-[75px]">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={row.shareValue ?? row.shareMin ?? 0}
                          onChange={(e) => handleRowChange(idx, 'shareValue', parseFloat(e.target.value) || 0)}
                          className="w-full min-w-[65px] p-1.5 text-xs rounded border outline-none font-mono-code font-semibold text-[var(--ink)] bg-[var(--card)] focus-visible:ring-1"
                          style={{ borderColor: 'var(--line)' }}
                        />
                      </td>

                      <td className="py-2 px-2 min-w-[210px]">
                        <input
                          type="text"
                          value={row.shareClass}
                          onChange={(e) => handleRowChange(idx, 'shareClass', e.target.value)}
                          className="w-full min-w-[200px] p-1.5 text-xs rounded border outline-none font-medium text-[var(--ink)] bg-[var(--card)] focus-visible:ring-1"
                          style={{ borderColor: 'var(--line)' }}
                          title={row.shareClass}
                          placeholder="e.g. Class A Ordinary Voting Shares"
                        />
                      </td>

                      <td className="py-2 px-2 min-w-[100px]">
                        <input
                          type="text"
                          value={row.asOfDate || ''}
                          onChange={(e) => handleRowChange(idx, 'asOfDate', e.target.value)}
                          className="w-full min-w-[90px] p-1.5 text-xs rounded border outline-none font-mono-code text-[var(--ink)] bg-[var(--card)] focus-visible:ring-1"
                          style={{ borderColor: 'var(--line)' }}
                        />
                      </td>

                      <td className="py-2 px-2 font-mono-code text-[10px]">
                        <span
                          className="px-1.5 py-0.5 rounded font-bold"
                          style={{
                            backgroundColor: confPct >= 90 ? 'var(--emerald-s)' : 'var(--amber-s)',
                            color: confColor
                          }}
                        >
                          {confPct}%
                        </span>
                      </td>

                      <td className="py-2 px-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(idx)}
                          className="p-1 text-[var(--ink3)] hover:text-[var(--rose)] transition-colors cursor-pointer"
                          title="Remove row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {confirmError && (
            <p className="text-xs text-[var(--rose)] font-medium">{confirmError}</p>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => {
                setIsExtracted(false);
                setSelectedFile(null);
                setFileBase64(null);
                setExtractedRows([]);
              }}
              className="text-xs text-[var(--ink2)] hover:underline cursor-pointer"
            >
              Re-upload document
            </button>

            <button
              type="button"
              disabled={confirming || extractedRows.length === 0}
              onClick={handleConfirm}
              title={
                confirming
                  ? 'Committing extracted shareholders to ownership graph...'
                  : extractedRows.length === 0
                  ? 'At least one shareholder row required to apply'
                  : 'Apply verified shareholders to live graph'
              }
              className="py-2 px-4 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {confirming ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Committing to Graph...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Confirm &amp; Apply to Graph</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
