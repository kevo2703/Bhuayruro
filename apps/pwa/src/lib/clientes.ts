import { apiRequest } from "./api";
import { getToken } from "./auth";

// P1 — cliente HTTP del padrón y del Seguimiento (plan §12). Todo online: el padrón no vive en Dexie
// a propósito, porque son datos personales y de salud que no tienen por qué quedarse en el equipo del
// mostrador. La VENTA en cambio sigue yendo por la cola offline; lo único que se le cuelga es el
// `cliente_id` que esta capa resolvió cuando había red.
//
// ROTULADO: en pantalla esto se llama "Seguimiento", jamás "historia clínica" (§12).

export type Cliente = {
  id: string;
  nombre: string;
  alias: string | null;
  dni: string | null;
  telefono: string | null;
  whatsapp: string | null;
  optin_whatsapp: number;
  fecha_nacimiento: string | null;
  segmento_rfm: string | null;
  rostro_codigo: string | null;
  created_at: string;
  updated_at: string;
};

export type ClienteDetalle = Cliente & {
  alergias: string | null;
  notas: string | null;
  optin_whatsapp_at: string | null;
  optin_whatsapp_texto: string | null;
  rfm_calculado_at: string | null;
};

export type Familiar = { id: string; nombre: string; relacion: string | null; notas: string | null; created_at: string };

export type Tratamiento = {
  id: string;
  familiar_id: string | null;
  familiar_nombre: string | null;
  venta_id: string | null;
  producto_id: string | null;
  producto_nombre: string | null;
  descripcion: string;
  duracion_dias: number | null;
  dosis_diaria: number | null;
  cantidad_dispensada: number | null;
  indicacion_seguimiento: string | null;
  estado: string;
  fecha_inicio: string;
  dias_transcurridos: number;
  fecha_toca: string | null;
};

export type Compra = { id: string; fecha_hora: string; total_cent: number; estado: string };

export type PanelCliente = {
  cliente: ClienteDetalle;
  familiares: Familiar[];
  tratamientos: Tratamiento[];
  compras: Compra[];
};

export type SeguimientoPendiente = {
  tratamiento_id: string;
  cliente_id: string;
  cliente_nombre: string;
  telefono: string | null;
  whatsapp: string | null;
  optin_whatsapp: number;
  familiar_nombre: string | null;
  descripcion: string;
  indicacion_seguimiento: string | null;
  fecha_inicio: string;
  fecha_toca: string;
  dias_de_atraso: number; // negativo = todavía no le toca
};

export type Cumpleanero = {
  id: string;
  nombre: string;
  alias: string | null;
  telefono: string | null;
  whatsapp: string | null;
  optin_whatsapp: number;
  fecha_nacimiento: string;
  fecha: string;
  dias_para: number;
  edad: number | null;
};

export type NuevoCliente = {
  nombre: string;
  telefono?: string | null;
  whatsapp?: string | null;
  optin_whatsapp?: boolean;
  dni?: string | null;
  fecha_nacimiento?: string | null;
  alias?: string | null;
  alergias?: string | null;
  notas?: string | null;
};

export type NuevoTratamiento = {
  descripcion: string;
  familiar_id?: string | null;
  venta_id?: string | null;
  producto_id?: string | null;
  duracion_dias?: number | null;
  indicacion_seguimiento?: string | null;
  cantidad_dispensada?: number | null;
  dosis_diaria?: number | null;
};

// La sucursal SALE de la sesión para todo el mundo menos el super_admin, que no tiene una y debe
// elegirla (`sucursalVerificada` en el server la comprueba contra su tenant). Por eso todas las
// llamadas aceptan un `suc` opcional: el Mostrador nunca lo manda, la pantalla Clientes sí cuando la
// usa el dueño.
const conSuc = (path: string, suc?: string | null): string =>
  suc ? `${path}${path.includes("?") ? "&" : "?"}sucursal_id=${encodeURIComponent(suc)}` : path;

const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  apiRequest<T>(path, signal ? { token: getToken(), signal, reintentos: 0 } : { token: getToken() });
const post = <T>(path: string, body: unknown): Promise<T> => apiRequest<T>(path, { method: "POST", body, token: getToken() });

// Búsqueda del mostrador: un solo campo. El server ya resuelve tildes, ñ y teléfono con espacios o
// guiones (FTS + comparación por dígitos), así que acá no hay que normalizar nada.
export async function buscarClientes(q: string, signal?: AbortSignal, suc?: string | null): Promise<Cliente[]> {
  if (!q.trim()) return [];
  const r = await get<{ clientes: Cliente[] }>(conSuc(`/clientes/buscar?q=${encodeURIComponent(q.trim())}&limit=8`, suc), signal);
  return r.clientes ?? [];
}

export function listarClientes(
  opts: { cursor?: string | null; limite?: number; suc?: string | null } = {},
  signal?: AbortSignal,
): Promise<{ clientes: Cliente[]; siguiente_cursor: string | null }> {
  const params = [`limit=${opts.limite ?? 30}`];
  if (opts.cursor) params.push(`cursor=${encodeURIComponent(opts.cursor)}`);
  return get<{ clientes: Cliente[]; siguiente_cursor: string | null }>(conSuc(`/clientes?${params.join("&")}`, opts.suc), signal);
}

export async function crearCliente(datos: NuevoCliente, suc?: string | null): Promise<ClienteDetalle> {
  const r = await post<{ cliente: ClienteDetalle }>(conSuc("/clientes", suc), datos);
  return r.cliente;
}

export function panelCliente(id: string, signal?: AbortSignal, suc?: string | null): Promise<PanelCliente> {
  return get<PanelCliente>(conSuc(`/clientes/${id}/panel`, suc), signal);
}

// Editar el perfil es de admin (§12). El opt-in se re-sella con fecha y texto cada vez que pasa de
// "no" a "sí" — eso lo resuelve el server, acá solo se manda la casilla.
export async function actualizarCliente(id: string, campos: Record<string, unknown>, suc?: string | null): Promise<ClienteDetalle> {
  const r = await apiRequest<{ cliente: ClienteDetalle }>(conSuc(`/clientes/${id}`, suc), {
    method: "PATCH",
    body: campos,
    token: getToken(),
  });
  return r.cliente;
}

// Borrado lógico: el histórico de ventas NO se toca (§12).
export function eliminarCliente(id: string, suc?: string | null): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(conSuc(`/clientes/${id}`, suc), { method: "DELETE", token: getToken() });
}

export async function agregarFamiliar(clienteId: string, nombre: string, relacion?: string | null, suc?: string | null): Promise<Familiar> {
  const r = await post<{ familiar: Familiar }>(conSuc(`/clientes/${clienteId}/familiares`, suc), { nombre, relacion: relacion ?? null });
  return r.familiar;
}

export function crearTratamiento(clienteId: string, datos: NuevoTratamiento, suc?: string | null): Promise<{ id: string }> {
  return post<{ id: string }>(conSuc(`/clientes/${clienteId}/tratamientos`, suc), datos);
}

// Cerrar el seguimiento = "ya le pregunté". Es acción de mostrador (operador+), no de admin.
export function cerrarSeguimiento(clienteId: string, tratamientoId: string, suc?: string | null): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(conSuc(`/clientes/${clienteId}/tratamientos/${tratamientoId}`, suc), {
    method: "PATCH",
    body: { estado: "cerrado" },
    token: getToken(),
  });
}

export function seguimientosPendientes(proximosDias = 2, suc?: string | null): Promise<{ hoy: string; pendientes: SeguimientoPendiente[] }> {
  return get<{ hoy: string; pendientes: SeguimientoPendiente[] }>(conSuc(`/seguimientos/pendientes?proximos_dias=${proximosDias}`, suc));
}

export function cumpleanosSemana(dias = 7, suc?: string | null): Promise<{ hoy: string; dias: number; cumpleanos: Cumpleanero[] }> {
  return get<{ hoy: string; dias: number; cumpleanos: Cumpleanero[] }>(conSuc(`/clientes/cumpleanos?dias=${dias}`, suc));
}

// --- Ayudas de presentación (compartidas por el Mostrador y la pantalla Clientes) ---

// Un nombre para el chip del mostrador: alias si lo hay (así lo llaman en la botica), si no el nombre.
export function nombreCorto(c: { nombre: string; alias?: string | null }): string {
  return (c.alias ?? "").trim() || c.nombre;
}

// Teléfono en la forma en que lo lee una persona: 918 343 561.
export function telefonoLegible(numero: string | null | undefined): string {
  const d = (numero ?? "").replace(/\D/g, "");
  if (d.length !== 9) return d;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

// "hoy" / "mañana" / "en 3 días" / "hace 2 días" — el mostrador no lee fechas ISO en hora punta.
export function cuandoToca(diasDeAtraso: number): string {
  if (diasDeAtraso === 0) return "hoy";
  if (diasDeAtraso > 0) return diasDeAtraso === 1 ? "ayer" : `hace ${diasDeAtraso} días`;
  return diasDeAtraso === -1 ? "mañana" : `en ${Math.abs(diasDeAtraso)} días`;
}

export function cuandoCumple(diasPara: number): string {
  if (diasPara === 0) return "hoy";
  if (diasPara === 1) return "mañana";
  return `en ${diasPara} días`;
}
