/**
 * Sentinel AI — Document AI Type Definitions & Client-Safe Signature Validator
 * Safe for client-side React bundles (no Node.js or google-auth-library dependencies).
 */

export interface ExtractedShareholderRow {
  id: string;
  holderName: string;
  holderType: 'person' | 'entity';
  shareKind: 'exact' | 'range';
  shareExact: number | null; // e.g. 65 for exact shares, or null if range
  shareMin: number | null;   // e.g. 25 if range, or null if exact
  shareMax: number | null;   // e.g. 50 if range, or null if exact
  shareValue?: number | null; // retained for backward compatibility: equals shareExact when exact, null when range
  shareClass: string;
  asOfDate: string | null;
  sourcePage: number;
  confidence: number; // 0..1
  fieldConfidences: {
    holderName: number;
    share: number;
    shareClass: number;
    asOfDate?: number | null;
  };
}

/**
 * Normalises an extracted shareholder row before writing to Firestore or returning to callers.
 * Conforms to Requirement 1:
 * - A share is either exact (shareExact set, shareMin and shareMax null)
 *   or a range (shareMin and shareMax set, shareExact null).
 * - Never writes undefined: uses null for absent optional fields.
 */
export function normalizeExtractedRow(
  raw: Partial<ExtractedShareholderRow> | any,
  index: number = 0
): ExtractedShareholderRow {
  if (!raw || typeof raw !== 'object') {
    return {
      id: `row-${index + 1}`,
      holderName: 'Disclosed Owner',
      holderType: 'person',
      shareKind: 'exact',
      shareExact: 0,
      shareMin: null,
      shareMax: null,
      shareValue: 0,
      shareClass: 'Ordinary Shares',
      asOfDate: new Date().toISOString().slice(0, 10),
      sourcePage: 1,
      confidence: 0.9,
      fieldConfidences: {
        holderName: 0.9,
        share: 0.9,
        shareClass: 0.9,
        asOfDate: 0.9
      }
    };
  }

  // Determine if share is range or exact
  const hasRangeFields =
    raw.shareKind === 'range' ||
    (raw.shareMin !== undefined && raw.shareMin !== null && raw.shareMax !== undefined && raw.shareMax !== null);

  let shareKind: 'exact' | 'range';
  let shareExact: number | null = null;
  let shareMin: number | null = null;
  let shareMax: number | null = null;
  let shareValue: number | null = null;

  if (hasRangeFields) {
    shareKind = 'range';
    const minVal = typeof raw.shareMin === 'number'
      ? raw.shareMin
      : (typeof raw.shareValue === 'number' ? raw.shareValue : (typeof raw.shareExact === 'number' ? raw.shareExact : 0));
    const maxVal = typeof raw.shareMax === 'number'
      ? raw.shareMax
      : minVal;

    shareMin = Number.isFinite(minVal) ? minVal : 0;
    shareMax = Number.isFinite(maxVal) ? maxVal : shareMin;
    shareExact = null;
    shareValue = null;
  } else {
    shareKind = 'exact';
    const exactVal = typeof raw.shareExact === 'number'
      ? raw.shareExact
      : (typeof raw.shareValue === 'number' ? raw.shareValue : (typeof raw.shareMin === 'number' ? raw.shareMin : 0));

    shareExact = Number.isFinite(exactVal) ? exactVal : 0;
    shareMin = null;
    shareMax = null;
    shareValue = shareExact;
  }

  const holderName = typeof raw.holderName === 'string' && raw.holderName.trim()
    ? String(raw.holderName).replace(/[`'"<>]/g, '').trim()
    : 'Disclosed Owner';

  const holderType: 'person' | 'entity' =
    raw.holderType === 'entity' || /ltd|inc|llc|holdings|corp|sa|gmbh|trust|settlement/i.test(holderName)
      ? 'entity'
      : 'person';

  const shareClass = typeof raw.shareClass === 'string' && raw.shareClass.trim()
    ? String(raw.shareClass).replace(/[`'"<>]/g, '').trim()
    : 'Ordinary Shares';

  const asOfDate = typeof raw.asOfDate === 'string' && raw.asOfDate.trim()
    ? String(raw.asOfDate).trim()
    : new Date().toISOString().slice(0, 10);

  const sourcePage = typeof raw.sourcePage === 'number' && Number.isFinite(raw.sourcePage)
    ? raw.sourcePage
    : 1;

  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.92;

  const fc = raw.fieldConfidences || {};
  const fieldConfidences = {
    holderName: typeof fc.holderName === 'number' && Number.isFinite(fc.holderName) ? fc.holderName : 0.95,
    share: typeof fc.share === 'number' && Number.isFinite(fc.share) ? fc.share : 0.90,
    shareClass: typeof fc.shareClass === 'number' && Number.isFinite(fc.shareClass) ? fc.shareClass : 0.88,
    asOfDate: typeof fc.asOfDate === 'number' && Number.isFinite(fc.asOfDate) ? fc.asOfDate : 0.92
  };

  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id.trim()
    : `row-${index + 1}`;

  return {
    id,
    holderName,
    holderType,
    shareKind,
    shareExact,
    shareMin,
    shareMax,
    shareValue,
    shareClass,
    asOfDate,
    sourcePage,
    confidence,
    fieldConfidences
  };
}

/**
 * Asserts that an object or record contains absolutely no undefined values.
 * Throws an Error indicating the exact property path if any undefined is encountered.
 */
export function assertNoUndefined(obj: any, path: string = ''): void {
  if (obj === undefined) {
    throw new Error(`Found undefined at path: ${path || '<root>'}`);
  }
  if (obj === null || typeof obj !== 'object') {
    return;
  }
  for (const [key, val] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (val === undefined) {
      throw new Error(`Found undefined at path: ${currentPath}`);
    }
    if (typeof val === 'object' && val !== null) {
      assertNoUndefined(val, currentPath);
    }
  }
}

export interface DocumentExtractionInput {
  fileBase64: string;
  fileMimeType: string;
  fileName: string;
  fileSizeBytes: number;
  gapId: string;
  groupId: string;
  gapContext?: {
    label: string;
    description: string;
    declaredShare?: number;
  };
}

export interface DocumentExtractionResult {
  extractionId: string;
  extractor: 'Preview extraction (Gemini)' | 'Production Document AI (Form Parser)' | 'Preview extraction (Deterministic Simulation)';
  status: 'extracted' | 'failed';
  rows: ExtractedShareholderRow[];
  rawTextSummary?: string;
  pageCount: number;
  confidence: number;
}

export interface IDocumentAiAdapter {
  extractShareholders(input: DocumentExtractionInput): Promise<DocumentExtractionResult>;
  mode(): 'PREVIEW' | 'PRODUCTION';
}

/**
 * Validates binary file signatures (magic bytes).
 * Defends against disguised file attacks (e.g. .txt renamed to .pdf).
 * Safe for browser and server (works with Uint8Array or Buffer).
 */
export function validateFileSignature(
  buffer: Uint8Array,
  mimeType: string
): { valid: boolean; detectedFormat: string | null; error?: string } {
  if (!buffer || buffer.length < 4) {
    return { valid: false, detectedFormat: null, error: 'File is empty or too short.' };
  }

  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  // PDF magic bytes: %PDF- (0x25, 0x50, 0x44, 0x46)
  const isPdf = b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46;

  // PNG magic bytes: 0x89 0x50 0x4E 0x47
  const isPng = b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47;

  // JPEG magic bytes: 0xFF 0xD8 0xFF
  const isJpeg = b0 === 0xff && b1 === 0xd8 && b2 === 0xff;

  let detectedFormat: string | null = null;
  if (isPdf) detectedFormat = 'application/pdf';
  else if (isPng) detectedFormat = 'image/png';
  else if (isJpeg) detectedFormat = 'image/jpeg';

  if (mimeType === 'application/pdf' && !isPdf) {
    return {
      valid: false,
      detectedFormat,
      error: 'Invalid file signature: File has a .pdf extension or MIME type, but its binary content does not start with %PDF- header. Renamed text files or executables are strictly rejected.'
    };
  }

  if (mimeType === 'image/png' && !isPng) {
    return {
      valid: false,
      detectedFormat,
      error: 'Invalid file signature: File is not a valid PNG binary image.'
    };
  }

  if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && !isJpeg) {
    return {
      valid: false,
      detectedFormat,
      error: 'Invalid file signature: File is not a valid JPEG binary image.'
    };
  }

  return { valid: true, detectedFormat };
}
