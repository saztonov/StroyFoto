import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

export type UserRole = 'admin' | 'user';

export interface AccessPayload {
  sub: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  typ: 'access';
  exp: number;
}

export interface SignedAccessToken {
  token: string;
  expiresAtSec: number;
}

const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

export async function signAccessToken(
  payload: Omit<AccessPayload, 'typ' | 'exp'>,
): Promise<SignedAccessToken> {
  const token = await new SignJWT({
    email: payload.email,
    role: payload.role,
    isActive: payload.isActive,
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.ACCESS_TOKEN_TTL)
    .sign(secret);

  const { payload: verified } = await jwtVerify(token, secret);
  const expSec = typeof verified.exp === 'number' ? verified.exp : 0;

  return { token, expiresAtSec: expSec };
}

export async function verifyAccessToken(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, secret);

  if (payload.typ !== 'access') {
    throw new Error('Invalid token type');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Invalid token subject');
  }
  if (typeof payload.email !== 'string' || !payload.email) {
    throw new Error('Invalid token email');
  }
  if (payload.role !== 'admin' && payload.role !== 'user') {
    throw new Error('Invalid token role');
  }
  if (typeof payload.isActive !== 'boolean') {
    throw new Error('Invalid token isActive flag');
  }
  if (typeof payload.exp !== 'number') {
    throw new Error('Invalid token expiration');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    role: payload.role,
    isActive: payload.isActive,
    typ: 'access',
    exp: payload.exp,
  };
}
