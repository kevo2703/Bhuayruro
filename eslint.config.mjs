import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Configuración plana de ESLint 9 (S17). Reemplaza a los `.eslintrc.cjs` de la raíz y de apps/api,
// que ESLint 9 dejó de leer: `pnpm lint` fallaba en los 5 paquetes desde el 2026-07-04 y la "regla
// dura" del plan §4.1 vivía escrita pero apagada. Ahora corre de verdad.
//
// Se usa el preset CON TIPOS (`recommendedTypeChecked`) a propósito: sin tipos no se detectan las
// promesas sin await ni los `async` de adorno, que en un POS que escribe en D1 son la clase de defecto
// que más cuesta. El costo se midió antes de decidir: 61 hallazgos en 34 archivos, 31 de ellos `as`
// redundantes.

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dev-dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.cache/**",
      "**/test-results/**",
      "**/playwright-report/**",
      // Bundles temporales que deja `wrangler dev` en cada arranque: código empaquetado, no fuente
      // (sin esto son ~145 hallazgos por carpeta y hay una por corrida).
      "**/.wrangler/**",
      "**/.husky/_/**",
      // Assets construidos que el Worker sirve: es el build de la PWA, no fuente.
      "apps/api/public/**",
      // Tipos generados y declaraciones: no son código de nadie.
      "**/*.d.ts",
      "**/worker-configuration.d.ts",
    ],
  },

  js.configs.recommended,

  // El preset con tipos se aplica SOLO a TypeScript: los .mjs/.cjs del repo (generadores de seed,
  // arnés del e2e, configs) no están en ningún tsconfig y el analizador con tipos no los puede
  // resolver — sin este acotado, cada uno de ellos falla con "not found by the project service".
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // `any` explícito: 0 en el código de producción. Queda en error para que siga así.
      "@typescript-eslint/no-explicit-any": "error",
      // El plan pide que el dinero y el SQL sean explícitos; `console` no es parte del contrato.
      "no-console": "off",
      // ─────────────────────────────────────────────────────────────────────────────────────────
      // APAGADA EN TODO EL REPO, y con cicatriz de S17. Su `--fix` borró aserciones de tipo que el
      // compilador SÍ necesita: los `as Respuesta` de los 15 archivos de test de la API (typecheck
      // se cayó con 20 errores TS18046 en cadena), el `as ReferenciaTipo` de repos/reposiciones.ts
      // (un literal se volvió `string`), y en uuidv7.ts dejó los `!` a MEDIAS — unos sí y otros no.
      // Su lectura de tipos no coincide con la de `tsc` en este repo (D1, workers-types, Hono).
      //
      // REGLA QUE SE LLEVA DE ACÁ: después de un `--fix` masivo, typecheck ANTES de creerle. Y el
      // script `lint` NO lleva `--fix` a propósito.
      // ─────────────────────────────────────────────────────────────────────────────────────────
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },

  // ---- Regla DURA del plan §4.1: `env.DB` solo dentro de src/repos/ ----
  // Hasta hoy esto lo enforceaba únicamente el test #14 (`canal-prohibido.test.ts`, verde). Ahora
  // también lo enforcea el linter, que es donde se ve mientras se escribe y no media hora después.
  {
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/repos/**", "apps/api/src/spike.ts"],
    rules: {
      // Se cubren las DOS formas. La regla heredada del `.eslintrc` solo tenía la primera, así que un
      // `env.DB` suelto (que es justo cómo lo toman las barredoras del Cron) le pasaba por al lado.
      // Verificado con sonda: se probaron los dos accesos y los dos quedan frenados.
      "no-restricted-syntax": [
        "error",
        {
          // `c.env.DB` — dentro de un handler de Hono.
          selector: "MemberExpression[property.name='DB'][object.property.name='env']",
          message: "Acceso a env.DB prohibido fuera de src/repos/ (plan §4.1). Usa c.get('db') + un repo.",
        },
        {
          // `env.DB` — con los bindings recibidos como parámetro (worker.ts, Cron, libs).
          selector: "MemberExpression[property.name='DB'][object.name='env']",
          message: "Acceso a env.DB prohibido fuera de src/repos/ (plan §4.1). Pasa el binding a un repo.",
        },
      ],
    },
  },

  // ---- PWA: React + navegador ----
  {
    files: ["apps/pwa/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Solo la regla que el código ya invoca en un `eslint-disable`. El set completo de jsx-a11y es
      // una decisión de producto (hay avisos que en un POS táctil no aplican) y no se toma de callado.
      "jsx-a11y/media-has-caption": "warn",
    },
  },

  // ---- Tests: el arnés puede ser más suelto que el código que prueba ----
  // Un test lee respuestas HTTP como `unknown` y las navega a mano: exigirle ahí la misma disciplina
  // de tipos que al código de producción solo produce ruido, no seguridad.
  {
    files: ["**/test/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "apps/e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Un `async` sin await en un test suele ser la firma que pide el runner, no un descuido.
      "@typescript-eslint/require-await": "off",
      // Mismo criterio: el helper que lee el JSON de una respuesta usa `any` a propósito. En el código
      // de producción sigue prohibido (y hoy hay cero).
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // ---- Scripts de Node sueltos (.mjs/.cjs): sin tipos, con globals de Node ----
  {
    files: ["**/*.mjs", "**/*.cjs", "scripts/**/*.js"],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },

  // Prettier al final: apaga todo lo que sea de formato (lo resuelve `pnpm format`).
  prettier,
);
