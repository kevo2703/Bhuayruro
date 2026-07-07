// Generador del catálogo maestro nacional (B7.1) → apps/api/seeds/0002_catalogo_maestro.sql
// Lee apps/api/seeds/fuentes/CATALOGO_GTIN_v4.xlsx (SUSALUD Datos Abiertos, 15,181 × 14 cols,
// act. 11-abr-2025) SIN dependencias: un XLSX es un zip (inflateRawSync) con XML plano.
// nombre_norm usa normalizarNombre() del shared — LA MISMA función del importador/matching
// (Node ≥23 importa el .ts puro con type-stripping; por eso normalizar.ts no tiene imports).
//
// Uso: node scripts/gen-catalogo-maestro.mjs
// Carga: wrangler d1 execute huayruro-db --local|--remote --file ./seeds/0002_catalogo_maestro.sql
//
// Nota EAN13: el plan preveía enriquecer UNIDADENVASE vacíos con CATALOGO_EAN13.csv (2021);
// verificado 2026-07-07: las 15,181 filas traen UNIDADENVASE numérico → el cruce no hace falta.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { normalizarNombre } from "../packages/shared/src/catalogo/normalizar.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX = join(RAIZ, "apps/api/seeds/fuentes/CATALOGO_GTIN_v4.xlsx");
const SALIDA = join(RAIZ, "apps/api/seeds/0002_catalogo_maestro.sql");
const FILAS_ESPERADAS = 15181; // dimensión verificada de la fuente (gate B7: COUNT debe dar esto)
const LOTE = 300; // filas por INSERT multi-VALUES (D1 corta statements >100 KB: 500 filas ≈ 120 KB dio SQLITE_TOOBIG)

// ---- mini-lector ZIP (solo lo que un XLSX necesita: entradas deflate/stored) ----
function leerZip(buf) {
  // End Of Central Directory: firma 0x06054b50, escaneada desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP corrupto: sin End Of Central Directory");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset del central directory
  const entradas = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP corrupto: entrada central inválida");
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lenNombre = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + lenNombre);
    entradas.set(nombre, { metodo, tamComp, offLocal });
    p += 46 + lenNombre + lenExtra + lenComent;
  }
  return (nombre) => {
    const e = entradas.get(nombre);
    if (!e) throw new Error(`ZIP: no existe ${nombre}`);
    // Cabecera local: los largos de nombre/extra pueden diferir de los del central directory.
    const ln = buf.readUInt16LE(e.offLocal + 26);
    const le = buf.readUInt16LE(e.offLocal + 28);
    const ini = e.offLocal + 30 + ln + le;
    const datos = buf.subarray(ini, ini + e.tamComp);
    if (e.metodo === 8) return inflateRawSync(datos);
    if (e.metodo === 0) return Buffer.from(datos);
    throw new Error(`ZIP: método de compresión ${e.metodo} no soportado`);
  };
}

// ---- XML de hoja de cálculo (sharedStrings + celdas por referencia A1) ----
const desescapar = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

function leerSharedStrings(xml) {
  const sst = [];
  const reSi = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = reSi.exec(xml))) {
    let texto = "";
    const reT = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = reT.exec(m[1]))) texto += desescapar(t[1]);
    sst.push(texto);
  }
  return sst;
}

const colIdx = (letras) => {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function leerFilas(xml, sst) {
  const filas = [];
  const reRow = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = reRow.exec(xml))) {
    const celdas = [];
    // Celdas con contenido; las autocerradas (<c .../>) se quedan undefined (fila dispersa).
    const reC = /<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g;
    let c;
    while ((c = reC.exec(m[1]))) {
      const inner = c[3];
      const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
      let val = "";
      if (is) {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(is[1]);
        val = t ? desescapar(t[1]) : "";
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v) val = /t="s"/.test(c[2]) ? sst[Number(v[1])] : desescapar(v[1]);
      }
      celdas[colIdx(c[1])] = val;
    }
    filas.push(celdas);
  }
  return filas;
}

// ---- lectura + validación de la fuente ----
const zip = leerZip(readFileSync(XLSX));
const sst = leerSharedStrings(zip("xl/sharedStrings.xml").toString("utf8"));
const filas = leerFilas(zip("xl/worksheets/sheet1.xml").toString("utf8"), sst);

const CABECERA = [
  "CODIGO", "TIPOCODIGO", "TIPOPRODUCTO", "NOMBRE", "DENOMINACIONCOMUN", "CONCENTRACION",
  "FORMAFARMACEUTICA", "FORMAFARMACEUTICASIMP", "LABORATORIO", "PAIS", "PRESENTACION",
  "UNIDADENVASE", "SITUACION", "NUMREGISTROSANITARIO",
];
const cab = (filas[0] ?? []).map((s) => (s ?? "").trim());
if (CABECERA.some((c, i) => cab[i] !== c)) {
  throw new Error(`La cabecera de la fuente cambió. Esperaba ${CABECERA.join(",")} y llegó ${cab.join(",")}`);
}

const limpiar = (s) => (s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
const vistos = new Set();
let duplicados = 0;
const productos = [];
for (const row of filas.slice(1)) {
  const codigo = limpiar(row[0]);
  const nombre = limpiar(row[3]);
  if (!codigo || !nombre) throw new Error(`Fila sin código o sin nombre: ${JSON.stringify(row)}`);
  if (vistos.has(codigo)) {
    duplicados++; // gtin es UNIQUE: ante un refresh futuro con duplicados, gana la primera fila
    continue;
  }
  vistos.add(codigo);
  const ue = limpiar(row[11]);
  productos.push({
    gtin: codigo,
    nombre,
    dci: limpiar(row[4]) || null,
    concentracion: limpiar(row[5]) || null,
    forma: limpiar(row[6]) || null,
    formaSimple: limpiar(row[7]) || null,
    laboratorio: limpiar(row[8]) || null,
    pais: limpiar(row[9]) || null,
    presentacion: limpiar(row[10]) || null,
    unidadesEnvase: /^\d+$/.test(ue) ? Number(ue) : null,
    situacion: limpiar(row[12]) || null,
    registroSan: limpiar(row[13]) || null,
    nombreNorm: normalizarNombre(nombre),
  });
}
if (productos.length + duplicados !== FILAS_ESPERADAS) {
  throw new Error(`Filas leídas ${productos.length + duplicados} ≠ esperadas ${FILAS_ESPERADAS}: revisa la fuente/parser`);
}

// ---- emisión SQL ----
// IDs DETERMINISTAS (forma uuid, índice secuencial): regenerar el script produce el mismo SQL,
// y local/remota quedan con los mismos ids (mismo criterio que scripts/gen-seed-d1.mjs).
const q = (s) => (s === null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const idDe = (i) => `40000000-0000-7000-8000-${String(i + 1).padStart(12, "0")}`;

const L = [];
L.push("-- Catálogo maestro nacional (B7) — GENERADO por scripts/gen-catalogo-maestro.mjs. NO editar a mano.");
L.push("-- Fuente: SUSALUD CATALOGO_GTIN_v4.xlsx (15,181 filas, act. 11-abr-2025) en seeds/fuentes/.");
L.push("-- Tabla GLOBAL read-only (D-N7). Recarga = reemplazo total (si un lista_item ya referencia");
L.push("-- un maestro_id, la FK aborta el DELETE: decisión humana antes de refrescar).");
L.push("DELETE FROM catalogo_maestro;");
L.push("");
const COLS = "(id, gtin, nombre, dci, concentracion, forma, forma_simple, laboratorio, pais, presentacion, unidades_envase, situacion, registro_san, fuente, nombre_norm)";
for (let i = 0; i < productos.length; i += LOTE) {
  const lote = productos.slice(i, i + LOTE);
  L.push(`INSERT INTO catalogo_maestro ${COLS} VALUES`);
  lote.forEach((p, j) => {
    const fila = [
      q(idDe(i + j)), q(p.gtin), q(p.nombre), q(p.dci), q(p.concentracion), q(p.forma), q(p.formaSimple),
      q(p.laboratorio), q(p.pais), q(p.presentacion), p.unidadesEnvase ?? "NULL", q(p.situacion),
      q(p.registroSan), q("susalud_gtin_v4"), q(p.nombreNorm),
    ].join(", ");
    L.push(`  (${fila})${j === lote.length - 1 ? ";" : ","}`);
  });
  L.push("");
}
L.push("-- Reconstruye el índice FTS externo desde la tabla de contenido (única escritura del runtime).");
L.push("INSERT INTO maestro_fts(maestro_fts) VALUES('rebuild');");
L.push("");

writeFileSync(SALIDA, L.join("\n"), "utf8");
console.log(`OK: ${productos.length} productos (${duplicados} códigos duplicados omitidos) → ${SALIDA}`);
console.log(`Tamaño: ${(L.join("\n").length / 1024 / 1024).toFixed(2)} MB · lotes de ${LOTE}`);
