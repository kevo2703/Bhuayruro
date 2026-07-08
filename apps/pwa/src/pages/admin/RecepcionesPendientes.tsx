import { useEffect, useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { getToken } from "../../lib/auth";
import { solesCent } from "../../lib/money";
import { Cargando, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

// Bandeja de recepciones del bot de Telegram (B9 §7.4). El bot registra lo que LLEGA → aquí un admin
// lo revisa y, al APROBAR, se convierte en recepción REAL (mismo kardex). Rechazar no toca stock.

type Maestro = { nombre: string; dci: string | null; laboratorio: string | null; presentacion: string | null };
type Card = {
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

export function RecepcionesPendientes({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const sucursales = useApi<{ sucursales: { id: string; nombre: string }[] }>(esSuper ? "/sucursales" : null);
  const [sucId, setSucId] = useState<string | null>(null);
  useEffect(() => {
    if (esSuper && sucId === null && sucursales.data?.sucursales.length) setSucId(sucursales.data.sucursales[0]!.id);
  }, [esSuper, sucId, sucursales.data]);

  const q = esSuper ? (sucId ? `?sucursal_id=${sucId}` : null) : "";
  const suf = esSuper && sucId ? `?sucursal_id=${sucId}` : "";
  const pend = useApi<{ pendientes: Card[] }>(q === null ? null : `/recepciones/pendientes${q}`, [q]);

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">Recepciones del bot</h1>
        <p className="text-sm opacity-60 mt-1">
          Lo que llega y se registra por Telegram cae aquí. Revísalo y aprueba: al aprobar entra al inventario como una recepción real.
        </p>
      </div>

      {esSuper && (
        <select value={sucId ?? ""} onChange={(e) => setSucId(e.target.value)} className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm">
          {sucursales.data?.sucursales.map((s) => (
            <option key={s.id} value={s.id} className="bg-neutral-900">{s.nombre}</option>
          ))}
        </select>
      )}

      <BotVinculacion suf={suf} />

      <section className="space-y-3">
        <h2 className="font-semibold text-sm">Pendientes de aprobar</h2>
        {pend.cargando ? (
          <Cargando que="recepciones" />
        ) : (pend.data?.pendientes.length ?? 0) === 0 ? (
          <Vacio>Nada pendiente. Cuando alguien registre algo por el bot, aparece aquí.</Vacio>
        ) : (
          pend.data!.pendientes.map((c) => <Tarjeta key={c.id} card={c} onCambio={() => pend.recargar()} />)
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
    <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">🤖 Vincular un teléfono al bot</h2>
        <button onClick={() => void generar()} disabled={ocupado} className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-medium disabled:opacity-40">
          {ocupado ? "..." : "Generar código"}
        </button>
      </div>
      {codigo && (
        <div className="bg-emerald-500/10 rounded border border-emerald-500/30 p-3 text-sm">
          Dile a la persona que le escriba al bot: <b className="font-mono text-lg tracking-widest">/vincular {codigo.codigo}</b>
          <span className="block text-xs opacity-60 mt-1">Vence en 10 minutos. Un solo uso.</span>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {(chats.data?.chats.length ?? 0) > 0 && (
        <ul className="text-sm divide-y divide-white/5">
          {chats.data!.chats.map((c) => (
            <li key={c.chat_id} className="py-2 flex items-center justify-between gap-2">
              <span className="opacity-80">
                📱 <span className="font-mono text-xs">{c.chat_id}</span> · {c.usuario ?? "—"} {c.sucursal ? `· ${c.sucursal}` : ""}
              </span>
              <button onClick={() => void desvincular(c.chat_id)} className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30">
                desvincular
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Tarjeta de un borrador ────────────────────────────────────────────────────────
function Tarjeta({ card, onCambio }: { card: Card; onCambio: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState<"" | "corregir" | "alta">("");

  const resuelto = !!card.producto_id || !!card.producto_sugerido;

  async function accion(path: string, body: unknown = {}) {
    setOcupado(true);
    setError(null);
    try {
      await mutar(`/recepciones/pendientes/${card.id}/${path}`, { method: "POST", body });
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{card.producto_texto ?? "(sin nombre)"}</p>
          <p className="text-xs opacity-60">
            Lote <b>{card.lote ?? "—"}</b> · vence {card.vencimiento?.slice(0, 7) ?? "—"} · {card.cantidad ?? "—"} u
            {card.precio_unidad_cent != null ? ` · ${solesCent(card.precio_unidad_cent)}/u` : ""}
            {card.ubicacion ? ` · 📍 ${card.ubicacion}` : ""}
          </p>
          <p className="text-xs mt-0.5">
            {resuelto ? (
              <span className="text-emerald-300">✓ {card.producto_id ? "en tu catálogo" : `coincide con ${card.producto_sugerido!.nombre}`}</span>
            ) : (
              <span className="text-amber-400">⚠ producto no está en tu catálogo — hay que darlo de alta</span>
            )}
            {card.confianza_ocr != null && <span className="opacity-40"> · OCR {Math.round(card.confianza_ocr * 100)}%</span>}
          </p>
        </div>
        {card.fotos > 0 && (
          <div className="flex gap-1 shrink-0">
            {Array.from({ length: card.fotos }).map((_, i) => (
              <FotoBorrador key={i} borradorId={card.id} idx={i} />
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {modo === "" && (
        <div className="flex flex-wrap gap-2">
          {resuelto ? (
            <button onClick={() => void accion("aprobar")} disabled={ocupado} className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
              ✅ Aprobar (recibir)
            </button>
          ) : (
            <button onClick={() => setModo("alta")} className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold">
              ➕ Dar de alta y recibir
            </button>
          )}
          <button onClick={() => setModo("corregir")} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">✏️ Corregir</button>
          <button onClick={() => void accion("rechazar")} disabled={ocupado} className="text-sm px-3 py-1.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40">
            🗑 Rechazar
          </button>
        </div>
      )}

      {modo === "corregir" && <Corregir card={card} onGuardar={(cambios) => accion("corregir", cambios)} onCerrar={() => setModo("")} />}
      {modo === "alta" && <MiniAlta card={card} onAprobar={(nuevo) => accion("aprobar", { nuevo_producto: nuevo })} onCerrar={() => setModo("")} />}
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
  if (!url) return <div className="w-14 h-14 rounded bg-white/5 animate-pulse" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="foto" className="w-14 h-14 rounded object-cover border border-white/10" /></a>;
}

function Corregir({ card, onGuardar, onCerrar }: { card: Card; onGuardar: (c: Record<string, unknown>) => void; onCerrar: () => void }) {
  const [lote, setLote] = useState(card.lote ?? "");
  const [venc, setVenc] = useState(card.vencimiento ?? "");
  const [cant, setCant] = useState(card.cantidad?.toString() ?? "");
  const [ubi, setUbi] = useState(card.ubicacion ?? "");

  return (
    <div className="space-y-2 pt-2 border-t border-white/10">
      <div className="grid grid-cols-2 gap-2">
        <input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
        <input value={venc} onChange={(e) => setVenc(e.target.value)} type="date" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
        <input value={cant} onChange={(e) => setCant(e.target.value)} type="number" min={1} placeholder="Cantidad" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
        <input value={ubi} onChange={(e) => setUbi(e.target.value)} placeholder="Ubicación" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onGuardar({ lote: lote.trim(), vencimiento: venc.trim(), cantidad: cant.trim() === "" ? undefined : Number(cant), ubicacion: ubi.trim() })}
          className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
        >
          Guardar cambios
        </button>
        <button onClick={onCerrar} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Cancelar</button>
      </div>
    </div>
  );
}

function MiniAlta({ card, onAprobar, onCerrar }: { card: Card; onAprobar: (n: Record<string, unknown>) => void; onCerrar: () => void }) {
  const m = card.maestro;
  const [f, setF] = useState({
    nombre: m?.nombre ?? card.producto_texto ?? "",
    laboratorio: m?.laboratorio ?? "",
    principio_activo: m?.dci ?? "",
    presentacion: m?.presentacion ?? "",
    codigo_barras: card.gtin ?? "",
  });
  return (
    <div className="space-y-2 pt-2 border-t border-white/10">
      <p className="text-xs opacity-60">Este producto no está en tu catálogo. Confírmalo para darlo de alta y recibirlo:</p>
      <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre *" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input value={f.laboratorio} onChange={(e) => setF({ ...f, laboratorio: e.target.value })} placeholder="Laboratorio" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
        <input value={f.principio_activo} onChange={(e) => setF({ ...f, principio_activo: e.target.value })} placeholder="Principio activo" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
        <input value={f.presentacion} onChange={(e) => setF({ ...f, presentacion: e.target.value })} placeholder="Presentación" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" />
        <input value={f.codigo_barras} onChange={(e) => setF({ ...f, codigo_barras: e.target.value })} placeholder="Código de barras" className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm font-mono" />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => f.nombre.trim() && onAprobar({ nombre: f.nombre.trim(), laboratorio: f.laboratorio.trim(), principio_activo: f.principio_activo.trim(), presentacion: f.presentacion.trim(), codigo_barras: f.codigo_barras.trim() })}
          className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
        >
          Crear y recibir
        </button>
        <button onClick={onCerrar} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Cancelar</button>
      </div>
    </div>
  );
}
