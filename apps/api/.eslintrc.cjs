/**
 * Regla dura del plan §4.1: PROHIBIDO `env.DB` fuera de src/repos/.
 *
 * ⚠️ Estado del repo (2026-07-04): ESLint 9 no corre con config legacy `.eslintrc.*`
 * (falta migrar a flat config `eslint.config.js` + instalar @typescript-eslint/*).
 * Es deuda PREEXISTENTE, no de esta sesión. Mientras tanto, el enforcement REAL del
 * canal prohibido es el test #14 (apps/api/test/canal-prohibido.test.ts), que falla la
 * suite si aparece `env.DB`/SQL crudo fuera de repos/. Esta regla queda lista para cuando
 * el repo migre a flat config.
 */
module.exports = {
  overrides: [
    {
      files: ["src/**/*.ts"],
      excludedFiles: ["src/repos/**", "src/spike.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: "MemberExpression[property.name='DB'][object.property.name='env']",
            message: "Acceso a env.DB prohibido fuera de src/repos/ (plan §4.1). Usa c.get('db') + un repo.",
          },
        ],
      },
    },
  ],
};
