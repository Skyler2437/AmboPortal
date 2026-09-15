import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { AdminTopNav } from "@/components/AdminTopNav";
import AdminMobileBottomNav from "@/components/AdminMobileBottomNav";

// Admin pages are auth-gated and per-request (they read the session cookie and
// use the Supabase service-role client), so they must never be statically
// prerendered. Forcing dynamic also stops Next from probe-rendering them at
// build time, where SUPABASE_SERVICE_ROLE_KEY is absent and createAdminClient()
// throws "Missing Supabase URL or Service Role Key" into the build logs.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session || (session.role !== "admin" && session.role !== "superadmin")) {
    redirect("/login");
  }

  return (
    <div className="portal-shell flex min-h-screen flex-col">
      {/* Desktop Top Nav */}
      <AdminTopNav />

      <main className="portal-main flex-1 p-4 pb-24 md:p-8 md:pb-8 overflow-x-hidden">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <AdminMobileBottomNav />
    </div>
  );
}
