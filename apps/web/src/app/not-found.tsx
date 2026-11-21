import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">This page doesn’t exist or has moved.</p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/">Back to chats</Link>
      </Button>
    </div>
  );
}
