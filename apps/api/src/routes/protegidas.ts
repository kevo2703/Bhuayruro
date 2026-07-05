import { Hono } from "hono";
import { uuidv7 } from "@huayruro/shared";
import { noEncontrado, validacion } from "../lib/errores";
import { ahoraIso } from "../lib/fecha";
import { leerBody } from "../lib/http";
import { hashPassword } from "../lib/password";
import { esSuper, sucursalObjetivo } from "../lib/scope";
import { requiereAuth } from "../mw/auth";
import { adminOSuper, operadorParaArriba, requiereUsuario, soloSuperAdmin } from "../mw/roles";
import { auditRepo, faltantesRepo, usuarioRepo } from "../repos/admin";
import { cajaRepo } from "../repos/caja";
import { precioRepo, productoRepo } from "../repos/catalogo";
import { dashboardRepo, type Rango } from "../repos/dashboard";
import { inventarioRepo } from "../repos/inventario";
import { quiebreRepo } from "../repos/quiebre";
import { recepcionRepo } from "../repos/recepcion";
import { sucursalRepo } from "../repos/sucursal";
import { ventaRepo } from "../repos/venta";
import { fechaLocal } from "../lib/fecha";
import type { AppEnv } from "../types";

const METODOS = new Set(["efectivo", "yape", "plin", "tarjeta", "transferencia", "otro"]);
const RANGOS = new Set(["hoy", "7d", "30d"]);
const leerRango = (v?: string): Rango => (v && RANGOS.has(v) ? (v as Rango) : "7d");

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
  const body = await leerBody<{ nombre: string; direccion: string; activa: boolean }>(c);
  await sucursalRepo(c.get("db"), c.get("actor")).actualizar(c.req.param("id"), {
    nombre: body.nombre,
    direccion: body.direccion === undefined ? undefined : body.direccion?.trim() || null,
    activa: typeof body.activa === "boolean" ? body.activa : undefined,
  });
  return c.json({ ok: true });
});

// ---- Catálogo (compartido a nivel tenant) ----
rutasProtegidas.get("/catalogo/productos", requiereUsuario, async (c) => {
  const productos = await productoRepo(c.get("db"), c.get("actor")).listar(c.req.query("q"));
  return c.json({ productos });
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

rutasProtegidas.post("/catalogo/productos", adminOSuper, async (c) => {
  const body = await leerBody<{
    nombre: string; presentacion: string; laboratorio: string; principio_activo: string; categoria: string; requiere_receta: boolean;
  }>(c);
  if (!body.nombre || !body.nombre.trim()) throw validacion("nombre requerido");
  const r = await productoRepo(c.get("db"), c.get("actor")).crear({
    nombre: body.nombre.trim(),
    presentacion: body.presentacion?.trim() || null,
    laboratorio: body.laboratorio?.trim() || null,
    principio_activo: body.principio_activo?.trim() || null,
    categoria: body.categoria?.trim() || null,
    requiere_receta: body.requiere_receta ? 1 : 0,
    nowIso: ahoraIso(),
  });
  return c.json(r, 201);
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

// ---- Faltantes ----
rutasProtegidas.get("/faltantes", adminOSuper, async (c) => {
  const suc = sucursalObjetivo(c.get("actor"), c.req.query("sucursal_id"));
  return c.json({ faltantes: await faltantesRepo(c.get("db"), c.get("actor")).miBotica(suc) });
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
