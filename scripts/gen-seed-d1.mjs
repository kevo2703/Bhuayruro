// Generador del seed §5.6 → apps/api/seeds/0001_seed_p0.sql
// Determinista (UUIDs fijos), hashes PBKDF2 reales (mismo algoritmo que src/lib/password.ts),
// igv_dm/precio_total_dm derivados con la aritmética exacta del §6.2 (half-up).
// Uso: node scripts/gen-seed-d1.mjs   (regenera el .sql; luego wrangler d1 execute --file)
import { writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const TS = "2026-07-04T00:00:00.000Z";
const rnd = (a, b) => (2n * a + b) / (2n * b); // round(a/b) half-up

// ---- PBKDF2 idéntico a src/lib/password.ts (100000 iter, salt 16B, key 32B) ----
// 100000 = tope de Cloudflare Workers en prod (no subir; ver nota en src/lib/password.ts).
async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256),
  );
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

// ---- Datos §5.6 ----
const TENANT = "10000000-0000-7000-8000-000000000001";
const SUC = {
  ves: "20000000-0000-7000-8000-0000000000a1",
  chzp: "20000000-0000-7000-8000-0000000000a2",
  chzl: "20000000-0000-7000-8000-0000000000a3",
};
const productos = [
  ["Postday", "Caja x 1 tab", "Lafrancol", "Levonorgestrel 1.5 mg", "Anticonceptivo emergencia", 0, 20000, 127119, "7790001000017"],
  ["Portil Crema", "Tubo 20 g", "Farmindustria", "Mometasona furoato 0.1%", "Dermatológico", 0, 22000, 50847, "7790001000024"],
  ["Sildex 50 mg", "Caja x 1 tab", "Genfar", "Sildenafilo 50 mg", "Disfunción eréctil", 0, 12000, 42373, "7790001000031"],
  ["Paracetamol 500 mg", "Tableta unidad", "Genérico Mifarma", "Paracetamol 500 mg", "Analgésico", 0, 3000, 12712, "7790001000048"],
  ["Ibuprofeno 400 mg", "Tableta unidad", "Genérico Mifarma", "Ibuprofeno 400 mg", "Antiinflamatorio", 0, 4000, 15254, "7790001000055"],
  ["Diclofenaco Gel", "Tubo 30 g", "Bayer", "Diclofenaco dietilamonio 1.16%", "Antiinflamatorio tópico", 0, 40000, 101695, "7790001000062"],
  ["Loratadina 10 mg", "Tableta unidad", "Genérico Inkafarma", "Loratadina 10 mg", "Antihistamínico", 0, 5000, 16949, "7790001000079"],
  ["Omeprazol 20 mg", "Cápsula unidad", "Genérico Mifarma", "Omeprazol 20 mg", "Antiulceroso", 0, 4000, 16949, "7790001000086"],
  ["Bromhexina Jarabe", "Frasco 120 ml", "Boehringer", "Bromhexina 4 mg/5 ml", "Mucolítico", 0, 30000, 67797, "7790001000093"],
  ["Amoxicilina 500 mg", "Cápsula unidad", "Genérico Medifarma", "Amoxicilina 500 mg", "Antibiótico", 1, 8000, 25424, "7790001000109"],
];
const sucursales = [SUC.ves, SUC.chzp, SUC.chzl];

const q = (s) => (s === null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const pad = (n, w = 2) => String(n).padStart(w, "0");
const id = (pfx, i, j = 0) => `${pfx}-0000-7000-8000-${pad(i, 4)}${pad(j, 8)}`;

const L = [];
L.push("-- Seed §5.6 (SINTÉTICO: 10 SKU demo + 4 usuarios placeholder). Generado por scripts/gen-seed-d1.mjs.");
L.push("-- Idempotente-ish: pensado para una D1 recién migrada. NO es el catálogo real VES (eso es T-K4/E12).");
L.push("");

L.push(`INSERT INTO tenant (id, nombre, nombre_comercial, created_at, updated_at) VALUES`);
L.push(`  (${q(TENANT)}, 'Cadena Botica Huayruro', 'Botica Huayruro', ${q(TS)}, ${q(TS)});`);
L.push("");

L.push(`INSERT INTO sucursal (id, tenant_id, nombre, direccion, created_at, updated_at) VALUES`);
L.push(`  (${q(SUC.ves)}, ${q(TENANT)}, 'Huayruro VES', 'Av. Revolución × Av. Las Lomas, Villa El Salvador, Lima', ${q(TS)}, ${q(TS)}),`);
L.push(`  (${q(SUC.chzp)}, ${q(TENANT)}, 'Huayruro Chazuta Puerto', 'Chazuta — Puerto, San Martín', ${q(TS)}, ${q(TS)}),`);
L.push(`  (${q(SUC.chzl)}, ${q(TENANT)}, 'Huayruro Chazuta Plaza', 'Chazuta — Plaza, San Martín', ${q(TS)}, ${q(TS)});`);
L.push("");

// Productos + FTS + presentaciones (base + blíster) + códigos de barras
const prodRows = [], ftsRows = [], presRows = [], cbRows = [];
productos.forEach((p, i) => {
  const [nombre, presentacion, lab, principio, categoria, receta, , , gtin] = p;
  const pid = id("30000000", i + 1);
  const presBase = id("40000000", i + 1, 1); // factor 1, es_base
  const presBlister = id("41000000", i + 1, 1); // factor 10
  const cbid = id("50000000", i + 1);
  prodRows.push(
    `  (${q(pid)}, ${q(TENANT)}, ${q(nombre)}, ${q(presentacion)}, ${q(lab)}, ${q(principio)}, ${q(categoria)}, ${receta}, ${q(TS)}, ${q(TS)})`,
  );
  ftsRows.push(`  (${q(pid)}, ${q(`${nombre} ${principio} ${lab} ${categoria}`)})`);
  presRows.push(`  (${q(presBase)}, ${q(pid)}, 'unidad', 1, 1, ${q(TS)})`);
  presRows.push(`  (${q(presBlister)}, ${q(pid)}, 'blíster x10', 10, 0, ${q(TS)})`);
  cbRows.push(`  (${q(cbid)}, ${q(pid)}, ${q(presBase)}, ${q(gtin)}, ${q(TS)})`);
});
L.push(`INSERT INTO producto_catalogo (id, tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, created_at, updated_at) VALUES`);
L.push(prodRows.join(",\n") + ";");
L.push("");
L.push(`INSERT INTO producto_fts (producto_id, texto) VALUES`);
L.push(ftsRows.join(",\n") + ";");
L.push("");
L.push(`INSERT INTO presentacion (id, producto_id, nombre, factor_unidades, es_base, created_at) VALUES`);
L.push(presRows.join(",\n") + ";");
L.push("");
L.push(`INSERT INTO codigo_barras (id, producto_id, presentacion_id, gtin, created_at) VALUES`);
L.push(cbRows.join(",\n") + ";");
L.push("");

// Precios (base) + inventario 50u + 1 lote/inventario con vencimiento escalonado
const precioRows = [], invRows = [], loteRows = [];
productos.forEach((p, i) => {
  const [, , , , , , compraDm, sinIgvDm] = p;
  const pid = id("30000000", i + 1);
  const presBase = id("40000000", i + 1, 1);
  const S = BigInt(sinIgvDm);
  const igvDm = Number(rnd(S * 18n, 100n));
  const totalDm = Number(rnd(S * 118n, 100n));
  sucursales.forEach((suc, j) => {
    const precioId = id("60000000", i + 1, j + 1);
    const invId = id("70000000", i + 1, j + 1);
    const loteId = id("80000000", i + 1, j + 1);
    // vencimiento escalonado: mes 8..(8+prod), por sucursal desplazado
    const mes = 8 + ((i + j) % 5);
    const venc = `2026-${pad(mes)}-15`;
    precioRows.push(
      `  (${q(precioId)}, ${q(pid)}, ${q(suc)}, ${q(presBase)}, ${compraDm}, ${sinIgvDm}, ${igvDm}, ${totalDm}, ${q(TS)}, ${q(TS)})`,
    );
    invRows.push(`  (${q(invId)}, ${q(suc)}, ${q(pid)}, 50, 10, ${q(TS)})`);
    loteRows.push(
      `  (${q(loteId)}, ${q(invId)}, 'L-${pad(i + 1)}${pad(j + 1)}', ${q(venc)}, 50, 'Proveedor Demo', ${q(TS)}, ${q(TS)}, ${q(TS)})`,
    );
  });
});
L.push(`INSERT INTO precio_local (id, producto_id, sucursal_id, presentacion_id, precio_compra_dm, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, created_at) VALUES`);
L.push(precioRows.join(",\n") + ";");
L.push("");
L.push(`INSERT INTO inventario_local (id, sucursal_id, producto_id, stock_unidades, stock_minimo, updated_at) VALUES`);
L.push(invRows.join(",\n") + ";");
L.push("");
L.push(`INSERT INTO lote (id, inventario_id, numero_lote, fecha_vencimiento, unidades, proveedor, fecha_recepcion, created_at, updated_at) VALUES`);
L.push(loteRows.join(",\n") + ";");
L.push("");

// 4 usuarios (passwords temporales dev; se cambian en el primer login)
const passwords = {
  super: "HuayruroSuper.2026",
  ves: "HuayruroVes.2026",
  chzp: "HuayruroChzP.2026",
  chzl: "HuayruroChzL.2026",
};
const [hSuper, hVes, hChzp, hChzl] = await Promise.all([
  hashPassword(passwords.super),
  hashPassword(passwords.ves),
  hashPassword(passwords.chzp),
  hashPassword(passwords.chzl),
]);
const U = (n, suc, rol, nombre, email, hash) =>
  `  (${q(id("90000000", n))}, ${q(TENANT)}, ${suc ? q(suc) : "NULL"}, ${q(rol)}, ${q(nombre)}, ${q(email)}, ${q(hash)}, ${q(TS)}, ${q(TS)})`;
L.push(`INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email, password_hash, created_at, updated_at) VALUES`);
L.push(
  [
    U(1, null, "super_admin", "Kevin (super)", "kevin@huayruro.local", hSuper),
    U(2, SUC.ves, "admin_sucursal", "Kevin (VES)", "admin.ves@huayruro.local", hVes),
    U(3, SUC.chzp, "admin_sucursal", "Papá (Chazuta Puerto)", "admin.chzp@huayruro.local", hChzp),
    U(4, SUC.chzl, "admin_sucursal", "Mamá (Chazuta Plaza)", "admin.chzl@huayruro.local", hChzl),
  ].join(",\n") + ";",
);
L.push("");
L.push("-- Passwords temporales dev (cambiar en el primer login):");
for (const [k, v] of Object.entries(passwords)) L.push(`--   ${k}: ${v}`);
L.push("");

writeFileSync(new URL("../apps/api/seeds/0001_seed_p0.sql", import.meta.url), L.join("\n"));
console.log("seed escrito: apps/api/seeds/0001_seed_p0.sql");
console.log("verificación esperada: productos=10 · precios=30 · inventario=30 · lotes=30 · presentaciones=20 · usuarios=4");
