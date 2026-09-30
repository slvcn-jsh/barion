import { structurePdfText, type PdfLayoutTextItem } from '@/ingestion/pdfLayout';
import { segmentExtractedPages } from '@/ingestion/segmenter';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'pdf-layout-test-id' }));

function item(text: string, x: number, y: number, options: { bold?: boolean; size?: number } = {}): PdfLayoutTextItem {
  const size = options.size ?? 10;
  return {
    str: text,
    width: Math.max(20, text.length * 4),
    height: size,
    fontName: options.bold ? 'Helvetica-Bold' : 'Helvetica',
    transform: [size, 0, 0, size, x, y],
  };
}

describe('PDF layout reconstruction', () => {
  it('reconstructs scrambled multi-column text into method-owned rows', () => {
    const items = [
      item('METHOD', 10, 700, { bold: true }),
      item('HOW IT WORKS', 150, 700, { bold: true }),
      item('HOW IT IS USED', 310, 700, { bold: true }),
      item('EFFECTIVENESS', 470, 700, { bold: true }),
      item('ADVANTAGES', 590, 700, { bold: true }),
      item('DISADVANTAGES', 700, 700, { bold: true }),
      item('Contraceptive Patch', 10, 650, { bold: true, size: 11 }),
      item('Available by prescription.', 10, 625),
      item('Releases hormones through skin.', 150, 640),
      item('Applied weekly for three weeks.', 310, 640),
      item('99% effective.', 470, 640),
      item('Continuous protection.', 590, 640),
      item('No protection against STIs.', 700, 640),
      item('Depo-Provera', 10, 500, { bold: true, size: 11 }),
      item('Available from a clinician.', 10, 475),
      item('Artificial hormone injection.', 150, 490),
      item('Given every 12 weeks.', 310, 490),
      item('More than 99% effective.', 470, 490),
      item('Four injections each year.', 590, 490),
      item('May delay return to fertility.', 700, 490),
    ].reverse();

    const text = structurePdfText(items);
    const segments = segmentExtractedPages([{ locator: 'Page 2', text }], 'Reviewer');
    const patch = segments.find((segment) => segment.sectionPath === 'Contraceptive Patch');
    const depo = segments.find((segment) => segment.sectionPath === 'Depo-Provera');

    expect(patch?.text).toContain('Applied weekly for three weeks.');
    expect(patch?.text).not.toContain('Artificial hormone injection.');
    expect(depo?.text).toContain('Given every 12 weeks.');
    expect(depo?.text).not.toContain('Releases hormones through skin.');
  });

  it('keeps ordinary prose in visual top-to-bottom order', () => {
    const text = structurePdfText([
      item('Second paragraph.', 20, 600),
      item('Document title', 20, 700, { bold: true, size: 16 }),
      item('First paragraph.', 20, 650),
    ]);

    expect(text.indexOf('Document title')).toBeLessThan(text.indexOf('First paragraph.'));
    expect(text.indexOf('First paragraph.')).toBeLessThan(text.indexOf('Second paragraph.'));
  });
  it('handles multi-span headers and vertical jitter across columns', () => {
    const items = [
      item('METHOD', 10, 702, { bold: true }),
      item('HOW IT', 150, 698, { bold: true }),
      item('WORKS', 210, 698, { bold: true }),
      item('HOW IT IS', 310, 701, { bold: true }),
      item('USED', 390, 701, { bold: true }),
      item('EFFECTIVENESS', 470, 696, { bold: true }),
      item('ADVANTAGES', 590, 703, { bold: true }),
      item('DISADVANTAGES', 700, 697, { bold: true }),
      item('I.U.D.', 10, 650, { bold: true, size: 11 }),
      item('Small device inserted into uterus.', 150, 640),
      item('Checked monthly.', 310, 640),
      item('99% effective.', 470, 640),
      item('Long-lasting.', 590, 640),
      item('Insertion discomfort.', 700, 640),
      item('Nexplanon', 10, 500, { bold: true, size: 11 }),
      item('Single rod in upper arm.', 150, 490),
      item('Kept in place for three years.', 310, 490),
      item('99% effective.', 470, 490),
      item('Continuous protection.', 590, 490),
      item('No protection against STIs.', 700, 490),
    ];

    const text = structurePdfText(items);
    const segments = segmentExtractedPages([{ locator: 'Page 2', text }], 'Reviewer');
    const iud = segments.find((segment) => segment.sectionPath === 'I.U.D.');
    const nexplanon = segments.find((segment) => segment.sectionPath === 'Nexplanon');

    expect(iud?.text).toContain('How it is used: Checked monthly.');
    expect(iud?.text).not.toContain('Single rod in upper arm.');
    expect(nexplanon?.text).toContain('Kept in place for three years.');
    expect(nexplanon?.text).not.toContain('Small device inserted into uterus.');
  });

  it('infers method column when wrapped table headers use common aliases', () => {
    const items = [
      item('WHAT IT IS', 150, 704, { bold: true }),
      item('HOW TO', 320, 704, { bold: true }),
      item('USE', 320, 692, { bold: true }),
      item('EFFICACY', 480, 698, { bold: true }),
      item('BENEFITS', 590, 706, { bold: true }),
      item('POSSIBLE SIDE', 700, 704, { bold: true }),
      item('EFFECTS', 700, 692, { bold: true }),
      item('Contraceptive Patch', 10, 650, { bold: true, size: 11 }),
      item('Small thin smooth patch attached to skin.', 150, 635),
      item('Apply on the same day each week.', 320, 635),
      item('More than 99% effective.', 480, 635),
      item('Continuous protection.', 590, 635),
      item('Potential side-effects similar to pills.', 700, 635),
      item('Depo-Provera', 10, 500, { bold: true, size: 11 }),
      item('Artificial hormone injection.', 150, 485),
      item('Receive every 12 weeks.', 320, 485),
      item('More than 99% effective.', 480, 485),
      item('Four injections each year.', 590, 485),
      item('May delay return to fertility.', 700, 485),
    ];

    const text = structurePdfText(items);
    const segments = segmentExtractedPages([{ locator: 'Page 2', text }], 'Reviewer');
    const patch = segments.find((segment) => segment.sectionPath === 'Contraceptive Patch');
    const depo = segments.find((segment) => segment.sectionPath === 'Depo-Provera');

    expect(patch?.text).toContain('Description: Small thin smooth patch attached to skin.');
    expect(patch?.text).toContain('How it is used: Apply on the same day each week.');
    expect(patch?.text).not.toContain('Artificial hormone injection.');
    expect(depo?.text).toContain('How it is used: Receive every 12 weeks.');
  });
});
