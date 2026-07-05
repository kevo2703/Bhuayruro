import { centASolesStr } from "@huayruro/shared";

// Impresión de la GUÍA INTERNA 80 mm (§10). Dos niveles:
//   (1) WebUSB + ESC/POS directo a la impresora térmica (Chrome/Edge, ADR-004).
//   (2) Fallback: ventana de impresión del navegador con CSS 80 mm (@media print).
// La guía se arma con datos LOCALES → imprime aunque no haya red (venta ya encolada).
//
// ⚠️ La validación WebUSB real depende de la impresora física de VES (tarea T-K1): vendor/product
// id + endpoint OUT concretos. Hasta entonces, cualquier fallo del path (1) cae al path (2), que
// es totalmente funcional y verificable. NO es comprobante de pago (guía interna).

export type GuiaItem = { nombre: string; presentacion: string; cantidad: number; totalCent: number };

export type GuiaVenta = {
  sucursalNombre: string;
  sucursalDireccion: string | null;
  fechaHora: string; // ISO
  clientUuid: string;
  items: GuiaItem[];
  subtotalSinIgvCent: number;
  igvTotalCent: number;
  totalCent: number;
  metodoPago: string;
  efectivoRecibidoCent: number | null;
  vueltoCent: number | null;
  reimpresion?: boolean;
};

const S = (cent: number) => `S/ ${centASolesStr(cent)}`;
export const guiaNumero = (clientUuid: string) => clientUuid.replace(/-/g, "").slice(-8).toUpperCase();

function fechaLegible(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------- Path (2): fallback por navegador (CSS 80 mm). Verificable sin hardware. ----------

function htmlGuia(g: GuiaVenta): string {
  const filas = g.items
    .map(
      (it) =>
        `<tr><td class="c">${it.cantidad}</td><td class="n">${escapar(it.nombre)}<br><span class="p">${escapar(it.presentacion)}</span></td><td class="t">${S(it.totalCent)}</td></tr>`,
    )
    .join("");
  const pago =
    g.metodoPago === "efectivo" && g.efectivoRecibidoCent != null
      ? `<div class="row"><span>Recibido</span><span>${S(g.efectivoRecibidoCent)}</span></div><div class="row"><span>Vuelto</span><span>${S(g.vueltoCent ?? 0)}</span></div>`
      : "";
  return `<!doctype html><html lang="es-PE"><head><meta charset="utf-8"><title>Guía ${guiaNumero(g.clientUuid)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: 80mm; margin: 0; padding: 4mm 3mm; font-family: 'Courier New', monospace; font-size: 11px; color: #000; }
  h1 { font-size: 14px; text-align: center; margin: 0; }
  .sub { text-align: center; font-size: 10px; margin: 1mm 0 2mm; }
  .aviso { text-align: center; font-weight: bold; font-size: 10px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 1mm 0; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 0.6mm 0; }
  td.c { width: 8mm; } td.t { text-align: right; white-space: nowrap; } td.n { padding: 0 1mm; }
  .p { font-size: 9px; color: #333; }
  .tot { border-top: 1px dashed #000; margin-top: 2mm; padding-top: 1mm; }
  .row { display: flex; justify-content: space-between; }
  .grande { font-size: 15px; font-weight: bold; }
  .pie { text-align: center; margin-top: 3mm; font-size: 9px; }
  .rei { text-align:center; font-weight:bold; }
</style></head><body>
  <h1>${escapar(g.sucursalNombre)}</h1>
  <div class="sub">${escapar(g.sucursalDireccion ?? "")}</div>
  <div class="aviso">GUÍA INTERNA — no es comprobante de pago</div>
  ${g.reimpresion ? '<div class="rei">** REIMPRESIÓN **</div>' : ""}
  <div class="row"><span>${fechaLegible(g.fechaHora)}</span><span>N° ${guiaNumero(g.clientUuid)}</span></div>
  <table>${filas}</table>
  <div class="tot">
    <div class="row"><span>Subtotal</span><span>${S(g.subtotalSinIgvCent)}</span></div>
    <div class="row"><span>IGV 18%</span><span>${S(g.igvTotalCent)}</span></div>
    <div class="row grande"><span>TOTAL</span><span>${S(g.totalCent)}</span></div>
    <div class="row"><span>Pago</span><span>${escapar(g.metodoPago)}</span></div>
    ${pago}
  </div>
  <div class="pie">¡Gracias por su compra!</div>
</body></html>`;
}

function escapar(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function imprimirPorNavegador(g: GuiaVenta): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }
  win.document.open();
  win.document.write(htmlGuia(g));
  win.document.close();
  win.focus();
  // Dar tiempo al layout antes de imprimir; limpiar el iframe después.
  setTimeout(() => {
    try {
      win.print();
    } finally {
      setTimeout(() => iframe.remove(), 2000);
    }
  }, 250);
}

// ---------- Path (1): WebUSB + ESC/POS. Cae al fallback ante cualquier fallo. ----------

const ESC = 0x1b;
const GS = 0x1d;

function bytesGuia(g: GuiaVenta): Uint8Array {
  const out: number[] = [];
  const enc = new TextEncoder();
  const push = (...b: number[]) => out.push(...b);
  const texto = (s: string) => {
    for (const byte of enc.encode(s)) out.push(byte);
  };
  const linea = (s = "") => {
    texto(s);
    push(0x0a);
  };
  const ANCHO = 42; // 80 mm ~ 42 col a fuente A
  const dosCol = (izq: string, der: string) => {
    const espacio = Math.max(1, ANCHO - izq.length - der.length);
    linea(izq + " ".repeat(espacio) + der);
  };

  push(ESC, 0x40); // init
  push(ESC, 0x61, 0x01); // center
  push(ESC, 0x21, 0x08); // emphasized
  linea(g.sucursalNombre);
  push(ESC, 0x21, 0x00);
  if (g.sucursalDireccion) linea(g.sucursalDireccion);
  linea("GUIA INTERNA - no es comprobante");
  if (g.reimpresion) linea("** REIMPRESION **");
  push(ESC, 0x61, 0x00); // left
  linea("-".repeat(ANCHO));
  dosCol(fechaLegible(g.fechaHora), "N " + guiaNumero(g.clientUuid));
  linea("-".repeat(ANCHO));
  for (const it of g.items) {
    dosCol(`${it.cantidad} x ${recorta(it.nombre, 24)}`, S(it.totalCent));
    if (it.presentacion) linea("   " + recorta(it.presentacion, ANCHO - 3));
  }
  linea("-".repeat(ANCHO));
  dosCol("Subtotal", S(g.subtotalSinIgvCent));
  dosCol("IGV 18%", S(g.igvTotalCent));
  push(ESC, 0x21, 0x10); // double height
  dosCol("TOTAL", S(g.totalCent));
  push(ESC, 0x21, 0x00);
  dosCol("Pago", g.metodoPago);
  if (g.metodoPago === "efectivo" && g.efectivoRecibidoCent != null) {
    dosCol("Recibido", S(g.efectivoRecibidoCent));
    dosCol("Vuelto", S(g.vueltoCent ?? 0));
  }
  push(0x0a);
  push(ESC, 0x61, 0x01);
  linea("Gracias por su compra!");
  push(0x0a, 0x0a, 0x0a);
  push(GS, 0x56, 0x42, 0x00); // partial cut
  return new Uint8Array(out);
}

const recorta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type UsbLike = {
  opened: boolean;
  configuration: { interfaces: { interfaceNumber: number; alternate: { endpoints: { direction: string; endpointNumber: number }[] } }[] } | null;
  open: () => Promise<void>;
  selectConfiguration: (n: number) => Promise<void>;
  claimInterface: (n: number) => Promise<void>;
  transferOut: (endpoint: number, data: BufferSource) => Promise<unknown>;
};

function usbDisponible(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

// Pide permiso para una impresora (una vez; el navegador la recuerda). Solo Chrome/Edge sobre HTTPS.
export async function conectarImpresora(): Promise<boolean> {
  if (!usbDisponible()) return false;
  try {
    // Clase 7 = impresora (printer). El usuario elige el dispositivo.
    await (navigator as unknown as { usb: { requestDevice: (o: unknown) => Promise<unknown> } }).usb.requestDevice({
      filters: [{ classCode: 7 }],
    });
    return true;
  } catch {
    return false;
  }
}

async function dispositivoConcedido(): Promise<UsbLike | null> {
  if (!usbDisponible()) return null;
  try {
    const devs = (await (navigator as unknown as { usb: { getDevices: () => Promise<UsbLike[]> } }).usb.getDevices()) ?? [];
    return devs[0] ?? null;
  } catch {
    return null;
  }
}

async function imprimirPorUsb(g: GuiaVenta): Promise<boolean> {
  const dev = await dispositivoConcedido();
  if (!dev) return false;
  try {
    if (!dev.opened) await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);
    const iface = dev.configuration?.interfaces.find((i) =>
      i.alternate.endpoints.some((e) => e.direction === "out"),
    );
    if (!iface) return false;
    await dev.claimInterface(iface.interfaceNumber);
    const epOut = iface.alternate.endpoints.find((e) => e.direction === "out");
    if (!epOut) return false;
    await dev.transferOut(epOut.endpointNumber, bytesGuia(g) as unknown as BufferSource);
    return true;
  } catch {
    return false; // cae al fallback
  }
}

// Imprime la guía: intenta WebUSB; si no hay impresora o falla, usa el navegador (CSS 80 mm).
export async function imprimirGuia(g: GuiaVenta): Promise<"usb" | "navegador"> {
  if (await imprimirPorUsb(g)) return "usb";
  imprimirPorNavegador(g);
  return "navegador";
}

// ¿Hay una impresora WebUSB ya concedida? (para mostrar/ocultar el botón "conectar impresora").
export async function hayImpresora(): Promise<boolean> {
  return (await dispositivoConcedido()) !== null;
}
