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
 * The web app's addresses, in one place:
 *   /chat                                       the chat list (Chats)
 *   /chat/new?deviceId&path&name                a new chat in a folder
 *   /chat/<id>                                  a chat
 *   /chat/<id>/agents/<toolUseId>               one of its sub-agents
 *   /chat/<id>/agents/<toolUseId>/transcript    that sub-agent's whole transcript
 *   /agents                                     the Agents page (Connected, Sub-agents, Finished)
 * Old `/agents/<id>` links redirect to `/chat/<id>` (next.config.ts).
 */
export const routes = {
  chats: '/chat',
  /** A new chat in a folder: its screen counts as an open chat (openChatId gives "new"). */
  newChat: (place: { deviceId: string; path: string; name: string }) =>
    `/chat/new?${new URLSearchParams({ deviceId: place.deviceId, path: place.path, name: place.name })}`,
  chat: (id: string) => `/chat/${id}`,
  subagent: (id: string, toolUseId: string) => `/chat/${id}/agents/${encodeURIComponent(toolUseId)}`,
  transcript: (id: string, toolUseId: string) =>
    `/chat/${id}/agents/${encodeURIComponent(toolUseId)}/transcript`,
  agents: '/agents',
};

/**
 * A link a notification or approval carries (the API writes `/agents/<id>` for a chat, which the
 * app reads too), as the web app's own address.
 */
export function webPath(link: string): string {
  return link.replace(/^\/agents\/([^/?#]+)/, '/chat/$1');
}

/** The session whose chat is open (a chat, one of its sub-agents or a transcript), if any. */
export function openChatId(pathname: string): string | null {
  return /^\/chat\/([^/]+)(?:\/agents\/[^/]+(?:\/transcript)?)?\/?$/.exec(pathname)?.[1] ?? null;
}

/** The chat list or anything inside a chat. */
export function isChatsRoute(pathname: string): boolean {
  return pathname === '/chat' || pathname.startsWith('/chat/');
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/chat') return isChatsRoute(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}
