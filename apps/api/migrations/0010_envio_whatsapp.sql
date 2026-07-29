-- ============================================================
-- 0010 — Registro de mensajes de WhatsApp al cliente (A2 v1, plan de expansión §2 A2).
--
-- POR QUÉ EXISTE UNA TABLA Y NO UNA MARCA EN EL NAVEGADOR: la bandeja de reposición se abre desde el
-- celular del mostrador Y desde la compu del panel. Si la marca de "ya le escribí" viviera en el
-- equipo, la señora recibiría el mismo mensaje dos veces el mismo día. Es un dato de la botica, no
-- del navegador.
--
-- LA HEREDA P4b: cuando el envío se automatice (Cron + guardrails de MV), esta misma tabla es el
-- CANDADO del cooldown ("1 mensaje por cliente cada 7 días, sea del tipo que sea") y el registro de
-- auditoría de qué se mandó. Por eso `motivo` ya admite los tipos que vendrán (cumpleaños,
-- reactivación de A3) y `origen` distingue el mensaje que mandó una persona del que mandó el sistema.
-- Si la dejáramos solo para reposición, P4b tendría que migrarla de nuevo.
--
-- SE GUARDA EL TEXTO (`mensaje`): sin él no se puede auditar qué se le dijo a quién, y el
-- refinamiento de tono de S19 no tendría con qué comparar. Es el mensaje que se pre-cargó; quien
-- atiende puede editarlo en WhatsApp antes de mandar, así que no es prueba de envío — es el registro
-- de lo que el sistema propuso. La v1 es ASISTIDA: acá nadie envía nada, solo se anota.
-- ============================================================

CREATE TABLE envio_whatsapp (
  id              TEXT PRIMARY KEY,
  sucursal_id     TEXT NOT NULL REFERENCES sucursal(id),
  cliente_id      TEXT NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  motivo          TEXT NOT NULL CHECK (motivo IN ('reposicion','cumpleanos','reactivacion','otro')),
  -- 'asistido' = una persona abrió el wa.me y lo mandó (v1). 'automatico' = lo mandó el Cron (P4b).
  origen          TEXT NOT NULL DEFAULT 'asistido' CHECK (origen IN ('asistido','automatico')),
  -- De qué aviso concreto se trata. Es lo que evita repetir: mientras la persona no vuelva a comprar,
  -- ese aviso ya está atendido. Una compra nueva genera otra línea de venta = otro aviso.
  referencia_tipo TEXT CHECK (referencia_tipo IS NULL OR referencia_tipo IN ('venta_item','tratamiento')),
  referencia_id   TEXT,
  producto_id     TEXT REFERENCES producto_catalogo(id),
  mensaje         TEXT,
  enviado_at      TEXT NOT NULL,
  -- Quién lo marcó. NO es señal de supervisión de personal (veto D-N5, que rige el audio y la
  -- biometría): es una acción deliberada hacia un cliente y necesita responsable, igual que una
  -- anulación o un ajuste de stock.
  operador_id     TEXT REFERENCES usuario_perfil(id),
  created_at      TEXT NOT NULL
);

-- EL CANDADO de verdad contra el mensaje repetido: un aviso concreto se registra UNA vez. Va como
-- índice PARCIAL porque en SQLite un UNIQUE normal deja pasar N filas con `referencia_id` NULL, y
-- los motivos que no cuelgan de un aviso puntual (un saludo suelto) sí pueden repetirse.
CREATE UNIQUE INDEX idx_envio_referencia
  ON envio_whatsapp(cliente_id, motivo, referencia_tipo, referencia_id)
  WHERE referencia_id IS NOT NULL;

-- Cooldown por persona (lo que P4b va a consultar antes de cada envío) y "a quién le escribimos hoy".
CREATE INDEX idx_envio_cliente ON envio_whatsapp(cliente_id, enviado_at DESC);
CREATE INDEX idx_envio_sucursal ON envio_whatsapp(sucursal_id, motivo, enviado_at DESC);
