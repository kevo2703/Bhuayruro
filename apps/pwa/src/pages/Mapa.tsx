import { useState } from "react";
import { navegar, SECCIONES, VISTAS, RUTAS_POS, type RutaId, type Vista } from "../lib/ruta";
import { Card, Chip, SectionLabel, Tabs, TabPill, cn } from "../components/ui";
import type { SesionActiva, Rol } from "../lib/tipos";

// Mapa del sistema (#/mapa): el "¿dónde está qué?". Se deriva EN VIVO de SECCIONES + VISTAS de
// ruta.ts — una pantalla nueva aparece sola aquí. El Record<RutaId, string> de abajo es EXHAUSTIVO
// a propósito: agregar una ruta sin escribirle su línea de "para qué sirve" no compila.

const PARA_QUE: Record<RutaId, string> = {
  hoy: "El resumen del día: qué necesita tu atención y cómo va cada botica.",
  mostrador: "Donde se cobra: buscar producto, carrito y cobro — con o sin internet.",
  recepcion: "Registrar la mercadería que llega de la droguería (entra al stock con su lote).",
  inventario: "El stock de cada botica: recepciones por aprobar, por vencer, faltantes, stock bajo y conteo.",
  caja: "El cierre del día: cuánto debía haber en caja, cuánto se contó y la diferencia.",
  dashboard: "Ventas en vivo, cierres de caja y últimas ventas, por botica o de toda la cadena.",
  casos: "La bandeja de alertas del sistema (descuadres, anulaciones, mermas). Tú revisas y decides; nada es automático.",
  conteo: "Conteo de inventario: hojas ciegas por prioridad para verificar que el stock del sistema sea el real.",
  faltantes: "Lo que falta reponer en la botica: stock bajo el mínimo o quiebres recientes.",
  consolidado: "La única vista cruzada de la cadena: ventas por botica y faltantes consolidados para pedir.",
  catalogo: "Los productos que vendes: altas asistidas desde el catálogo nacional, presentaciones y precios.",
  "importar-catalogo": "Cargar el catálogo completo desde una hoja CSV, con previsualización antes de escribir.",
  "catalogo-prueba": "Catálogo de práctica desde el maestro nacional, para que el oído tenga contra qué comparar.",
  proveedores: "Tus droguerías y sus listas de precios: subir o pegar la lista y cruzarla con tu catálogo.",
  pedido: "El pedido sugerido de la semana: compara droguerías y arma la orden más barata en 1–2 proveedores.",
  "recepciones-pendientes": "Lo que el bot de Telegram registró y espera aprobación para entrar al stock.",
  grabadores: "Los equipos vinculados al sistema (grabador del mostrador, bot): token y apagado.",
  "audio-calidad": "La salud del oído del mostrador: señales reconocidas y el diccionario de nombres que aprende.",
  usuarios: "Quién entra al sistema y con qué rol.",
  sucursales: "Tus boticas y sus horarios (el horario alimenta la alerta de venta fuera de hora).",
  ajustes: "La trastienda: catálogo, usuarios, boticas, dispositivos y el oído, todo en un lugar.",
  mapa: "Esta pantalla: el plano de todo el sistema.",
};

const ROL_CHIP: { rol: Rol; label: string }[] = [
  { rol: "super_admin", label: "Dueño" },
  { rol: "admin_sucursal", label: "Encargado" },
  { rol: "operador", label: "Vendedor" },
  { rol: "lector_reportes", label: "Lector" },
];

function vistaDe(id: RutaId): Vista {
  // VISTAS registra todas las rutas; si esto lanzara, ruta.ts está roto (owns apunta a una ruta inexistente).
  const v = VISTAS.find((x) => x.id === id);
  if (!v) throw new Error(`ruta sin vista: ${id}`);
  return v;
}

function FilaPantalla({ v, miRol }: { v: Vista; miRol: Rol }) {
  const puede = v.roles.includes(miRol);
  return (
    <li className="flex items-start justify-between gap-3 border-b border-line-row py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span aria-hidden="true" className="text-[13px]">{v.icono}</span>
          <span className="text-[13px] font-semibold text-ink">{v.label}</span>
          {ROL_CHIP.filter((r) => v.roles.includes(r.rol)).map((r) => (
            <span key={r.rol} className="rounded-full bg-inset px-1.5 py-px text-[10.5px] font-semibold text-ink-3">
              {r.label}
            </span>
          ))}
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{PARA_QUE[v.id]}</p>
      </div>
      {puede ? (
        <button
          type="button"
          onClick={() => navegar(v.id)}
          className="flex-none rounded-[8px] border border-line-input bg-card px-2.5 py-1 text-[12px] font-medium text-link transition-colors hover:bg-hover-btn hover:text-link-hover"
        >
          Ir →
        </button>
      ) : (
        <span className="flex-none text-[11px] text-ink-3">no aplica a tu rol</span>
      )}
    </li>
  );
}

// --- Vista A: por sección (las 6 del sidebar + Punto de venta + red de seguridad) ---
function PorSeccion({ miRol }: { miRol: Rol }) {
  // Red de seguridad anti-desfasaje: cualquier vista que no esté en SECCIONES.owns ni en el POS
  // cae a "Otras pantallas" en vez de desaparecer del mapa.
  const cubiertas = new Set<RutaId>([...SECCIONES.flatMap((s) => s.owns), ...RUTAS_POS]);
  const pos = VISTAS.filter((v) => v.grupo === "pos");
  const sueltas = VISTAS.filter((v) => !cubiertas.has(v.id) && v.grupo !== "pos");

  return (
    <div className="grid grid-cols-2 items-start gap-3.5">
      {SECCIONES.map((s) => (
        <Card key={s.id}>
          <SectionLabel>{s.label}</SectionLabel>
          <ul className="mt-1">
            {s.owns.map((id) => (
              <FilaPantalla key={id} v={vistaDe(id)} miRol={miRol} />
            ))}
          </ul>
        </Card>
      ))}
      <Card>
        <SectionLabel>Punto de venta (celular / mostrador)</SectionLabel>
        <p className="mt-1 text-[12px] text-ink-3">Lo que ve el vendedor en la botica. El dueño y el encargado entran por "Mostrador" en el menú.</p>
        <ul className="mt-1">
          {pos.map((v) => (
            <FilaPantalla key={v.id} v={v} miRol={miRol} />
          ))}
        </ul>
      </Card>
      {sueltas.length > 0 && (
        <Card>
          <SectionLabel>Otras pantallas</SectionLabel>
          <ul className="mt-1">
            {sueltas.map((v) => (
              <FilaPantalla key={v.id} v={v} miRol={miRol} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// --- Vista B: según tu rol (qué ve cada quien) ---
function PorRol({ miRol }: { miRol: Rol }) {
  const columnas: { rol: Rol; titulo: string; alcance: string }[] = [
    { rol: "operador", titulo: "Vendedor", alcance: "Solo el punto de venta de su botica" },
    { rol: "admin_sucursal", titulo: "Encargado", alcance: "Su botica: panel + mostrador" },
    { rol: "super_admin", titulo: "Dueño", alcance: "Toda la cadena" },
  ];
  return (
    <div className="grid grid-cols-3 items-start gap-3.5">
      {columnas.map((c) => {
        const esMio = c.rol === miRol;
        const vistas = VISTAS.filter((v) => v.roles.includes(c.rol));
        return (
          <Card key={c.rol} className={cn(esMio && "border-accent")}>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>{c.titulo}</SectionLabel>
              {esMio && <Chip variant="ok">tu rol</Chip>}
            </div>
            <p className="mt-0.5 text-[12px] text-ink-3">{c.alcance}</p>
            <ul className="mt-1">
              {vistas.map((v) => (
                <li key={v.id} className="flex items-start gap-1.5 border-b border-line-row py-2 last:border-0">
                  <span aria-hidden="true" className="text-[12.5px]">{v.icono}</span>
                  <div className="min-w-0">
                    <span className="text-[12.5px] font-semibold text-ink">{v.label}</span>
                    <p className="text-[11.5px] leading-relaxed text-ink-2">{PARA_QUE[v.id]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

export function Mapa({ sesion }: { sesion: SesionActiva }) {
  const [tab, setTab] = useState<"seccion" | "rol">("seccion");
  const miRol = sesion.usuario.rol;
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h2 className="text-[16px] font-bold tracking-[-0.01em] text-ink">¿Dónde está qué?</h2>
        <p className="mt-1 max-w-[640px] text-[12.5px] leading-relaxed text-ink-2">
          El plano de todo el sistema: cada sección, sus pantallas, para qué sirve cada una y quién la ve.
          Este mapa se arma solo desde el registro de rutas, así que siempre está al día.
        </p>
      </div>
      <Tabs>
        <TabPill active={tab === "seccion"} onClick={() => setTab("seccion")}>
          Por sección
        </TabPill>
        <TabPill active={tab === "rol"} onClick={() => setTab("rol")}>
          Según tu rol
        </TabPill>
      </Tabs>
      {tab === "seccion" ? <PorSeccion miRol={miRol} /> : <PorRol miRol={miRol} />}
    </div>
  );
}
