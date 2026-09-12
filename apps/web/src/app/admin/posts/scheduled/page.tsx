import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ScheduledPosts } from "@/components/post/ScheduledPosts";
export default async function ScheduledPostsPage() {
  const session = await getSession();
  if (!session || !["admin", "superadmin"].includes(session.role)) redirect("/login");
  return <ScheduledPosts />;
}
