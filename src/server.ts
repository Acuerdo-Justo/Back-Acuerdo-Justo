import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { attachMeetingSignaling } from './realtime/meetingSignaling.js';

const server = app.listen(env.PORT, () => {
  console.log(`API disponible en http://localhost:${env.PORT}/api`);
});
attachMeetingSignaling(server);

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
