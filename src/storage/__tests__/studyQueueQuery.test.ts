import { buildStudyQueueScope } from '@/storage/repositories/studyQueueScope';

describe('study queue scope', () => {
  it('binds deck identifier as the scope parameter', () => {
    expect(buildStudyQueueScope('deck-123')).toEqual({
      clause: 'AND cards.deck_id = ?',
      params: ['deck-123'],
    });
  });

  it('binds module identifier through active course membership', () => {
    const scope = buildStudyQueueScope(undefined, 'module-123');
    expect(scope.clause).toContain('module_decks.module_id = ?');
    expect(scope.params).toEqual(['module-123']);
  });
});
