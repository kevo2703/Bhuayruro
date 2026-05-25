// Política pública — copiada desde docs/legal/politica-privacidad.md
// Mantener sincronizada con ese archivo (fuente de verdad).

export default function PrivacidadPage() {
  return (
    <article className="prose prose-invert max-w-3xl">
      <h1 className="text-3xl font-bold">Política de Privacidad — Cadena Botica Huayruro</h1>
      <p className="opacity-60 text-sm">
        Última actualización: 2026-05-24 · Marco legal: Ley N° 29733 + D.S. 016-2024-JUS
      </p>

      <h2 className="mt-8 text-xl font-semibold">1. Responsable del tratamiento</h2>
      <p className="opacity-90 mt-2">
        <strong>Cadena Botica Huayruro</strong> (en transición a régimen formal). Establecimientos:
        Botica Huayruro VES (Villa El Salvador, Lima), Botica Huayruro Chazuta Puerto y Botica
        Huayruro Chazuta Plaza (San Martín).
      </p>
      <p className="opacity-90 mt-2">
        <strong>Contacto privacidad:</strong> privacidad@huayruro.pe (en habilitación).{" "}
        <strong>Oficial de Datos Personales:</strong> Kevin Mandujano.
      </p>

      <h2 className="mt-8 text-xl font-semibold">2. Qué datos recolectamos</h2>
      <p className="opacity-90 mt-2">
        En nuestro sistema POS, recolectamos datos solo de <strong>operadores</strong> (personal de
        las boticas): nombre completo, email, rol asignado y log de actividad dentro del sistema.
      </p>
      <p className="opacity-90 mt-2">
        <strong>No recolectamos datos del cliente final</strong> que compra en mostrador: ni nombre,
        ni DNI, ni síntomas, ni diagnóstico. Por diseño técnico, el sistema solo registra la
        transacción (producto, monto, método de pago).
      </p>

      <h2 className="mt-8 text-xl font-semibold">3. Video vigilancia</h2>
      <p className="opacity-90 mt-2">
        Las boticas cuentan con cámaras IP con fines de seguridad. Las grabaciones se conservan
        hasta 30 días. No se comparten con terceros salvo requerimiento de autoridad competente.
      </p>

      <h2 className="mt-8 text-xl font-semibold">4. Finalidades del tratamiento</h2>
      <ul className="list-disc list-inside opacity-90 mt-2 space-y-1">
        <li>Operación del POS de venta y control de inventario</li>
        <li>Trazabilidad de lotes y vencimientos (cumplimiento DIGEMID)</li>
        <li>Seguridad (video vigilancia, audit log de operadores)</li>
        <li>Cumplimiento de obligaciones legales y tributarias</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">5. Plazos de retención</h2>
      <ul className="list-disc list-inside opacity-90 mt-2 space-y-1">
        <li>Audit log de operadores: 2 años</li>
        <li>Ventas y movimientos de stock: 5 años (período tributario referencial)</li>
        <li>Quiebres y no-compras: 12 meses</li>
        <li>Datos de operadores ex-empleados: 5 años anonimizados</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">6. Derechos del titular (ARCO)</h2>
      <p className="opacity-90 mt-2">Tenés derecho a:</p>
      <ul className="list-disc list-inside opacity-90 mt-2 space-y-1">
        <li>
          <strong>Acceso:</strong> consultar qué datos tenemos tuyos
        </li>
        <li>
          <strong>Rectificación:</strong> corregir datos inexactos
        </li>
        <li>
          <strong>Cancelación:</strong> solicitar eliminación (con límites de retención legal)
        </li>
        <li>
          <strong>Oposición:</strong> oponerte al tratamiento cuando proceda
        </li>
      </ul>
      <p className="opacity-90 mt-2">
        Para ejercerlos: email a privacidad@huayruro.pe con asunto "Solicitud ARCO". Respondemos en
        máximo 15 días hábiles (plazo legal: 20 días).
      </p>

      <h2 className="mt-8 text-xl font-semibold">7. Medidas de seguridad</h2>
      <ul className="list-disc list-inside opacity-90 mt-2 space-y-1">
        <li>Encriptación en tránsito (HTTPS/TLS 1.3) y en reposo</li>
        <li>Autenticación con email + magic link / contraseña fuerte</li>
        <li>Row Level Security (Postgres) para aislamiento entre sucursales</li>
        <li>Audit log de operaciones sensibles</li>
        <li>Notificación de incidentes de seguridad a ANPDP en 48 horas</li>
      </ul>

      <h2 className="mt-8 text-xl font-semibold">8. Transferencias internacionales</h2>
      <p className="opacity-90 mt-2">
        Los datos se almacenan en servidores de <strong>Supabase</strong> y <strong>Vercel</strong>,
        que pueden ubicarse en Estados Unidos o Unión Europea. Estos proveedores ofrecen garantías
        de seguridad equivalentes a las exigidas por la LPDP peruana.
      </p>

      <h2 className="mt-8 text-xl font-semibold">9. Reclamaciones</h2>
      <p className="opacity-90 mt-2">
        Si considerás que tus derechos no fueron atendidos correctamente, podés reclamar ante la{" "}
        <strong>Autoridad Nacional de Protección de Datos Personales (ANPDP)</strong> del
        Ministerio de Justicia.
      </p>
    </article>
  );
}
