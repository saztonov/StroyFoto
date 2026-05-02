import type { UserRole } from '../auth/jwt.js';

export interface SessionUser {
  id: string;
  email: string;
}

export interface ProfileDTO {
  id: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface SessionEnvelope {
  session: {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
    user: SessionUser;
  };
  profile: ProfileDTO;
}

export interface BuildSessionInput {
  user: SessionUser;
  profile: ProfileDTO;
  accessToken: string;
  refreshToken?: string;
  expiresAtSec: number;
}

export function buildSessionResponse(input: BuildSessionInput): SessionEnvelope {
  const session: SessionEnvelope['session'] = {
    access_token: input.accessToken,
    expires_at: input.expiresAtSec,
    user: input.user,
  };
  if (input.refreshToken) {
    session.refresh_token = input.refreshToken;
  }
  return { session, profile: input.profile };
}
