import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const migrationUrl = new URL('./migrations/001_auth.sql', import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

try {
  await pool.query(migration);
  console.log('Migracion de autenticacion completada.');
} finally {
  await pool.end();
}
