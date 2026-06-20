export interface NavItem {
  name: string;
  href: string;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  { items: [{ name: "Overview", href: "/app" }] },
  {
    label: "Earn",
    items: [
      { name: "Provide PLP liquidity", href: "/app/deposit" },
      { name: "Lend on Margin", href: "/app/lend" },
      { name: "Supply dUSDC", href: "/app/supply" },
    ],
  },
  {
    label: "Borrow",
    items: [{ name: "Borrow against tPLP", href: "/app/borrow" }],
  },
  {
    label: "Monitor",
    items: [
      { name: "Portfolio", href: "/app/portfolio" },
      { name: "Analytics", href: "/app/analytics" },
      { name: "PLP Risk", href: "/app/risk" },
      { name: "Activity", href: "/app/activity" },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  const base = href.split("#")[0];
  if (base === "/app") return pathname === "/app";
  return pathname === base || pathname.startsWith(`${base}/`);
}
