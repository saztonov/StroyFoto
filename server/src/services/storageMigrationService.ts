import { pool } from '../db.js';
import { AppError } from '../http/errors.js';

export interface MigrationOverviewDTO {
  photos_remaining: number;
  plans_remaining: number;
  photos_done: number;
  plans_done: number;
}

interface OverviewRow {
  photos_remaining: string;
  plans_remaining: string;
  photos_done: string;
  plans_done: string;
}

export async function getOverview(): Promise<MigrationOverviewDTO> {
  const result = await pool.query<OverviewRow>(
    `SELECT
       (SELECT count(*) FROM report_photos WHERE storage='r2')      AS photos_remaining,
       (SELECT count(*) FROM plans         WHERE storage='r2')      AS plans_remaining,
       (SELECT count(*) FROM report_photos WHERE storage='cloudru') AS photos_done,
       (SELECT count(*) FROM plans         WHERE storage='cloudru') AS plans_done`,
  );
  const row = result.rows[0];
  return {
    photos_remaining: Number(row.photos_remaining),
    plans_remaining: Number(row.plans_remaining),
    photos_done: Number(row.photos_done),
    plans_done: Number(row.plans_done),
  };
}

export interface PhotoMigrationItemDTO {
  id: string;
  report_id: string;
  r2_key: string;
  thumb_r2_key: string | null;
  storage: 'cloudru' | 'r2';
}

interface PhotoMigrationRow {
  id: string;
  report_id: string;
  r2_key: string;
  thumb_r2_key: string | null;
  storage: 'cloudru' | 'r2';
}

export async function listPhotosByStorage(input: {
  storage: 'cloudru' | 'r2';
  limit: number;
}): Promise<PhotoMigrationItemDTO[]> {
  const result = await pool.query<PhotoMigrationRow>(
    `SELECT id, report_id, r2_key, thumb_r2_key, storage
       FROM report_photos
      WHERE storage = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [input.storage, input.limit],
  );
  return result.rows;
}

export interface PlanMigrationItemDTO {
  id: string;
  project_id: string;
  r2_key: string;
  storage: 'cloudru' | 'r2';
}

interface PlanMigrationRow {
  id: string;
  project_id: string;
  r2_key: string;
  storage: 'cloudru' | 'r2';
}

export async function listPlansByStorage(input: {
  storage: 'cloudru' | 'r2';
  limit: number;
}): Promise<PlanMigrationItemDTO[]> {
  const result = await pool.query<PlanMigrationRow>(
    `SELECT id, project_id, r2_key, storage
       FROM plans
      WHERE storage = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [input.storage, input.limit],
  );
  return result.rows;
}

export async function markPhotoStorage(input: {
  id: string;
  storage: 'cloudru' | 'r2';
  expectedStorage: 'cloudru' | 'r2';
}): Promise<{ ok: true }> {
  const result = await pool.query(
    `UPDATE report_photos
        SET storage = $2
      WHERE id = $1 AND storage = $3`,
    [input.id, input.storage, input.expectedStorage],
  );
  if (result.rowCount === 0) {
    throw new AppError(
      409,
      'ALREADY_MIGRATED',
      'Запись уже находится в указанном состоянии или не найдена.',
    );
  }
  return { ok: true };
}

export async function markPlanStorage(input: {
  id: string;
  storage: 'cloudru' | 'r2';
  expectedStorage: 'cloudru' | 'r2';
}): Promise<{ ok: true }> {
  const result = await pool.query(
    `UPDATE plans
        SET storage = $2
      WHERE id = $1 AND storage = $3`,
    [input.id, input.storage, input.expectedStorage],
  );
  if (result.rowCount === 0) {
    throw new AppError(
      409,
      'ALREADY_MIGRATED',
      'Запись уже находится в указанном состоянии или не найдена.',
    );
  }
  return { ok: true };
}
