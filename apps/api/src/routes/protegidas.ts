import { Hono } from "hono";
import { calcularCabecera, uuidv7 } from "@huayruro/shared";
import { validacion } from "../lib/errores";
import { ahoraIso } from "../lib/fecha";
import { leerBody } from "../lib/http";
import { hashPassword } from "../lib/password";
import { esSuper, sucursalObjetivo } from "../lib/scope";
import { requiereAuth } from "../mw/auth";
import { adminOSuper, operadorParaArriba, requiereUsuario, soloSuperAdmin } from "../mw/roles";
import { auditRepo, faltantesRepo, usuarioRepo } from "../repos/admin";
import { precioRepo, productoRepo } from "../repos/catalogo";
import { inventarioRepo } from "../repos/inventario";
import { sucursalRepo } from "../repos/sucursal";
import { ventaRepo } from "../repos/venta";
import type { AppEnv } from "../types";

const METODOS = new Set(["efectivo", "yape", "plin", "tarjeta", "transferencia", "otro"]);

export const rutasProtegidas = new Hono<AppEnv>();

// Toda ruta protegida pasa por la resolución de sesión.
rutasProtegidas.use("*", requiereAuth);

// ---- Sucursales ----
rutasProtegidas.get("/sucursales", requiereUsuario, async (c) => {
  return c.json({ sucursales: await sucursalRepo(c.get("db"), c.get("actor")).listar() });
});

// ---- Catálogo (compartido a nivel tenant) ----
rutasProtegidas.get("/catalogo/productos", requiereUsuario, async (c) => {
  const productos = await productoRepo(c.get("db"), c.get("actor")).listar(c.req.query("q"));
  return c.json({ productos });
});

// ---- Precios (por sucursal) ----
rutasProtegidas.get("/precios", requiereUsuario, async (c) => {
  const actor = c.get("actor");
  const suc = sucursalObjetivo(actor, c.req.query("sucursal_id"));
  const precios = await precioRepo(c.get("db")).listar(suc, c.req.query("producto_id"));
  return c.json({ precios });
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

// ---- Ventas (S1 MINIMAL: cabecera; el batch §7.3 completo llega en S2/E6) ----
rutasProtegidas.post("/ventas", operadorParaArriba, async (c) => {
  const actor = c.get("actor");
  // La sucursal SALE de la sesión (§7.1); el body NUNCA la trae. Super elige por query.
  const suc = sucursalObjetivo(actor, esSuper(actor) ? c.req.query("sucursal_id") : null);

  const body = await leerBody<{
    client_uuid: string;
    metodo_pago: string;
    items: { producto_id: string; cantidad: number; precio_sin_igv_unitario_dm: number }[];
    observaciones: string;
    fecha_hora_cliente: string;
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

  const cab = calcularCabecera(
    body.items.map((i) => ({ cantidad: i.cantidad, precioSinIgvUnitarioDm: i.precio_sin_igv_unitario_dm })),
  );

  const r = await ventaRepo(c.get("db")).crearCabeceraMinima({
    vId: uuidv7(),
    clientUuid: body.client_uuid,
    sucursalId: suc,
    operadorId: actor.tipo === "usuario" ? actor.usuarioId : null,
    nowIso: ahoraIso(),
    cab,
    metodoPago: body.metodo_pago as "efectivo",
    observaciones: body.observaciones ?? null,
    fechaHoraCliente: body.fecha_hora_cliente ?? null,
  });

  return c.json({
    venta_id: r.ventaId,
    idempotent: r.idempotent,
    subtotal_sin_igv_cent: r.resumen.subtotal_sin_igv_cent,
    igv_total_cent: r.resumen.igv_total_cent,
    total_cent: r.resumen.total_cent,
    sucursal_id: r.resumen.sucursal_id,
    fecha_hora_servidor: r.resumen.fecha_hora,
    advertencias: [] as string[],
  });
});

rutasProtegidas.get("/ventas/:id", requiereUsuario, async (c) => {
  const venta = await ventaRepo(c.get("db")).obtener(c.req.param("id"), c.get("actor"));
  if (!venta) return c.json({ error: { codigo: "no_encontrado", mensaje: "venta no encontrada" } }, 404);
  return c.json({ venta });
});

rutasProtegidas.post("/ventas/:id/anular", adminOSuper, async (c) => {
  const body = await leerBody<{ motivo: string }>(c);
  const motivo = `${uuidv7()}: ${body.motivo ?? "anulación"}`; // prefijo por request (guarda §7.6)
  await ventaRepo(c.get("db")).anularMinima(c.req.param("id"), c.get("actor"), motivo, ahoraIso());
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

// ---- Auditoría (solo super) ----
rutasProtegidas.get("/audit", soloSuperAdmin, async (c) => {
  return c.json({ eventos: await auditRepo(c.get("db"), c.get("actor")).listar() });
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
