import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { CreatePostForm } from "@/components/CreatePostForm";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default async function AdminNewPostPage() {
    const session = await getSession();
    if (!session || (session.role !== "admin" && session.role !== "superadmin")) redirect("/");

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href="/admin/posts">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <h1 className="text-lg font-semibold">New Post</h1>
            </div>
            <CreatePostForm backPath="/admin/posts" canManagePosts />
        </div>
    );
}
