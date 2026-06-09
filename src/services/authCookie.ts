import type { Request, Response } from 'express';
import { env } from '../config/env.js';

const authCookieName = 'acuerdo_justo_session';

const cookieOptions = {
  httpOnly: true,
  sameSite: env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
  secure: env.NODE_ENV === 'production',
  path: '/',
};

export function getAuthToken(request: Pick<Request, 'headers'>) {
  const cookies = request.headers.cookie?.split(';') ?? [];

  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name === authCookieName) return decodeURIComponent(valueParts.join('='));
  }

  return null;
}

export function setAuthCookie(response: Response, token: string) {
  response.cookie(authCookieName, token, cookieOptions);
}

export function clearAuthCookie(response: Response) {
  response.clearCookie(authCookieName, cookieOptions);
}
