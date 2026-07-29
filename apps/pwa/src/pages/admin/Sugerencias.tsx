import { useState } from "react";
import { DISPARADORES, MAX_GUION, pctConversion, type DisparadorTipo } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { SelectorProducto, type ProductoRef } from "../../components/SelectorProducto";
import { Button, Card, EmptyState, Input, SectionLabel, TableHead, TableRow, Td, Th, cn, useToast } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// ============================================================
// P4a — Sugerencias del mostrador (A4). Esta pantalla existe para PODAR: la tabla no está para
// felicitar a nadie, está para ver qué regla nadie acepta y apagarla.
//
// Por eso la conversión viaja pegada a cada regla y no en un panel aparte, y por eso "apagar" es
// más prominente que "borrar": apagar conserva el historial; borrar se lo lleva.
//
// Los números salen de la botica seleccionada (los eventos son por sucursal); las reglas son de la
// cadena. Se dice explícito en la pantalla para que nadie lea la tabla como si fuera de todas.
// ============================================================

type Regla = {
  id: string;
  disparador_tipo: DisparadorTipo;
  disparador_valor: string;
  sugerido_producto_id: string;
  sugerido_nombre: string;
  guion: string;
  prioridad: number;
  activa: number;
  es_demo: number;
  mostradas: number;
  aceptadas: number;
  rechazadas: number;
  soles_cent: number;
};

type Sucursal = { id: string; nombre: string };

const ROTULO: Record<DisparadorTipo, string> = {
  producto: "Producto",
  categoria: "Categoría",
  principio_activo: "Principio activo",
};

const selectCls = "w-full rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";

export function Sugerencias({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const q = esSuper && suc ? `?sucursal_id=${suc}` : "";
  const lista = useApi<{ reglas: Regla[] }>(!esSuper || suc ? `/sugerencias/conversion${q}` : null, [suc]);
  const toast = useToast();
  const [creando, setCreando] = useState(false);

  const reglas = lista.data?.reglas ?? [];
  const activas = reglas.filter((r) => r.activa === 1).length;
  const cols = "1.4fr 1.5fr 2fr 70px 70px 70px 100px 150px";

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Cuando se agrega un producto que calza con una regla, el mostrador muestra <strong>una sola</strong> tarjeta con el
          consejo. Un toque la agrega, otro la descarta — y las dos cosas se cuentan acá.
        </p>
        <Button variant={creando ? "outline" : "primary"} size="sm" onClick={() => setCreando((v) => !v)}>
          {creando ? "Cerrar" : "Nueva regla"}
        </Button>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className={selectCls} aria-label="Botica">
          <option value="">— Elige una botica —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {creando && (
        <FormRegla
          onListo={(m) => {
            setCreando(false);
            toast(m);
            lista.recargar();
          }}
        />
      )}

      {esSuper && !suc ? (
        <Card><EmptyState title="Elige una botica" subtitle="Las reglas son de la cadena; la conversión es de cada botica." /></Card>
      ) : (
        <Card className="gap-2">
          <SectionLabel right={<span className="text-[12px] text-ink-3 tabular-nums">{activas} activas · {reglas.length} en total</span>}>
            Reglas y conversión
          </SectionLabel>

          {lista.cargando ? (
            <p className="py-4 text-center text-[13px] text-ink-3">Cargando reglas…</p>
          ) : lista.error ? (
            <div className="py-4 text-center">
              <p className="text-[13px] text-accent-ink">{lista.error}</p>
              <button onClick={lista.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
            </div>
          ) : reglas.length === 0 ? (
            <EmptyState title="Todavía no hay reglas" subtitle="Crea una con “Nueva regla”: cuándo se dispara, qué producto sugiere y qué se dice." />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[880px]">
                <TableHead cols={cols}>
                  <Th>Cuando se lleva</Th>
                  <Th>Sugiere</Th>
                  <Th>Lo que se dice</Th>
                  <Th align="right">Vistas</Th>
                  <Th align="right">Aceptadas</Th>
                  <Th align="right">Conv.</Th>
                  <Th align="right">Soles</Th>
                  <Th />
                </TableHead>
                {reglas.map((r) => (
                  <FilaRegla key={r.id} r={r} cols={cols} onCambio={lista.recargar} onToast={toast} />
                ))}
              </div>
            </div>
          )}

          <p className="text-[12px] leading-relaxed text-ink-3">
            Los soles son los de la venta REAL de ese producto en las ventas donde se aceptó la sugerencia — no un
            estimado. Una venta anulada no suma. <strong>Apagar</strong> una regla la saca del mostrador y conserva sus
            números; <strong>borrarla</strong> se lleva también su historial.
          </p>
        </Card>
      )}
    </div>
  );
}

function FilaRegla({ r, cols, onCambio, onToast }: { r: Regla; cols: string; onCambio: () => void; onToast: (m: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const pct = pctConversion(r);

  async function alternar() {
    setOcupado(true);
    try {
      await mutar(`/sugerencias/reglas/${r.id}`, { method: "PATCH", body: { activa: r.activa !== 1 } });
      onToast(r.activa === 1 ? "Regla apagada: ya no aparece en el mostrador." : "Regla encendida.");
      onCambio();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function borrar() {
    const aviso =
      r.mostradas + r.rechazadas > 0
        ? `Se borra la regla y sus ${r.mostradas + r.rechazadas} registros de conversión. Si solo quieres que deje de aparecer, apágala.`
        : "Se borra la regla.";
    if (!window.confirm(aviso)) return;
    setOcupado(true);
    try {
      await mutar(`/sugerencias/reglas/${r.id}`, { method: "DELETE" });
      onToast("Regla borrada.");
      onCambio();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <TableRow cols={cols} className={cn(r.activa !== 1 && "opacity-60")}>
      <Td>
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-table">{ROTULO[r.disparador_tipo]}</p>
        <p className="truncate text-[13px] font-semibold text-ink">{r.disparador_valor}</p>
      </Td>
      <Td>
        <p className="truncate text-[13px] text-ink">{r.sugerido_nombre}</p>
        {r.es_demo === 1 && <span className="text-[11px] font-semibold text-ink-3">regla de ejemplo</span>}
      </Td>
      <Td className="text-[12.5px] leading-snug text-ink-2">{r.guion}</Td>
      <Td align="right" className="tabular-nums text-[13px] text-ink-2">{r.mostradas}</Td>
      <Td align="right" className="tabular-nums text-[13px] text-ink">{r.aceptadas}</Td>
      {/* Sin vistas no se dice 0 %: se leería como "no convierte" cuando nadie la vio todavía. */}
      <Td align="right" className="tabular-nums text-[13px] font-semibold text-ink">{pct === null ? "—" : `${pct}%`}</Td>
      <Td align="right" className="tabular-nums text-[13px] text-ink">{solesCent(r.soles_cent)}</Td>
      <Td>
        <div className="flex justify-end gap-1.5">
          <button
            onClick={() => void alternar()}
            disabled={ocupado}
            className={cn(
              "rounded-[8px] px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50",
              r.activa === 1 ? "bg-accent-soft text-accent-ink hover:bg-accent-soft-2" : "bg-ok-soft text-ok hover:opacity-90",
            )}
          >
            {r.activa === 1 ? "Apagar" : "Encender"}
          </button>
          <button
            onClick={() => void borrar()}
            disabled={ocupado}
            className="rounded-[8px] px-2 py-1 text-[12px] text-ink-3 hover:text-accent-ink hover:bg-hover-btn disabled:opacity-50"
            aria-label={`Borrar regla ${r.disparador_valor}`}
          >
            Borrar
          </button>
        </div>
      </Td>
    </TableRow>
  );
}

function FormRegla({ onListo }: { onListo: (mensaje: string) => void }) {
  const [tipo, setTipo] = useState<DisparadorTipo>("principio_activo");
  const [valor, setValor] = useState("");
  const [disparadorRef, setDisparadorRef] = useState<ProductoRef | null>(null);
  const [sugerido, setSugerido] = useState<ProductoRef | null>(null);
  const [guion, setGuion] = useState("");
  const [prioridad, setPrioridad] = useState("0");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valorFinal = tipo === "producto" ? (disparadorRef?.id ?? "") : valor.trim();

  async function crear() {
    setEnviando(true);
    setError(null);
    try {
      await mutar("/sugerencias/reglas", {
        method: "POST",
        body: {
          disparador_tipo: tipo,
          disparador_valor: valorFinal,
          sugerido_producto_id: sugerido?.id ?? "",
          guion,
          prioridad: Number(prioridad) || 0,
        },
      });
      onListo("Regla creada. Aparece en el mostrador en el próximo pull del catálogo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="gap-3">
      <SectionLabel>Nueva regla</SectionLabel>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">Se dispara por</span>
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as DisparadorTipo);
              setValor("");
              setDisparadorRef(null);
            }}
            className={selectCls}
          >
            {DISPARADORES.map((d) => (
              <option key={d} value={d}>{ROTULO[d]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">
            {tipo === "producto" ? "Producto que la dispara" : tipo === "categoria" ? "Categoría (ej. Antibiótico)" : "Principio activo (ej. Ibuprofeno)"}
          </span>
          {tipo === "producto" ? (
            disparadorRef ? (
              <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line-input bg-field px-3 py-2">
                <span className="truncate text-[13px] text-ink">{disparadorRef.nombre}</span>
                <button onClick={() => setDisparadorRef(null)} className="text-[12px] text-link underline">cambiar</button>
              </div>
            ) : (
              <SelectorProducto onSelect={setDisparadorRef} placeholder="Buscar el producto que dispara…" />
            )
          ) : (
            <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder={tipo === "categoria" ? "Antibiótico" : "Ibuprofeno"} />
          )}
          {tipo !== "producto" && (
            <span className="text-[11.5px] text-ink-3">
              Basta con una parte: “Ibuprofeno” alcanza también a “Ibuprofeno 400 mg”. No distingue tildes ni mayúsculas.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">Producto que se sugiere</span>
          {sugerido ? (
            <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line-input bg-field px-3 py-2">
              <span className="truncate text-[13px] text-ink">{sugerido.nombre}</span>
              <button onClick={() => setSugerido(null)} className="text-[12px] text-link underline">cambiar</button>
            </div>
          ) : (
            <SelectorProducto onSelect={setSugerido} placeholder="Buscar el producto a sugerir…" />
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">Prioridad</span>
          <Input value={prioridad} onChange={(e) => setPrioridad(e.target.value)} inputMode="numeric" placeholder="0" />
          <span className="text-[11.5px] text-ink-3">Si dos reglas calzan a la vez, gana la de número más alto (solo se muestra una).</span>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-ink-2">Lo que se le dice a la persona</span>
        <Input
          value={guion}
          onChange={(e) => setGuion(e.target.value.slice(0, MAX_GUION))}
          placeholder="Si lo va a tomar más de dos días, un protector gástrico le cuida el estómago."
        />
        <span className="text-[11.5px] text-ink-3">
          Es la frase que quien atiende dice en voz alta: consejo, nunca oferta. {guion.length}/{MAX_GUION}
        </span>
      </label>

      {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
      <div>
        <Button onClick={() => void crear()} disabled={enviando || !valorFinal || !sugerido || !guion.trim()}>
          {enviando ? "Creando…" : "Crear regla"}
        </Button>
      </div>
    </Card>
  );
}
