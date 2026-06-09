import { compare, hash } from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { clearAuthCookie, getAuthToken, setAuthCookie } from '../services/authCookie.js';
import { createAccessToken, verifyAccessToken } from '../services/tokenService.js';
import type { AuthUser, UserRole } from '../types/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

const credentialsSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(60),
  password: z.string().min(6).max(72),
});

const registerSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(3).max(160),
});

function toAuthUser(row: { id: string; full_name: string; username: string; role: UserRole }): AuthUser {
  return { id: row.id, fullName: row.full_name, username: row.username, role: row.role };
}

router.post('/register', asyncHandler(async (request, response) => {
  const input = registerSchema.parse(request.body);
  const passwordHash = await hash(input.password, 12);

  try {
    const result = await pool.query(
      `insert into users (full_name, username, password_hash, role)
       values ($1, $2, $3, 'client')
       returning id, full_name, username, role`,
      [input.fullName, input.username, passwordHash],
    );
    const user = toAuthUser(result.rows[0]);
    const session = await pool.query('insert into auth_sessions (user_id) values ($1) returning id', [user.id]);
    setAuthCookie(response, createAccessToken(user, session.rows[0].id));
    response.status(201).json({ user });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw new HttpError(409, 'El nombre de usuario ya esta registrado.');
    }
    throw error;
  }
}));

router.post('/login', asyncHandler(async (request, response) => {
  const input = credentialsSchema.parse(request.body);
  const result = await pool.query(
    `select id, full_name, username, password_hash, role
     from users
     where username = $1 and is_active = true`,
    [input.username],
  );
  const row = result.rows[0];

  if (!row || !(await compare(input.password, row.password_hash))) {
    throw new HttpError(401, 'Usuario o contrasena incorrectos.');
  }

  const user = toAuthUser(row);
  const session = await pool.query('insert into auth_sessions (user_id) values ($1) returning id', [user.id]);
  setAuthCookie(response, createAccessToken(user, session.rows[0].id));
  response.json({ user });
}));

router.post('/logout', asyncHandler(async (request, response) => {
  const token = getAuthToken(request);
  if (token) {
    try {
      const tokenUser = verifyAccessToken(token);
      await pool.query('update auth_sessions set revoked_at = now() where id = $1', [tokenUser.sessionId]);
    } catch {
      // The cookie is cleared even when its token has expired.
    }
  }
  clearAuthCookie(response);
  response.status(204).end();
}));

router.get('/me', requireAuth, (request, response) => {
  response.json({ user: request.user });
});

router.post('/activity', requireAuth, asyncHandler(async (request, response) => {
  await pool.query('update auth_sessions set last_activity = now() where id = $1', [request.sessionId]);
  response.status(204).end();
}));

export { router as authRoutes };
