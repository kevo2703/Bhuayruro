import { Hono, type Context } from "hono";
import { ErrorImportacion, ErrorLista, GTIN_RE, PLANTILLA_CSV, minutosDeHHMM, parseFecha, uuidv7, validarCatalogoCsv, validarListaCsv, type ProductoImportable } from "@huayruro/shared";
import { ErrorApi, noEncontrado, validacion } from "../lib/errores";
import { ahoraIso } from "../lib/fecha";
import { leerBody } from "../lib/http";
import { hashPassword } from "../lib/password";
import { generarToken, hashToken } from "../lib/token";
import { esSuper, sucursalObjetivo } from "../lib/scope";
import { requiereAuth } from "../mw/auth";
import { adminOSuper, operadorParaArriba, requiereDispositivo, requiereUsuario, soloSuperAdmin } from "../mw/roles";
import { audioCorreccionRepo, audioMediaRepo, audioRepo, audioSenalRepo, audioSistemaRepo, procesarAudio, reporteCalidad } from "../repos/audio";
import { catalogoPruebaRepo } from "../repos/catalogo-prueba";
import { dispositivoRepo } from "../repos/dispositivo";
import { auditRepo, faltantesRepo, usuarioRepo } from "../repos/admin";
import { cajaRepo } from "../repos/caja";
import { clientesRepo, type CamposCliente, type CamposTratamiento } from "../repos/clientes";
import { precioRepo, productoRepo } from "../repos/catalogo";
import { importarCatalogoRepo } from "../repos/importar-catalogo";
import { maestroRepo } from "../repos/maestro";
import { proveedorRepo } from "../repos/proveedores";
import { comparadorRepo } from "../repos/comparador";
import { pedidoRepo } from "../repos/pedido";
import { dashboardRepo, type Rango } from "../repos/dashboard";
import { hoyRepo } from "../repos/hoy";
import { casosRepo } from "../repos/casos";
import { espejoRepo } from "../repos/espejo";
import { conteoRepo } from "../repos/conteo";
import { inventarioRepo } from "../repos/inventario";
import { quiebreRepo } from "../repos/quiebre";
import { eventoCajaRepo } from "../repos/evento-caja";
import { recepcionRepo } from "../repos/recepcion";
import { recepcionBorradorRepo } from "../repos/recepcion-borrador";
import { botRepo } from "../repos/bot";
import { sucursalRepo } from "../repos/sucursal";
import { ventaRepo } from "../repos/venta";
import { fechaLocal } from "../lib/fecha";
import type { AppEnv } from "../types";

const METODOS = new Set(["efectivo", "yape", "plin", "tarjeta", "transferencia", "otro"]);
const RANGOS = new Set(["hoy", "7d", "30d"]);
const leerRango = (v?: string): Rango => (v && RANGOS.has(v) ? (v as Rango) : "7d");

// Vista compacta de una fila importable para la previsualización de la pantalla.
const vistaPreview = (p: ProductoImportable) => ({
  fila: p.fila,
  nombre: p.nombre,
  gtin: p.gtin,
  precio_venta_publico_dm: p.precioVentaPublicaDm,
  precio_sin_igv_dm: p.precioSinIgvDm,
  precio_compra_dm: p.precioCompraDm,
  stock: p.stockInicial,
  minimo: p.stockMinimo,
  lote: p.lote,
  blister: p.blister ? { nombre: p.blister.nombre, factor: p.blister.factor, precio_venta_publico_dm: p.blister.precioVentaPublicaDm } : null,
});

export const rutasProtegidas = new Hono<AppEnv>();

// Toda ruta protegida pasa por la resolución de sesión.
rutasProtegidas.use("*", requiereAuth);

// ---- Sucursales ----
rutasProtegidas.get("/sucursales", requiereUsuario, async (c) => {
  return c.json({ sucursales: await sucursalRepo(c.get("db"), c.get("actor")).listar() });
});

rutasProtegidas.post("/sucursales", soloSuperAdmin, async (c) => {
  const body = await leerBody<{ nombre: string; direccion: string }>(c);
  const r = await sucursalRepo(c.get("db"), c.get("actor")).crear({
    nombre: body.nombre ?? "",
    direccion: body.direccion?.trim() || null,
    nowIso: ahoraIso(),
  });
  return c.json({ id: r.id }, 201);
});

rutasProtegidas.patch("/sucursales/:id", soloSuperAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await leerBody<{ nombre: string; direccion: string; activa: boolean; hora_apertura?: string | null; hora_cierre?: string | null }>(c);
  const repo = sucursalRepo(c.get("db"), c.get("actor"));
  await repo.actualizar(id, {
    nombre: body.nombre,
    direccion: body.direccion === undefined ? undefined : body.direccion?.trim() || null,
    activa: typeof body.activa === "boolean" ? body.activa : undefined,
  });
  // Horario declarado (B11.1 EBR 'fuera de horario'). Se acepta si el body trae alguna de las dos claves;
  // vacío = apagar el control. Apertura y cierre se cargan juntos (o ambos vacíos).
  const tieneHorario = Object.prototype.hasOwnProperty.call(body, "hora_apertura") || Object.prototype.hasOwnProperty.call(body, "hora_cierre");
  if (tieneHorario) {
    const norm = (x: unknown): string | null => {
      const s = (x ?? "").toString().trim();
      if (!s) return null;
      if (minutosDeHHMM(s) === null) throw validacion("hora inválida (usa HH:MM)");
      return s;
    };
    const hApertura = norm(body.hora_apertura);
    const hCierre = norm(body.hora_cierre);
    if ((hApertura === null) !== (hCierre === null)) throw validacion("carga apertura y cierre juntos (o deja ambos vacíos para apagar el horario)");
    await repo.fijarHorario(id, hApertura, hCierre);
  }
  return c.json({ ok: true });
});

// ---- Catálogo (compartido a nivel tenant) ----
rutasProtegidas.get("/catalogo/productos", requiereUsuario, async (c) => {
  const productos = await productoRepo(c.get("db"), c.get("actor")).listar(c.req.query("q"));
  return c.json({ productos });
});

// Conteo de productos activos del catálogo (pantalla de Ajustes). Tenant-wide (el catálogo es compartido).
rutasProtegidas.get("/catalogo/conteo", adminOSuper, async (c) => {
  return c.json(await productoRepo(c.get("db"), c.get("actor")).contarActivos());
});

rutasProtegidas.get("/catalogo/productos/:id/presentaciones", requiereUsuario, async (c) => {
  const presentaciones = await productoRepo(c.get("db"), c.get("actor")).presentaciones(c.req.param("id"));
  return c.json({ presentaciones });
});

// Agregar presentación (Δ1: blíster/caja con factor).
rutasProtegidas.post("/catalogo/productos/:id/presentaciones", adminOSuper, async (c) => {
  const body = await leerBody<{ nombre: string; factor_unidades: number }>(c);
  const factor = body.factor_unidades;
  if (!body.nombre?.trim()) throw validacion("nombre requerido");
  if (typeof factor !== "number" || !Number.isInteger(factor) || factor < 1) throw validacion("factor_unidades entero ≥1");
  const r = await productoRepo(c.get("db"), c.get("actor")).agregarPresentacion(c.req.param("id"), body.nombre.trim(), factor, ahoraIso());
  return c.json(r, 201);
});

// Hot-path del escáner: GTIN → producto + presentación (Δ1) + precio vigente de MI sucursal.
rutasProtegidas.get("/catalogo/barcode/:gtin", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  const r = await productoRepo(c.get("db"), c.get("actor")).porGtin(c.req.param("gtin"), suc);
  if (!r) throw noEncontrado("código de barras");
  return c.json({ producto: r });
});

// Delta para Dexie (productos + presentaciones + códigos + precios de MI sucursal, con tombstones).
rutasProtegidas.get("/catalogo/sync", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json(await productoRepo(c.get("db"), c.get("actor")).sync(suc, c.req.query("desde") ?? null));
});

// Crea producto; `codigo_barras` opcional (alta asistida B7.4: el producto nace con el GTIN del maestro).
rutasProtegidas.post("/catalogo/productos", adminOSuper, async (c) => {
  const body = await leerBody<{
    nombre: string; presentacion: string; laboratorio: string; principio_activo: string; categoria: string; requiere_receta: boolean; codigo_barras: string;
  }>(c);
  if (!body.nombre || !body.nombre.trim()) throw validacion("nombre requerido");
  const gtin = body.codigo_barras?.trim() || null;
  if (gtin && !GTIN_RE.test(gtin)) throw validacion(`código de barras inválido: "${gtin}"`);
  const r = await productoRepo(c.get("db"), c.get("actor")).crear({
    nombre: body.nombre.trim(),
    presentacion: body.presentacion?.trim() || null,
    laboratorio: body.laboratorio?.trim() || null,
    principio_activo: body.principio_activo?.trim() || null,
    categoria: body.categoria?.trim() || null,
    requiere_receta: body.requiere_receta ? 1 : 0,
    gtin,
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

// ---- Catálogo maestro nacional (B7) — GLOBAL read-only (D-N7), solo referencia/alta asistida ----
rutasProtegidas.get("/maestro/buscar", requiereUsuario, async (c) => {
  return c.json({ resultados: await maestroRepo(c.get("db")).buscar(c.req.query("q") ?? "") });
});

rutasProtegidas.get("/maestro/por-gtin/:gtin", requiereUsuario, async (c) => {
  const r = await maestroRepo(c.get("db")).porGtin(c.req.param("gtin"));
  if (!r) throw noEncontrado("código en el catálogo maestro");
  return c.json({ producto: r });
});

// Total del catálogo maestro nacional (GLOBAL) — pantalla de Ajustes. Cualquier usuario autenticado.
rutasProtegidas.get("/maestro/conteo", requiereUsuario, async (c) => {
  return c.json(await maestroRepo(c.get("db")).contar());
});

rutasProtegidas.patch("/catalogo/productos/:id", adminOSuper, async (c) => {
  const body = await leerBody<{
    nombre: string; presentacion: string; laboratorio: string; principio_activo: string; categoria: string; requiere_receta: boolean;
  }>(c);
  await productoRepo(c.get("db"), c.get("actor")).actualizar(
    c.req.param("id"),
    {
      nombre: body.nombre?.trim(),
      presentacion: body.presentacion?.trim(),
      laboratorio: body.laboratorio?.trim(),
      principio_activo: body.principio_activo?.trim(),
      categoria: body.categoria?.trim(),
      requiere_receta: body.requiere_receta === undefined ? undefined : body.requiere_receta ? 1 : 0,
    },
    ahoraIso(),
  );
  return c.json({ ok: true });
});

rutasProtegidas.delete("/catalogo/productos/:id", adminOSuper, async (c) => {
  await productoRepo(c.get("db"), c.get("actor")).eliminar(c.req.param("id"), ahoraIso());
  return c.json({ ok: true });
});

// ---- Importador de catálogo en lote (T-K4) ----

// Plantilla CSV descargable (cabecera + 2 ejemplos).
rutasProtegidas.get("/catalogo/importar/plantilla", adminOSuper, (_c) => {
  return new Response(PLANTILLA_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plantilla-catalogo-huayruro.csv"`,
    },
  });
});

// Importa un CSV: `?dry_run=1` valida y previsualiza SIN escribir; sin él, comete atómicamente por
// fila. Super elige sucursal con ?sucursal_id; admin importa a la suya. El catálogo es compartido a
// nivel tenant; precio/stock/lote son por sucursal.
rutasProtegidas.post("/catalogo/importar", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  // La sucursal pedida por un super DEBE ser de su tenant (sucursalObjetivo no lo verifica → aislamiento).
  if (esSuper(actor)) {
    const sucs = await sucursalRepo(c.get("db"), actor).listar();
    if (!sucs.some((s) => s.id === suc)) throw noEncontrado("sucursal");
  }
  const dryRun = c.req.query("dry_run") === "1";
  const body = await leerBody<{ csv: string }>(c);
  if (typeof body.csv !== "string" || !body.csv.trim()) throw validacion("csv requerido");
  if (body.csv.length > 2_000_000) throw validacion("archivo demasiado grande (máx ~2 MB)");

  let reporte;
  try {
    reporte = validarCatalogoCsv(body.csv, { hoy: fechaLocal() });
  } catch (e) {
    if (e instanceof ErrorImportacion) throw validacion(e.message);
    throw e;
  }
  if (reporte.validas.length > 5000) throw validacion("demasiadas filas válidas (máx 5000 por importación)");

  const repo = importarCatalogoRepo(c.get("db"), actor);
  const gtins = reporte.validas.flatMap((p) => [p.gtin, p.blister?.gtin ?? null]).filter((g): g is string => !!g);
  const nombresSinCod = reporte.validas.filter((p) => !p.gtin).map((p) => p.nombre);
  const [porGtin, porNombre] = await Promise.all([repo.gtinsExistentes(gtins), repo.nombresExistentes(nombresSinCod)]);
  // Resuelve si un producto ya está en el catálogo del tenant: por GTIN, o por nombre si no tiene código.
  const resolver = (p: (typeof reporte.validas)[number]) => (p.gtin ? porGtin.get(p.gtin) : porNombre.get(p.nombreNorm));
  const yaEnCatalogo = reporte.validas
    .filter((p) => !!resolver(p))
    .map((p) => ({ fila: p.fila, nombre: p.nombre, gtin: p.gtin }));

  if (dryRun) {
    return c.json({
      dry_run: true,
      sucursal_id: suc,
      delimitador: reporte.delimitador,
      columnas_detectadas: reporte.columnasDetectadas,
      columnas_ignoradas: reporte.columnasIgnoradas,
      resumen: { ...reporte.resumen, ya_en_catalogo: yaEnCatalogo.length, nuevos: reporte.validas.length - yaEnCatalogo.length },
      muestra: reporte.validas.slice(0, 50).map(vistaPreview),
      ya_en_catalogo: yaEnCatalogo,
      rechazadas: reporte.rechazadas,
      advertencias: reporte.advertencias,
    });
  }

  const hoy = fechaLocal();
  const nowIso = ahoraIso();
  let creados = 0, agregados = 0, omitidos = 0;
  const fallidos: { fila: number; nombre: string; error: string }[] = [];
  const notas: { fila: number; nombre: string; nota: string }[] = [];
  for (const p of reporte.validas) {
    try {
      const d = await repo.importarUno(p, { sucursalId: suc, hoy, nowIso }, resolver(p));
      if (d.estado === "creado") creados++;
      else if (d.estado === "agregado_a_sucursal") agregados++;
      else omitidos++;
      if (d.nota) notas.push({ fila: p.fila, nombre: p.nombre, nota: d.nota });
    } catch (e) {
      fallidos.push({ fila: p.fila, nombre: p.nombre, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json({
    dry_run: false,
    sucursal_id: suc,
    creados,
    agregados,
    omitidos,
    fallidos,
    notas,
    rechazadas: reporte.rechazadas,
    advertencias: reporte.advertencias,
    resumen: reporte.resumen,
  });
});

// Conteo del catálogo demo (seed sintético) del tenant — para ofrecer la purga.
rutasProtegidas.get("/catalogo/demo/conteo", adminOSuper, async (c) => {
  return c.json({ productos: await importarCatalogoRepo(c.get("db"), c.get("actor")).contarSeedDemo() });
});

// Purga el catálogo demo (seed sintético). Solo super; nunca borra ventas (si hay, la FK aborta).
rutasProtegidas.post("/catalogo/demo/purgar", soloSuperAdmin, async (c) => {
  try {
    const r = await importarCatalogoRepo(c.get("db"), c.get("actor")).purgarSeedDemo();
    return c.json({ ok: true, ...r });
  } catch (e) {
    // FK: hay ventas/movimientos ligados a un producto demo → no se purga en silencio.
    throw validacion("no se pudo purgar el catálogo demo: hay ventas o movimientos ligados a productos demo. Anula/limpia esas ventas de prueba primero.");
  }
});

// ---- Catálogo de PRUEBA (B10.4.1) — promueve el maestro (medicamentos) con 100u de stock para dar al
// matcher del audio contra qué pegar durante el piloto. Data de prueba: gated (admin+) y purgable. ----

// Estado: cuántos productos de prueba hay y el techo del maestro (para la barra de progreso).
rutasProtegidas.get("/catalogo/prueba/conteo", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const r = await catalogoPruebaRepo(c.get("db"), c.get("actor")).conteo();
  return c.json({ ...r, sucursal_id: suc });
});

// Promueve UNA página del maestro (la UI itera con el cursor `siguiente_desde` hasta null).
rutasProtegidas.post("/catalogo/prueba/cargar", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ desde?: string; cantidad?: number }>(c);
  const desdeId = (body.desde ?? "").toString();
  const cantRaw = Number(body.cantidad);
  const cantidad = Number.isFinite(cantRaw) && cantRaw >= 1 && cantRaw <= 250 ? Math.round(cantRaw) : 150;
  const r = await catalogoPruebaRepo(c.get("db"), c.get("actor")).promoverPagina({
    sucursalId: suc,
    desdeId,
    cantidad,
    hoy: ahoraIso().slice(0, 10),
    nowIso: ahoraIso(),
  });
  return c.json(r);
});

// Purga TODO el catálogo de prueba del tenant (antes de cargar el real, T-K4). Solo super; nunca borra ventas.
rutasProtegidas.post("/catalogo/prueba/purgar", soloSuperAdmin, async (c) => {
  try {
    const r = await catalogoPruebaRepo(c.get("db"), c.get("actor")).purgar();
    return c.json({ ok: true, ...r });
  } catch (e) {
    throw validacion("no se pudo purgar el catálogo de prueba: hay ventas o movimientos ligados a un producto de prueba. Anula esas ventas primero.");
  }
});

// ---- Precios (por sucursal) ----
rutasProtegidas.get("/precios", requiereUsuario, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, c.req.query("sucursal_id"));
  const precios = await precioRepo(c.get("db")).listar(suc, c.req.query("producto_id"));
  return c.json({ precios });
});

// Versión nueva de precio (cierra el vigente + crea el nuevo, en batch).
rutasProtegidas.post("/precios", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  const body = await leerBody<{ producto_id: string; presentacion_id: string; precio_sin_igv_dm: number; precio_compra_dm: number }>(c);
  if (!body.producto_id || !body.presentacion_id) throw validacion("producto_id y presentacion_id requeridos");
  if (!Number.isInteger(body.precio_sin_igv_dm) || (body.precio_sin_igv_dm ?? -1) < 0) {
    throw validacion("precio_sin_igv_dm entero ≥0 requerido");
  }
  if (body.precio_compra_dm !== undefined && (!Number.isInteger(body.precio_compra_dm) || body.precio_compra_dm < 0)) {
    throw validacion("precio_compra_dm entero ≥0");
  }
  const r = await precioRepo(c.get("db")).crearVersion({
    productoId: body.producto_id,
    sucursalId: suc,
    presentacionId: body.presentacion_id,
    precioSinIgvDm: body.precio_sin_igv_dm!,
    precioCompraDm: body.precio_compra_dm ?? null,
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

rutasProtegidas.patch("/precios/:id", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const body = await leerBody<{ precio_sin_igv_dm: number }>(c);
  if (!Number.isInteger(body.precio_sin_igv_dm) || (body.precio_sin_igv_dm ?? -1) < 0) {
    throw validacion("precio_sin_igv_dm entero ≥0 requerido");
  }
  await precioRepo(c.get("db")).actualizarPorId(
    c.req.param("id"),
    esSuper(actor) ? null : actor.sucursalId,
    body.precio_sin_igv_dm!,
  );
  return c.json({ ok: true });
});

// ---- Inventario (por sucursal) ----
rutasProtegidas.get("/inventario", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  const inventario = await inventarioRepo(c.get("db")).listar(suc, c.req.query("bajo_minimo") === "1");
  return c.json({ inventario });
});

rutasProtegidas.post("/inventario/ajustes", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const body = await leerBody<{ inventario_id: string; cantidad: number; motivo: string }>(c);
  if (!body.inventario_id || !Number.isInteger(body.cantidad) || (body.cantidad ?? -1) < 0) {
    throw validacion("inventario_id y cantidad (entero ≥0) requeridos");
  }
  await inventarioRepo(c.get("db")).ajustarPorId(
    body.inventario_id,
    esSuper(actor) ? null : actor.sucursalId,
    body.cantidad!,
    body.motivo ?? "conteo",
    actor.tipo === "usuario" ? actor.usuarioId : null,
    ahoraIso(),
  );
  return c.json({ ok: true });
});

// Lotes por vencer (alertas de vencimiento).
rutasProtegidas.get("/inventario/lotes", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  const lotes = await inventarioRepo(c.get("db")).lotesPorVencer(suc, c.req.query("vence_antes"));
  return c.json({ lotes });
});

// Fija el stock mínimo de un producto en MI sucursal.
rutasProtegidas.patch("/inventario/:productoId/minimo", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  const body = await leerBody<{ stock_minimo: number }>(c);
  if (!Number.isInteger(body.stock_minimo) || (body.stock_minimo ?? -1) < 0) throw validacion("stock_minimo entero ≥0");
  await inventarioRepo(c.get("db")).fijarMinimo(c.req.param("productoId"), suc, body.stock_minimo!, ahoraIso());
  return c.json({ ok: true });
});

// ---- Recepción de mercadería (idempotente por client_uuid; funciona offline vía cola) ----
rutasProtegidas.post("/recepciones", operadorParaArriba, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  const body = await leerBody<{
    client_uuid: string;
    proveedor: string;
    observaciones: string;
    items: { producto_id: string; numero_lote: string; fecha_vencimiento: string; cantidad: number }[];
  }>(c);
  if (!body.client_uuid) throw validacion("client_uuid requerido");
  if (!Array.isArray(body.items) || body.items.length === 0) throw validacion("items requerido");
  for (const it of body.items) {
    if (!it.producto_id || !it.numero_lote || !/^\d{4}-\d{2}-\d{2}$/.test(it.fecha_vencimiento ?? "")) {
      throw validacion("cada ítem requiere producto_id, numero_lote y fecha_vencimiento (YYYY-MM-DD)");
    }
    if (!Number.isInteger(it.cantidad) || it.cantidad < 1) throw validacion("cantidad de ítem inválida");
  }
  const r = await recepcionRepo(c.get("db")).registrar({
    clientUuid: body.client_uuid,
    sucursalId: suc,
    tenantId: actor.tenantId,
    operadorId: actor.tipo === "usuario" ? actor.usuarioId : null,
    proveedor: body.proveedor ?? null,
    observaciones: body.observaciones ?? null,
    items: body.items.map((i) => ({
      productoId: i.producto_id,
      numeroLote: i.numero_lote,
      fechaVencimiento: i.fecha_vencimiento,
      cantidad: i.cantidad,
    })),
    nowIso: ahoraIso(),
  });
  return c.json({ recepcion_id: r.recepcionId, idempotent: r.idempotent }, r.idempotent ? 200 : 201);
});

// ---- Quiebres (idempotente por client_uuid; funciona offline vía cola) ----
rutasProtegidas.post("/quiebres", operadorParaArriba, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  const body = await leerBody<{ client_uuid: string; producto_id: string | null; gtin_consultado: string | null; descripcion_libre: string | null }>(c);
  if (!body.client_uuid) throw validacion("client_uuid requerido");
  if (!body.producto_id && !body.descripcion_libre?.trim() && !body.gtin_consultado) {
    throw validacion("indica un producto, un código o una descripción");
  }
  const r = await quiebreRepo(c.get("db")).registrar({
    clientUuid: body.client_uuid,
    sucursalId: suc,
    operadorId: actor.tipo === "usuario" ? actor.usuarioId : null,
    productoId: body.producto_id ?? null,
    gtinConsultado: body.gtin_consultado ?? null,
    descripcionLibre: body.descripcion_libre?.trim() || null,
    nowIso: ahoraIso(),
  });
  return c.json({ quiebre_id: r.id, idempotent: r.idempotent }, r.idempotent ? 200 : 201);
});

rutasProtegidas.get("/quiebres", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json({ quiebres: await quiebreRepo(c.get("db")).listar(suc) });
});

// ---- Apertura de cajón sin venta (Δ3 'no_sale'; idempotente por client_uuid, offline vía la cola) ----
// Declaración honesta del operador (abrir para dar vuelto/revisar). Alimenta el indicador EBR
// `cajon_sin_venta`. El operador registra en SU sucursal; el super (que no cobra) elige con ?sucursal_id.
rutasProtegidas.post("/eventos-caja/no-sale", operadorParaArriba, async (c) => {
  const actor = c.get("actor");
  const suc = await sucursalVerificada(c); // verifica que la sucursal del super sea de su tenant (D-N8)
  const body = await leerBody<{ client_uuid: string; motivo?: string | null }>(c);
  if (!body.client_uuid) throw validacion("client_uuid requerido");
  const r = await eventoCajaRepo(c.get("db")).registrarNoSale({
    clientUuid: body.client_uuid,
    sucursalId: suc,
    operadorId: actor.tipo === "usuario" ? actor.usuarioId : null,
    motivo: body.motivo?.trim() || null,
    nowIso: ahoraIso(),
  });
  return c.json({ evento_id: r.id, idempotent: r.idempotent }, r.idempotent ? 200 : 201);
});

// ---- Caja (por sucursal) ----
rutasProtegidas.get("/caja/dia", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  const fecha = c.req.query("fecha") || fechaLocal();
  return c.json(await cajaRepo(c.get("db")).resumenDia(suc, fecha));
});

rutasProtegidas.post("/caja/cierres", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  const body = await leerBody<{ fecha: string; total_efectivo_cent: number; total_yape_cent: number; total_otros_cent: number; observaciones: string }>(c);
  const enteroNoNeg = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!enteroNoNeg(body.total_efectivo_cent ?? 0) || !enteroNoNeg(body.total_yape_cent ?? 0) || !enteroNoNeg(body.total_otros_cent ?? 0)) {
    throw validacion("totales contados en céntimos, enteros ≥0");
  }
  const r = await cajaRepo(c.get("db")).cerrar({
    sucursalId: suc,
    fecha: body.fecha || fechaLocal(),
    totalEfectivoCent: body.total_efectivo_cent ?? 0,
    totalYapeCent: body.total_yape_cent ?? 0,
    totalOtrosCent: body.total_otros_cent ?? 0,
    observaciones: body.observaciones ?? null,
    cerradoPor: actor.tipo === "usuario" ? actor.usuarioId : null,
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

rutasProtegidas.get("/caja/cierres", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json({ cierres: await cajaRepo(c.get("db")).historial(suc, c.req.query("mes")) });
});

// ---- Ventas (§7: batch atómico, idempotente, FEFO cascada) ----
rutasProtegidas.post("/ventas", operadorParaArriba, async (c) => {
  const actor = c.get("actor");
  // La sucursal SALE de la sesión (§7.1); el body NUNCA la trae. Super elige por query.
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);

  const body = await leerBody<{
    client_uuid: string;
    metodo_pago: string;
    items: { producto_id: string; presentacion_id?: string; cantidad: number; precio_sin_igv_unitario_dm: number }[];
    observaciones: string;
    fecha_hora_cliente: string;
    atencion_inicio: string;
    cliente_id: string;
  }>(c);

  if (!body.client_uuid) throw validacion("client_uuid requerido");
  if (!body.metodo_pago || !METODOS.has(body.metodo_pago)) throw validacion("metodo_pago inválido");
  if (!Array.isArray(body.items) || body.items.length === 0) throw validacion("items requerido");
  for (const it of body.items) {
    if (!it.producto_id || !Number.isInteger(it.cantidad) || it.cantidad < 1) throw validacion("ítem inválido");
    if (!Number.isInteger(it.precio_sin_igv_unitario_dm) || it.precio_sin_igv_unitario_dm < 0) {
      throw validacion("precio de ítem inválido");
    }
  }

  const r = await ventaRepo(c.get("db")).registrarVenta({
    clientUuid: body.client_uuid,
    sucursalId: suc,
    operadorId: actor.tipo === "usuario" ? actor.usuarioId : null,
    tenantId: actor.tenantId,
    metodoPago: body.metodo_pago as "efectivo",
    items: body.items.map((i) => ({
      productoId: i.producto_id,
      presentacionId: i.presentacion_id ?? null,
      cantidad: i.cantidad,
      precioSinIgvUnitarioDm: i.precio_sin_igv_unitario_dm,
    })),
    observaciones: body.observaciones ?? null,
    fechaHoraCliente: body.fecha_hora_cliente ?? null,
    atencionInicio: body.atencion_inicio ?? null,
    clienteId: body.cliente_id ?? null,
    nowIso: ahoraIso(),
    ip: c.req.header("cf-connecting-ip") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  });

  return c.json({
    venta_id: r.ventaId,
    idempotent: r.idempotent,
    subtotal_sin_igv_cent: r.resumen.subtotal_sin_igv_cent,
    igv_total_cent: r.resumen.igv_total_cent,
    total_cent: r.resumen.total_cent,
    sucursal_id: r.resumen.sucursal_id,
    fecha_hora_servidor: r.resumen.fecha_hora,
    advertencias: r.advertencias,
  });
});

rutasProtegidas.get("/ventas/:id", requiereUsuario, async (c) => {
  const detalle = await ventaRepo(c.get("db")).obtenerDetalle(c.req.param("id"), c.get("actor"));
  if (!detalle) return c.json({ error: { codigo: "no_encontrado", mensaje: "venta no encontrada" } }, 404);
  return c.json(detalle);
});

rutasProtegidas.post("/ventas/:id/anular", adminOSuper, async (c) => {
  const body = await leerBody<{ motivo: string }>(c);
  const motivo = `${uuidv7()}: ${body.motivo ?? "anulación"}`; // prefijo por request (guarda §7.6)
  await ventaRepo(c.get("db")).anular(c.req.param("id"), c.get("actor"), motivo, ahoraIso());
  return c.json({ ok: true });
});

// Feed de ventas del panel (LECTURA, últimas 40 'completada' con resumen de ítems). super sin
// ?sucursal_id → cadena (todas las sucursales del tenant); super con ?sucursal_id → esa (verificada);
// admin → la suya. NO expone estado de sync (device-local → la UI lo rotula).
rutasProtegidas.get("/ventas", requiereUsuario, async (c) => {
  const actor = c.get("actor");
  const pedida = c.req.query("sucursal_id");
  if (esSuper(actor) && !pedida) {
    return c.json(await ventaRepo(c.get("db")).feed({ tenantId: actor.tenantId }));
  }
  const suc = await sucursalVerificada(c);
  return c.json(await ventaRepo(c.get("db")).feed({ sucursalId: suc }));
});

// ---- Usuarios ----
rutasProtegidas.get("/usuarios", adminOSuper, async (c) => {
  return c.json({ usuarios: await usuarioRepo(c.get("db"), c.get("actor")).listar() });
});

rutasProtegidas.post("/usuarios", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const body = await leerBody<{ nombre: string; email: string; password: string; rol: string; sucursal_id: string }>(c);
  if (!body.nombre || !body.email || !body.password || body.password.length < 8) {
    throw validacion("nombre, email y password (mín. 8) requeridos");
  }
  // admin_sucursal solo crea operadores de SU sucursal; super elige.
  let rol: "operador" | "admin_sucursal" | "super_admin" | "lector_reportes";
  let sucursalId: string | null;
  if (esSuper(actor)) {
    rol = (body.rol as typeof rol) ?? "operador";
    sucursalId = rol === "super_admin" ? null : (body.sucursal_id ?? null);
    if (rol !== "super_admin" && !sucursalId) throw validacion("sucursal_id requerido");
  } else {
    rol = "operador";
    sucursalId = actor.sucursalId;
  }
  const r = await usuarioRepo(c.get("db"), actor).crear({
    nombre: body.nombre,
    email: body.email.trim().toLowerCase(),
    passwordHash: await hashPassword(body.password),
    rol,
    sucursalId,
    nowIso: ahoraIso(),
  });
  return c.json({ id: r.id }, 201);
});

// PATCH usuario (activar/desactivar, reset password, y —super— rol/sucursal/nombre).
rutasProtegidas.patch("/usuarios/:id", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const body = await leerBody<{ activo: boolean; password: string; rol: string; sucursal_id: string | null; nombre: string }>(c);
  const campos: { activo?: boolean; passwordHash?: string; rol?: "operador" | "admin_sucursal" | "super_admin" | "lector_reportes"; sucursalId?: string | null; nombre?: string } = {};
  if (typeof body.activo === "boolean") campos.activo = body.activo;
  if (typeof body.nombre === "string" && body.nombre.trim()) campos.nombre = body.nombre.trim();
  if (typeof body.password === "string") {
    if (body.password.length < 8) throw validacion("password mín. 8");
    campos.passwordHash = await hashPassword(body.password);
  }
  if (esSuper(actor)) {
    if (body.rol !== undefined) campos.rol = body.rol as "operador" | "admin_sucursal" | "super_admin" | "lector_reportes";
    if (body.sucursal_id !== undefined) campos.sucursalId = body.sucursal_id;
  }
  await usuarioRepo(c.get("db"), actor).actualizar(c.req.param("id"), campos, ahoraIso());
  return c.json({ ok: true });
});

// ---- Auditoría (solo super) ----
rutasProtegidas.get("/audit", soloSuperAdmin, async (c) => {
  return c.json({ eventos: await auditRepo(c.get("db"), c.get("actor")).listar() });
});

// ---- Dashboards ----
rutasProtegidas.get("/dashboard/resumen", requiereUsuario, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json(await dashboardRepo(c.get("db")).resumen(suc, leerRango(c.req.query("rango"))));
});

// Consolidado por botica (agregados lado a lado; nunca detalle mezclado) — solo super.
rutasProtegidas.get("/consolidado/resumen", soloSuperAdmin, async (c) => {
  return c.json(await dashboardRepo(c.get("db")).consolidado(c.get("actor").tenantId, leerRango(c.req.query("rango"))));
});

// Portada "Hoy" del panel del dueño (refresh visual). admin → SU sucursal (cadena=null); super →
// cadena + sus boticas del tenant. El "oído" se enriquece aparte con repos/audio.ts (VETO D-N5:
// el SQL de audio_senal vive solo ahí). Aislamiento: el alcance sale del tenant del actor.
rutasProtegidas.get("/hoy/resumen", requiereUsuario, async (c) => {
  const actor = c.get("actor");
  const base = await hoyRepo(c.get("db")).resumen({
    tenantId: actor.tenantId,
    esSuper: esSuper(actor),
    sucursalId: esSuper(actor) ? null : actor.sucursalId, // requiereUsuario ⇒ usuario; admin/lector siempre tienen sucursal
    nowIso: ahoraIso(),
  });
  const idsEnAlcance = base.boticas.map((b) => b.sucursal_id);
  const oido = await audioSenalRepo(c.get("db")).oidoReciente(idsEnAlcance, 2);
  return c.json({ ...base, oido });
});

// ---- Faltantes ----
// Aditivo: cada faltante trae `origen` ('oido'|'manual'|null) desde faltantesRepo; para los de origen
// 'oido' se enriquece con la `frase` del audio (vía repos/audio.ts, para no leer audio_senal fuera de ahí).
rutasProtegidas.get("/faltantes", adminOSuper, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  const faltantes = await faltantesRepo(c.get("db"), c.get("actor")).miBotica(suc);
  const oidoIds = faltantes.filter((f) => f["origen"] === "oido").map((f) => f["producto_id"] as string);
  if (oidoIds.length > 0) {
    const frases = await audioSenalRepo(c.get("db")).frasesFaltantePorProducto(suc, oidoIds);
    for (const f of faltantes) if (f["origen"] === "oido") f["frase"] = frases.get(f["producto_id"] as string) ?? null;
  }
  return c.json({ faltantes });
});

// La ÚNICA operación cross-botica (solo super).
rutasProtegidas.get("/consolidado/faltantes", soloSuperAdmin, async (c) => {
  return c.json(await faltantesRepo(c.get("db"), c.get("actor")).consolidado());
});

// CSV del consolidado (una fila por producto×botica + fila TOTAL) — la lista del pedido al distribuidor.
rutasProtegidas.get("/consolidado/faltantes.csv", soloSuperAdmin, async (c) => {
  const csv = await faltantesRepo(c.get("db"), c.get("actor")).consolidadoCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="faltantes-consolidado.csv"`,
    },
  });
});

// Cierres de caja de TODAS las boticas del tenant (últimas ~3 semanas) — solo super. Aislamiento por
// tenant_id (patrón dashboardRepo.consolidado): jamás cierres de otro tenant.
rutasProtegidas.get("/consolidado/cierres", soloSuperAdmin, async (c) => {
  const desde = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  return c.json(await cajaRepo(c.get("db")).consolidadoCierres(c.get("actor").tenantId, desde));
});

// ---- Proveedores + listas de precios (B8.1) — tenant-scoped ----
rutasProtegidas.get("/proveedores", adminOSuper, async (c) => {
  return c.json({ proveedores: await proveedorRepo(c.get("db"), c.get("actor")).listar() });
});

rutasProtegidas.post("/proveedores", adminOSuper, async (c) => {
  const body = await leerBody<{ nombre: string; ruc: string; contacto: string; monto_minimo_cent: number; flete_cent: number; dias_entrega: number }>(c);
  if (!body.nombre?.trim()) throw validacion("nombre requerido");
  const enteroNoNeg = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) >= 0);
  if (!enteroNoNeg(body.monto_minimo_cent) || !enteroNoNeg(body.flete_cent) || !enteroNoNeg(body.dias_entrega)) {
    throw validacion("monto_minimo_cent, flete_cent y dias_entrega deben ser enteros ≥0");
  }
  const r = await proveedorRepo(c.get("db"), c.get("actor")).crear({
    nombre: body.nombre.trim(),
    ruc: body.ruc?.trim() || null,
    contacto: body.contacto?.trim() || null,
    montoMinimoCent: body.monto_minimo_cent ?? 0,
    fleteCent: body.flete_cent ?? 0,
    diasEntrega: body.dias_entrega ?? null,
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

rutasProtegidas.patch("/proveedores/:id", adminOSuper, async (c) => {
  const body = await leerBody<{ nombre: string; ruc: string | null; contacto: string | null; monto_minimo_cent: number; flete_cent: number; dias_entrega: number | null; activo: boolean }>(c);
  const enteroNoNegOpc = (n: unknown) => n === undefined || n === null || (Number.isInteger(n) && (n as number) >= 0);
  if (!enteroNoNegOpc(body.monto_minimo_cent) || !enteroNoNegOpc(body.flete_cent) || !enteroNoNegOpc(body.dias_entrega)) {
    throw validacion("monto_minimo_cent, flete_cent y dias_entrega deben ser enteros ≥0");
  }
  await proveedorRepo(c.get("db"), c.get("actor")).actualizar(c.req.param("id"), {
    nombre: body.nombre?.trim() || undefined,
    ruc: body.ruc === undefined ? undefined : body.ruc?.trim() || null,
    contacto: body.contacto === undefined ? undefined : body.contacto?.trim() || null,
    montoMinimoCent: body.monto_minimo_cent ?? undefined,
    fleteCent: body.flete_cent ?? undefined,
    diasEntrega: body.dias_entrega === undefined ? undefined : body.dias_entrega,
    activo: typeof body.activo === "boolean" ? body.activo : undefined,
  });
  return c.json({ ok: true });
});

// Listas del tenant (todas o de un proveedor). El matching (B8.2) vive en la sesión S5.
rutasProtegidas.get("/proveedores/listas", adminOSuper, async (c) => {
  return c.json({ listas: await proveedorRepo(c.get("db"), c.get("actor")).listas(c.req.query("proveedor_id") || undefined) });
});

rutasProtegidas.get("/proveedores/listas/:id/items", adminOSuper, async (c) => {
  return c.json(await proveedorRepo(c.get("db"), c.get("actor")).itemsDeLista(c.req.param("id")));
});

// Ingesta de una lista (CSV o pegado TSV de Excel — D-N8): `?dry_run=1` previsualiza sin escribir;
// sin él, comete la lista COMPLETA en un batch atómico. El proveedor debe ser del tenant (404 si no).
rutasProtegidas.post("/proveedores/:id/listas", adminOSuper, async (c) => {
  const body = await leerBody<{ csv: string; etiqueta: string; fecha_lista: string }>(c);
  if (typeof body.csv !== "string" || !body.csv.trim()) throw validacion("csv requerido");
  if (body.csv.length > 2_000_000) throw validacion("archivo demasiado grande (máx ~2 MB)");
  const dryRun = c.req.query("dry_run") === "1";

  let reporte;
  try {
    reporte = validarListaCsv(body.csv);
  } catch (e) {
    if (e instanceof ErrorLista) throw validacion(e.message);
    throw e;
  }

  if (dryRun) {
    // Igual valida que el proveedor exista y sea propio (fallo temprano y aislado).
    await proveedorRepo(c.get("db"), c.get("actor")).verificar(c.req.param("id"));
    return c.json({
      dry_run: true,
      delimitador: reporte.delimitador,
      columnas_detectadas: reporte.columnasDetectadas,
      columnas_ignoradas: reporte.columnasIgnoradas,
      resumen: reporte.resumen,
      muestra: reporte.items.slice(0, 50),
      rechazadas: reporte.rechazadas,
      advertencias: reporte.advertencias,
    });
  }

  const etiqueta = body.etiqueta?.trim();
  if (!etiqueta) throw validacion("etiqueta requerida (ej. \"VES julio 2026\")");
  const fechaLista = body.fecha_lista?.trim() ? parseFecha(body.fecha_lista.trim()) : fechaLocal();
  if (!fechaLista) throw validacion(`fecha_lista inválida: "${body.fecha_lista}" (usa AAAA-MM-DD)`);

  const r = await proveedorRepo(c.get("db"), c.get("actor")).crearLista({
    proveedorId: c.req.param("id"),
    etiqueta: etiqueta.slice(0, 80),
    fechaLista,
    items: reporte.items,
    hoy: fechaLocal(),
    nowIso: ahoraIso(),
  });
  return c.json(
    {
      dry_run: false,
      lista_id: r.id,
      insertadas: r.insertadas,
      resumen: reporte.resumen,
      rechazadas: reporte.rechazadas,
      advertencias: reporte.advertencias,
    },
    201,
  );
});

// ---- Matching de listas (B8.2) — GTIN→alias→nombre→fuzzy; la confirmación aprende alias ----

// Matchea (o re-matchea) una lista contra el catálogo del tenant. Devuelve resumen + pendientes con top-3.
rutasProtegidas.post("/proveedores/listas/:id/matchear", adminOSuper, async (c) => {
  return c.json(await comparadorRepo(c.get("db"), c.get("actor")).matchearLista(c.req.param("id")));
});

// Confirma un match (fija el producto + aprende el alias del proveedor).
rutasProtegidas.post("/proveedores/listas/items/:itemId/confirmar", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const body = await leerBody<{ producto_id: string }>(c);
  if (!body.producto_id?.trim()) throw validacion("producto_id requerido");
  await comparadorRepo(c.get("db"), actor).confirmar(c.req.param("itemId"), body.producto_id.trim(), {
    usuarioId: actor.tipo === "usuario" ? actor.usuarioId : "",
    nowIso: ahoraIso(),
  });
  return c.json({ ok: true });
});

// Descarta un ítem (no lo vendemos).
rutasProtegidas.post("/proveedores/listas/items/:itemId/descartar", adminOSuper, async (c) => {
  await comparadorRepo(c.get("db"), c.get("actor")).descartar(c.req.param("itemId"));
  return c.json({ ok: true });
});

// ---- Pedido (B8.3) — comparador de combos + persistencia + CSV por proveedor ----

// Valida y normaliza el arreglo de necesidades del body.
const leerNecesidades = (raw: unknown): { producto_id: string; nombre: string; unidades_base: number }[] => {
  if (!Array.isArray(raw)) throw validacion("items debe ser un arreglo");
  return raw.map((it, i) => {
    const o = it as { producto_id?: string; nombre?: string; unidades_base?: number };
    if (!o.producto_id || typeof o.producto_id !== "string") throw validacion(`item ${i + 1}: producto_id requerido`);
    if (!Number.isInteger(o.unidades_base) || (o.unidades_base ?? -1) < 0) throw validacion(`item ${i + 1}: unidades_base entero ≥0`);
    return { producto_id: o.producto_id, nombre: (o.nombre ?? "").toString(), unidades_base: o.unidades_base! };
  });
};
const leerAceptarVenc = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);

// Base editable = faltantes de la sucursal (sugerido).
rutasProtegidas.get("/pedidos/base", adminOSuper, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json({ necesidades: await pedidoRepo(c.get("db"), c.get("actor")).necesidadesBase(suc) });
});

// Compara combos (sin persistir): top-3 con delta + productos sin oferta.
rutasProtegidas.post("/pedidos/comparar", adminOSuper, async (c) => {
  const body = await leerBody<{ items: unknown; aceptar_venc_corto: unknown }>(c);
  const necesidades = leerNecesidades(body.items);
  return c.json(await pedidoRepo(c.get("db"), c.get("actor")).comparar(necesidades, leerAceptarVenc(body.aceptar_venc_corto)));
});

// Guarda el pedido para un combo elegido (1–2 proveedores).
rutasProtegidas.post("/pedidos", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  const body = await leerBody<{ items: unknown; aceptar_venc_corto: unknown; proveedor_ids: unknown }>(c);
  const necesidades = leerNecesidades(body.items);
  if (necesidades.length === 0) throw validacion("no hay items en el pedido");
  if (!Array.isArray(body.proveedor_ids) || body.proveedor_ids.length === 0) throw validacion("proveedor_ids requerido (1 o 2)");
  const proveedorIds = body.proveedor_ids.filter((x): x is string => typeof x === "string");
  const r = await pedidoRepo(c.get("db"), actor).crear({
    necesidades,
    aceptarVencCorto: leerAceptarVenc(body.aceptar_venc_corto),
    proveedorIds,
    sucursalId: suc,
    usuarioId: actor.tipo === "usuario" ? actor.usuarioId : "",
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

rutasProtegidas.get("/pedidos", adminOSuper, async (c) => {
  return c.json({ pedidos: await pedidoRepo(c.get("db"), c.get("actor")).listar() });
});

rutasProtegidas.get("/pedidos/:id", adminOSuper, async (c) => {
  return c.json(await pedidoRepo(c.get("db"), c.get("actor")).detalle(c.req.param("id")));
});

rutasProtegidas.patch("/pedidos/:id", adminOSuper, async (c) => {
  const body = await leerBody<{ estado: string }>(c);
  await pedidoRepo(c.get("db"), c.get("actor")).marcarEstado(c.req.param("id"), body.estado ?? "", ahoraIso());
  return c.json({ ok: true });
});

// CSV de la orden para un proveedor del pedido (con neutralización anti-fórmulas).
rutasProtegidas.get("/pedidos/:id/csv", adminOSuper, async (c) => {
  const proveedorId = c.req.query("proveedor_id");
  if (!proveedorId) throw validacion("proveedor_id requerido");
  const csv = await pedidoRepo(c.get("db"), c.get("actor")).csvProveedor(c.req.param("id"), proveedorId);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedido-${c.req.param("id").slice(0, 8)}.csv"`,
    },
  });
});

// ---- Bandeja de recepciones del bot de Telegram (B9 §7.4) — admin+ ----

// Borradores pendientes de MI sucursal (super elige con ?sucursal_id).
rutasProtegidas.get("/recepciones/pendientes", adminOSuper, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json({ pendientes: await recepcionBorradorRepo(c.get("db"), c.get("actor")).pendientes(suc) });
});

// Aprobar → recepción REAL (kardex). Cuerpo opcional: correcciones + nuevo_producto (alta al vuelo).
rutasProtegidas.post("/recepciones/pendientes/:id/aprobar", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const body = await leerBody<{ correcciones: Record<string, unknown>; nuevo_producto: Record<string, unknown> }>(c);
  const np = body.nuevo_producto;
  const opts: Parameters<ReturnType<typeof recepcionBorradorRepo>["aprobar"]>[1] = {
    correcciones: (body.correcciones ?? {}) as Record<string, never>,
    usuarioId: actor.tipo === "usuario" ? actor.usuarioId : "",
    nowIso: ahoraIso(),
  };
  if (np?.nombre) {
    opts.nuevoProducto = {
      nombre: String(np.nombre),
      presentacion: (np.presentacion as string) ?? null,
      laboratorio: (np.laboratorio as string) ?? null,
      principio_activo: (np.principio_activo as string) ?? null,
      categoria: (np.categoria as string) ?? null,
      requiere_receta: !!np.requiere_receta,
      codigo_barras: (np.codigo_barras as string) ?? null,
    };
  }
  const r = await recepcionBorradorRepo(c.get("db"), actor).aprobar(c.req.param("id"), opts);
  return c.json({ ok: true, ...r });
});

rutasProtegidas.post("/recepciones/pendientes/:id/corregir", adminOSuper, async (c) => {
  const body = await leerBody<Record<string, unknown>>(c);
  await recepcionBorradorRepo(c.get("db"), c.get("actor")).corregir(c.req.param("id"), body as Record<string, never>, ahoraIso());
  return c.json({ ok: true });
});

rutasProtegidas.post("/recepciones/pendientes/:id/rechazar", adminOSuper, async (c) => {
  const actor = c.get("actor");
  await recepcionBorradorRepo(c.get("db"), actor).rechazar(c.req.param("id"), actor.tipo === "usuario" ? actor.usuarioId : "", ahoraIso());
  return c.json({ ok: true });
});

// Proxy de una foto del borrador (R2 vía Worker): nunca exponemos claves R2 directas.
rutasProtegidas.get("/recepciones/pendientes/:id/foto/:idx", adminOSuper, async (c) => {
  const idx = Number(c.req.param("idx"));
  const key = await recepcionBorradorRepo(c.get("db"), c.get("actor")).claveFoto(c.req.param("id"), Number.isInteger(idx) ? idx : -1);
  const media = c.env.MEDIA;
  if (!media) throw noEncontrado("foto");
  const obj = await media.get(key);
  if (!obj) throw noEncontrado("foto");
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
});

// ---- Gestión del bot desde la web (B9 §7.1) — admin+ ----

// Genera un código de 6 dígitos (expira 10 min) para vincular un teléfono; queda ligado a MI usuario.
rutasProtegidas.post("/bot/vincular-codigo", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  if (esSuper(actor)) {
    const sucs = await sucursalRepo(c.get("db"), actor).listar();
    if (!sucs.some((s) => s.id === suc)) throw noEncontrado("sucursal");
  }
  const r = await botRepo(c.get("db"), c.env).generarCodigoVinculacion({
    tenantId: actor.tenantId,
    sucursalId: suc,
    usuarioId: actor.tipo === "usuario" ? actor.usuarioId : "",
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

// Chats vinculados del tenant (para ver/gestionar).
rutasProtegidas.get("/bot/chats", adminOSuper, async (c) => {
  return c.json({ chats: await recepcionBorradorRepo(c.get("db"), c.get("actor")).listarChats() });
});

// Desvincular un teléfono (la allowlist deja de responderle).
rutasProtegidas.post("/bot/chats/:chatId/desvincular", adminOSuper, async (c) => {
  await recepcionBorradorRepo(c.get("db"), c.get("actor")).desvincular(c.req.param("chatId"));
  return c.json({ ok: true });
});

// ---- Audio A10 casi-tiempo-real (B10.1 §8) ----

// Sucursal objetivo verificando pertenencia al tenant cuando el actor es super (aislamiento D-N8).
async function sucursalVerificada(c: Context<AppEnv>): Promise<string> {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);
  if (esSuper(actor)) {
    const sucs = await sucursalRepo(c.get("db"), actor).listar();
    if (!sucs.some((s) => s.id === suc)) throw noEncontrado("sucursal");
  }
  return suc;
}

// Grabadores de la sucursal (admin+). Nunca expone el token (solo su hash vive en la D1).
rutasProtegidas.get("/dispositivos", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  return c.json({ dispositivos: await dispositivoRepo(c.get("db"), c.get("actor")).listar(suc) });
});

// Alta de un grabador → devuelve el token EN CLARO una sola vez (se pega en la grabadora del A10).
rutasProtegidas.post("/dispositivos", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ nombre: string }>(c);
  const nombre = body.nombre?.trim().slice(0, 60) || "Grabador A10";
  const token = generarToken();
  const r = await dispositivoRepo(c.get("db"), c.get("actor")).crear({
    sucursalId: suc,
    nombre,
    tokenHash: await hashToken(token),
    nowIso: ahoraIso(),
  });
  return c.json({ id: r.id, nombre, token }, 201);
});

// Kill-switch de un grabador (activo=false corta la grabación sin borrar el dispositivo).
rutasProtegidas.patch("/dispositivos/:id", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ activo: boolean }>(c);
  if (typeof body.activo !== "boolean") throw validacion("activo (boolean) requerido");
  await dispositivoRepo(c.get("db"), c.get("actor")).activar(c.req.param("id"), body.activo, suc);
  return c.json({ ok: true });
});

// Grabaciones recientes de la sucursal (para el panel admin y el estado de la grabadora).
rutasProtegidas.get("/audio", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  return c.json({ grabaciones: await audioSistemaRepo(c.get("db")).recientes(suc, 50) });
});

// Ingesta de un chunk de audio del grabador A10 (auth de DISPOSITIVO, no de usuario). El cuerpo es
// el audio crudo (opus/webm); metadatos por query. Idempotente por client_uuid (= id de la fila y del
// objeto R2) → reintentar tras un corte NO duplica ni re-transcribe. Dispara la transcripción en
// segundo plano (ctx.waitUntil, latencia <2 min); el Cron cada 5 min recoge los 'subido' que queden.
const AUDIO_MAX_BYTES = 8 * 1024 * 1024; // holgado para un chunk de 30 s opus (~120 KB)
const CLIENT_UUID_RE = /^[0-9a-fA-F-]{16,40}$/;

rutasProtegidas.post("/audio", requiereDispositivo, async (c) => {
  const actor = c.get("actor");
  if (actor.tipo !== "dispositivo") throw noEncontrado("dispositivo"); // narrowing (el mw ya lo garantiza)

  const clientUuid = (c.req.query("client_uuid") ?? "").trim();
  if (!CLIENT_UUID_RE.test(clientUuid)) throw validacion("client_uuid requerido (uuid)");
  const grabadoAt = (c.req.query("grabado_at") ?? "").trim() || ahoraIso();
  const durRaw = Number(c.req.query("duracion_seg"));
  const duracionSeg = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) throw validacion("cuerpo de audio vacío");
  if (bytes.byteLength > AUDIO_MAX_BYTES) throw validacion("chunk de audio demasiado grande");

  const repo = audioRepo(c.get("db"), actor);
  // Reintento offline: si ya tengo el chunk, no re-subo a R2 ni re-transcribo.
  if (await repo.existe(clientUuid)) return c.json({ id: clientUuid, idempotent: true }, 200);

  const media = c.env.MEDIA;
  if (!media) throw new ErrorApi(503, "sin_almacenamiento", "almacenamiento de audio no disponible");
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(grabadoAt.slice(0, 10)) ? grabadoAt.slice(0, 10) : ahoraIso().slice(0, 10);
  const r2Key = `audio/${actor.tenantId}/${fecha}/${clientUuid}.webm`;
  await media.put(r2Key, bytes, { httpMetadata: { contentType: c.req.header("content-type") ?? "audio/webm" } });

  const { inserted } = await repo.registrarChunk({ id: clientUuid, r2Key, duracionSeg, grabadoAt, nowIso: ahoraIso() });
  if (!inserted) return c.json({ id: clientUuid, idempotent: true }, 200); // carrera: otro reintento ya insertó

  // Transcripción + extracción de señales en segundo plano (latencia <2 min). Sin ExecutionContext
  // (tests) → se omite; la barredora del Cron transcribe/extrae los pendientes igual.
  try {
    c.executionCtx.waitUntil(procesarAudio(c.get("db"), c.env, clientUuid));
  } catch {
    /* sin ExecutionContext: el Cron transcribe los 'subido' y extrae señales de los 'transcrito' */
  }
  return c.json({ id: clientUuid, idempotent: false }, 201);
});

// ---- Señales del audio (B10.2 §8) — bandeja del Mostrador (badge 🎙️), operador+ ----
// SKU/precio SIEMPRE desde D1; confirmar un faltante crea un quiebre REAL (sin operador, VETO D-N5).

// Señales pendientes de MI sucursal (operador usa la suya; super elige con ?sucursal_id verificado).
rutasProtegidas.get("/audio/senales", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  return c.json({ senales: await audioSenalRepo(c.get("db")).pendientes(suc) });
});

// Confirmar: faltante → quiebre real (alimenta faltantes/consolidado/comparador); venta_posible → confirmado.
// `producto_id` (opcional, faltante) = "corregir": elige el producto correcto → va al quiebre Y se aprende.
rutasProtegidas.post("/audio/senales/:id/confirmar", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ venta_id: string | null; producto_id?: string | null }>(c);
  const r = await audioSenalRepo(c.get("db")).confirmar(c.req.param("id"), suc, {
    nowIso: ahoraIso(),
    ventaId: body.venta_id?.trim() || null,
    productoId: body.producto_id?.trim() || null,
  });
  return c.json({ ok: true, ...r });
});

// Descartar: no era faltante / no aplica.
rutasProtegidas.post("/audio/senales/:id/descartar", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  await audioSenalRepo(c.get("db")).descartar(c.req.param("id"), suc, ahoraIso());
  return c.json({ ok: true });
});

// ---- Reproductor + retención del audio (B10.4.3) — QA del piloto, admin+ ----

// Proxy del chunk de audio (R2 vía el Worker, como el proxy de fotos del bot): nunca exponemos claves
// R2. Scoped por tenant (D-N8: audio de otra botica → 404). La PWA lo baja con Bearer → blob → <audio>.
rutasProtegidas.get("/audio/:id/media", adminOSuper, async (c) => {
  const key = await audioMediaRepo(c.get("db"), c.get("actor")).claveAudio(c.req.param("id"));
  if (!key) throw noEncontrado("audio");
  const media = c.env.MEDIA;
  if (!media) throw noEncontrado("audio");
  const obj = await media.get(key);
  if (!obj) throw noEncontrado("audio"); // ya expiró por el lifecycle de R2, o nunca estuvo
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "audio/webm", "Cache-Control": "private, max-age=3600" },
  });
});

// Purga TODO el audio del tenant (salvaguarda LPDP — Ley 29733: se corre al cerrar la prueba). Borra
// los objetos de R2 + las filas (grabaciones + señales); NO toca los quiebres reales. Solo super.
rutasProtegidas.post("/audio/purgar", soloSuperAdmin, async (c) => {
  const repo = audioMediaRepo(c.get("db"), c.get("actor"));
  const media = c.env.MEDIA;
  const claves = await repo.clavesAudioTenant();
  if (media && claves.length > 0) {
    // R2 borra en lotes de hasta 1000 claves por llamada.
    for (let i = 0; i < claves.length; i += 1000) await media.delete(claves.slice(i, i + 1000));
  }
  const r = await repo.purgarAudioTenant();
  return c.json({ ok: true, ...r, objetos_r2: claves.length });
});

// ---- Calidad del audio (B10.3) — panel admin (admin+) ----

// Reporte de calidad de la sucursal: días (hoy en vivo + snapshots), faltantes sin match, errores.
rutasProtegidas.get("/audio/calidad", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const diasRaw = Number(c.req.query("dias"));
  const dias = Number.isFinite(diasRaw) && diasRaw >= 1 && diasRaw <= 30 ? Math.round(diasRaw) : 7;
  return c.json(await reporteCalidad(c.get("db"), suc, dias));
});

// Correcciones aprendidas del tenant (vocabulario forma-oída → producto; VETO D-N5: sin personal).
rutasProtegidas.get("/audio/correcciones", adminOSuper, async (c) => {
  return c.json({ correcciones: await audioCorreccionRepo(c.get("db"), c.get("actor").tenantId).listar() });
});

// Enseñar una corrección + re-matchear los faltantes pendientes de la sucursal que calzan.
rutasProtegidas.post("/audio/correcciones", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ texto: string; producto_id: string }>(c);
  const texto = (body.texto ?? "").trim();
  const productoId = (body.producto_id ?? "").trim();
  if (!texto) throw validacion("texto requerido");
  if (!productoId) throw validacion("producto_id requerido");
  const r = await audioCorreccionRepo(c.get("db"), c.get("actor").tenantId).enseniar({ texto, productoId, sucursalId: suc, nowIso: ahoraIso() });
  return c.json({ ok: true, ...r });
});

// Borrar una corrección equivocada.
rutasProtegidas.delete("/audio/correcciones/:id", adminOSuper, async (c) => {
  await audioCorreccionRepo(c.get("db"), c.get("actor").tenantId).borrar(c.req.param("id"));
  return c.json({ ok: true });
});

// ---- Casos / EBR (B11.1) — bandeja de excepciones deterministas, admin+ ----
// El sistema INFORMA; el admin confirma/descarta. Aislamiento por sucursal (super elige con ?sucursal_id
// verificado). El VETO D-N5 (repo de casos jamás lee audio) lo hornea veto-audio.test.ts.

const ESTADOS_CASO = new Set(["abierto", "confirmado", "descartado", "autocerrado", "resueltos", "todos"]);

// Bandeja de casos de la sucursal. ?estado= (abierto por defecto; 'resueltos' = los tres terminales;
// 'todos' trae toda la historia). Aditivo: la respuesta ahora también trae `conteos {abiertos,resueltos}`.
rutasProtegidas.get("/casos", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const q = c.req.query("estado");
  const estado = q && ESTADOS_CASO.has(q) ? q : "abierto";
  const filtro = estado === "todos" ? null : estado;
  const repo = casosRepo(c.get("db"));
  const [casos, conteos] = await Promise.all([repo.listar(suc, filtro), repo.contar(suc)]);
  return c.json({ casos, conteos });
});

// Conteos de la bandeja (para las pestañas): { abiertos, resueltos } de la sucursal.
rutasProtegidas.get("/casos/conteo", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  return c.json(await casosRepo(c.get("db")).contar(suc));
});

// Confirmar un caso (es real → queda registrado quién lo revisó y cuándo). Notas opcionales.
rutasProtegidas.post("/casos/:id/confirmar", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ notas?: string }>(c);
  await casosRepo(c.get("db")).resolver(c.req.param("id"), suc, {
    estado: "confirmado",
    revisorId: c.get("actor").tipo === "usuario" ? (c.get("actor") as { usuarioId: string }).usuarioId : null,
    notas: body.notas?.trim() || null,
    nowIso: ahoraIso(),
  });
  return c.json({ ok: true });
});

// Descartar un caso (falso positivo / no aplica).
rutasProtegidas.post("/casos/:id/descartar", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ notas?: string }>(c);
  await casosRepo(c.get("db")).resolver(c.req.param("id"), suc, {
    estado: "descartado",
    revisorId: c.get("actor").tipo === "usuario" ? (c.get("actor") as { usuarioId: string }).usuarioId : null,
    notas: body.notas?.trim() || null,
    nowIso: ahoraIso(),
  });
  return c.json({ ok: true });
});

// Reabrir un caso resuelto → vuelve a 'abierto' y limpia revisor/nota/resuelto_at (idempotente).
// Única escritura nueva aprobada. Scoped por sucursal (aislamiento como el resolver).
rutasProtegidas.post("/casos/:id/reabrir", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  await casosRepo(c.get("db")).reabrir(c.req.param("id"), suc);
  return c.json({ ok: true });
});

// Espejo operativo (B11.2): métricas por operador vs promedio de la MISMA botica. ?dias=7|30 (default 30).
rutasProtegidas.get("/casos/espejo", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const diasRaw = Number(c.req.query("dias"));
  const dias = Number.isFinite(diasRaw) && diasRaw >= 1 && diasRaw <= 90 ? Math.round(diasRaw) : 30;
  return c.json(await espejoRepo(c.get("db")).personal(suc, dias, ahoraIso()));
});

// ---- Conteo de inventario (P5/C3) — conteo cíclico ABC + ajuste de stock + merma_conteo, admin+ ----

// Lista sugerida del día (ABC): productos que "tocan" contar. CIEGA (no expone el stock esperado).
rutasProtegidas.get("/conteos/sugeridos", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const limRaw = Number(c.req.query("limite"));
  const limite = Number.isFinite(limRaw) && limRaw >= 1 && limRaw <= 100 ? Math.round(limRaw) : 20;
  return c.json(await conteoRepo(c.get("db")).sugeridos(suc, { hoyYmd: fechaLocal(), nowIso: ahoraIso(), limite }));
});

// IRA % (exactitud de inventario) del periodo + merma + sesiones recientes. ?dias (default 30).
rutasProtegidas.get("/conteos/resumen", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const diasRaw = Number(c.req.query("dias"));
  const dias = Number.isFinite(diasRaw) && diasRaw >= 1 && diasRaw <= 365 ? Math.round(diasRaw) : 30;
  return c.json(await conteoRepo(c.get("db")).resumen(suc, { dias, nowIso: ahoraIso() }));
});

// Finaliza una hoja de conteo: ajusta stock de los descuadrados + valoriza merma. Idempotente por client_uuid.
rutasProtegidas.post("/conteos", adminOSuper, async (c) => {
  const actor = c.get("actor");
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ client_uuid: string; notas?: string | null; items: { producto_id: string; contado: number }[] }>(c);
  if (!body.client_uuid) throw validacion("client_uuid requerido");
  if (!Array.isArray(body.items) || body.items.length === 0) throw validacion("items requerido");
  const items = body.items.map((it) => {
    if (!it || typeof it.producto_id !== "string" || !it.producto_id) throw validacion("cada ítem requiere producto_id");
    if (!Number.isInteger(it.contado) || it.contado < 0) throw validacion("cada ítem requiere contado (entero ≥0)");
    return { productoId: it.producto_id, contado: it.contado };
  });
  const r = await conteoRepo(c.get("db")).finalizar({
    sucursalId: suc,
    clientUuid: body.client_uuid,
    operadorId: actor.tipo === "usuario" ? actor.usuarioId : null,
    items,
    notas: body.notas?.trim() || null,
    nowIso: ahoraIso(),
  });
  return c.json(r, r.idempotent ? 200 : 201);
});

// Detalle por línea de una sesión de conteo (vista detalle). Scoped (404 si la sesión es ajena).
rutasProtegidas.get("/conteos/:id", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const detalle = await conteoRepo(c.get("db")).detalle(c.req.param("id"), suc);
  if (!detalle) throw noEncontrado("conteo");
  return c.json(detalle);
});

// ============================================================
// P1 — Clientes y seguimiento de tratamiento (plan §12).
//
// Permisos: el OPERADOR crea y lee (es quien atiende el mostrador); EDITAR y BORRAR el perfil es de
// admin. `lector_reportes` queda FUERA incluso de la lectura: acá hay datos personales y de salud
// (DNI, alergias, notas) y ese rol existe para reportes agregados — la minimización de datos que el
// backlog legal (§17) deja anotada empieza por no repartir el padrón a quien no atiende.
//
// Rotulado: en la UI todo esto se llama "Seguimiento", nunca "historia clínica" (§12).
// Toda ruta resuelve la sucursal con `sucursalVerificada(c)`: el id NUNCA sale del body.
// ============================================================

// En un PATCH hay que distinguir "el campo no vino" (no tocar) de "vino en null" (borrar el dato),
// cosa que un `?? null` colapsaría en lo mismo. De ahí el `in` explícito campo por campo más abajo.
// Nada de `String(v)` a ciegas: un `{"alias": {}}` se guardaría como el literal "[object Object]".
// Lo que no es texto ni número se toma como "borrar el dato", nunca como un valor.
const leerTexto = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const leerNumero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
// Campo obligatorio en un POST/PATCH: si no vino como texto, se manda vacío para que la validación
// del repo responda 400 — en vez de que un `.trim()` sobre un objeto reviente en 500.
const leerObligatorio = (v: unknown): string => (typeof v === "string" ? v : "");

rutasProtegidas.get("/clientes", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const limite = Number(c.req.query("limit"));
  const r = await clientesRepo(c.get("db")).listar(suc, {
    limite: Number.isFinite(limite) && limite > 0 ? limite : undefined,
    cursor: c.req.query("cursor") ?? null,
  });
  return c.json({ ...r, sucursal_id: suc });
});

// Búsqueda del mostrador (nombre, alias, teléfono o DNI). Se registra ANTES que las rutas con
// parámetro para que "buscar" no se lea como un id de cliente.
rutasProtegidas.get("/clientes/buscar", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const limite = Number(c.req.query("limit"));
  const clientes = await clientesRepo(c.get("db")).buscar(
    suc,
    c.req.query("q") ?? "",
    Number.isFinite(limite) && limite > 0 ? limite : 20,
  );
  return c.json({ clientes, sucursal_id: suc });
});

// Cumpleaños de la semana (§12: gesto comercial). Va acá y no en el dashboard porque son NOMBRES de
// personas del padrón: el mismo permiso que el resto de `/clientes` (operador+; `lector_reportes` no).
// El panel del dueño y el Mostrador lo consumen desde esta misma ruta, cada uno con su sesión.
// Se registra ANTES de las rutas con `:id` para que "cumpleanos" no se lea como un id.
rutasProtegidas.get("/clientes/cumpleanos", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const dias = Number(c.req.query("dias"));
  const limite = Number(c.req.query("limit"));
  const r = await clientesRepo(c.get("db")).cumpleanos(suc, {
    hoyYmd: fechaLocal(),
    dias: Number.isFinite(dias) && dias > 0 ? dias : undefined,
    limite: Number.isFinite(limite) && limite > 0 ? limite : undefined,
  });
  return c.json({ ...r, sucursal_id: suc });
});

// Alta rápida: con el nombre alcanza (§12 — "nombre + teléfono en 10 segundos"). El DNI es opcional
// pero único dentro de la botica: si se repite, 409.
rutasProtegidas.post("/clientes", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{
    nombre: string;
    alias: string;
    dni: string;
    telefono: string;
    whatsapp: string;
    optin_whatsapp: boolean;
    fecha_nacimiento: string;
    alergias: string;
    notas: string;
  }>(c);
  if (!leerObligatorio(body.nombre).trim()) throw validacion("nombre requerido");

  const cliente = await clientesRepo(c.get("db")).crear({
    sucursalId: suc,
    nombre: leerObligatorio(body.nombre),
    alias: body.alias ?? null,
    dni: body.dni ?? null,
    telefono: body.telefono ?? null,
    whatsapp: body.whatsapp ?? null,
    optinWhatsapp: body.optin_whatsapp === true,
    fechaNacimiento: body.fecha_nacimiento ?? null,
    alergias: body.alergias ?? null,
    notas: body.notas ?? null,
    nowIso: ahoraIso(),
  });
  return c.json({ cliente }, 201);
});

// Panel de seguimiento: lo que ve quien atiende al reconocer al cliente (§12).
rutasProtegidas.get("/clientes/:id/panel", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const limite = Number(c.req.query("limit_compras"));
  const panel = await clientesRepo(c.get("db")).panel(c.req.param("id"), suc, {
    hoyYmd: fechaLocal(),
    limiteCompras: Number.isFinite(limite) && limite > 0 ? limite : undefined,
  });
  if (!panel) throw noEncontrado("cliente");
  return c.json(panel);
});

// Edición del perfil: admin (§12 "admin edita/borra").
rutasProtegidas.patch("/clientes/:id", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<Record<string, unknown>>(c);
  const campos: CamposCliente = {};
  if ("nombre" in body) campos.nombre = leerObligatorio(body.nombre);
  if ("alias" in body) campos.alias = leerTexto(body.alias);
  if ("dni" in body) campos.dni = leerTexto(body.dni);
  if ("telefono" in body) campos.telefono = leerTexto(body.telefono);
  if ("whatsapp" in body) campos.whatsapp = leerTexto(body.whatsapp);
  if ("optin_whatsapp" in body) campos.optinWhatsapp = body.optin_whatsapp === true;
  if ("fecha_nacimiento" in body) campos.fechaNacimiento = leerTexto(body.fecha_nacimiento);
  if ("alergias" in body) campos.alergias = leerTexto(body.alergias);
  if ("notas" in body) campos.notas = leerTexto(body.notas);
  if ("rostro_codigo" in body) campos.rostroCodigo = leerTexto(body.rostro_codigo);

  const cliente = await clientesRepo(c.get("db")).actualizar(c.req.param("id"), suc, campos, ahoraIso());
  return c.json({ cliente });
});

// Borrado lógico: admin. El histórico de ventas NO se toca (siguen apuntando a este id).
rutasProtegidas.delete("/clientes/:id", adminOSuper, async (c) => {
  const suc = await sucursalVerificada(c);
  await clientesRepo(c.get("db")).eliminar(c.req.param("id"), suc, ahoraIso());
  return c.json({ ok: true });
});

// Para quién más compra este cliente ("ibuprofeno para el hijo"). Sin esta ruta `tratamiento.familiar_id`
// sería inalcanzable y el flujo del §12 no se podría registrar completo.
rutasProtegidas.post("/clientes/:id/familiares", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{ nombre: string; relacion: string; notas: string }>(c);
  if (!leerObligatorio(body.nombre).trim()) throw validacion("nombre requerido");
  const familiar = await clientesRepo(c.get("db")).agregarFamiliar(c.req.param("id"), suc, {
    nombre: leerObligatorio(body.nombre),
    relacion: body.relacion ?? null,
    notas: body.notas ?? null,
    nowIso: ahoraIso(),
  });
  return c.json({ familiar }, 201);
});

// Registro del seguimiento al dispensar. `indicacion_seguimiento` es lo que hay que PREGUNTAR la
// próxima vez — el recordatorio sale de ahí más la regla de días, sin ningún modelo de por medio.
rutasProtegidas.post("/clientes/:id/tratamientos", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<{
    familiar_id: string;
    venta_id: string;
    producto_id: string;
    descripcion: string;
    duracion_dias: number;
    dosis_diaria: number;
    cantidad_dispensada: number;
    indicacion_seguimiento: string;
    fecha_inicio: string;
  }>(c);
  if (!leerObligatorio(body.descripcion).trim()) throw validacion("descripcion requerida");

  const r = await clientesRepo(c.get("db")).crearTratamiento(c.req.param("id"), suc, {
    familiarId: body.familiar_id ?? null,
    ventaId: body.venta_id ?? null,
    productoId: body.producto_id ?? null,
    descripcion: leerObligatorio(body.descripcion),
    duracionDias: body.duracion_dias ?? null,
    dosisDiaria: body.dosis_diaria ?? null,
    cantidadDispensada: body.cantidad_dispensada ?? null,
    indicacionSeguimiento: body.indicacion_seguimiento ?? null,
    fechaInicio: body.fecha_inicio ?? fechaLocal(),
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
});

// Cerrar o corregir un seguimiento. Es `operadorParaArriba` y no admin a propósito: cerrar el
// seguimiento es el acto de mostrador que remata el flujo del §12 ("ya le pregunté, está bien"). El
// veto de edición de §12 es sobre el PERFIL del cliente, no sobre el seguimiento del día.
rutasProtegidas.patch("/clientes/:id/tratamientos/:tratamientoId", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const body = await leerBody<Record<string, unknown>>(c);
  const campos: CamposTratamiento = {};
  if ("descripcion" in body) campos.descripcion = leerObligatorio(body.descripcion);
  if ("duracion_dias" in body) campos.duracionDias = leerNumero(body.duracion_dias);
  if ("dosis_diaria" in body) campos.dosisDiaria = leerNumero(body.dosis_diaria);
  if ("cantidad_dispensada" in body) campos.cantidadDispensada = leerNumero(body.cantidad_dispensada);
  if ("indicacion_seguimiento" in body) campos.indicacionSeguimiento = leerTexto(body.indicacion_seguimiento);
  if ("estado" in body) campos.estado = body.estado as "activo" | "cerrado";

  await clientesRepo(c.get("db")).actualizarTratamiento(
    c.req.param("tratamientoId"),
    c.req.param("id"),
    suc,
    campos,
    ahoraIso(),
  );
  return c.json({ ok: true });
});

// "¿A quién le toca hoy?" — la lista del día. `proximos_dias` adelanta la ventana para preparar las
// llamadas del resto de la semana.
rutasProtegidas.get("/seguimientos/pendientes", operadorParaArriba, async (c) => {
  const suc = await sucursalVerificada(c);
  const proximos = Number(c.req.query("proximos_dias"));
  const limite = Number(c.req.query("limit"));
  const r = await clientesRepo(c.get("db")).pendientes(suc, {
    hoyYmd: fechaLocal(),
    proximosDias: Number.isFinite(proximos) && proximos > 0 ? proximos : 0,
    limite: Number.isFinite(limite) && limite > 0 ? limite : undefined,
  });
  return c.json({ ...r, sucursal_id: suc });
});
