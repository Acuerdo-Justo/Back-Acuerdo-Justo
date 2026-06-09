import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { validateBookingDate } from '../services/bookingRules.js';

const router = Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookingSchema = z.object({
  advisorId: z.string().uuid(),
  date: dateSchema,
  period: z.enum(['morning', 'afternoon']),
  mode: z.enum(['presencial', 'virtual']),
});

router.use(requireAuth);

router.get('/advisors', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `select id, full_name as "name", username from users
     where role = 'legal_advisor' and is_active = true order by full_name`,
  );
  response.json({ advisors: result.rows });
}));

router.get('/', asyncHandler(async (request, response) => {
  const from = request.query.from ? dateSchema.parse(request.query.from) : '1900-01-01';
  const to = request.query.to ? dateSchema.parse(request.query.to) : '2999-12-31';
  const conditions = ['a.appointment_date between $1 and $2'];
  const values: string[] = [from, to];
  const calendarView = request.query.calendar === '1';
  if (request.user!.role === 'client' && !calendarView) {
    values.push(request.user!.id);
    conditions.push(`a.client_id = $${values.length}`);
  } else if (request.user!.role === 'legal_advisor') {
    values.push(request.user!.id);
    conditions.push(`a.advisor_id = $${values.length}`);
  }
  let clientName = 'client.full_name';
  let clientId = 'client.id';
  let service = 'a.service';
  let linkedCaseId = 'lc.id';
  let linkedCaseNumber = 'lc.case_number';
  if (request.user!.role === 'client' && calendarView) {
    values.push(request.user!.id);
    clientName = `case when a.client_id = $${values.length} then client.full_name else 'Reservado' end`;
    clientId = `case when a.client_id = $${values.length} then client.id else null end`;
    service = `case when a.client_id = $${values.length} then a.service else 'Reservado' end`;
    linkedCaseId = `case when a.client_id = $${values.length} then lc.id else null end`;
    linkedCaseNumber = `case when a.client_id = $${values.length} then lc.case_number else null end`;
  }
  const result = await pool.query(
    `select a.id, concat('CIT-', extract(year from a.appointment_date)::int, '-', lpad(a.sequence_number::text, 5, '0')) as "displayId",
            a.appointment_date::text as date, a.period, a.mode, ${service} as service,
            ${clientId} as "clientId", ${clientName} as client,
            advisor.id as "advisorId", advisor.full_name as advisor, advisor.username as "advisorUsername",
            ${linkedCaseId} as "linkedCaseId", ${linkedCaseNumber} as "linkedCaseNumber"
     from appointments a
     join users client on client.id = a.client_id
     join users advisor on advisor.id = a.advisor_id
     left join case_appointments ca on ca.appointment_id = a.id
     left join legal_cases lc on lc.id = ca.case_id
     where ${conditions.join(' and ')}
     order by a.appointment_date, a.period`,
    values,
  );
  response.json({ appointments: result.rows });
}));

router.post('/', requireRole('client'), asyncHandler(async (request, response) => {
  const input = bookingSchema.parse(request.body);
  validateBookingDate(input.date, input.period);

  const advisor = await pool.query(`select id from users where id = $1 and role = 'legal_advisor' and is_active = true`, [input.advisorId]);
  if (!advisor.rows[0]) throw new HttpError(404, 'Asesor legal no encontrado.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `insert into appointments (client_id, advisor_id, appointment_date, period, mode, service)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [request.user!.id, input.advisorId, input.date, input.period, input.mode, input.mode === 'virtual' ? 'Asesoria virtual' : 'Asesoria presencial'],
    );
    await client.query(
      `insert into notifications (user_id, title, message, kind, action, unique_key)
       select $1, 'Citas programadas para el ' || to_char($2::date, 'DD/MM/YYYY'),
              'Tienes ' || count(*)::text || ' cita' || case when count(*) = 1 then '' else 's' end ||
              ' programada' || case when count(*) = 1 then '' else 's' end || ' para este dia.',
              'appointment_day', 'agenda', $3
       from appointments where advisor_id = $1 and appointment_date = $2::date
       on conflict (unique_key) do update
       set title = excluded.title, message = excluded.message, is_read = false, created_at = now()`,
      [
        input.advisorId,
        input.date,
        `appointments-day:${input.advisorId}:${input.date}`,
      ],
    );
    await client.query('commit');
    response.status(201).json({ appointment: result.rows[0] });
  } catch (error) {
    await client.query('rollback');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') throw new HttpError(409, 'Ese turno ya fue reservado.');
    throw error;
  } finally {
    client.release();
  }
}));

export { router as appointmentRoutes };
