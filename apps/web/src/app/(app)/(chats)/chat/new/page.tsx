import type { Metadata } from 'next';
import { NewChat } from '@/components/agents/new-chat';

export const metadata: Metadata = { title: 'New chat' };

type Params = { deviceId?: string | string[]; path?: string | string[]; name?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A chat that has not started yet, in the folder picked from New chat (`?deviceId=&path=&name=`). */
export default async function NewChatPage({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  return <NewChat deviceId={one(q.deviceId)} path={one(q.path)} name={one(q.name)} />;
}
