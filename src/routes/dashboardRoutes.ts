import { Router } from 'express';
import { pool } from '../database/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const role = request.user!.role;
  const userId = request.user!.id;
  const caseScope = role === 'admin' ? 'true' : role === 'legal_advisor' ? 'lc.advisor_id = $1' : 'lc.client_id = $1';
  const appointmentScope = role === 'admin' ? 'true' : role === 'legal_advisor' ? 'a.advisor_id = $1' : 'a.client_id = $1';
  const values = role === 'admin' ? [] : [userId];
  const [users, openCases, weekAppointments, closedCases, recentCases] = await Promise.all([
    role === 'admin' ? pool.query('select count(*)::int as count from users where is_active = true') : Promise.resolve({ rows: [{ count: 0 }] }),
    pool.query(`select count(*)::int as count from legal_cases lc where ${caseScope} and lc.status <> 'closed'`, values),
    pool.query(`select count(*)::int as count from appointments a where ${appointmentScope} and a.appointment_date between current_date and current_date + 7`, values),
    pool.query(`select count(*)::int as count from legal_cases lc where ${caseScope} and lc.status = 'closed'`, values),
    pool.query(
      `select lc.case_number as id, client.full_name as client, lc.service, lc.status, lc.created_at as date
       from legal_cases lc join users client on client.id = lc.client_id
       where ${caseScope} order by lc.created_at desc limit 5`,
      values,
    ),
  ]);
  response.json({
    metrics: {
      users: users.rows[0].count,
      openCases: openCases.rows[0].count,
      weekAppointments: weekAppointments.rows[0].count,
      closedCases: closedCases.rows[0].count,
    },
    recentCases: recentCases.rows,
  });
}));

export { router as dashboardRoutes };
