import { createId, nowIso } from '@/domain/ids';
import type { CalendarStudyBlock, ReviewCalendarDay } from '@/domain/types';
import { getDatabase } from '@/storage/database';

type DueRow = { dueAt: string };
type ExamRow = { courseId: string; title: string; examDate: string };
type BlockRow = CalendarStudyBlock;

export async function getReviewCalendar(dayCount = 14): Promise<ReviewCalendarDay[]> {
  const db = await getDatabase();
  const count = Math.max(7, Math.min(60, Math.round(dayCount)));
  const start = startOfLocalDay(new Date());
  const end = addLocalDays(start, count);
  const startKey = dateKey(start);
  const endKey = dateKey(end);

  const [dueRows, shortRows, examRows, blockRows] = await Promise.all([
    db.getAllAsync<DueRow>(
      `SELECT memory_states.due_at AS dueAt
       FROM memory_states
       JOIN cards ON cards.id = memory_states.card_id
       JOIN decks ON decks.id = cards.deck_id
       LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
       WHERE memory_states.due_at < ?
         AND cards.deleted_at IS NULL AND cards.status != 'needs_review'
         AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
         AND COALESCE(card_learning_state.is_suspended, 0) = 0`,
      end.toISOString(),
    ),
    db.getAllAsync<DueRow>(
      `SELECT card_mode_mastery.short_due_at AS dueAt
       FROM card_mode_mastery
       JOIN cards ON cards.id = card_mode_mastery.card_id
       JOIN decks ON decks.id = cards.deck_id
       LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
       WHERE card_mode_mastery.short_due_at IS NOT NULL
         AND card_mode_mastery.short_due_at < ?
         AND cards.deleted_at IS NULL AND cards.status != 'needs_review'
         AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
         AND COALESCE(card_learning_state.is_suspended, 0) = 0`,
      end.toISOString(),
    ),
    db.getAllAsync<ExamRow>(
      `SELECT id AS courseId, title, exam_date AS examDate
       FROM courses
       WHERE exam_date >= ? AND exam_date < ?
         AND deleted_at IS NULL AND archived_at IS NULL
       ORDER BY exam_date ASC`,
      startKey,
      endKey,
    ),
    db.getAllAsync<BlockRow>(
      `SELECT id, title, starts_at AS startsAt, duration_minutes AS durationMinutes, status
       FROM study_blocks
       WHERE starts_at >= ? AND starts_at < ?
       ORDER BY starts_at ASC`,
      start.toISOString(),
      end.toISOString(),
    ),
  ]);

  const dueCounts = countByDay(dueRows, startKey);
  const shortCounts = countByDay(shortRows, startKey);
  return Array.from({ length: count }, (_, index) => {
    const date = addLocalDays(start, index);
    const key = dateKey(date);
    return {
      date: key,
      label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      isToday: index === 0,
      dueCount: dueCounts.get(key) ?? 0,
      shortTermCount: shortCounts.get(key) ?? 0,
      exams: examRows.filter((exam) => exam.examDate === key).map(({ courseId, title }) => ({ courseId, title })),
      blocks: blockRows.filter((block) => dateKey(new Date(block.startsAt)) === key),
    };
  });
}

export async function createStudyBlock(date: string, title = 'Barion study plan', durationMinutes = 20) {
  const startsAt = localDateAtHour(date, 19);
  const now = nowIso();
  const id = createId('study-block');
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO study_blocks
     (id, title, starts_at, duration_minutes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', ?, ?)`,
    id,
    title.trim() || 'Barion study plan',
    startsAt.toISOString(),
    Math.max(5, Math.min(180, Math.round(durationMinutes))),
    now,
    now,
  );
  return id;
}

export async function setStudyBlockCompleted(blockId: string, completed: boolean) {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE study_blocks SET status = ?, updated_at = ? WHERE id = ?',
    completed ? 'completed' : 'planned',
    nowIso(),
    blockId,
  );
}

export async function deleteStudyBlock(blockId: string) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM study_blocks WHERE id = ?', blockId);
}

function countByDay(rows: DueRow[], overdueKey: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const parsed = new Date(row.dueAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dateKey(parsed) < overdueKey ? overdueKey : dateKey(parsed);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateAtHour(value: string, hour: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Choose a valid calendar date.');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0, 0, 0);
  if (dateKey(date) !== value) throw new Error('Choose a valid calendar date.');
  return date;
}
