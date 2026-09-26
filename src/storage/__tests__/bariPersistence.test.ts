import { buildBariCardEvidence, buildBariDeckEvidence } from '@/ai/bariChat';
import type { StudyCard } from '@/domain/types';

describe('Bari Evidence and Context Builder', () => {
  it('builds card evidence with priority to snippet text and locator', () => {
    const card: StudyCard = {
      id: 'card-1',
      deckId: 'deck-1',
      deckTitle: 'Test Deck',
      cardType: 'mechanism',
      prompt: 'What is the mechanism of action of metformin?',
      answer: 'Decreases hepatic glucose production and increases peripheral insulin sensitivity.',
      status: 'verified',
      isStarred: false,
      isFlagged: false,
      isSuspended: false,
      isLeech: false,
      lapseCount: 0,
      weakScore: 0,
      dueAt: new Date().toISOString(),
      fsrsCardJson: '{}',
    };

    const snippet = {
      sourceTitle: 'Pharmacology Guide',
      locator: 'Page 17',
      text: 'Metformin improves glycemic control primarily by reducing hepatic glucose production.',
      supportScore: 1,
      verificationStatus: 'verified',
    };

    const evidence = buildBariCardEvidence(card, snippet);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].locator).toBe('Page 17');
    expect(evidence[0].sectionPath).toBe('Pharmacology Guide');
    expect(evidence[0].text).toContain('reducing hepatic glucose production');
  });

  it('falls back to card prompt and answer when snippet is not present', () => {
    const card: StudyCard = {
      id: 'card-2',
      deckId: 'deck-1',
      deckTitle: 'Test Deck',
      cardType: 'mechanism',
      prompt: 'What is the first-line treatment for anaphylaxis?',
      answer: 'Intramuscular epinephrine.',
      status: 'verified',
      isStarred: false,
      isFlagged: false,
      isSuspended: false,
      isLeech: false,
      lapseCount: 0,
      weakScore: 0,
      dueAt: new Date().toISOString(),
      fsrsCardJson: '{}',
    };

    const evidence = buildBariCardEvidence(card);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].locator).toBe('Card Context');
    expect(evidence[0].text).toContain('Intramuscular epinephrine');
  });

  it('limits deck evidence to specified count for prompt token budgeting', () => {
    const segments = Array.from({ length: 25 }, (_, i) => ({
      id: `seg-${i + 1}`,
      sourceId: 'src-1',
      locator: `Page ${i + 1}`,
      sectionPath: 'Chapter 1',
      text: `Sample pharmacology content for segment ${i + 1}`,
      createdAt: new Date().toISOString(),
    }));

    const deckEvidence = buildBariDeckEvidence(segments, 10);
    expect(deckEvidence).toHaveLength(10);
    expect(deckEvidence[0].locator).toBe('Page 1');
    expect(deckEvidence[9].locator).toBe('Page 10');
  });
});
