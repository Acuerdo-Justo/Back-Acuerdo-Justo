import { compare, hash } from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { createAccessToken } from '../services/tokenService.js';
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
    response.status(201).json({ user, accessToken: createAccessToken(user) });
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
  response.json({ user, accessToken: createAccessToken(user) });
}));

router.get('/me', requireAuth, asyncHandler(async (request, response) => {
  const result = await pool.query(
    'select id, full_name, username, role from users where id = $1 and is_active = true',
    [request.user!.id],
  );

  if (!result.rows[0]) throw new HttpError(404, 'Usuario no encontrado.');
  response.json({ user: toAuthUser(result.rows[0]) });
}));

export { router as authRoutes };
