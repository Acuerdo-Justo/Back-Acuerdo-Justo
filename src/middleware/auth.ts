import type { NextFunction, Request, Response } from 'express';
import { pool } from '../database/pool.js';
import { getAuthToken } from '../services/authCookie.js';
import type { UserRole } from '../types/auth.js';
import { HttpError } from '../utils/httpError.js';
import { verifyAccessToken } from '../services/tokenService.js';

export async function requireAuth(request: Request, _response: Response, next: NextFunction) {
  const token = getAuthToken(request);

  if (!token) {
    next(new HttpError(401, 'Debes iniciar sesion.'));
    return;
  }

  try {
    const tokenUser = verifyAccessToken(token);
    const result = await pool.query(
      `select users.id, users.full_name, users.username, users.role
       from auth_sessions session join users on users.id = session.user_id
       where session.id = $1 and session.user_id = $2
         and users.is_active = true and session.revoked_at is null
         and session.last_activity > now() - interval '5 minutes'`,
      [tokenUser.sessionId, tokenUser.id],
    );
    const row = result.rows[0];

    if (!row) {
      next(new HttpError(401, 'La sesion no es valida o ha expirado.'));
      return;
    }

    request.user = {
      id: row.id,
      fullName: row.full_name,
      username: row.username,
      role: row.role,
    };
    request.sessionId = tokenUser.sessionId;
    next();
  } catch {
    next(new HttpError(401, 'La sesion no es valida o ha expirado.'));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      next(new HttpError(403, 'No tienes permisos para realizar esta accion.'));
      return;
    }

    next();
  };
}
