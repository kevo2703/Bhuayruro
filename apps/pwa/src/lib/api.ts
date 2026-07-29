// Cliente HTTP del POS contra el Worker (§11.1: reemplaza el cliente Supabase).
// Base `/api`, token de sesión, errores tipados. Reintenta SOLO fallos de red/5xx
// (las escrituras son idempotentes por client_uuid → reintentar es seguro).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ApiError";
  }
  // Error de negocio/validación/permiso: NO reintentar (va a bandeja de rechazados).
  get esDefinitivo(): boolean {
    return this.status === 400 || this.status === 403 || this.status === 404 || this.status === 422;
  }
}

export class RedError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "RedError";
  }
}

export type ApiOpts = {
  // PUT existe para el marcador de crónicos (Δ4): ahí los dos campos viajan JUNTOS y reemplazan el
  // estado anterior (marcar sin dosis no es un estado válido), que es exactamente un PUT y no un PATCH.
  // Es idempotente, así que el reintento de red de acá abajo lo trata igual que al resto.
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  base?: string;
  signal?: AbortSignal;
  reintentos?: number; // reintentos de red (default 2)
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiRequest<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  const { method = "GET", body, token, base = "/api", signal, reintentos = 2 } = opts;
  const url = `${base}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let ultimo: unknown;
  for (let intento = 0; intento <= reintentos; intento++) {
    let res: Response;
    try {
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      if (signal) init.signal = signal;
      res = await fetch(url, init);
    } catch (e) {
      // Fallo de red (offline / DNS / conexión perdida) → reintentar con backoff corto.
      ultimo = new RedError(e instanceof Error ? e.message : String(e));
      if (intento < reintentos) await dormir(200 * (intento + 1));
      continue;
    }
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    // 5xx: transitorio → reintentar. 4xx: definitivo → lanzar sin reintento.
    let codigo = "http_error";
    let mensaje = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { codigo?: string; mensaje?: string } };
      if (j.error) {
        codigo = j.error.codigo ?? codigo;
        mensaje = j.error.mensaje ?? mensaje;
      }
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    if (res.status >= 500 && intento < reintentos) {
      ultimo = new ApiError(res.status, codigo, mensaje);
      await dormir(200 * (intento + 1));
      continue;
    }
    throw new ApiError(res.status, codigo, mensaje);
  }
  throw ultimo instanceof Error ? ultimo : new RedError("sin conexión");
}
