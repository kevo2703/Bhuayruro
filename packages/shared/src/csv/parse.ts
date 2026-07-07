// Parser CSV robusto (RFC 4180 + realidades de Excel es-PE), sin dependencias.
// Maneja: comillas dobles con "" escapado, saltos de línea DENTRO de campos entre comillas,
// BOM inicial, fin de línea CRLF o LF, y detección de delimitador (';' de Excel es-PE, ',' o tab).
// Devuelve filas de celdas ya "des-comilladas"; NO interpreta cabeceras ni tipos (eso es del validador).

export type CsvParseado = {
  delimitador: string; // el detectado
  filas: string[][]; // incluye la fila de cabecera; sin filas totalmente vacías al final
  comillasSinCerrar: boolean; // true si una comilla abierta nunca se cerró (archivo probablemente corrupto)
};

const DELIMS = [";", ",", "\t", "|"] as const;

// Cuenta ocurrencias de cada delimitador candidato FUERA de comillas en la primera línea lógica.
function detectarDelimitador(texto: string): string {
  // Tomamos hasta el primer salto de línea que no esté entre comillas.
  let dentroComillas = false;
  let fin = texto.length;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === '"') dentroComillas = !dentroComillas;
    else if ((ch === "\n" || ch === "\r") && !dentroComillas) {
      fin = i;
      break;
    }
  }
  const cabecera = texto.slice(0, fin);
  let mejor = ",";
  let mejorConteo = -1;
  for (const d of DELIMS) {
    let conteo = 0;
    let comillas = false;
    for (let i = 0; i < cabecera.length; i++) {
      const ch = cabecera[i];
      if (ch === '"') comillas = !comillas;
      else if (ch === d && !comillas) conteo++;
    }
    if (conteo > mejorConteo) {
      mejor = d;
      mejorConteo = conteo;
    }
  }
  return mejor;
}

/**
 * Parsea un texto CSV a matriz de celdas. Si no se pasa `delimitador`, lo detecta de la cabecera.
 * Las celdas vienen trim() NO aplicado dentro de comillas; fuera de comillas se recorta el espacio
 * de borde por conveniencia del usuario (el validador vuelve a normalizar por campo).
 */
export function parseCsv(textoCrudo: string, delimitadorForzado?: string): CsvParseado {
  // Quita BOM.
  const texto = textoCrudo.charCodeAt(0) === 0xfeff ? textoCrudo.slice(1) : textoCrudo;
  const delimitador = delimitadorForzado ?? detectarDelimitador(texto);

  const filas: string[][] = [];
  let celda = "";
  let fila: string[] = [];
  let dentroComillas = false;
  let celdaTuvoComillas = false;

  const pushCelda = () => {
    // Fuera de comillas recortamos bordes; con comillas respetamos el contenido literal.
    fila.push(celdaTuvoComillas ? celda : celda.trim());
    celda = "";
    celdaTuvoComillas = false;
  };
  const pushFila = () => {
    pushCelda();
    // Ignora filas totalmente vacías (p.ej. líneas en blanco al final).
    if (!(fila.length === 1 && fila[0] === "")) filas.push(fila);
    fila = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (dentroComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++; // comilla escapada ""
        } else {
          dentroComillas = false;
        }
      } else {
        celda += ch;
      }
      continue;
    }
    // La comilla SOLO abre campo entrecomillado al inicio de la celda (RFC 4180). Una comilla suelta
    // en medio de un valor sin comillas (p.ej. `Alcohol 70" antiséptico`) se trata como literal.
    if (ch === '"' && celda === "" && !celdaTuvoComillas) {
      dentroComillas = true;
      celdaTuvoComillas = true;
      continue;
    }
    if (ch === delimitador) {
      pushCelda();
      continue;
    }
    if (ch === "\r") {
      // CRLF o CR solo → fin de fila; si viene \n lo saltamos.
      if (texto[i + 1] === "\n") i++;
      pushFila();
      continue;
    }
    if (ch === "\n") {
      pushFila();
      continue;
    }
    celda += ch;
  }
  // Última fila sin salto final.
  if (celda !== "" || fila.length > 0) pushFila();

  return { delimitador, filas, comillasSinCerrar: dentroComillas };
}
