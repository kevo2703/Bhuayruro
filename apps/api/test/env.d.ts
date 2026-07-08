declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ASSETS: Fetcher;
    TEST_MIGRATIONS: D1Migration[];
    // Bot de Telegram (B9): R2 lo provee miniflare; el secret se fija en el test; el token se omite
    // a propósito (sin él las fotos caen a texto en los fixtures).
    MEDIA?: R2Bucket;
    AI?: Ai;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_WEBHOOK_SECRET?: string;
  }
}
