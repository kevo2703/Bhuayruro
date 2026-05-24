import { z } from "zod";

export const metodoPagoSchema = z.enum([
  "efectivo",
  "yape",
  "plin",
  "tarjeta",
  "transferencia",
  "otro",
]);

export type MetodoPago = z.infer<typeof metodoPagoSchema>;

export const ventaItemInputSchema = z.object({
  producto_id: z.string().uuid(),
  lote_id: z.string().uuid().optional(),
  cantidad: z.number().positive().finite(),
  precio_sin_igv_unitario: z.number().nonnegative().finite(),
});

export type VentaItemInput = z.infer<typeof ventaItemInputSchema>;

export const registrarVentaInputSchema = z.object({
  client_uuid: z.string().uuid(),
  sucursal_id: z.string().uuid(),
  metodo_pago: metodoPagoSchema,
  items: z.array(ventaItemInputSchema).min(1, "La venta debe tener al menos 1 item"),
  observaciones: z.string().max(500).optional(),
  fecha_hora_cliente: z.string().datetime().optional(),
});

export type RegistrarVentaInput = z.infer<typeof registrarVentaInputSchema>;

export const registrarVentaOutputSchema = z.object({
  venta_id: z.string().uuid(),
  total: z.number(),
  fecha_hora_servidor: z.string().datetime(),
  guia_interna_numero: z.string().optional(),
  idempotent: z.boolean().optional(),
});

export type RegistrarVentaOutput = z.infer<typeof registrarVentaOutputSchema>;
