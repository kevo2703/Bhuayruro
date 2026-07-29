// Deep-link de WhatsApp (wa.me) a partir del número del padrón.
//
// La base guarda teléfonos y WhatsApp SOLO en dígitos y SIN código de país, a propósito: es lo único
// que hace comparables "918 343 561", "918-343-561" y "+51 918343561" al buscar en el mostrador. El
// código de país lo pone quien EMITE el mensaje — o sea, esto. La misma regla la va a usar la bandeja
// de reposición de crónicos (A2), así que vive en shared y no en una pantalla.

export const COD_PAIS_PERU = "51";
const LARGO_MOVIL_PE = 9; // los celulares peruanos son 9 dígitos y empiezan con 9

// Número en formato internacional sin "+", o null si no hay con qué armar un enlace creíble.
export function numeroWhatsappInternacional(numero: string | null | undefined, codPais = COD_PAIS_PERU): string | null {
  const d = (numero ?? "").replace(/\D/g, "");
  if (d.length === 0) return null;
  if (d.length === LARGO_MOVIL_PE) return `${codPais}${d}`;
  // Ya viene con el código del país (o es un fijo/extranjero cargado completo): se respeta tal cual.
  if (d.startsWith(codPais) && d.length > LARGO_MOVIL_PE) return d;
  // Cualquier otra cosa (número corto, mal tipeado) NO se "arregla" adivinando: mejor sin enlace.
  return null;
}

// URL lista para abrir el chat. `texto` va pre-cargado en la caja de mensaje (no lo envía solo).
export function enlaceWhatsapp(numero: string | null | undefined, texto?: string): string | null {
  const internacional = numeroWhatsappInternacional(numero);
  if (!internacional) return null;
  const base = `https://wa.me/${internacional}`;
  return texto && texto.trim() ? `${base}?text=${encodeURIComponent(texto.trim())}` : base;
}
