/**
 * Coerción a texto de algo que llegó de afuera (cuerpo HTTP, fila de una hoja, columna de D1).
 *
 * Por qué existe: `String(x)` sobre un objeto devuelve la cadena `"[object Object]"`, y eso llegaba a
 * sitios donde se ve — una celda del CSV del pedido al distribuidor, o el NOMBRE de un producto creado
 * desde la bandeja del bot. Un `POST` con `{"nombre": {}}` alcanzaba para dar de alta un producto
 * llamado "[object Object]" en el catálogo de la botica.
 *
 * Lo detectó `@typescript-eslint/no-base-to-string` al migrar el linter en S17.
 *
 * Un objeto o un array no son texto y no se convierten a texto: devuelven cadena vacía, y el
 * validador de arriba decide qué hacer con eso (rechazar la fila, pedir el campo, etc.).
 */
export function aTexto(x: unknown): string {
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "bigint" || typeof x === "boolean") return String(x);
  return "";
}
