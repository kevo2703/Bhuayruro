// Base de repositorios. ÚNICO lugar del código con SQL (`prepare`, `batch`, `exec`).
// Regla dura (plan §4.1): fuera de src/repos/ está PROHIBIDO tocar env.DB — lo verifica
// el test del canal prohibido (§4.4 #14) y la regla ESLint.

const esRedPerdida = (e: unknown): boolean => /Network connection lost/i.test(String(e));

// Reintento sobre el error transitorio de D1 remoto (lección del spike E0 / ADR-011).
export async function withRetry<T>(fn: () => Promise<T>, intentos = 4): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      if (!esRedPerdida(e)) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
  throw ultimo;
}
