import type { ReactNode } from "react";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { Toaster } from "@/components/ui/sonner";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/world.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 right-0 w-[480px] max-w-[60vw] object-contain opacity-[0.04]"
      />

      <Sidebar />

      <div className="lg:pl-64">
        <Topbar />
        <main className="relative px-6 lg:px-12 py-10">{children}</main>
      </div>

      <Toaster position="bottom-right" />
    </div>
  );
}
