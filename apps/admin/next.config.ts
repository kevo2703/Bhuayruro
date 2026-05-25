import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// __dirname no existe con ESM en next.config.ts — derivarlo.
const dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar .env.local desde la raíz del monorepo (Next.js solo lee desde cwd del app).
loadEnv({ path: path.resolve(dirname, "../../.env.local") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@huayruro/shared", "@huayruro/ui", "@huayruro/db"],
};

export default nextConfig;
