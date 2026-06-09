import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../types/auth.js';
import { HttpError } from '../utils/httpError.js';
import { verifyAccessToken } from '../services/tokenService.js';

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    next(new HttpError(401, 'Debes iniciar sesion.'));
    return;
  }

  try {
    request.user = verifyAccessToken(authorization.slice(7));
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
