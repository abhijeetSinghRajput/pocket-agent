import type { DeviceStatus } from '@pocket-agent/protocol';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STYLE: Record<DeviceStatus, { variant: 'success' | 'neutral' | 'danger'; dot: string }> = {
  Online: { variant: 'success', dot: 'bg-success' },
  Offline: { variant: 'neutral', dot: 'bg-muted-foreground/50' },
  Revoked: { variant: 'danger', dot: 'bg-destructive' },
};

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const s = STYLE[status];
  return (
    <Badge variant={s.variant} data-testid="device-status">
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', s.dot, status === 'Online' && 'animate-pulse')}
      />
      {status}
    </Badge>
  );
}
