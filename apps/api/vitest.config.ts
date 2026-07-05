import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = fileURLToPath(new URL("./migrations", import.meta.url));
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: true,
          miniflare: {
            // Inyecta las migraciones leídas para que el setupFile las aplique a env.DB.
            bindings: { TEST_MIGRATIONS: migrations },
          },
          wrangler: { configPath: "./wrangler.jsonc" },
        },
      },
    },
  };
});
