import { Activity, Bot, LayoutDashboard, Laptop, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar; the rest go under "More". */
  primaryOnMobile: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, primaryOnMobile: true },
  { href: '/agents', label: 'Agents', icon: Bot, primaryOnMobile: true },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck, primaryOnMobile: true },
  { href: '/activity', label: 'Activity', icon: Activity, primaryOnMobile: true },
  { href: '/devices', label: 'Devices', icon: Laptop, primaryOnMobile: false },
  { href: '/settings', label: 'Settings', icon: Settings, primaryOnMobile: false },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
