import { useEffect, useRef, useState } from "react";
import { TEXTO_OPTIN_WHATSAPP } from "@huayruro/shared";
import { buscarClientes, crearCliente, nombreCorto, telefonoLegible, type Cliente } from "../lib/clientes";

type Props = {
  onAsignar: (cliente: Cliente) => void;
  onCerrar: () => void;
};

const DEBOUNCE_MS = 250;
const soloDigitos = (s: string) => s.replace(/\D/g, "");

// "Asignar cliente" del cobro (§12 + expansión A1). UN solo campo: el server ya resuelve tildes, ñ y
// teléfono con espacios o guiones, así que quien atiende teclea lo que oye y listo. Si no está, se crea
// con nombre + celular en el mismo campo — el objetivo son 10 segundos, no un formulario completo.
//
// El opt-in de WhatsApp muestra EL TEXTO que se guarda con fecha en el perfil: es la constancia de lo
// que la persona aceptó, así que se lee tal cual, no se parafrasea.
export function ClienteModal({ onAsignar, onCerrar }: Props) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modoAlta, setModoAlta] = useState(false);
  const cajaRef = useRef<HTMLInputElement>(null);

  // Alta rápida
  const [nombre, setNombre] = useState("");
  const [celular, setCelular] = useState("");
  const [optin, setOptin] = useState(false);
  const [cumple, setCumple] = useState("");
  const [masDatos, setMasDatos] = useState(false);
  const [dni, setDni] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cajaRef.current?.focus();
  }, []);

  // Búsqueda con debounce y cancelación: en el mostrador se teclea rápido y no queremos que una
  // respuesta vieja pise a la nueva.
  useEffect(() => {
    if (modoAlta) return;
    const termino = q.trim();
    if (!termino) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    const ctrl = new AbortController();
    setBuscando(true);
    const t = setTimeout(() => {
      buscarClientes(termino, ctrl.signal)
        .then((cs) => {
          setResultados(cs);
          setError(null);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setResultados([]);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setBuscando(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, modoAlta]);

  // Lo tecleado se reparte solo: si son puros números es el celular; si no, el nombre.
  function abrirAlta() {
    const termino = q.trim();
    if (soloDigitos(termino).length >= 6 && soloDigitos(termino).length === termino.replace(/[\s-]/g, "").length) {
      setCelular(soloDigitos(termino));
      setNombre("");
    } else {
      setNombre(termino);
    }
    setModoAlta(true);
  }

  async function guardar() {
    if (!nombre.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const celularDigitos = soloDigitos(celular);
      const cliente = await crearCliente({
        nombre: nombre.trim(),
        telefono: celularDigitos || null,
        whatsapp: celularDigitos || null,
        optin_whatsapp: optin && celularDigitos.length > 0,
        fecha_nacimiento: cumple || null,
        dni: soloDigitos(dni) || null,
      });
      onAsignar(cliente);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-surface/40 backdrop-blur p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-card border border-line rounded-t-[14px] sm:rounded-[14px] p-5 sm:p-6 shadow-[0_10px_30px_rgba(36,29,26,0.25)] max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">{modoAlta ? "Cliente nuevo" : "Asignar cliente"}</h2>
          <button onClick={onCerrar} className="inline-flex min-h-11 items-center px-2 text-sm underline text-ink-2">
            cerrar
          </button>
        </div>

        {!modoAlta ? (
          <>
            <p className="text-xs text-ink-2 mt-1">Busca por nombre, celular o DNI. Si no está, lo creas acá mismo.</p>
            <input
              ref={cajaRef}
              type="search"
              inputMode="search"
              placeholder="María, 918 343 561, 45678912…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-3 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
            />

            <div className="mt-3 flex-1 overflow-y-auto">
              {buscando && <p className="text-xs text-ink-3 py-2">Buscando…</p>}
              {error && <p className="text-xs text-accent-ink py-2">{error}</p>}
              {resultados.length > 0 && (
                <ul className="divide-y divide-line-row rounded-[9px] bg-inset border border-line-inset">
                  {resultados.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => onAsignar(c)}
                        className="w-full text-left p-3 min-h-11 hover:bg-hover-btn flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold text-ink">{nombreCorto(c)}</span>
                          <span className="block truncate text-[12px] text-ink-2">
                            {c.telefono ? telefonoLegible(c.telefono) : "sin celular"}
                            {c.dni ? ` · DNI ${c.dni}` : ""}
                          </span>
                        </span>
                        {c.optin_whatsapp === 1 && <span title="Aceptó recibir avisos por WhatsApp">✅</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!buscando && q.trim() && resultados.length === 0 && !error && (
                <p className="text-[13px] text-ink-2 py-2">No hay nadie con ese dato en esta botica.</p>
              )}
            </div>

            <button
              onClick={abrirAlta}
              className="mt-3 w-full min-h-11 py-2.5 rounded-[9px] bg-ok-soft border border-ok/30 text-ok font-semibold"
            >
              ➕ Crear cliente {q.trim() ? `"${q.trim()}"` : "nuevo"}
            </button>
          </>
        ) : (
          <div className="mt-3 flex-1 overflow-y-auto">
            <label className="block text-sm text-ink-2">Nombre</label>
            <input
              autoFocus
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="María Quispe"
              className="mt-1 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
            />

            <label className="block text-sm text-ink-2 mt-3">Celular (es también su WhatsApp)</label>
            <input
              type="tel"
              inputMode="numeric"
              value={celular}
              onChange={(e) => setCelular(e.target.value)}
              placeholder="918 343 561"
              className="mt-1 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
            />

            <label className={`mt-3 flex items-start gap-2.5 rounded-[9px] border p-3 ${celular.trim() ? "border-line-inset bg-inset" : "border-line-row bg-card opacity-60"}`}>
              <input
                type="checkbox"
                checked={optin}
                disabled={!celular.trim()}
                onChange={(e) => setOptin(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-ok"
              />
              <span className="text-[13px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">Le preguntaste:</span> “{TEXTO_OPTIN_WHATSAPP}” y dijo que sí.
                <span className="block text-[11.5px] text-ink-3">Se guarda con la fecha y esta misma frase, como constancia.</span>
              </span>
            </label>

            {!masDatos ? (
              <button onClick={() => setMasDatos(true)} className="mt-3 text-[12.5px] underline text-ink-2">
                agregar cumpleaños o DNI
              </button>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-ink-2">Cumpleaños</label>
                  <input
                    type="date"
                    value={cumple}
                    onChange={(e) => setCumple(e.target.value)}
                    className="mt-1 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
                  />
                </div>
                <div>
                  <label className="block text-sm text-ink-2">DNI</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    className="mt-1 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
                  />
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-accent-ink">{error}</p>}

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setModoAlta(false)}
                disabled={guardando}
                className="flex-1 min-h-11 py-2.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn text-sm disabled:opacity-50"
              >
                Volver
              </button>
              <button
                onClick={() => void guardar()}
                disabled={guardando || !nombre.trim()}
                className="flex-1 min-h-11 py-2.5 rounded-[9px] bg-ok hover:bg-ok text-white font-semibold disabled:opacity-30"
              >
                {guardando ? "Guardando…" : "Guardar y asignar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
