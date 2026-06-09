import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
const idSchema = z.string().uuid();
router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  await createMeetingReminders(request.user!.id);
  const result = await pool.query(
    `select id, title, message, kind, target_id as "targetId", action, is_read as "isRead", created_at as "createdAt"
     from notifications where user_id = $1 order by created_at desc limit 100`,
    [request.user!.id],
  );
  const unread = result.rows.filter((notification) => !notification.isRead).length;
  response.json({ notifications: result.rows, unread });
}));

router.patch('/:notificationId/read', asyncHandler(async (request, response) => {
  const notificationId = idSchema.parse(request.params.notificationId);
  await pool.query('update notifications set is_read = true where id = $1 and user_id = $2', [notificationId, request.user!.id]);
  response.status(204).end();
}));

router.post('/read-all', asyncHandler(async (request, response) => {
  await pool.query('update notifications set is_read = true where user_id = $1 and is_read = false', [request.user!.id]);
  response.status(204).end();
}));

async function createMeetingReminders(userId: string) {
  await pool.query(
    `insert into notifications (user_id, title, message, kind, target_id, action, unique_key)
     select participant.user_id,
            'Asesoria virtual en una hora',
            'Tu reunion virtual de hoy comienza a las ' ||
              case when a.period = 'morning' then '09:00' else '15:00' end || '.',
            'meeting_reminder', a.id, 'advisories',
            'meeting-reminder:' || a.id::text || ':' || participant.user_id::text
     from appointments a
     cross join lateral (values (a.client_id), (a.advisor_id)) participant(user_id)
     left join virtual_meeting_events v on v.meeting_id = a.id::text
     where participant.user_id = $1
       and a.mode = 'virtual'
       and v.finished_at is null
       and ((a.appointment_date + case when a.period = 'morning' then time '09:00' else time '15:00' end) at time zone 'America/Lima')
           between now() and now() + interval '1 hour'
     on conflict (unique_key) do nothing`,
    [userId],
  );
}

export { router as notificationRoutes };
