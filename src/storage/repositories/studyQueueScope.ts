export function buildStudyQueueScope(deckId?: string, moduleId?: string) {
  if (deckId) {
    return { clause: 'AND cards.deck_id = ?', params: [deckId] };
  }
  if (moduleId) {
    return {
      clause: `AND cards.deck_id IN (
        SELECT module_decks.deck_id
        FROM module_decks
        JOIN course_modules ON course_modules.id = module_decks.module_id
        JOIN courses ON courses.id = course_modules.course_id
        WHERE module_decks.module_id = ?
          AND courses.deleted_at IS NULL
          AND courses.archived_at IS NULL
      )`,
      params: [moduleId],
    };
  }
  return { clause: '', params: [] as string[] };
}
