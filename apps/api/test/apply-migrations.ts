import { applyD1Migrations, env } from "cloudflare:test";

// Aplica las migraciones de ./migrations al D1 de prueba antes de cada archivo de test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
