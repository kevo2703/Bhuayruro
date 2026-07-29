import { TEXTO_OPTIN_WHATSAPP, diasEntreYmd, edadEnCumple, uuidv7, ventanaCumpleanos } from "@huayruro/shared";
import { conflicto, noEncontrado, validacion } from "../lib/errores";
import { withRetry } from "./base";

// ============================================================
// P1 — Perfil de cliente y seguimiento de tratamiento. Plan D1 §5.3 (modelo) + §12 (flujo).
//   · crear/buscar: alta rápida de mostrador (nombre + teléfono) y búsqueda por nombre, alias,
//     teléfono o DNI — la puerta de entrada real del flujo "asignar cliente" al cobrar.
//   · panel(): lo que ve quien atiende cuando reconoce al cliente — perfil, familiares, seguimientos
//     activos y últimas compras.
//   · pendientes(): a quién "le toca" hoy. SIN IA: es `fecha_inicio + duración` y la
//     `indicacion_seguimiento` que se escribió al dispensar. Cero modelos, cero costo (§12).
//
// AISLAMIENTO: el cliente es POR BOTICA. TODA consulta de acá filtra por `sucursal_id`, y las tablas
// hijas (familiares, tratamientos) se alcanzan SIEMPRE por JOIN contra `cliente` con ese filtro — nunca
// por su id a secas. Recurso de otra botica = 404, no 403 (§8: fallo cerrado, no revela existencia).
//
// ROTULADO: `tratamiento` es interno; en la UI se llama "Seguimiento", jamás "historia clínica" (§12).
// ============================================================

const MAX_PAGINA = 100;
const MAX_COMPRAS_PANEL = 20;
const MAX_TOKENS_BUSQUEDA = 6;

// Normaliza un texto libre: recorta y convierte el vacío en NULL (para no guardar "" que rompe los
// índices parciales `IS NOT NULL` y ensucia el FTS).
// Acepta `unknown` a propósito: un body con `{"nombre": {}}` llegaría hasta acá y `.trim()` sobre un
// objeto tira TypeError = 500. Cualquier cosa que no sea string se trata como ausente, y entonces la
// validación de arriba responde el 400 que corresponde.
const txt = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

// Teléfonos y DNI se guardan SOLO en dígitos: es lo único que hace comparable "918 343 561",
// "918-343-561" y "+51 918343561". El prefijo de país lo agrega quien emite el WhatsApp (A2), no el
// padrón — guardarlo acá haría que buscar "918" ya no encontrara al cliente.
const digitos = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = String(v).replace(/\D/g, "");
  return d.length > 0 ? d : null;
};

// Texto indexado en `cliente_fts`. Incluye los números además del nombre porque unicode61 trata cada
// número como un token propio, así que "9876*" alcanza el celular por la misma vía que "mari*".
function textoFts(c: { nombre: string; alias: string | null; dni: string | null; telefono: string | null; whatsapp: string | null }): string {
  return [c.nombre, c.alias, c.dni, c.telefono, c.whatsapp].filter(Boolean).join(" ");
}

// FTS5 reserva `- * " : ( ) ^` y los operadores AND/OR/NOT: un nombre con paréntesis o un teléfono
// escrito "987-654-321" harían reventar el MATCH con error de sintaxis (y un 500 en la caja). Se reduce
// la consulta a tokens alfanuméricos, se citan uno a uno y se busca por prefijo.
function consultaFts(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOKENS_BUSQUEDA);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export type ClienteFila = {
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

export type ClienteDetalle = ClienteFila & {
  alergias: string | null;
  notas: string | null;
  optin_whatsapp_at: string | null;
  optin_whatsapp_texto: string | null;
  rfm_calculado_at: string | null;
};

export type FamiliarFila = { id: string; nombre: string; relacion: string | null; notas: string | null; created_at: string };

export type TratamientoFila = {
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
};

export type CompraFila = { id: string; fecha_hora: string; total_cent: number; estado: string };

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
  dias_de_atraso: number;
};

export type CumpleFila = {
  id: string;
  nombre: string;
  alias: string | null;
  telefono: string | null;
  whatsapp: string | null;
  optin_whatsapp: number;
  fecha_nacimiento: string;
  dia: string; // "MM-DD"
};

export type Cumpleanero = CumpleFila & {
  fecha: string; // el día concreto de este año en que le toca
  dias_para: number; // 0 = hoy
  edad: number | null; // años que cumple; null si el año de nacimiento no sirve
};

// Campos editables del perfil (PATCH). `undefined` = no tocar; `null` = borrar el dato.
export type CamposCliente = {
  nombre?: string;
  alias?: string | null;
  dni?: string | null;
  telefono?: string | null;
  whatsapp?: string | null;
  optinWhatsapp?: boolean;
  fechaNacimiento?: string | null;
  alergias?: string | null;
  notas?: string | null;
  rostroCodigo?: string | null;
};

export type CamposTratamiento = {
  descripcion?: string;
  duracionDias?: number | null;
  dosisDiaria?: number | null;
  cantidadDispensada?: number | null;
  indicacionSeguimiento?: string | null;
  estado?: "activo" | "cerrado";
};

const COLUMNAS_LISTA = `id, nombre, alias, dni, telefono, whatsapp, optin_whatsapp, fecha_nacimiento,
                        segmento_rfm, rostro_codigo, created_at, updated_at`;

// Duración efectiva de un seguimiento: la escrita, o la que se deduce de cuánto se dispensó y cuánto
// toma por día (expansión §1). NULLIF evita la división por cero si alguien guarda dosis 0.
const DIAS_EFECTIVOS = `COALESCE(t.duracion_dias, CAST(t.cantidad_dispensada / NULLIF(t.dosis_diaria, 0) AS INTEGER))`;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function validarYmd(v: string | null, campo: string): void {
  if (v !== null && !YMD_RE.test(v)) throw validacion(`${campo} debe ser YYYY-MM-DD`);
}

function validarEntero(v: number | null | undefined, campo: string, min: number): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < min) throw validacion(`${campo} debe ser entero ≥${min}`);
  return v;
}

export function clientesRepo(db: D1Database) {
  // Verifica que el cliente exista y sea DE ESTA BOTICA. Es el candado que usan todas las operaciones
  // sobre tablas hijas: sin esto, un id de tratamiento adivinado alcanzaría datos de otra sucursal.
  async function exigirCliente(clienteId: string, sucursalId: string): Promise<void> {
    const r = await withRetry(() =>
      db
        .prepare(`SELECT id FROM cliente WHERE id = ?1 AND sucursal_id = ?2 AND deleted_at IS NULL`)
        .bind(clienteId, sucursalId)
        .first<{ id: string }>(),
    );
    if (!r) throw noEncontrado("cliente");
  }

  // El DNI es opcional, pero si se llena tiene que ser único DENTRO de la botica (decisión S13). Se
  // chequea antes para poder devolver un 409 legible; el UNIQUE parcial de la migración queda como
  // candado real ante la carrera de dos cajas dando de alta a la misma persona a la vez.
  async function exigirDniLibre(dni: string | null, sucursalId: string, excluirId: string | null): Promise<void> {
    if (!dni) return;
    const r = await withRetry(() =>
      db
        .prepare(`SELECT id FROM cliente WHERE sucursal_id = ?1 AND dni = ?2 AND deleted_at IS NULL AND (?3 IS NULL OR id != ?3)`)
        .bind(sucursalId, dni, excluirId)
        .first<{ id: string }>(),
    );
    if (r) throw conflicto(`ya existe un cliente con DNI ${dni} en esta botica`);
  }

  return {
    // Alta rápida de mostrador: con nombre alcanza (§12 — "nombre + teléfono en 10 segundos").
    async crear(input: {
      sucursalId: string;
      nombre: string;
      alias?: string | null;
      dni?: string | null;
      telefono?: string | null;
      whatsapp?: string | null;
      optinWhatsapp?: boolean;
      fechaNacimiento?: string | null;
      alergias?: string | null;
      notas?: string | null;
      nowIso: string;
    }): Promise<ClienteDetalle> {
      const nombre = txt(input.nombre);
      if (!nombre) throw validacion("nombre requerido");
      const dni = digitos(input.dni);
      const fechaNacimiento = txt(input.fechaNacimiento);
      validarYmd(fechaNacimiento, "fecha_nacimiento");
      await exigirDniLibre(dni, input.sucursalId, null);

      const id = uuidv7();
      const campos = {
        nombre,
        alias: txt(input.alias),
        dni,
        telefono: digitos(input.telefono),
        whatsapp: digitos(input.whatsapp),
      };
      // El opt-in guarda SIEMPRE la fecha y el texto que se leyó — sin eso es un booleano indefendible.
      const optin = input.optinWhatsapp === true ? 1 : 0;

      try {
        await withRetry(() =>
          db.batch([
            db
              .prepare(
                `INSERT INTO cliente (id, sucursal_id, nombre, alias, dni, telefono, whatsapp, optin_whatsapp,
                                      optin_whatsapp_at, optin_whatsapp_texto, fecha_nacimiento, alergias, notas,
                                      created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
              )
              .bind(
                id, input.sucursalId, campos.nombre, campos.alias, campos.dni, campos.telefono, campos.whatsapp, optin,
                optin ? input.nowIso : null, optin ? TEXTO_OPTIN_WHATSAPP : null,
                fechaNacimiento, txt(input.alergias), txt(input.notas), input.nowIso,
              ),
            db.prepare(`INSERT INTO cliente_fts (cliente_id, texto) VALUES (?1, ?2)`).bind(id, textoFts(campos)),
          ]),
        );
      } catch (e) {
        // Carrera de doble alta: el UNIQUE parcial abortó el batch (atómico → no quedó a medias).
        if (/UNIQUE constraint failed/i.test(String(e)) && dni) {
          throw conflicto(`ya existe un cliente con DNI ${dni} en esta botica`);
        }
        throw e;
      }

      const creado = await this.obtener(id, input.sucursalId);
      if (!creado) throw noEncontrado("cliente");
      return creado;
    },

    async obtener(id: string, sucursalId: string): Promise<ClienteDetalle | null> {
      return withRetry(() =>
        db
          .prepare(
            `SELECT ${COLUMNAS_LISTA}, alergias, notas, optin_whatsapp_at, optin_whatsapp_texto, rfm_calculado_at
             FROM cliente WHERE id = ?1 AND sucursal_id = ?2 AND deleted_at IS NULL`,
          )
          .bind(id, sucursalId)
          .first<ClienteDetalle>(),
      );
    },

    // Padrón de la botica, paginado por cursor keyset (§8). Los ids son uuidv7 (ordenados por tiempo),
    // así que `id < cursor` con orden descendente da "los más nuevos primero" sin OFFSET.
    async listar(
      sucursalId: string,
      opts: { limite?: number | undefined; cursor?: string | null | undefined },
    ): Promise<{ clientes: ClienteFila[]; siguiente_cursor: string | null }> {
      const limite = Math.min(Math.max(opts.limite ?? 50, 1), MAX_PAGINA);
      const cursor = txt(opts.cursor);
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT ${COLUMNAS_LISTA} FROM cliente
             WHERE sucursal_id = ?1 AND deleted_at IS NULL AND (?2 IS NULL OR id < ?2)
             ORDER BY id DESC LIMIT ?3`,
          )
          .bind(sucursalId, cursor, limite)
          .all<ClienteFila>(),
      );
      const clientes = r.results ?? [];
      return {
        clientes,
        siguiente_cursor: clientes.length === limite ? (clientes[clientes.length - 1]?.id ?? null) : null,
      };
    },

    // Búsqueda del mostrador. Dos caminos que se unen: FTS5 para nombre y alias (sin tildes, por
    // prefijo) y comparación directa por dígitos para teléfono/DNI. Hacen falta los dos: el FTS indexa
    // "918343561" como UN token, así que quien teclea "918 343 561" no lo encontraría por esa vía.
    async buscar(sucursalId: string, q: string, limite = 20): Promise<ClienteFila[]> {
      const tope = Math.min(Math.max(limite, 1), MAX_PAGINA);
      const termino = consultaFts(q);
      if (!termino) return [];

      const porTexto = await withRetry(() =>
        db
          .prepare(
            `SELECT c.id, c.nombre, c.alias, c.dni, c.telefono, c.whatsapp, c.optin_whatsapp, c.fecha_nacimiento,
                    c.segmento_rfm, c.rostro_codigo, c.created_at, c.updated_at
             FROM cliente_fts f JOIN cliente c ON c.id = f.cliente_id
             WHERE cliente_fts MATCH ?1 AND c.sucursal_id = ?2 AND c.deleted_at IS NULL
             ORDER BY rank LIMIT ?3`,
          )
          .bind(termino, sucursalId, tope)
          .all<ClienteFila>(),
      );
      const encontrados = new Map<string, ClienteFila>((porTexto.results ?? []).map((c) => [c.id, c]));

      // El padrón de una botica son miles de filas, no millones: el LIKE por contenido sobre esa escala
      // es inmediato y encuentra el celular tecleado a medias o con separadores.
      const d = digitos(q);
      if (d && d.length >= 3 && encontrados.size < tope) {
        const patron = `%${d}%`;
        const porNumero = await withRetry(() =>
          db
            .prepare(
              `SELECT ${COLUMNAS_LISTA} FROM cliente
               WHERE sucursal_id = ?1 AND deleted_at IS NULL
                 AND (telefono LIKE ?2 OR whatsapp LIKE ?2 OR dni LIKE ?2)
               ORDER BY nombre LIMIT ?3`,
            )
            .bind(sucursalId, patron, tope)
            .all<ClienteFila>(),
        );
        for (const c of porNumero.results ?? []) if (!encontrados.has(c.id)) encontrados.set(c.id, c);
      }
      return [...encontrados.values()].slice(0, tope);
    },

    // Edición del perfil (admin). Se lee la fila completa antes de escribir porque `cliente_fts` guarda
    // el texto ya combinado: sin el estado actual no se puede reconstruir el índice tras un PATCH parcial.
    async actualizar(id: string, sucursalId: string, campos: CamposCliente, nowIso: string): Promise<ClienteDetalle> {
      const actual = await this.obtener(id, sucursalId);
      if (!actual) throw noEncontrado("cliente");

      const elegir = <T>(nuevo: T | undefined, previo: T): T => (nuevo === undefined ? previo : nuevo);

      const nombre = campos.nombre === undefined ? actual.nombre : txt(campos.nombre);
      if (!nombre) throw validacion("nombre requerido");
      const dni = campos.dni === undefined ? actual.dni : digitos(campos.dni);
      const fechaNacimiento = campos.fechaNacimiento === undefined ? actual.fecha_nacimiento : txt(campos.fechaNacimiento);
      validarYmd(fechaNacimiento, "fecha_nacimiento");
      await exigirDniLibre(dni, sucursalId, id);

      const fila = {
        nombre,
        alias: campos.alias === undefined ? actual.alias : txt(campos.alias),
        dni,
        telefono: campos.telefono === undefined ? actual.telefono : digitos(campos.telefono),
        whatsapp: campos.whatsapp === undefined ? actual.whatsapp : digitos(campos.whatsapp),
      };

      // El consentimiento se re-sella con fecha y texto cada vez que pasa de "no" a "sí"; al revocarlo
      // se limpian ambos. Nunca se conserva un opt-in en 1 sin constancia de cuándo y a qué dijo que sí.
      const optinPrevio = actual.optin_whatsapp === 1;
      const optin = elegir(campos.optinWhatsapp, optinPrevio);
      const optinAt = optin ? (optinPrevio ? actual.optin_whatsapp_at : nowIso) : null;
      const optinTexto = optin ? (optinPrevio ? actual.optin_whatsapp_texto : TEXTO_OPTIN_WHATSAPP) : null;

      await withRetry(() =>
        db.batch([
          db
            .prepare(
              `UPDATE cliente SET nombre = ?2, alias = ?3, dni = ?4, telefono = ?5, whatsapp = ?6,
                      optin_whatsapp = ?7, optin_whatsapp_at = ?8, optin_whatsapp_texto = ?9,
                      fecha_nacimiento = ?10, alergias = ?11, notas = ?12, rostro_codigo = ?13, updated_at = ?14
               WHERE id = ?1 AND sucursal_id = ?15 AND deleted_at IS NULL`,
            )
            .bind(
              id, fila.nombre, fila.alias, fila.dni, fila.telefono, fila.whatsapp,
              optin ? 1 : 0, optinAt, optinTexto,
              fechaNacimiento,
              campos.alergias === undefined ? actual.alergias : txt(campos.alergias),
              campos.notas === undefined ? actual.notas : txt(campos.notas),
              campos.rostroCodigo === undefined ? actual.rostro_codigo : txt(campos.rostroCodigo),
              nowIso, sucursalId,
            ),
          db.prepare(`DELETE FROM cliente_fts WHERE cliente_id = ?1`).bind(id),
          db.prepare(`INSERT INTO cliente_fts (cliente_id, texto) VALUES (?1, ?2)`).bind(id, textoFts(fila)),
        ]),
      );

      const actualizado = await this.obtener(id, sucursalId);
      if (!actualizado) throw noEncontrado("cliente");
      return actualizado;
    },

    // Borrado lógico (admin). Saca la fila del FTS para que deje de aparecer en el mostrador, pero
    // conserva el registro: las ventas ya emitidas siguen apuntando a este id y el histórico no se toca.
    async eliminar(id: string, sucursalId: string, nowIso: string): Promise<void> {
      await exigirCliente(id, sucursalId);
      await withRetry(() =>
        db.batch([
          db.prepare(`UPDATE cliente SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND sucursal_id = ?3`).bind(id, nowIso, sucursalId),
          db.prepare(`DELETE FROM cliente_fts WHERE cliente_id = ?1`).bind(id),
        ]),
      );
    },

    // Lo que ve quien atiende al reconocer al cliente (§12): perfil, para quién más compra,
    // seguimientos abiertos y las últimas compras.
    async panel(
      id: string,
      sucursalId: string,
      opts: { hoyYmd: string; limiteCompras?: number | undefined },
    ): Promise<{ cliente: ClienteDetalle; familiares: FamiliarFila[]; tratamientos: (TratamientoFila & { dias_transcurridos: number; fecha_toca: string | null })[]; compras: CompraFila[] } | null> {
      const cliente = await this.obtener(id, sucursalId);
      if (!cliente) return null;
      const limiteCompras = Math.min(Math.max(opts.limiteCompras ?? 10, 1), MAX_COMPRAS_PANEL);

      const [familiares, tratamientos, compras] = await Promise.all([
        withRetry(() =>
          db.prepare(`SELECT id, nombre, relacion, notas, created_at FROM cliente_familiar WHERE cliente_id = ?1 ORDER BY created_at`).bind(id).all<FamiliarFila>(),
        ),
        withRetry(() =>
          db
            .prepare(
              `SELECT t.id, t.familiar_id, f.nombre AS familiar_nombre, t.venta_id, t.producto_id,
                      p.nombre AS producto_nombre, t.descripcion, t.duracion_dias, t.dosis_diaria,
                      t.cantidad_dispensada, t.indicacion_seguimiento, t.estado, t.fecha_inicio,
                      CASE WHEN ${DIAS_EFECTIVOS} IS NOT NULL
                           THEN date(t.fecha_inicio, '+' || ${DIAS_EFECTIVOS} || ' days') END AS fecha_toca
               FROM tratamiento t
               LEFT JOIN cliente_familiar f ON f.id = t.familiar_id
               LEFT JOIN producto_catalogo p ON p.id = t.producto_id
               WHERE t.cliente_id = ?1 AND t.estado = 'activo'
               ORDER BY t.fecha_inicio DESC`,
            )
            .bind(id)
            .all<TratamientoFila & { fecha_toca: string | null }>(),
        ),
        // Doble filtro a propósito: el cliente ya está scoped, pero `venta.cliente_id` no tiene FK y
        // una fila mal escrita por otra vía no debe poder colar una venta ajena en este panel.
        withRetry(() =>
          db
            .prepare(
              `SELECT id, fecha_hora, total_cent, estado FROM venta
               WHERE cliente_id = ?1 AND sucursal_id = ?2 ORDER BY fecha_hora DESC LIMIT ?3`,
            )
            .bind(id, sucursalId, limiteCompras)
            .all<CompraFila>(),
        ),
      ]);

      return {
        cliente,
        familiares: familiares.results ?? [],
        tratamientos: (tratamientos.results ?? []).map((t) => ({
          ...t,
          dias_transcurridos: diasEntreYmd(t.fecha_inicio, opts.hoyYmd),
        })),
        compras: compras.results ?? [],
      };
    },

    async agregarFamiliar(
      clienteId: string,
      sucursalId: string,
      input: { nombre: string; relacion?: string | null; notas?: string | null; nowIso: string },
    ): Promise<FamiliarFila> {
      await exigirCliente(clienteId, sucursalId);
      const nombre = txt(input.nombre);
      if (!nombre) throw validacion("nombre del familiar requerido");
      const id = uuidv7();
      const relacion = txt(input.relacion);
      const notas = txt(input.notas);
      await withRetry(() =>
        db
          .prepare(`INSERT INTO cliente_familiar (id, cliente_id, nombre, relacion, notas, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
          .bind(id, clienteId, nombre, relacion, notas, input.nowIso)
          .run(),
      );
      return { id, nombre, relacion, notas, created_at: input.nowIso };
    },

    // Registro del seguimiento al dispensar (§12: "Ibuprofeno → para el hijo → preguntar en ~5 días").
    // Cada referencia opcional se valida contra ESTA botica: un familiar de otro cliente, una venta de
    // otra sucursal o un producto de otro tenant son 404.
    async crearTratamiento(
      clienteId: string,
      sucursalId: string,
      input: {
        familiarId?: string | null;
        ventaId?: string | null;
        productoId?: string | null;
        descripcion: string;
        duracionDias?: number | null;
        dosisDiaria?: number | null;
        cantidadDispensada?: number | null;
        indicacionSeguimiento?: string | null;
        fechaInicio: string;
        nowIso: string;
      },
    ): Promise<{ id: string }> {
      await exigirCliente(clienteId, sucursalId);
      const descripcion = txt(input.descripcion);
      if (!descripcion) throw validacion("descripcion requerida");
      const fechaInicio = txt(input.fechaInicio);
      if (!fechaInicio) throw validacion("fecha_inicio requerida");
      validarYmd(fechaInicio, "fecha_inicio");

      const duracionDias = validarEntero(input.duracionDias, "duracion_dias", 1);
      const cantidadDispensada = validarEntero(input.cantidadDispensada, "cantidad_dispensada", 1);
      const dosisDiaria = input.dosisDiaria ?? null;
      if (dosisDiaria !== null && (!Number.isFinite(dosisDiaria) || dosisDiaria <= 0)) {
        throw validacion("dosis_diaria debe ser mayor a 0");
      }

      const familiarId = txt(input.familiarId);
      if (familiarId) {
        const f = await withRetry(() =>
          db.prepare(`SELECT id FROM cliente_familiar WHERE id = ?1 AND cliente_id = ?2`).bind(familiarId, clienteId).first<{ id: string }>(),
        );
        if (!f) throw noEncontrado("familiar");
      }

      const ventaId = txt(input.ventaId);
      if (ventaId) {
        const v = await withRetry(() =>
          db.prepare(`SELECT id FROM venta WHERE id = ?1 AND sucursal_id = ?2`).bind(ventaId, sucursalId).first<{ id: string }>(),
        );
        if (!v) throw noEncontrado("venta");
      }

      const productoId = txt(input.productoId);
      if (productoId) {
        // Se valida por el tenant DE LA SUCURSAL, no por el actor: así el candado no depende de qué rol
        // hizo la llamada y un super_admin operando otra botica tampoco puede cruzar catálogos.
        const p = await withRetry(() =>
          db
            .prepare(
              `SELECT p.id FROM producto_catalogo p JOIN sucursal s ON s.tenant_id = p.tenant_id
               WHERE p.id = ?1 AND s.id = ?2 AND p.deleted_at IS NULL`,
            )
            .bind(productoId, sucursalId)
            .first<{ id: string }>(),
        );
        if (!p) throw noEncontrado("producto");
      }

      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO tratamiento (id, cliente_id, familiar_id, venta_id, producto_id, descripcion,
                                      duracion_dias, dosis_diaria, cantidad_dispensada, indicacion_seguimiento,
                                      estado, fecha_inicio, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'activo', ?11, ?12, ?12)`,
          )
          .bind(id, clienteId, familiarId, ventaId, productoId, descripcion, duracionDias, dosisDiaria,
            cantidadDispensada, txt(input.indicacionSeguimiento), fechaInicio, input.nowIso)
          .run(),
      );
      return { id };
    },

    // Cerrar o corregir un seguimiento. El JOIN contra `cliente` es lo que impide tocar el tratamiento
    // de otra botica aunque se conozca su id.
    async actualizarTratamiento(
      tratamientoId: string,
      clienteId: string,
      sucursalId: string,
      campos: CamposTratamiento,
      nowIso: string,
    ): Promise<void> {
      await exigirCliente(clienteId, sucursalId);
      const actual = await withRetry(() =>
        db
          .prepare(
            `SELECT t.id FROM tratamiento t JOIN cliente c ON c.id = t.cliente_id
             WHERE t.id = ?1 AND t.cliente_id = ?2 AND c.sucursal_id = ?3 AND c.deleted_at IS NULL`,
          )
          .bind(tratamientoId, clienteId, sucursalId)
          .first<{ id: string }>(),
      );
      if (!actual) throw noEncontrado("tratamiento");

      if (campos.estado !== undefined && campos.estado !== "activo" && campos.estado !== "cerrado") {
        throw validacion("estado debe ser 'activo' o 'cerrado'");
      }
      if (campos.descripcion !== undefined && !txt(campos.descripcion)) throw validacion("descripcion requerida");
      const duracionDias = campos.duracionDias === undefined ? undefined : validarEntero(campos.duracionDias, "duracion_dias", 1);
      const cantidadDispensada = campos.cantidadDispensada === undefined ? undefined : validarEntero(campos.cantidadDispensada, "cantidad_dispensada", 1);
      if (campos.dosisDiaria !== undefined && campos.dosisDiaria !== null && (!Number.isFinite(campos.dosisDiaria) || campos.dosisDiaria <= 0)) {
        throw validacion("dosis_diaria debe ser mayor a 0");
      }

      // COALESCE con `undefined → null` deja pasar los campos no enviados sin tocarlos. Los que sí
      // vienen en null (borrar el dato) se distinguen con su bandera `_set` para no chocar con eso.
      await withRetry(() =>
        db
          .prepare(
            `UPDATE tratamiento SET
               descripcion = COALESCE(?2, descripcion),
               duracion_dias = CASE WHEN ?3 = 1 THEN ?4 ELSE duracion_dias END,
               dosis_diaria = CASE WHEN ?5 = 1 THEN ?6 ELSE dosis_diaria END,
               cantidad_dispensada = CASE WHEN ?7 = 1 THEN ?8 ELSE cantidad_dispensada END,
               indicacion_seguimiento = CASE WHEN ?9 = 1 THEN ?10 ELSE indicacion_seguimiento END,
               estado = COALESCE(?11, estado),
               updated_at = ?12
             WHERE id = ?1`,
          )
          .bind(
            tratamientoId,
            campos.descripcion === undefined ? null : txt(campos.descripcion),
            campos.duracionDias === undefined ? 0 : 1, duracionDias ?? null,
            campos.dosisDiaria === undefined ? 0 : 1, campos.dosisDiaria ?? null,
            campos.cantidadDispensada === undefined ? 0 : 1, cantidadDispensada ?? null,
            campos.indicacionSeguimiento === undefined ? 0 : 1, txt(campos.indicacionSeguimiento),
            campos.estado ?? null,
            nowIso,
          )
          .run(),
      );
    },

    // Cumpleaños de la semana (§12: gesto comercial). La ventana se arma en JS y el SQL solo compara
    // el MM-DD: cero aritmética de fechas dentro de la consulta y el filtro por sucursal manda.
    // Son NOMBRES DE PERSONAS del padrón, así que esto se sirve por la misma puerta que el resto de
    // `/clientes` (operador para arriba; `lector_reportes` no entra).
    // Binds: sucursal + como mucho 32 días + límite = bien por debajo del tope de 100 de la D1 remota.
    async cumpleanos(
      sucursalId: string,
      opts: { hoyYmd: string; dias?: number | undefined; limite?: number | undefined },
    ): Promise<{ hoy: string; dias: number; cumpleanos: Cumpleanero[] }> {
      const ventana = ventanaCumpleanos(opts.hoyYmd, opts.dias ?? 7);
      const limite = Math.min(Math.max(opts.limite ?? 50, 1), MAX_PAGINA);
      const diasPedidos = opts.dias ?? 7;
      if (ventana.length === 0) return { hoy: opts.hoyYmd, dias: diasPedidos, cumpleanos: [] };

      const ph = ventana.map((_, i) => `?${i + 2}`).join(",");
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT id, nombre, alias, telefono, whatsapp, optin_whatsapp, fecha_nacimiento,
                    substr(fecha_nacimiento, 6, 5) AS dia
             FROM cliente
             WHERE sucursal_id = ?1 AND deleted_at IS NULL AND fecha_nacimiento IS NOT NULL
               AND substr(fecha_nacimiento, 6, 5) IN (${ph})
             ORDER BY nombre LIMIT ?${ventana.length + 2}`,
          )
          .bind(sucursalId, ...ventana.map((d) => d.dia), limite)
          .all<CumpleFila>(),
      );

      // Cada MM-DD sabe a qué día del calendario corresponde (el 29-feb comparte el del 28 en años no
      // bisiestos), así que el orden "primero el de hoy" sale de la ventana, no de otra consulta.
      const porDia = new Map(ventana.map((d) => [d.dia, d]));
      const cumpleanos = (r.results ?? [])
        .map((c) => {
          const d = porDia.get(c.dia);
          return {
            ...c,
            fecha: d?.ymd ?? opts.hoyYmd,
            dias_para: d?.offset ?? 0,
            edad: edadEnCumple(c.fecha_nacimiento, d?.ymd ?? opts.hoyYmd),
          };
        })
        .sort((a, b) => a.dias_para - b.dias_para || a.nombre.localeCompare(b.nombre, "es"));

      return { hoy: opts.hoyYmd, dias: diasPedidos, cumpleanos };
    },

    // "¿A quién le toca hoy?" — seguimientos activos cuya fecha estimada de fin ya llegó (o llega
    // dentro de `proximosDias`). SIN IA: fecha de inicio + duración, y lo que hay que preguntar es la
    // `indicacion_seguimiento` que se escribió al dispensar (§12).
    // Un seguimiento sin duración NI dosis no entra acá: no hay regla de días que aplicar. Igual sale
    // en el panel del cliente, que es donde se lo ve al atenderlo.
    async pendientes(
      sucursalId: string,
      opts: { hoyYmd: string; proximosDias?: number | undefined; limite?: number | undefined },
    ): Promise<{ hoy: string; pendientes: SeguimientoPendiente[] }> {
      const limite = Math.min(Math.max(opts.limite ?? 50, 1), MAX_PAGINA);
      const ventana = Math.min(Math.max(opts.proximosDias ?? 0, 0), 30);
      const hasta = new Date(Date.parse(`${opts.hoyYmd}T12:00:00.000Z`) + ventana * 86_400_000).toISOString().slice(0, 10);

      const r = await withRetry(() =>
        db
          .prepare(
            `WITH activos AS (
               SELECT t.id AS tratamiento_id, t.cliente_id, c.nombre AS cliente_nombre, c.telefono, c.whatsapp,
                      c.optin_whatsapp, f.nombre AS familiar_nombre, t.descripcion, t.indicacion_seguimiento,
                      t.fecha_inicio, ${DIAS_EFECTIVOS} AS dias
               FROM tratamiento t
               JOIN cliente c ON c.id = t.cliente_id
               LEFT JOIN cliente_familiar f ON f.id = t.familiar_id
               WHERE c.sucursal_id = ?1 AND c.deleted_at IS NULL AND t.estado = 'activo'
             )
             SELECT tratamiento_id, cliente_id, cliente_nombre, telefono, whatsapp, optin_whatsapp,
                    familiar_nombre, descripcion, indicacion_seguimiento, fecha_inicio,
                    date(fecha_inicio, '+' || dias || ' days') AS fecha_toca
             FROM activos
             WHERE dias IS NOT NULL AND date(fecha_inicio, '+' || dias || ' days') <= ?2
             ORDER BY fecha_toca ASC LIMIT ?3`,
          )
          .bind(sucursalId, hasta, limite)
          .all<Omit<SeguimientoPendiente, "dias_de_atraso">>(),
      );

      return {
        hoy: opts.hoyYmd,
        pendientes: (r.results ?? []).map((p) => ({
          ...p,
          dias_de_atraso: diasEntreYmd(p.fecha_toca, opts.hoyYmd), // negativo = todavía no le toca
        })),
      };
    },
  };
}
