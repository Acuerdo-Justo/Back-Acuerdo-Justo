import { Router } from 'express';
import { pool } from '../database/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const values: string[] = [];
  let scope = 'true';
  if (request.user!.role !== 'admin') {
    values.push(request.user!.id);
    scope = request.user!.role === 'legal_advisor' ? 'a.advisor_id = $1' : 'a.client_id = $1';
  }
  const result = await pool.query(
    `select a.id, concat('ASV-', extract(year from a.appointment_date)::int, '-', lpad(a.sequence_number::text, 5, '0')) as "displayId",
            a.appointment_date::text as date, a.period, client.full_name as client, advisor.full_name as advisor,
            v.started_at as "startedAt", v.finished_at as "finishedAt",
            case when v.finished_at is not null then 'finished' when v.started_at is not null then 'active' else 'scheduled' end as status
     from appointments a join users client on client.id = a.client_id join users advisor on advisor.id = a.advisor_id
     left join virtual_meeting_events v on v.meeting_id = a.id::text
     where a.mode = 'virtual' and ${scope} order by a.appointment_date desc`,
    values,
  );
  response.json({ meetings: result.rows });
}));

export { router as meetingRoutes };
