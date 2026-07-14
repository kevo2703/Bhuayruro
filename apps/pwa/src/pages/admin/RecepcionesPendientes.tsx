import { useEffect, useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { getToken } from "../../lib/auth";
import { solesCent } from "../../lib/money";
import { fechaCorta } from "../../lib/fecha-ui";
import { Card, Chip, Button, Input, EmptyState, useToast } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Bandeja de recepciones del bot de Telegram (B9 §7.4). El bot registra lo que LLEGA → aquí un admin
// lo revisa y, al APROBAR, se convierte en recepción REAL (mismo kardex). Rechazar no toca stock.
// Un borrador = UN producto (el modelo real no es multi-línea con Total; se respeta tal cual).

type Maestro = { nombre: string; dci: string | null; laboratorio: string | null; presentacion: string | null };
type Borrador = {
  id: string;
  created_at: string;
  producto_texto: string | null;
  producto_id: string | null;
  producto_sugerido: { id: string; nombre: string } | null;
  gtin: string | null;
  maestro: Maestro | null;
  lote: string | null;
  vencimiento: string | null;
  precio_unidad_cent: number | null;
  precio_blister_cent: number | null;
  unidades_por_blister: number | null;
  cantidad: number | null;
  ubicacion: string | null;
  fotos: number;
  confianza_ocr: number | null;
};

export function RecepcionesPendientes({ sesion, onCount }: { sesion: SesionActiva; onCount?: (n: number) => void }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const sucursales = useApi<{ sucursales: { id: string; nombre: string }[] }>(esSuper ? "/sucursales" : null);
  const [sucId, setSucId] = useState<string | null>(null);
  useEffect(() => {
    if (esSuper && sucId === null && sucursales.data?.sucursales.length) setSucId(sucursales.data.sucursales[0]!.id);
  }, [esSuper, sucId, sucursales.data]);

  const q = esSuper ? (sucId ? `?sucursal_id=${sucId}` : null) : "";
  const suf = esSuper && sucId ? `?sucursal_id=${sucId}` : "";
  const pend = useApi<{ pendientes: Borrador[] }>(q === null ? null : `/recepciones/pendientes${q}`, [q]);

  // Nombre de la botica destino (para el toast de aprobación). Real: la del super seleccionada, o la del admin.
  const sucNombre = esSuper ? (sucursales.data?.sucursales.find((s) => s.id === sucId)?.nombre ?? null) : (sesion.sucursal?.nombre ?? null);

  useEffect(() => {
    if (pend.data) onCount?.(pend.data.pendientes.length);
  }, [pend.data, onCount]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-2">
        Cuando llega mercadería, alguien le manda una foto de la guía al asistente de Telegram. El sistema arma el borrador; tú solo lo revisas y apruebas: al aprobar entra al inventario como una recepción real.
      </p>

      {esSuper && (
        <select
          value={sucId ?? ""}
          onChange={(e) => setSucId(e.target.value)}
          className="w-full max-w-xs rounded-[9px] border border-line-input bg-field px-3 py-2 text-[13px] text-ink outline-none"
        >
          {sucursales.data?.sucursales.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      <BotVinculacion suf={suf} />

      <section className="flex flex-col gap-3">
        {pend.cargando ? (
          <p className="p-6 text-center text-[13px] text-ink-3">Cargando recepciones…</p>
        ) : (pend.data?.pendientes.length ?? 0) === 0 ? (
          <EmptyState title="Nada pendiente" subtitle="Cuando alguien registre algo por el bot, aparece aquí." />
        ) : (
          pend.data!.pendientes.map((c) => <Tarjeta key={c.id} card={c} sucNombre={sucNombre} onCambio={() => pend.recargar()} />)
        )}
      </section>
    </div>
  );
}

// ── Vinculación del teléfono al bot (§7.1) ────────────────────────────────────────
type Chat = { chat_id: string; estado: string; usuario: string | null; sucursal: string | null; updated_at: string };

function BotVinculacion({ suf }: { suf: string }) {
  const chats = useApi<{ chats: Chat[] }>("/bot/chats");
  const [codigo, setCodigo] = useState<{ codigo: string; expira_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function generar() {
    setOcupado(true);
    setError(null);
    try {
      setCodigo(await mutar<{ codigo: string; expira_at: string }>(`/bot/vincular-codigo${suf}`, { method: "POST", body: {} }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function desvincular(chatId: string) {
    try {
      await mutar(`/bot/chats/${chatId}/desvincular`, { method: "POST", body: {} });
      chats.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[13.5px] font-bold text-ink">Vincular un teléfono al bot</h2>
          <p className="text-[12px] text-ink-3">La persona le escribe al bot con el código y su teléfono queda habilitado.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void generar()} disabled={ocupado}>
          {ocupado ? "…" : "Generar código"}
        </Button>
      </div>
      {codigo && (
        <div className="rounded-[8px] border border-line-inset bg-inset p-3 text-[12.5px] text-ink-emph">
          Dile que le escriba al bot: <b className="font-mono text-[16px] tracking-widest text-ink">/vincular {codigo.codigo}</b>
          <span className="mt-1 block text-[11.5px] text-ink-3">Vence en 10 minutos. Un solo uso.</span>
        </div>
      )}
      {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
      {(chats.data?.chats.length ?? 0) > 0 && (
        <ul className="flex flex-col">
          {chats.data!.chats.map((c) => (
            <li key={c.chat_id} className="flex items-center justify-between gap-2 border-b border-line-row py-2 last:border-b-0">
              <span className="text-[12.5px] text-ink-2">
                <span className="font-mono text-[11.5px] text-ink-3">{c.chat_id}</span> · {c.usuario ?? "—"}{c.sucursal ? ` · ${c.sucursal}` : ""}
              </span>
              <button onClick={() => void desvincular(c.chat_id)} className="rounded-full border border-line-input bg-card px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink hover:bg-hover-btn">
                Desvincular
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Tarjeta de un borrador ────────────────────────────────────────────────────────
function Tarjeta({ card, sucNombre, onCambio }: { card: Borrador; sucNombre: string | null; onCambio: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState<"" | "corregir" | "alta">("");
  const toast = useToast();

  const resuelto = !!card.producto_id || !!card.producto_sugerido;
  const aprobadaMsg = `Recepción aprobada — el stock ${sucNombre ? `de ${sucNombre} ` : ""}ya se actualizó.`;

  async function accion(path: string, body: unknown = {}, okMsg?: string) {
    setOcupado(true);
    setError(null);
    try {
      await mutar(`/recepciones/pendientes/${card.id}/${path}`, { method: "POST", body });
      onCambio();
      if (okMsg) toast(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-bold text-ink">{card.producto_texto ?? "(sin nombre)"}</p>
            <Chip variant="warn">Por aprobar</Chip>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Registrado por Telegram · {fechaCorta(card.created_at)}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-2 tabular-nums">
            Lote <b className="font-mono text-ink-emph">{card.lote ?? "—"}</b> · vence {card.vencimiento?.slice(0, 7) ?? "—"} · {card.cantidad ?? "—"} u
            {card.precio_unidad_cent != null ? ` · ${solesCent(card.precio_unidad_cent)}/u` : ""}
            {card.ubicacion ? ` · ${card.ubicacion}` : ""}
          </p>
          <p className="mt-1 text-[12px]">
            {resuelto ? (
              <span className="text-ok">✓ {card.producto_id ? "en tu catálogo" : `coincide con ${card.producto_sugerido!.nombre}`}</span>
            ) : (
              <span className="text-warn">Producto no está en tu catálogo — hay que darlo de alta</span>
            )}
            {card.confianza_ocr != null && <span className="text-ink-3"> · OCR {Math.round(card.confianza_ocr * 100)}%</span>}
          </p>
        </div>
        {card.fotos > 0 ? (
          <div className="flex shrink-0 gap-1">
            {Array.from({ length: card.fotos }).map((_, i) => (
              <FotoBorrador key={i} borradorId={card.id} idx={i} />
            ))}
          </div>
        ) : (
          <FotoPlaceholder />
        )}
      </div>

      {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}

      {modo === "" && (
        <div className="flex flex-wrap gap-2">
          {resuelto ? (
            <Button variant="primary" size="sm" onClick={() => void accion("aprobar", {}, aprobadaMsg)} disabled={ocupado}>
              Aprobar recepción
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setModo("alta")}>
              Dar de alta y recibir
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setModo("corregir")}>Corregir líneas</Button>
          <button
            onClick={() => void accion("rechazar", {}, "Recepción rechazada.")}
            disabled={ocupado}
            className="inline-flex items-center rounded-[9px] border border-line-input bg-card px-4 py-2 text-[12.5px] font-semibold text-accent-ink transition-colors hover:bg-hover-btn disabled:opacity-60"
          >
            Rechazar
          </button>
        </div>
      )}

      {modo === "corregir" && <Corregir card={card} onGuardar={(cambios) => accion("corregir", cambios, "Correcciones guardadas.")} onCerrar={() => setModo("")} />}
      {modo === "alta" && <MiniAlta card={card} onAprobar={(nuevo) => accion("aprobar", { nuevo_producto: nuevo }, aprobadaMsg)} onCerrar={() => setModo("")} />}
    </Card>
  );
}

// Placeholder de foto (patrón rayado sobre bg-inset) cuando el borrador llegó sin imagen.
function FotoPlaceholder() {
  return (
    <div
      className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-line-photo bg-inset p-1 text-center"
      style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--color-line-photo) 5px, var(--color-line-photo) 6px)" }}
    >
      <span className="font-mono text-[9px] leading-tight text-ink-3">sin foto</span>
    </div>
  );
}

// Foto del borrador vía el proxy autenticado del Worker (nunca exponemos claves R2).
function FotoBorrador({ borradorId, idx }: { borradorId: string; idx: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let objUrl: string | null = null;
    const token = getToken();
    fetch(`/api/recepciones/pendientes/${borradorId}/foto/${idx}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!vivo) return;
        objUrl = URL.createObjectURL(b);
        setUrl(objUrl);
      })
      .catch(() => {});
    return () => {
      vivo = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [borradorId, idx]);
  if (!url) return <div className="h-[64px] w-[64px] rounded-[10px] border border-line bg-inset" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="foto de la guía" className="h-[64px] w-[64px] rounded-[10px] border border-line object-cover" /></a>;
}

function Corregir({ card, onGuardar, onCerrar }: { card: Borrador; onGuardar: (c: Record<string, unknown>) => void; onCerrar: () => void }) {
  const [lote, setLote] = useState(card.lote ?? "");
  const [venc, setVenc] = useState(card.vencimiento ?? "");
  const [cant, setCant] = useState(card.cantidad?.toString() ?? "");
  const [ubi, setUbi] = useState(card.ubicacion ?? "");

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-2">
        <Input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote" />
        <Input value={venc} onChange={(e) => setVenc(e.target.value)} type="date" />
        <Input value={cant} onChange={(e) => setCant(e.target.value)} type="number" min={1} placeholder="Cantidad" className="tabular-nums" />
        <Input value={ubi} onChange={(e) => setUbi(e.target.value)} placeholder="Ubicación" />
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onGuardar({ lote: lote.trim(), vencimiento: venc.trim(), cantidad: cant.trim() === "" ? undefined : Number(cant), ubicacion: ubi.trim() })}
        >
          Guardar cambios
        </Button>
        <Button variant="outline" size="sm" onClick={onCerrar}>Cancelar</Button>
      </div>
    </div>
  );
}

function MiniAlta({ card, onAprobar, onCerrar }: { card: Borrador; onAprobar: (n: Record<string, unknown>) => void; onCerrar: () => void }) {
  const m = card.maestro;
  const [f, setF] = useState({
    nombre: m?.nombre ?? card.producto_texto ?? "",
    laboratorio: m?.laboratorio ?? "",
    principio_activo: m?.dci ?? "",
    presentacion: m?.presentacion ?? "",
    codigo_barras: card.gtin ?? "",
  });
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-[12px] text-ink-3">Este producto no está en tu catálogo. Confírmalo para darlo de alta y recibirlo:</p>
      <Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre *" />
      <div className="grid grid-cols-2 gap-2">
        <Input value={f.laboratorio} onChange={(e) => setF({ ...f, laboratorio: e.target.value })} placeholder="Laboratorio" />
        <Input value={f.principio_activo} onChange={(e) => setF({ ...f, principio_activo: e.target.value })} placeholder="Principio activo" />
        <Input value={f.presentacion} onChange={(e) => setF({ ...f, presentacion: e.target.value })} placeholder="Presentación" />
        <Input value={f.codigo_barras} onChange={(e) => setF({ ...f, codigo_barras: e.target.value })} placeholder="Código de barras" className="font-mono" />
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => f.nombre.trim() && onAprobar({ nombre: f.nombre.trim(), laboratorio: f.laboratorio.trim(), principio_activo: f.principio_activo.trim(), presentacion: f.presentacion.trim(), codigo_barras: f.codigo_barras.trim() })}
        >
          Crear y recibir
        </Button>
        <Button variant="outline" size="sm" onClick={onCerrar}>Cancelar</Button>
      </div>
    </div>
  );
}
