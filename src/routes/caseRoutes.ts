import { createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../database/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
const uploadsDirectory = fileURLToPath(new URL('../../uploads/', import.meta.url));
await mkdir(uploadsDirectory, { recursive: true });
const upload = multer({ dest: uploadsDirectory, limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
const idSchema = z.string().uuid();
const createSchema = z.object({ appointmentId: z.string().uuid(), caseNumber: z.string().trim().min(3).max(80).transform((value) => value.toUpperCase()), description: z.string().trim().min(3).max(5000) });
const linkSchema = z.object({ appointmentId: z.string().uuid() });
const statusSchema = z.object({ status: z.enum(['open', 'review', 'closed']) });

router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const scope = scopeSql(request.user!.role, request.user!.id, 'lc');
  const cases = await pool.query(
    `select lc.id, lc.case_number as "caseNumber", lc.service, lc.description, lc.status, lc.created_at as "createdAt",
            client.id as "clientId", client.full_name as client, advisor.full_name as advisor,
            count(distinct cd.id)::int as "documentCount"
     from legal_cases lc join users client on client.id = lc.client_id join users advisor on advisor.id = lc.advisor_id
     left join case_documents cd on cd.case_id = lc.id where ${scope.text}
     group by lc.id, client.id, advisor.id order by lc.created_at desc`,
    scope.values,
  );
  response.json({ cases: cases.rows });
}));

router.get('/:caseId', asyncHandler(async (request, response) => {
  const caseId = idSchema.parse(request.params.caseId);
  await assertCaseAccess(caseId, request.user!.id, request.user!.role);
  const detail = await pool.query(
    `select lc.id, lc.case_number as "caseNumber", lc.service, lc.description, lc.status, lc.created_at as "createdAt",
            client.id as "clientId", client.full_name as client, advisor.full_name as advisor
     from legal_cases lc join users client on client.id = lc.client_id join users advisor on advisor.id = lc.advisor_id where lc.id = $1`,
    [caseId],
  );
  const appointments = await pool.query(
    `select a.id, concat('CIT-', extract(year from a.appointment_date)::int, '-', lpad(a.sequence_number::text, 5, '0')) as "displayId",
            a.appointment_date::text as date, a.period, a.service
     from case_appointments ca join appointments a on a.id = ca.appointment_id where ca.case_id = $1 order by a.appointment_date desc`,
    [caseId],
  );
  const documents = await pool.query(
    `select cd.id, cd.original_name as name, cd.mime_type as "mimeType", cd.size_bytes::int as "sizeBytes",
            cd.created_at as "uploadedAt", u.full_name as "uploadedBy"
     from case_documents cd join users u on u.id = cd.uploaded_by where cd.case_id = $1 order by cd.created_at desc`,
    [caseId],
  );
  response.json({ case: { ...detail.rows[0], appointments: appointments.rows, documents: documents.rows } });
}));

router.post('/', requireRole('legal_advisor'), asyncHandler(async (request, response) => {
  const input = createSchema.parse(request.body);
  const appointment = await ownedUnclassifiedAppointment(input.appointmentId, request.user!.id);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const created = await client.query(
      `insert into legal_cases (case_number, client_id, advisor_id, service, description)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.caseNumber, appointment.client_id, request.user!.id, appointment.service, input.description],
    );
    await client.query('insert into case_appointments (case_id, appointment_id) values ($1, $2)', [created.rows[0].id, input.appointmentId]);
    await client.query(
      `insert into notifications (user_id, title, message, kind, target_id, action, unique_key)
       values ($1, 'Expediente creado', $2, 'case_created', $3, 'cases', $4)`,
      [appointment.client_id, `El asesor creo el expediente ${input.caseNumber} para tu cita.`, created.rows[0].id, `case-created:${created.rows[0].id}`],
    );
    await client.query('commit');
    response.status(201).json({ case: created.rows[0] });
  } catch (error) {
    await client.query('rollback');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') throw new HttpError(409, 'El numero de expediente ya existe.');
    throw error;
  } finally { client.release(); }
}));

router.post('/:caseId/appointments', requireRole('legal_advisor'), asyncHandler(async (request, response) => {
  const caseId = idSchema.parse(request.params.caseId);
  const { appointmentId } = linkSchema.parse(request.body);
  const appointment = await ownedUnclassifiedAppointment(appointmentId, request.user!.id);
  const legalCase = await pool.query('select client_id from legal_cases where id = $1 and advisor_id = $2', [caseId, request.user!.id]);
  if (!legalCase.rows[0]) throw new HttpError(404, 'Expediente no encontrado.');
  if (legalCase.rows[0].client_id !== appointment.client_id) throw new HttpError(400, 'La cita y el expediente deben pertenecer al mismo cliente.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('insert into case_appointments (case_id, appointment_id) values ($1, $2)', [caseId, appointmentId]);
    await client.query(
      `insert into notifications (user_id, title, message, kind, target_id, action, unique_key)
       values ($1, 'Cita anexada a expediente', $2, 'appointment_linked', $3, 'cases', $4)`,
      [appointment.client_id, 'El asesor anexo una de tus citas a un expediente existente.', caseId, `appointment-linked:${appointmentId}`],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  response.status(204).end();
}));

router.patch('/:caseId/status', requireRole('legal_advisor'), asyncHandler(async (request, response) => {
  const caseId = idSchema.parse(request.params.caseId);
  const { status } = statusSchema.parse(request.body);
  const result = await pool.query(
    `update legal_cases set status = $1, updated_at = now()
     where id = $2 and advisor_id = $3 returning status`,
    [status, caseId, request.user!.id],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Expediente no encontrado.');
  response.json({ status: result.rows[0].status });
}));

router.post(
  '/:caseId/documents',
  requireRole('client', 'legal_advisor'),
  asyncHandler(async (request, _response, next) => {
    const caseId = idSchema.parse(request.params.caseId);
    await assertCaseAccess(caseId, request.user!.id, request.user!.role);
    next();
  }),
  upload.array('documents', 10),
  asyncHandler(async (request, response) => {
  const caseId = idSchema.parse(request.params.caseId);
  const files = request.files as Express.Multer.File[];
  if (!files?.length) throw new HttpError(400, 'Selecciona al menos un documento.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const file of files) {
      await client.query(
        `insert into case_documents (case_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
         values ($1, $2, $3, $4, $5, $6)`,
        [caseId, request.user!.id, file.originalname, file.filename, file.mimetype || 'application/octet-stream', file.size],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
    throw error;
  } finally {
    client.release();
  }
  response.status(201).json({ uploaded: files.length });
  }),
);

router.get('/documents/:documentId/download', asyncHandler(async (request, response) => {
  const documentId = idSchema.parse(request.params.documentId);
  const result = await pool.query(
    `select cd.case_id, cd.original_name, cd.stored_name, cd.mime_type from case_documents cd where cd.id = $1`,
    [documentId],
  );
  const document = result.rows[0];
  if (!document) throw new HttpError(404, 'Documento no encontrado.');
  await assertCaseAccess(document.case_id, request.user!.id, request.user!.role);
  const inlineMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  const disposition = inlineMimeTypes.has(document.mime_type) ? 'inline' : 'attachment';
  response.setHeader('Content-Type', document.mime_type);
  response.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(document.original_name)}`);
  response.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${new URL(env.FRONTEND_URL).origin}`);
  response.removeHeader('X-Frame-Options');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(`${uploadsDirectory}/${document.stored_name}`).pipe(response);
}));

async function ownedUnclassifiedAppointment(id: string, advisorId: string) {
  const result = await pool.query(
    `select a.client_id, a.service from appointments a left join case_appointments ca on ca.appointment_id = a.id
     where a.id = $1 and a.advisor_id = $2 and ca.appointment_id is null`,
    [id, advisorId],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Cita pendiente no encontrada.');
  return result.rows[0] as { client_id: string; service: string };
}

async function assertCaseAccess(caseId: string, userId: string, role: string) {
  const condition = role === 'admin' ? 'true' : role === 'legal_advisor' ? 'advisor_id = $2' : 'client_id = $2';
  const result = await pool.query(`select id from legal_cases where id = $1 and ${condition}`, role === 'admin' ? [caseId] : [caseId, userId]);
  if (!result.rows[0]) throw new HttpError(404, 'Expediente no encontrado.');
}

function scopeSql(role: string, userId: string, alias: string) {
  if (role === 'admin') return { text: 'true', values: [] };
  return { text: `${alias}.${role === 'legal_advisor' ? 'advisor_id' : 'client_id'} = $1`, values: [userId] };
}

export { router as caseRoutes };
