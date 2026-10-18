/**
 * Sentinel AI — Synthetic Sample Document Generator
 * Generates synthetic PDF legal evidence in the browser using pdf-lib.
 * Ensures names, percentages, and share classes match Group 5 seed data & document extraction adapter.
 * Every page bears a visible diagonal "SYNTHETIC SAMPLE" watermark.
 */

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { generateFallbackExtraction } from '../adapters/documentAiAdapter';

export interface SampleDocParams {
  gapId: string;
  groupId: string;
}

export async function generateSampleDocumentPdf(gapId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const isNominee = gapId.includes('nominee');

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 dimensions
  const { width, height } = page.getSize();

  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);

  // Colors
  const inkDark = rgb(0.06, 0.09, 0.16); // #0f172a
  const inkMuted = rgb(0.39, 0.45, 0.55); // #64748b
  const primaryBlue = rgb(0.0, 0.43, 0.99); // #016efd
  const lineGrey = rgb(0.85, 0.88, 0.92);
  const watermarkRed = rgb(0.88, 0.11, 0.28); // #e11d48

  // Get exact extraction rows matching seed / extraction adapter
  const extractedRows = generateFallbackExtraction({
    fileBase64: '',
    fileMimeType: 'application/pdf',
    fileName: 'sample.pdf',
    gapId,
    groupId: 'grp-05-obsidian'
  });

  // 1. Watermark: "SYNTHETIC SAMPLE" diagonally across page
  page.drawText('SYNTHETIC SAMPLE', {
    x: 90,
    y: 320,
    size: 44,
    font: fontHelveticaBold,
    color: watermarkRed,
    opacity: 0.14,
    rotate: degrees(45)
  });

  page.drawText('FOR TESTING & AUDIT VERIFICATION ONLY — NOT A REAL LEGAL DEED', {
    x: 100,
    y: 280,
    size: 10,
    font: fontHelveticaBold,
    color: watermarkRed,
    opacity: 0.22,
    rotate: degrees(45)
  });

  // 2. Top Header & Crest Banner
  page.drawRectangle({
    x: 40,
    y: height - 90,
    width: width - 80,
    height: 50,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: lineGrey,
    borderWidth: 1
  });

  page.drawText('STATUTORY COMPLIANCE FILING SCHEDULE · REGISTRY ARCHIVE', {
    x: 55,
    y: height - 60,
    size: 8.5,
    font: fontCourier,
    color: primaryBlue
  });

  page.drawText('AUTHENTICATED CORPORATE SECRETARIAL EXTRACT', {
    x: 55,
    y: height - 76,
    size: 11,
    font: fontHelveticaBold,
    color: inkDark
  });

  let currentY = height - 120;

  if (isNominee) {
    // NOMINEE SHARE REGISTER
    page.drawText('BRITISH VIRGIN ISLANDS BUSINESS COMPANIES ACT, 2004', {
      x: 40,
      y: currentY,
      size: 9,
      font: fontHelveticaBold,
      color: inkMuted
    });
    currentY -= 22;

    page.drawText('Aegis Nominee Corporate Services Ltd', {
      x: 40,
      y: currentY,
      size: 18,
      font: fontHelveticaBold,
      color: inkDark
    });
    currentY -= 15;

    page.drawText('BVI Company No: VG-BVICN-2019440 · Registered Agent: Kingston Chambers, Road Town, Tortola', {
      x: 40,
      y: currentY,
      size: 8.5,
      font: fontHelvetica,
      color: inkMuted
    });
    currentY -= 25;

    page.drawText('STATUTORY REGISTER OF BENEFICIAL MEMBERS & EQUITABLE OWNERS', {
      x: 40,
      y: currentY,
      size: 11,
      font: fontHelveticaBold,
      color: primaryBlue
    });
    currentY -= 16;

    const narrative = [
      'Pursuant to Section 92 of the BVI Business Companies Act, this certified register discloses',
      'the ultimate natural persons holding beneficial and voting entitlement over the 36.0% nominal',
      'shareholding registered in Obsidian Wharf Properties Ltd (UK Registration: UK-CH-12409833).'
    ];
    narrative.forEach((line) => {
      page.drawText(line, { x: 40, y: currentY, size: 9, font: fontHelvetica, color: inkDark });
      currentY -= 13;
    });

    currentY -= 15;

    // Table Header
    page.drawRectangle({
      x: 40,
      y: currentY - 5,
      width: width - 80,
      height: 22,
      color: rgb(0.93, 0.95, 0.98),
      borderColor: lineGrey,
      borderWidth: 1
    });

    page.drawText('BENEFICIAL HOLDER', { x: 50, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    page.drawText('SHARE CLASS', { x: 210, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    page.drawText('EQUITY STAKE', { x: 340, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    page.drawText('AS-OF DATE', { x: 440, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    currentY -= 28;

    // Render exact extracted rows
    extractedRows.forEach((row, idx) => {
      page.drawText(row.holderName, { x: 50, y: currentY, size: 9.5, font: fontHelveticaBold, color: inkDark });
      page.drawText(`Natural Person · British (DOB: ${1958 + idx * 4})`, { x: 50, y: currentY - 11, size: 7.5, font: fontHelvetica, color: inkMuted });
      page.drawText(row.shareClass || 'Ordinary Equity', { x: 210, y: currentY, size: 8.5, font: fontHelvetica, color: inkDark });
      const val = row.shareExact ?? row.shareValue ?? 0;
      page.drawText(`${val.toFixed(1)}% (${(val * 10000).toLocaleString()} shares)`, { x: 340, y: currentY, size: 9, font: fontCourier, color: primaryBlue });
      page.drawText(row.asOfDate || '2026-09-28', { x: 440, y: currentY, size: 8.5, font: fontCourier, color: inkDark });
      currentY -= 36;
    });

    currentY -= 10;

    // Attestation Box
    page.drawRectangle({
      x: 40,
      y: currentY - 45,
      width: width - 80,
      height: 60,
      color: rgb(0.98, 0.98, 0.99),
      borderColor: lineGrey,
      borderWidth: 1
    });

    page.drawText('SECRETARIAL ATTESTATION & STAMP', { x: 50, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkMuted });
    page.drawText('Signed for and on behalf of Aegis Nominee Corporate Services Ltd:', { x: 50, y: currentY - 12, size: 8.5, font: fontHelvetica, color: inkDark });
    page.drawText('Marcus Kingsley Calloway, Resident Corporate Director', { x: 50, y: currentY - 26, size: 9, font: fontHelveticaBold, color: inkDark });
    page.drawText('Filing Reference: BVI-NOM-2026-9812-VERIFIED · Status: Active Register', { x: 50, y: currentY - 38, size: 7.5, font: fontCourier, color: inkMuted });

    const pdfBytes = await pdfDoc.save();
    return { bytes: pdfBytes, filename: 'Aegis_Nominee_Share_Register_Obsidian.pdf' };
  } else {
    // TRUST DEED BENEFICIARY SCHEDULE
    page.drawText('CAYMAN ISLANDS TRUSTS ACT (2020 REVISION)', {
      x: 40,
      y: currentY,
      size: 9,
      font: fontHelveticaBold,
      color: inkMuted
    });
    currentY -= 22;

    page.drawText('Pelican Star Discretionary Settlement', {
      x: 40,
      y: currentY,
      size: 18,
      font: fontHelveticaBold,
      color: inkDark
    });
    currentY -= 15;

    page.drawText('Trust Registration: KY-TR-90412-D · Trustee: Pelican Star Trustees (Cayman) Ltd', {
      x: 40,
      y: currentY,
      size: 8.5,
      font: fontHelvetica,
      color: inkMuted
    });
    currentY -= 25;

    page.drawText('TRUSTEE ATTESTATION & SCHEDULE OF DISCRETIONARY BENEFICIARIES', {
      x: 40,
      y: currentY,
      size: 11,
      font: fontHelveticaBold,
      color: primaryBlue
    });
    currentY -= 16;

    const narrative = [
      'The Trustee hereby certifies that under the Deed of Settlement dated 14 August 2018 (as amended),',
      'the Settlor is Julian Sterling Houghton and the discretionary beneficial interest in the 26.0%',
      'shareholding of Obsidian Wharf Properties Ltd is held exclusively for the beneficiaries below:'
    ];
    narrative.forEach((line) => {
      page.drawText(line, { x: 40, y: currentY, size: 9, font: fontHelvetica, color: inkDark });
      currentY -= 13;
    });

    currentY -= 15;

    // Table Header
    page.drawRectangle({
      x: 40,
      y: currentY - 5,
      width: width - 80,
      height: 22,
      color: rgb(0.93, 0.95, 0.98),
      borderColor: lineGrey,
      borderWidth: 1
    });

    page.drawText('BENEFICIARY NAME', { x: 50, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    page.drawText('BENEFICIAL CLASS', { x: 210, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    page.drawText('ENTITLEMENT', { x: 340, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    page.drawText('AS-OF DATE', { x: 440, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkDark });
    currentY -= 28;

    // Render exact extracted rows
    extractedRows.forEach((row, idx) => {
      page.drawText(row.holderName, { x: 50, y: currentY, size: 9.5, font: fontHelveticaBold, color: inkDark });
      page.drawText(`Natural Person · British (DOB: ${1970 + idx * 10})`, { x: 50, y: currentY - 11, size: 7.5, font: fontHelvetica, color: inkMuted });
      page.drawText(row.shareClass || 'Discretionary Beneficiary', { x: 210, y: currentY, size: 8.5, font: fontHelvetica, color: inkDark });
      const val = row.shareExact ?? row.shareValue ?? 0;
      page.drawText(`${val.toFixed(1)}% Trust Assets`, { x: 340, y: currentY, size: 9, font: fontCourier, color: primaryBlue });
      page.drawText(row.asOfDate || '2026-08-30', { x: 440, y: currentY, size: 8.5, font: fontCourier, color: inkDark });
      currentY -= 36;
    });

    currentY -= 10;

    // Attestation Box
    page.drawRectangle({
      x: 40,
      y: currentY - 45,
      width: width - 80,
      height: 60,
      color: rgb(0.98, 0.98, 0.99),
      borderColor: lineGrey,
      borderWidth: 1
    });

    page.drawText('TRUSTEE ATTESTATION & NOTARIAL SEAL', { x: 50, y: currentY + 2, size: 8, font: fontHelveticaBold, color: inkMuted });
    page.drawText('Executed by Pelican Star Trustees (Cayman) Ltd as sole trustee:', { x: 50, y: currentY - 12, size: 8.5, font: fontHelvetica, color: inkDark });
    page.drawText('Strathvale House, George Town, Grand Cayman · Trust Officer: H. Campbell', { x: 50, y: currentY - 26, size: 8.5, font: fontHelveticaBold, color: inkDark });
    page.drawText('Trust Protocol: CAY-TR-2026-441-SCHEDULE-B · Synthetic Certification', { x: 50, y: currentY - 38, size: 7.5, font: fontCourier, color: inkMuted });

    const pdfBytes = await pdfDoc.save();
    return { bytes: pdfBytes, filename: 'Pelican_Star_Trust_Deed_Summary.pdf' };
  }
}

/**
 * Triggers in-browser file download for generated PDF bytes.
 */
export function triggerBrowserDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
