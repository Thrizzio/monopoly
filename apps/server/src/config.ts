import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(8).default("dev-secret-change-me"),
  CLIENT_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.trim().replace(/\/+$/, "")),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
