declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ASSETS: Fetcher;
    TEST_MIGRATIONS: D1Migration[];
  }
}
