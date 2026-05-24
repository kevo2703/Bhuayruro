import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Botica Huayruro · Admin",
  description: "Panel administrativo de la cadena Botica Huayruro",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-PE">
      <body>{children}</body>
    </html>
  );
}
