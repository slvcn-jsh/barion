import { buildDeckPrintHtml } from '@/cards/print';
import type { DeckSummary, StudyCard } from '@/domain/types';

describe('deck print output', () => {
  it('excludes unsafe cards and escapes source content', () => {
    const deck = { title: 'Safety & dosing' } as DeckSummary;
    const safe = {
      status: 'source_extracted', prompt: 'What is <safe>?', answer: 'Use evidence & context.', cardType: 'safety',
      evidence: { sourceTitle: 'Guide', locator: 'p. 2', text: '<script>unsafe</script>', supportScore: 1, verificationStatus: 'exact-source' },
    } as StudyCard;
    const held = { ...safe, id: 'held', status: 'needs_review', prompt: 'Do not print' } as StudyCard;
    const html = buildDeckPrintHtml(deck, [safe, held], 'source-linked');
    expect(html).toContain('Safety &amp; dosing');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('Do not print');
  });
});
