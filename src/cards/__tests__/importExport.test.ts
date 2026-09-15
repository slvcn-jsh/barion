import {
  buildImportedCardsForRow,
  exportCardsToCsv,
  parseCardImportText,
} from '@/cards/importExport';

describe('card import/export helpers', () => {
  it('parses quoted CSV rows with a header', () => {
    const rows = parseCardImportText(
      'front,back\n"Metformin action","Reduces hepatic glucose production, improves insulin sensitivity"',
      {
        fieldSeparator: 'comma',
        cardSeparator: 'newline',
        firstRowIsHeader: true,
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ready');
    expect(rows[0].front).toBe('Metformin action');
    expect(rows[0].back).toBe('Reduces hepatic glucose production, improves insulin sensitivity');
  });

  it('uses custom front/back and card separators', () => {
    const rows = parseCardImportText('Term A:::Answer A|||Term B:::Answer B', {
      fieldSeparator: 'custom',
      customFieldSeparator: ':::',
      cardSeparator: 'custom',
      customCardSeparator: '|||',
    });

    expect(rows.filter((row) => row.status === 'ready')).toHaveLength(2);
    expect(rows[1].front).toBe('Term B');
  });

  it('expands Anki-style cloze groups into sibling cards', () => {
    const [row] = parseCardImportText(
      'PCOS involves {{c1::hyperandrogenism}} and {{c2::ovulatory dysfunction}}\tDiagnostic context',
      {
        fieldSeparator: 'tab',
        cardSeparator: 'newline',
      },
    );

    expect(row.status).toBe('ready');
    expect(row.cardType).toBe('cloze');
    expect(row.generatedCardCount).toBe(2);

    const cards = buildImportedCardsForRow(row);
    expect(cards).toHaveLength(2);
    expect(cards[0].prompt).toContain('[...]');
    expect(cards[0].answer).toContain('Answer: hyperandrogenism');
    expect(cards[1].answer).toContain('Answer: ovulatory dysfunction');
  });

  it('exports portable CSV with escaped cells', () => {
    const csv = exportCardsToCsv([
      {
        prompt: 'Drug, class',
        answer: 'Answer with "quoted" detail',
        cardType: 'basic',
        deckTitle: 'Pharmacology',
      },
    ]);

    expect(csv).toContain('"Drug, class"');
    expect(csv).toContain('"Answer with ""quoted"" detail"');
  });
});
