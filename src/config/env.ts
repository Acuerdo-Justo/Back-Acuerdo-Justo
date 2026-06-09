import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('8h'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  INITIAL_ADMIN_FULL_NAME: z.string().min(3).max(160),
  INITIAL_ADMIN_USERNAME: z.string().trim().toLowerCase().min(3).max(60),
  INITIAL_ADMIN_PASSWORD: z.string().min(12).max(72),
});

export const env = envSchema.parse(process.env);
