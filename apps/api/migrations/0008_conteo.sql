-- ============================================================
-- 0008_conteo — P5 (C3): conteo cíclico de inventario ("Conteo de inventario").
-- Fuente: plan expansión §4 C3 + §5 D ("Merma por conteo"). La persona cuenta físicamente el stock;
-- si el conteo NO cuadra con el sistema, se ajusta el stock (movimiento_stock motivo 'conteo_ciclico')
-- y la diferencia valorizada alimenta el indicador EBR `merma_conteo` (repos/casos.ts).
--
-- FK-safe: son tablas NUEVAS que referencian tablas existentes (no se reconstruye ninguna tabla ya
-- referenciada) → el gotcha D1 de defer_foreign_keys en migrations apply NO aplica aquí.
--
-- VETO D-N5: aunque `conteo_sesion` guarda quién CONTÓ (operador_id) para trazabilidad operativa, la
-- merma NUNCA se atribuye a una persona: el indicador `merma_conteo` abre un caso tipo 'perdida' (sobre
-- el SKU/sesión, no sobre el operador). Un descuadre puede ser recepción mal contada, robo de cliente o
-- vencimiento — no una falta del que contó.
-- ============================================================

-- Una sesión de conteo = una "hoja" contada en un momento (idempotente por client_uuid para reintento
-- offline). Guarda los agregados ya valorizados para que el Cron del EBR no tenga que recomputar.
CREATE TABLE conteo_sesion (
  id                 TEXT PRIMARY KEY,
  client_uuid        TEXT NOT NULL UNIQUE,            -- idempotencia (reintento no re-ajusta el stock)
  sucursal_id        TEXT NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  operador_id        TEXT REFERENCES usuario_perfil(id),  -- quién contó (trazabilidad; NUNCA para 'merma')
  items_contados     INTEGER NOT NULL DEFAULT 0,
  items_descuadrados INTEGER NOT NULL DEFAULT 0,      -- items con diferencia != 0
  merma_valor_cent   INTEGER NOT NULL DEFAULT 0,      -- suma de faltantes valorizados (≤ 0)
  exceso_valor_cent  INTEGER NOT NULL DEFAULT 0,      -- suma de sobrantes valorizados (≥ 0)
  notas              TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_conteo_sesion_sucursal_fecha ON conteo_sesion(sucursal_id, created_at DESC);
-- El indicador de merma escanea por merma reciente (sesiones materiales de los últimos días).
CREATE INDEX idx_conteo_sesion_merma ON conteo_sesion(sucursal_id, created_at) WHERE merma_valor_cent < 0;

-- Una línea por producto contado: esperado (lo que el sistema decía al finalizar) vs contado (lo físico).
CREATE TABLE conteo_item (
  id                    TEXT PRIMARY KEY,
  conteo_sesion_id      TEXT NOT NULL REFERENCES conteo_sesion(id) ON DELETE CASCADE,
  producto_id           TEXT NOT NULL REFERENCES producto_catalogo(id),
  esperado_unidades     INTEGER NOT NULL,            -- stock del sistema al momento de finalizar
  contado_unidades      INTEGER NOT NULL,            -- lo que se contó físicamente (o pesó, C4)
  diferencia_unidades   INTEGER NOT NULL,            -- contado - esperado (negativo = faltante = merma)
  costo_unitario_dm     INTEGER NOT NULL DEFAULT 0,  -- costo por unidad base usado para valorizar (dm)
  diferencia_valor_cent INTEGER NOT NULL DEFAULT 0,  -- diferencia_unidades valorizada (céntimos, con signo)
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_conteo_item_sesion ON conteo_item(conteo_sesion_id);
-- Para el indicador 'merma recurrente': un SKU con faltante en varias sesiones de la ventana.
CREATE INDEX idx_conteo_item_producto ON conteo_item(producto_id, created_at) WHERE diferencia_unidades < 0;
