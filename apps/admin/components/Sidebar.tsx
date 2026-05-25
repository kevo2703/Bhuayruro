"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/catalogo", label: "Catálogo" },
  { href: "/sucursales", label: "Sucursales" },
  { href: "/usuarios", label: "Usuarios" },
  { href: "/privacidad", label: "Privacidad" },
];

type Props = {
  userEmail: string | null;
};

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = getBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 min-h-screen border-r border-white/10 p-4 flex flex-col">
      <div className="mb-6">
        <h1 className="text-lg font-bold">Botica Huayruro</h1>
        <p className="text-xs opacity-60">Admin</p>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded text-sm transition ${
                active ? "bg-emerald-500/20 text-emerald-300" : "hover:bg-white/5 opacity-80"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 pt-4 border-t border-white/10 text-xs">
        <p className="opacity-50 truncate" title={userEmail ?? undefined}>
          {userEmail ?? "—"}
        </p>
        <button
          onClick={() => void handleSignOut()}
          className="mt-2 opacity-60 hover:opacity-100 underline"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
