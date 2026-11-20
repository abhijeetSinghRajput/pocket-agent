import type { ComponentType, SVGProps } from 'react';
import { ChatIcon, HomeIcon, LaptopIcon, SettingsIcon, ShieldCheckIcon } from '@/components/nav-icons';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Shown in the mobile bottom bar; the rest go under "More". */
  primaryOnMobile: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', icon: HomeIcon, primaryOnMobile: true },
  { href: '/agents', label: 'Agents', icon: ChatIcon, primaryOnMobile: true },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheckIcon, primaryOnMobile: true },
  { href: '/devices', label: 'Devices', icon: LaptopIcon, primaryOnMobile: true },
  { href: '/settings', label: 'Settings', icon: SettingsIcon, primaryOnMobile: false },
];

/** The session whose chat is open (`/agents/<id>`), if any. */
export function openChatId(pathname: string): string | null {
  return /^\/agents\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
