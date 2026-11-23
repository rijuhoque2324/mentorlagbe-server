import "dotenv/config";
import { z } from "zod";

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()),
  );

const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  CLIENT_URL: z.string().trim().min(1).default("http://localhost:3000"),

  MONGODB_URI: z.string().trim().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().trim().min(1).default("mentorlagbe"),

  BETTER_AUTH_SECRET: z
    .string()
    .trim()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().default("http://localhost:5000"),

  // Access tokens for protected /api/v1 routes. Falls back to the Better Auth
  // secret when unset so local development works out of the box.
  JWT_SECRET: optionalSecret,
  JWT_EXPIRES_IN: z.string().trim().min(1).default("1h"),

  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_CURRENCY: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "STRIPE_CURRENCY must be a 3-letter ISO code")
    .default("usd"),

  IMGBB_API_KEY: optionalSecret,

  LOG_REQUESTS: booleanish.optional(),
});

export type Env = z.infer<typeof envSchema> & {
  CLIENT_ORIGINS: string[];
  PRIMARY_CLIENT_URL: string;
  JWT_SIGNING_SECRET: string;
  isProduction: boolean;
  isTest: boolean;
};

function normalizeOrigin(value: string): string {
  const url = new URL(value.trim());
  return url.origin;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const data = parsed.data;
  let origins: string[];

  try {
    origins = data.CLIENT_URL.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(normalizeOrigin);
  } catch {
    throw new Error("Invalid environment configuration:\n  - CLIENT_URL must be a comma-separated list of URLs");
  }

  if (origins.length === 0) {
    throw new Error("Invalid environment configuration:\n  - CLIENT_URL must contain at least one URL");
  }

  return {
    ...data,
    CLIENT_ORIGINS: [...new Set(origins)],
    PRIMARY_CLIENT_URL: origins[0]!,
    JWT_SIGNING_SECRET: data.JWT_SECRET ?? data.BETTER_AUTH_SECRET,
    isProduction: data.NODE_ENV === "production",
    isTest: data.NODE_ENV === "test",
  };
}

export const env: Env = loadEnv();
