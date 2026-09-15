"use client";

import { TopNav, TopNavItem } from "@/components/TopNav";

export function AdminTopNav() {
    const navItems: TopNavItem[] = [
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/events", label: "Events" },
        { href: "/admin/posts", label: "Posts" },
        { href: "/admin/chat", label: "Chat" },
        { href: "/admin/resources", label: "Resources" },
        { href: "/admin/team", label: "Team" },
    ];

    return <TopNav items={navItems} profileHref="/admin/profile" />;
}
