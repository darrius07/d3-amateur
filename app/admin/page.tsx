import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("user_profiles").select("display_name,d3_admin_role").eq("id", user.id).maybeSingle();
  if (!profile?.d3_admin_role) redirect("/");
  return <main className="main"><section className="card"><p className="eyebrow">Administration D3</p><h1>Fondation</h1><p className="lead">Espace réservé aux administrateurs D3. Les outils seront ajoutés lors d’une étape ultérieure.</p></section></main>;
}
