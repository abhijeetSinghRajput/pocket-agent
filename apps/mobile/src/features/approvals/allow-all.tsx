import { toolTarget } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { CheckCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Button, buzz, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { Sheet } from '@/ui/sheet';
import { describeRequest, readableInput, sendDecision } from './shared';

/** The requests "Allow all" may decide: permission requests (a question needs its own answer). */
export const allowable = (list: readonly ApprovalDto[]) =>
  list.filter((a) => a.toolName !== 'AskUserQuestion' && a.status === 'Pending' && !a.decision);

/**
 * Several permission requests at once: lists exactly what each will run, then allows them all
 * (one after another; any that can't be allowed any more is reported, the rest still go).
 */
export function AllowAllButton({ requests, onDone }: { requests: ApprovalDto[]; onDone: () => void }) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  if (requests.length < 2) return null;

  async function allowAll() {
    setBusy(true);
    setFailed([]);
    const errors: string[] = [];
    for (const a of requests) {
      try {
        await sendDecision(a.id, { decision: 'allow' });
      } catch (err) {
        errors.push(`${a.toolName}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    buzz(errors.length === 0);
    setFailed(errors);
    onDone();
    if (!errors.length) setOpen(false);
  }

  return (
    <>
      <Button
        label={`Allow all ${requests.length}`}
        icon={CheckCheck}
        size="sm"
        variant="outline"
        onPress={() => setOpen(true)}
        testID="allow-all"
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissable={!busy}
        title={`Allow ${requests.length} requests?`}
        description="Each runs exactly as shown, once."
      >
        <ScrollView style={{ maxHeight: height * 0.45 }} contentContainerStyle={{ gap: 8 }}>
          {requests.map((a) => (
            <View
              key={a.id}
              style={{
                borderRadius: radius.md,
                backgroundColor: c.card,
                paddingHorizontal: 12,
                paddingVertical: 8,
                gap: 2,
              }}
            >
              <T variant="captionMedium" tone="muted">
                {describeRequest(a.toolName).label} · {a.projectName}
              </T>
              <T numberOfLines={3} style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 }}>
                {toolTarget(a.input) || readableInput(a.input)}
              </T>
            </View>
          ))}
        </ScrollView>
        <View style={{ gap: 8, paddingTop: 12 }}>
          {failed.length > 0 && <Notice>{`Not allowed: ${failed.join(' · ')}`}</Notice>}
          <Button
            label={busy ? 'Allowing…' : `Allow all ${requests.length}`}
            icon={CheckCheck}
            size="lg"
            full
            loading={busy}
            onPress={() => void allowAll()}
            testID="allow-all-confirm"
          />
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            full
            disabled={busy}
            onPress={() => setOpen(false)}
          />
        </View>
      </Sheet>
    </>
  );
}
