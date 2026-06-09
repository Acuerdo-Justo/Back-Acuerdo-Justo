import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hash } from 'bcryptjs';
import { env } from '../config/env.js';
import { pool } from './pool.js';

const migrationUrl = new URL('./migrations/001_auth.sql', import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

try {
  await mkdir(new URL('../../uploads/', import.meta.url), { recursive: true });
  await pool.query(migration);
  const adminPasswordHash = await hash(env.INITIAL_ADMIN_PASSWORD, 12);
  await pool.query(
    `insert into users (full_name, username, password_hash, role)
     values ($1, $2, $3, 'admin')
     on conflict (lower(username)) do nothing`,
    [env.INITIAL_ADMIN_FULL_NAME, env.INITIAL_ADMIN_USERNAME, adminPasswordHash],
  );
  console.log('Migracion de autenticacion completada.');
} finally {
  await pool.end();
}
