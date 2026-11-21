import type { ComponentType, SVGProps } from 'react';
import { ChatIcon, LaptopIcon, ShieldCheckIcon } from '@/components/nav-icons';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Chats is home. Settings, notifications and sign-out live in the profile menu. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Chats', icon: ChatIcon },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheckIcon },
  { href: '/devices', label: 'Devices', icon: LaptopIcon },
];

/** The session whose chat is open (`/agents/<id>`), if any. */
export function openChatId(pathname: string): string | null {
  return /^\/agents\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/** The chat list (`/`) or an open chat (`/agents/<id>`). */
export function isChatsRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/agents' || pathname.startsWith('/agents/');
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return isChatsRoute(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}
