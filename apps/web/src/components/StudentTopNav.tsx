"use client";

import { TopNav, TopNavItem } from "@/components/TopNav";

export function StudentTopNav() {
    const navItems: TopNavItem[] = [
        { href: "/student", label: "Home" },
        { href: "/student/events", label: "Events" },
        { href: "/student/events/new", label: "Log Service" },
        { href: "/student/posts", label: "Posts" },
        { href: "/student/chat", label: "Chat" },
        { href: "/student/resources", label: "Resources" },
    ];

    return <TopNav items={navItems} profileHref="/student/profile" />;
}
