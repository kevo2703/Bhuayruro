// Une clases condicionalmente. Los primitivos del design system lo usan para
// componer utilidades de Tailwind sin arrastrar dependencias.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
