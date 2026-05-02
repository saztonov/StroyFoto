import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';

export interface ReportAccessRow {
  id: string;
  project_id: string;
  author_id: string;
  updated_at: Date;
}

export async function loadReportForAccess(
  reportId: string,
): Promise<ReportAccessRow | null> {
  const result = await pool.query<ReportAccessRow>(
    `SELECT id, project_id, author_id, updated_at
       FROM reports
      WHERE id = $1`,
    [reportId],
  );
  return result.rowCount === 0 ? null : result.rows[0];
}

/**
 * Чтение отчёта: admin, автор, или член проекта.
 */
export async function assertReportReadable(
  user: AuthenticatedUser,
  report: ReportAccessRow,
): Promise<void> {
  if (user.role === 'admin') return;
  if (!user.isActive) {
    throw new AppError(
      403,
      'INACTIVE_USER',
      'Аккаунт ожидает активации администратором.',
    );
  }
  if (report.author_id === user.id) return;
  const member = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM project_memberships
        WHERE user_id = $1 AND project_id = $2
     ) AS ok`,
    [user.id, report.project_id],
  );
  if (member.rows[0]?.ok !== true) {
    throw new AppError(403, 'FORBIDDEN', 'Нет доступа к отчёту.');
  }
}

/**
 * Изменение/удаление отчёта: admin или автор. is_active обязателен.
 */
export function assertReportEditable(
  user: AuthenticatedUser,
  report: ReportAccessRow,
): void {
  if (!user.isActive) {
    throw new AppError(
      403,
      'INACTIVE_USER',
      'Аккаунт ожидает активации администратором.',
    );
  }
  if (user.role === 'admin') return;
  if (report.author_id !== user.id) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Изменять отчёт может только автор или администратор.',
    );
  }
}
