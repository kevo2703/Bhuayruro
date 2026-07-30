import { useCallback, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { elegirSugerencia, uuidv7, type ProductoDisparador, type ResultadoSugerencia } from "@huayruro/shared";
import { dbLocal } from "./db-local";
import { encolar } from "./cola";
import { flushAhora } from "./useSyncPos";
import type { ProductoVenta } from "./tipos";

// ============================================================
// A4 — La sugerencia de la atención en curso.
//
// Decisiones que se ven acá y conviene no re-litigar:
//   · El motor corre LOCAL (reglas en Dexie): en hora punta un consejo que espera un round-trip
//     llega cuando la persona ya se fue.
//   · MÁXIMO UNA sugerencia por venta (veto §2 A4, ratificado en la spec de S15): `yaMostrada` se
//     apaga recién al cerrar la atención, así que agregar más productos no trae otra tarjeta.
//   · Los eventos se acumulan y se mandan al CERRAR la atención, no en el momento: la cola es FIFO,
//     así que la venta viaja primero y el server puede enganchar el `venta_id` por su client_uuid.
//     Mandarlos antes dejaría el evento sin venta y la tabla no podría medir soles reales.
//   · Si la atención se cierra SIN venta (la persona se fue), los eventos se mandan igual: contar
//     solo las atenciones que terminaron en compra inflaría la conversión.
//
// Lo que se pierde a propósito (v1): si se recarga la página con una tarjeta en pantalla, esos
// eventos no llegan. Son segundos de vida y no valen una tabla intermedia en Dexie.
// ============================================================

export type SugerenciaViva = {
  reglaId: string;
  guion: string;
  producto: ProductoVenta;
};

type EventoPendiente = { id: string; regla_id: string; resultado: ResultadoSugerencia; fecha_hora: string };

export function useSugerencia(activo: boolean) {
  // Las reglas viven en Dexie y el sync las reemplaza enteras: apagar una regla en el panel la saca
  // del mostrador en el siguiente pull, sin recargar nada.
  const reglas = useLiveQuery(async () => (activo ? await dbLocal.reglas.toArray() : []), [activo]);

  const [viva, setViva] = useState<SugerenciaViva | null>(null);
  // Buffer y tope en refs: los lee `cerrar()` dentro de un handler asíncrono y no puede depender de
  // que React ya haya re-renderizado.
  const eventos = useRef<EventoPendiente[]>([]);
  const yaMostrada = useRef(false);

  const registrar = useCallback((reglaId: string, resultado: ResultadoSugerencia) => {
    // El id lo genera el POS: es la llave de idempotencia con la que el server no duplica cuando la
    // cola reintenta tras un corte.
    eventos.current.push({ id: uuidv7(), regla_id: reglaId, resultado, fecha_hora: new Date().toISOString() });
  }, []);

  /**
   * Evalúa el producto que acaba de entrar al carrito. Devuelve la tarjeta si hay consejo que dar.
   * `resolver` traduce el producto sugerido de la regla a algo vendible en ESTA botica (precio
   * vigente y presentación base); si no lo puede resolver, no hay tarjeta.
   */
  const evaluar = useCallback(
    (
      disparador: ProductoDisparador,
      productosEnCarrito: string[],
      stockPorProducto: Record<string, number> | null,
      resolver: (productoId: string) => ProductoVenta | null,
    ): void => {
      if (!activo || yaMostrada.current || !reglas?.length) return;
      const regla = elegirSugerencia(reglas, disparador, { productosEnCarrito, stockPorProducto });
      if (!regla) return;
      const producto = resolver(regla.sugerido_producto_id);
      if (!producto) return; // sin precio vigente acá: no se puede ofrecer lo que no se puede cobrar

      yaMostrada.current = true;
      registrar(regla.id, "mostrada");
      setViva({ reglaId: regla.id, guion: regla.guion, producto });
    },
    [activo, reglas, registrar],
  );

  /** Un tap la agrega al carrito; el otro la descarta. Ambos se miden. */
  const responder = useCallback(
    (resultado: Exclude<ResultadoSugerencia, "mostrada">) => {
      setViva((actual) => {
        if (actual) registrar(actual.reglaId, resultado);
        return null;
      });
    },
    [registrar],
  );

  /**
   * Cierra la atención: manda lo que pasó por la cola offline y limpia el tope. `ventaClientUuid`
   * viene cuando se cobró (para que el server enganche la venta) y es null si la persona se fue.
   */
  const cerrar = useCallback(async (ventaClientUuid: string | null): Promise<void> => {
    const pendientes = eventos.current;
    eventos.current = [];
    yaMostrada.current = false;
    setViva(null);
    if (pendientes.length === 0) return;
    await encolar(dbLocal, "sugerencia", { eventos: pendientes, venta_client_uuid: ventaClientUuid });
    flushAhora();
  }, []);

  return { viva, evaluar, responder, cerrar, hayReglas: (reglas?.length ?? 0) > 0 };
}
