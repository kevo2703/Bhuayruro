// Consentimiento de WhatsApp del cliente (P1 / plan expansión §1 y A2).
//
// El texto vive acá y no en la UI porque es la CONSTANCIA de lo que la persona aceptó: se muestra en el
// mostrador y se guarda tal cual en `cliente.optin_whatsapp_texto` junto con la fecha. Si algún día se
// reformula, los perfiles viejos conservan la redacción que de verdad se les leyó — que es lo único
// defendible si alguien reclama por qué le escriben.
//
// Redacción aprobada por Kevin (S13): nombra el canal, el para qué y el límite del uso en una sola
// frase de mostrador. Al decir "su medicina" el consentimiento queda amarrado al SEGUIMIENTO del
// tratamiento, no a publicidad — que es exactamente el alcance que A2 usa (recordatorio de reposición).
export const TEXTO_OPTIN_WHATSAPP = "¿Me da su WhatsApp para avisarle cuando le toque su medicina?";
