import { Sidebar } from "@/components/Sidebar";
import { ConsentModal } from "@/components/ConsentModal";
import { getServerClient } from "@/lib/supabase/server";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen">
      <Sidebar userEmail={user?.email ?? null} />
      <main className="flex-1 p-8 max-w-5xl">{children}</main>
      {user && <ConsentModal userId={user.id} />}
    </div>
  );
}
