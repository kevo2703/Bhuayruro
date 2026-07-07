// Motor del pedido óptimo — B8.3. Módulo PURO (sin DB): el repo carga faltantes + ofertas y llama
// a `compararPedido`; el golden test del comparador (plan §6.4) fija el combo óptimo a mano.
//
// Decisiones cerradas (plan §2.3, NO reabrir):
//   D-N1 comparación por UNIDAD BASE (factor caja→unidad).
//   D-N2 bonificación al precio EFECTIVO, en enteros (jamás floats).
//   D-N3 consolidar en 1–2 proveedores por ENUMERACIÓN exacta (singles + pares), respetando mínimos.
//
// Simplificación v1 (documentada; T-K13 valida con combos reales): la bonificación se modela como
// descuento PROPORCIONAL sobre el precio (no escalonado por umbral de compra). El precio efectivo y
// el total del renglón usan la MISMA base, así que son consistentes entre sí.
import { rndDiv } from "../calculos/dinero";

const norm = (compra: number | null, gratis: number | null): { compra: number; gratis: number } => ({
  compra: compra && compra > 0 ? compra : 1,
  gratis: gratis && gratis > 0 ? gratis : 0,
});

/**
 * Precio por UNIDAD BASE en diezmilésimas, con bonificación (D-N1/D-N2). Enteros, sin floats:
 *   precio_unidad_dm = round(precio_cent × 100 × compra / ((compra+gratis) × factor))
 * Sin bonif (compra=1,gratis=0) → round(precio_cent × 100 / factor).
 */
export function precioEfectivoUnidadDm(precioCent: number, factor: number, bonifCompra: number | null, bonifGratis: number | null): number {
  if (factor <= 0) throw new RangeError(`factor debe ser >0: ${factor}`);
  const { compra, gratis } = norm(bonifCompra, bonifGratis);
  return rndDiv(precioCent * 100 * compra, (compra + gratis) * factor);
}

/** Unidades de venta del proveedor a pedir para cubrir `necesidadBase` (redondeo hacia ARRIBA). */
export function unidadesProveedor(necesidadBase: number, factor: number): number {
  if (factor <= 0) throw new RangeError(`factor debe ser >0: ${factor}`);
  return Math.ceil(necesidadBase / factor);
}

/**
 * Total del renglón en céntimos: lo que se paga por `unidadesProv` unidades de venta, con la
 * bonificación como descuento proporcional. round(precio_cent × compra × unidadesProv / (compra+gratis)).
 * Sin bonif → precio_cent × unidadesProv exacto.
 */
export function renglonCent(precioCent: number, unidadesProv: number, bonifCompra: number | null, bonifGratis: number | null): number {
  const { compra, gratis } = norm(bonifCompra, bonifGratis);
  return rndDiv(precioCent * compra * unidadesProv, compra + gratis);
}

export type OfertaComparable = {
  lista_item_id: string;
  producto_id: string;
  proveedor_id: string;
  precio_cent: number;
  factor_unidades: number; // > 0 (las de factor NULL no entran al motor)
  bonif_compra: number | null;
  bonif_gratis: number | null;
  venc_corto: number; // 0|1
  vencimiento: string | null;
};

export type ProveedorComparable = {
  id: string;
  nombre: string;
  monto_minimo_cent: number;
  flete_cent: number;
};

export type Necesidad = { producto_id: string; nombre: string; unidades_base: number };

export type OpcionesPedido = {
  // producto_ids donde el humano ACEPTA una oferta de vencimiento corto (si no, no se auto-elige).
  aceptarVencCorto?: Set<string>;
};

export type RenglonPedido = {
  producto_id: string;
  nombre: string;
  lista_item_id: string;
  unidades_base: number; // lo que se necesita
  unidades_prov: number; // redondeado a la unidad de venta del proveedor
  factor_unidades: number;
  precio_cent: number; // precio de lista por unidad de venta del proveedor
  precio_unidad_dm: number; // efectivo por unidad base (post-bonif) — para comparar
  renglon_cent: number; // total del renglón
  bonif_compra: number | null;
  bonif_gratis: number | null;
  venc_corto: number;
  vencimiento: string | null;
};

export type ProveedorEnCombo = {
  id: string;
  nombre: string;
  monto_minimo_cent: number;
  flete_cent: number;
  subtotal_cent: number; // Σ renglones (sin flete)
  cumple_minimo: boolean;
  faltan_minimo_cent: number; // 0 si cumple
  renglones: RenglonPedido[];
};

export type ComboPedido = {
  proveedor_ids: string[]; // ordenados (identidad del combo)
  proveedores: ProveedorEnCombo[]; // solo los USADOS (con ≥1 renglón)
  cubiertos: number;
  sin_cubrir: { producto_id: string; nombre: string }[];
  cobertura: number; // 0..1
  total_cent: number; // Σ subtotales + Σ fletes de usados
  valido: boolean; // cubre algo Y todos los usados llegan a su mínimo
};

export type ResultadoComparacion = {
  combos: ComboPedido[]; // ordenados: cobertura DESC, válido DESC, total ASC
  top3: (ComboPedido & { delta_cent: number })[]; // delta vs el #1
  sin_oferta: { producto_id: string; nombre: string }[]; // sin oferta en NINGÚN proveedor
};

/** Evalúa UN combo (1 o 2 proveedores): asigna cada necesidad al proveedor más barato del combo. */
export function evaluarCombo(combo: ProveedorComparable[], necesidades: Necesidad[], ofertas: OfertaComparable[], opts: OpcionesPedido = {}): ComboPedido {
  const aceptar = opts.aceptarVencCorto ?? new Set<string>();
  const ids = new Set(combo.map((p) => p.id));
  const acc = new Map<string, RenglonPedido[]>(); // proveedor_id → renglones
  const sinCubrir: { producto_id: string; nombre: string }[] = [];

  for (const nec of necesidades) {
    if (nec.unidades_base <= 0) continue;
    // ofertas elegibles de este producto dentro del combo (venc corto excluido salvo aceptación)
    const cand = ofertas.filter(
      (o) => o.producto_id === nec.producto_id && ids.has(o.proveedor_id) && o.factor_unidades > 0 && (o.venc_corto === 0 || aceptar.has(o.producto_id)),
    );
    if (cand.length === 0) {
      sinCubrir.push({ producto_id: nec.producto_id, nombre: nec.nombre });
      continue;
    }
    // más barato por unidad base; desempate estable (precio_cent, luego proveedor_id)
    let mejor = cand[0]!;
    let mejorDm = precioEfectivoUnidadDm(mejor.precio_cent, mejor.factor_unidades, mejor.bonif_compra, mejor.bonif_gratis);
    for (const o of cand.slice(1)) {
      const dm = precioEfectivoUnidadDm(o.precio_cent, o.factor_unidades, o.bonif_compra, o.bonif_gratis);
      if (dm < mejorDm || (dm === mejorDm && (o.precio_cent < mejor.precio_cent || (o.precio_cent === mejor.precio_cent && o.proveedor_id < mejor.proveedor_id)))) {
        mejor = o;
        mejorDm = dm;
      }
    }
    const uProv = unidadesProveedor(nec.unidades_base, mejor.factor_unidades);
    const renglon: RenglonPedido = {
      producto_id: nec.producto_id,
      nombre: nec.nombre,
      lista_item_id: mejor.lista_item_id,
      unidades_base: nec.unidades_base,
      unidades_prov: uProv,
      factor_unidades: mejor.factor_unidades,
      precio_cent: mejor.precio_cent,
      precio_unidad_dm: mejorDm,
      renglon_cent: renglonCent(mejor.precio_cent, uProv, mejor.bonif_compra, mejor.bonif_gratis),
      bonif_compra: mejor.bonif_compra,
      bonif_gratis: mejor.bonif_gratis,
      venc_corto: mejor.venc_corto,
      vencimiento: mejor.vencimiento,
    };
    const lista = acc.get(mejor.proveedor_id) ?? [];
    lista.push(renglon);
    acc.set(mejor.proveedor_id, lista);
  }

  const usados: ProveedorEnCombo[] = [];
  let total = 0;
  for (const p of combo) {
    const renglones = acc.get(p.id);
    if (!renglones || renglones.length === 0) continue;
    const subtotal = renglones.reduce((s, r) => s + r.renglon_cent, 0);
    const cumple = subtotal >= p.monto_minimo_cent;
    usados.push({
      id: p.id,
      nombre: p.nombre,
      monto_minimo_cent: p.monto_minimo_cent,
      flete_cent: p.flete_cent,
      subtotal_cent: subtotal,
      cumple_minimo: cumple,
      faltan_minimo_cent: cumple ? 0 : p.monto_minimo_cent - subtotal,
      renglones,
    });
    total += subtotal + p.flete_cent;
  }

  const cubiertos = necesidades.filter((n) => n.unidades_base > 0).length - sinCubrir.length;
  const totalNec = necesidades.filter((n) => n.unidades_base > 0).length;
  return {
    proveedor_ids: [...ids].sort(),
    proveedores: usados,
    cubiertos,
    sin_cubrir: sinCubrir,
    cobertura: totalNec === 0 ? 0 : cubiertos / totalNec,
    total_cent: total,
    valido: cubiertos > 0 && usados.every((u) => u.cumple_minimo),
  };
}

/**
 * Compara todos los combos de 1 y 2 proveedores (enumeración exacta — D-N3) y los ordena
 * (cobertura DESC, válido DESC, total ASC). Solo entran proveedores con al menos una oferta para
 * las necesidades. Devuelve el ranking completo + top-3 con delta y los productos sin oferta alguna.
 */
export function compararPedido(necesidades: Necesidad[], ofertas: OfertaComparable[], proveedores: ProveedorComparable[], opts: OpcionesPedido = {}): ResultadoComparacion {
  const necesita = necesidades.filter((n) => n.unidades_base > 0);
  const idsConOferta = new Set(ofertas.map((o) => o.proveedor_id));
  const elegibles = proveedores.filter((p) => idsConOferta.has(p.id));

  const combos: ComboPedido[] = [];
  for (let i = 0; i < elegibles.length; i++) {
    combos.push(evaluarCombo([elegibles[i]!], necesita, ofertas, opts));
    for (let j = i + 1; j < elegibles.length; j++) {
      combos.push(evaluarCombo([elegibles[i]!, elegibles[j]!], necesita, ofertas, opts));
    }
  }

  const conCobertura = combos.filter((c) => c.cubiertos > 0);
  conCobertura.sort((a, b) => {
    if (b.cobertura !== a.cobertura) return b.cobertura - a.cobertura;
    if (a.valido !== b.valido) return a.valido ? -1 : 1;
    if (a.total_cent !== b.total_cent) return a.total_cent - b.total_cent;
    // desempate estable: menos proveedores, luego identidad del combo
    if (a.proveedor_ids.length !== b.proveedor_ids.length) return a.proveedor_ids.length - b.proveedor_ids.length;
    return a.proveedor_ids.join().localeCompare(b.proveedor_ids.join());
  });

  // Dedup por proveedores REALMENTE usados: un combo {A,C} donde C queda sin renglón colapsa a {A}
  // (mismo pedido). Ya viene ordenado best-first, así que nos quedamos con la primera aparición.
  const vistos = new Set<string>();
  const ranking: ComboPedido[] = [];
  for (const c of conCobertura) {
    const firma = c.proveedores.map((p) => p.id).sort().join("|");
    if (vistos.has(firma)) continue;
    vistos.add(firma);
    ranking.push(c);
  }

  const mejorTotal = ranking[0]?.total_cent ?? 0;
  const top3 = ranking.slice(0, 3).map((c) => ({ ...c, delta_cent: c.total_cent - mejorTotal }));

  // Productos sin oferta en NINGÚN proveedor (siempre sin cubrir).
  const conAlguna = new Set(ofertas.filter((o) => o.factor_unidades > 0).map((o) => o.producto_id));
  const sinOferta = necesita.filter((n) => !conAlguna.has(n.producto_id)).map((n) => ({ producto_id: n.producto_id, nombre: n.nombre }));

  return { combos: ranking, top3, sin_oferta: sinOferta };
}
