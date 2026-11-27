import { MessageCircle, MonitorSmartphone, type LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { AgentsIcon } from '@/components/agents-icon';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
}

/** Chats is home. Settings, notifications and sign-out live in the profile menu. Icons as in the app. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/chat', label: 'Chats', icon: MessageCircle },
  { href: '/agents', label: 'Agents', icon: AgentsIcon },
  { href: '/devices', label: 'Devices', icon: MonitorSmartphone },
];

/**
 * The session whose chat is open (`/agents/<id>`), if any. A sub-agent's page and its transcript
 * (`/agents/<id>/sub/<toolUseId>[/transcript]`) belong to that chat too.
 */
export function openChatId(pathname: string): string | null {
  return /^\/agents\/([^/]+)(?:\/sub\/[^/]+(?:\/transcript)?)?\/?$/.exec(pathname)?.[1] ?? null;
}

/** The chat list (`/`) or an open chat (`/agents/<id>`). */
export function isChatsRoute(pathname: string): boolean {
  return pathname === '/chat' || pathname.startsWith('/agents/');
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/chat') return isChatsRoute(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}
