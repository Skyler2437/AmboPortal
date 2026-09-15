"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronDown, Gamepad2, Sparkles, UserRound } from "lucide-react";
import { CheddarRain } from "@/components/CheddarRain";
import { SignOutButton } from "@/components/SignOutButton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TopNavItem {
    href: string;
    label: string;
}

interface TopNavProps {
    items: TopNavItem[];
    profileHref: string;
}

export function TopNav({ items, profileHref }: TopNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [rainActive, setRainActive] = useState(false);
    const stopRain = useCallback(() => setRainActive(false), []);
    const homeHref = items[0]?.href || "/";
    const isProfileActive = pathname === profileHref || pathname.startsWith(profileHref + "/");

    // Longest-prefix match: nested items (e.g. /student/events/new) win over
    // their parents, and the root item only highlights on an exact match.
    const activeHref = items.reduce<string | null>((best, item) => {
        const matches = pathname === item.href || (item.href !== homeHref && pathname.startsWith(item.href + "/"));
        if (!matches) return best;
        return !best || item.href.length > best.length ? item.href : best;
    }, null);

    return (
        // h-16 (4rem) is load-bearing: ChatLayout's desktop height is
        // calc(100dvh - 4rem - safe-area), which assumes this exact nav height.
        <header className="sticky top-0 z-40 hidden h-16 items-center border-b bg-white md:flex">
            <CheddarRain isActive={rainActive} onComplete={stopRain} />
            <div className="mx-auto flex h-full w-full max-w-[80rem] items-center gap-6 px-8 lg:gap-8">
                <Link href={homeHref} className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4" aria-label="AmboPortal home">
                    <Image src="/logo.png" alt="" width={32} height={32} />
                    <span className="hidden text-base font-semibold tracking-tight lg:inline">AmboPortal</span>
                </Link>
                <nav aria-label="Main navigation" className="flex h-full min-w-0 flex-1 items-center gap-0.5 lg:gap-1">
                    {items.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            aria-current={item.href === activeHref ? "page" : undefined}
                            className="portal-nav-link"
                            onClick={(e) => {
                                if (item.href.endsWith("/chat") && pathname.startsWith(item.href)) {
                                    e.preventDefault();
                                    router.push(item.href);
                                }
                            }}
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="Account menu"
                            data-active={isProfileActive || undefined}
                            className="group flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-secondary data-[state=open]:text-foreground data-[active=true]:text-primary"
                        >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                                <UserRound className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span>Account</span>
                            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl p-1.5 shadow-lg">
                        <DropdownMenuLabel className="px-2.5 py-2 text-xs font-medium text-muted-foreground">My account</DropdownMenuLabel>
                        <DropdownMenuItem asChild className="min-h-10 cursor-pointer rounded-md px-2.5">
                            <Link href={profileHref} aria-current={isProfileActive ? "page" : undefined}>
                                <UserRound aria-hidden="true" />
                                Profile
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="min-h-10 cursor-pointer rounded-md px-2.5">
                                <Sparkles aria-hidden="true" />
                                Extras
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-44 rounded-lg p-1.5">
                                <DropdownMenuItem asChild className="min-h-10 cursor-pointer rounded-md px-2.5">
                                    <Link href="/play"><Gamepad2 aria-hidden="true" />Play</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setRainActive(true)} className="min-h-10 cursor-pointer rounded-md px-2.5">
                                    <span aria-hidden="true">🧀</span>
                                    Cheddar rain
                                </DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator className="mx-0 my-1.5" />
                        <SignOutButton asMenuItem className="min-h-10 cursor-pointer rounded-md px-2.5 text-red-600 focus:bg-red-50 focus:text-red-700" />
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
