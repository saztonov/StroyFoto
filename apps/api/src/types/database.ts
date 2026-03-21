// Supabase Database types
// These types document the schema; the Supabase client is used without
// generic typing to avoid version-specific type format mismatches.
// Runtime validation is handled by Zod schemas in @stroyfoto/shared.

export type UserRole = "ADMIN" | "WORKER";
export type SyncStatus = "PENDING" | "SYNCED" | "CONFLICT";
export type UploadStatus = "PENDING_UPLOAD" | "UPLOADED";

export interface DbUser {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  full_name: string;
  created_at: string;
  updated_at: string;
}

export interface DbRefreshToken {
  id: string;
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface DbProject {
  id: string;
  name: string;
  code: string;
  address: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbWorkType {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbContractor {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbArea {
  id: string;
  name: string;
  project_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbReport {
  id: string;
  client_id: string;
  project_id: string;
  date_time: string;
  mark: string;
  work_type: string;
  area: string;
  contractor: string;
  description: string;
  user_id: string;
  sync_status: SyncStatus;
  created_at: string;
  updated_at: string;
}

export interface DbPhoto {
  id: string;
  client_id: string;
  report_id: string;
  bucket: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  upload_status: UploadStatus;
  created_at: string;
  updated_at: string;
}
