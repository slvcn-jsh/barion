import { createId, nowIso } from '@/domain/ids';
import type { CourseModuleSummary, CourseSummary } from '@/domain/types';
import { getDatabase } from '@/storage/database';
import { colors } from '@/theme/colors';
import { runWriteTransaction } from './shared';

export async function getCourses(): Promise<CourseSummary[]> {
  const db = await getDatabase();
  const courses = await db.getAllAsync<Omit<CourseSummary, 'modules'>>(
    `SELECT courses.id, courses.title, courses.exam_date AS examDate, courses.color,
            COUNT(DISTINCT course_modules.id) AS moduleCount,
            COUNT(DISTINCT decks.id) AS deckCount,
            COUNT(DISTINCT cards.id) AS cardCount
     FROM courses
     LEFT JOIN course_modules ON course_modules.course_id = courses.id
     LEFT JOIN module_decks ON module_decks.module_id = course_modules.id
     LEFT JOIN decks ON decks.id = module_decks.deck_id AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
     LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
     WHERE courses.deleted_at IS NULL AND courses.archived_at IS NULL
     GROUP BY courses.id
     ORDER BY CASE WHEN courses.id = 'course-default' THEN 0 ELSE 1 END, courses.updated_at DESC`,
  );
  const modules = await db.getAllAsync<Omit<CourseModuleSummary, 'deckIds'> & { deckIdsCsv: string | null }>(
    `SELECT course_modules.id, course_modules.course_id AS courseId, course_modules.title,
            course_modules.position,
            COUNT(DISTINCT decks.id) AS deckCount,
            COUNT(DISTINCT cards.id) AS cardCount,
            GROUP_CONCAT(DISTINCT decks.id) AS deckIdsCsv
     FROM course_modules
     LEFT JOIN module_decks ON module_decks.module_id = course_modules.id
     LEFT JOIN decks ON decks.id = module_decks.deck_id AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
     LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
     JOIN courses ON courses.id = course_modules.course_id
     WHERE courses.deleted_at IS NULL AND courses.archived_at IS NULL
     GROUP BY course_modules.id
     ORDER BY course_modules.position ASC, course_modules.created_at ASC`,
  );
  return courses.map((course) => ({
    ...course,
    moduleCount: Number(course.moduleCount),
    deckCount: Number(course.deckCount),
    cardCount: Number(course.cardCount),
    modules: modules
      .filter((module) => module.courseId === course.id)
      .map((module) => ({
        ...module,
        position: Number(module.position),
        deckCount: Number(module.deckCount),
        cardCount: Number(module.cardCount),
        deckIds: String(module.deckIdsCsv ?? '')
          .split(',')
          .filter(Boolean),
      })),
  }));
}

export async function createCourse(title: string, examDate?: string) {
  const db = await getDatabase();
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Enter a course name.');
  const parsedExamDate = examDate?.trim() || null;
  if (parsedExamDate && !/^\d{4}-\d{2}-\d{2}$/.test(parsedExamDate)) {
    throw new Error('Use YYYY-MM-DD for the exam date.');
  }
  const courseId = createId('course');
  const moduleId = createId('module');
  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO courses (id, title, exam_date, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      courseId,
      trimmed,
      parsedExamDate,
      colors.blue,
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO course_modules (id, course_id, title, position, created_at, updated_at)
       VALUES (?, ?, 'General folder', 0, ?, ?)`,
      moduleId,
      courseId,
      now,
      now,
    );
  });
  return courseId;
}

export async function createCourseModule(courseId: string, title: string) {
  const db = await getDatabase();
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Enter a folder name.');
  const now = nowIso();
  const id = createId('module');
  const position = await db.getFirstAsync<{ nextPosition: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM course_modules WHERE course_id = ?',
    courseId,
  );
  const result = await db.runAsync(
    `INSERT INTO course_modules (id, course_id, title, position, created_at, updated_at)
     SELECT ?, id, ?, ?, ?, ?
     FROM courses
     WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    id,
    trimmed,
    Number(position?.nextPosition ?? 0),
    now,
    now,
    courseId,
  );
  if (!result.changes) throw new Error('Choose an active class first.');
  return id;
}

export async function updateCourseExamDate(courseId: string, examDate: string) {
  const db = await getDatabase();
  const trimmed = examDate.trim();
  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Use YYYY-MM-DD for the exam date.');
  }
  await db.runAsync(
    'UPDATE courses SET exam_date = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    trimmed || null,
    nowIso(),
    courseId,
  );
}

export async function removeCourseModule(moduleId: string) {
  const db = await getDatabase();
  const folder = await db.getFirstAsync<{ id: string; courseId: string }>(
    `SELECT course_modules.id, course_modules.course_id AS courseId
     FROM course_modules
     JOIN courses ON courses.id = course_modules.course_id
     WHERE course_modules.id = ?
       AND courses.deleted_at IS NULL
       AND courses.archived_at IS NULL`,
    moduleId,
  );
  if (!folder) return false;

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync('DELETE FROM module_decks WHERE module_id = ?', moduleId);
    await txn.runAsync('DELETE FROM course_modules WHERE id = ?', moduleId);
    await txn.runAsync('UPDATE courses SET updated_at = ? WHERE id = ?', now, folder.courseId);
  });
  return true;
}

export async function removeCourse(courseId: string) {
  const db = await getDatabase();
  const course = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    courseId,
  );
  if (!course) return false;

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      'DELETE FROM module_decks WHERE module_id IN (SELECT id FROM course_modules WHERE course_id = ?)',
      courseId,
    );
    await txn.runAsync('DELETE FROM course_modules WHERE course_id = ?', courseId);
    await txn.runAsync(
      'UPDATE courses SET deleted_at = ?, archived_at = NULL, updated_at = ? WHERE id = ?',
      now,
      now,
      courseId,
    );
  });
  return true;
}

export async function setDeckInModule(moduleId: string, deckId: string, included: boolean) {
  const db = await getDatabase();
  if (included) {
    await db.runAsync(
      `INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
       SELECT course_modules.id, decks.id, ?
       FROM course_modules
       JOIN courses ON courses.id = course_modules.course_id
       JOIN decks ON decks.id = ?
       WHERE course_modules.id = ?
         AND courses.deleted_at IS NULL
         AND courses.archived_at IS NULL
         AND decks.deleted_at IS NULL
         AND decks.archived_at IS NULL`,
      nowIso(),
      deckId,
      moduleId,
    );
  } else {
    await db.runAsync('DELETE FROM module_decks WHERE module_id = ? AND deck_id = ?', moduleId, deckId);
  }
}
