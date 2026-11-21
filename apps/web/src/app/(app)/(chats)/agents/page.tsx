import { redirect } from 'next/navigation';

/** The chat list is the home screen now; old links to /agents land there. */
export default function AgentsPage() {
  redirect('/');
}
