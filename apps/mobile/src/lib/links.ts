import type { Href } from 'expo-router';

/** The chat a notification's link points to, if it is one. */
export function chatIdOfLink(link: string | null | undefined): string | null {
  return (link && /^\/agents\/([^/?#]+)/.exec(link)?.[1]) || null;
}

/**
 * Notifications and approvals carry the web app's paths (`/agents/<id>`, `/approvals`, …). This
 * maps one to the screen of this app that shows the same thing.
 */
export function routeForLink(link: string | null | undefined): Href {
  if (!link) return '/';
  const chat = chatIdOfLink(link);
  if (chat) return { pathname: '/chat/[id]', params: { id: chat } };
  // Requests waiting for a decision are on the Agents tab (under "Needs you").
  if (link.startsWith('/approvals')) return '/agents';
  if (link.startsWith('/notifications')) return '/alerts';
  if (link.startsWith('/devices')) return '/devices';
  if (link.startsWith('/profile') || link.startsWith('/settings')) return '/profile';
  return '/';
}

/** The web path the server uses for a chat (what notifications of that chat link to). */
export const chatLink = (sessionId: string) => `/agents/${sessionId}`;
