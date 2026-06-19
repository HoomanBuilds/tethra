"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccentDot } from "@/components/app/app-kit";

const navLinks = [
  { name: "Overview", href: "/app" },
  { name: "Deposit", href: "/app/deposit" },
  { name: "Lend", href: "/app/lend" },
  { name: "Portfolio", href: "/app/portfolio" },
  { name: "Analytics", href: "/app/analytics" },
  { name: "Activity", href: "/app/activity" },
];

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-foreground/10 bg-background">
      <Link href="/app" className="flex items-center gap-2 h-16 px-6 border-b border-foreground/10">
        <span className="font-display text-2xl tracking-tight text-foreground">Tethra</span>
        <span className="font-mono text-[10px] mt-1 text-muted-foreground">TM</span>
      </Link>

      <nav className="flex-1 px-3 py-6">
        {navLinks.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                active
                  ? "bg-foreground/[0.04] text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]"
              }`}
            >
              <AccentDot active={active} />
              {link.name}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-6 border-t border-foreground/10 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-foreground/20" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Testnet
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#eca8d6]" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Vault live
          </span>
        </div>
      </div>
    </aside>
  );
}
