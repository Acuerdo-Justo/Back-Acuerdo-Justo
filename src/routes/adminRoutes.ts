import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
const roleSchema = z.object({ role: z.enum(['client', 'legal_advisor', 'admin']) });
const idSchema = z.string().uuid();

router.use(requireAuth, requireRole('admin'));

router.get('/users', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `select id, full_name as "fullName", username, role, is_active as "isActive", created_at as "createdAt"
     from users order by created_at desc`,
  );
  response.json({ users: result.rows });
}));

router.patch('/users/:userId/role', asyncHandler(async (request, response) => {
  const userId = idSchema.parse(request.params.userId);
  const { role } = roleSchema.parse(request.body);

  if (request.user!.id === userId && role !== 'admin') {
    throw new HttpError(400, 'No puedes retirar tu propio rol de administrador.');
  }

  const result = await pool.query(
    `update users set role = $1, updated_at = now()
     where id = $2
     returning id, full_name as "fullName", username, role, is_active as "isActive", created_at as "createdAt"`,
    [role, userId],
  );

  if (!result.rows[0]) throw new HttpError(404, 'Usuario no encontrado.');
  response.json({ user: result.rows[0] });
}));

export { router as adminRoutes };
