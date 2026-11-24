import { pairingRequestId, PairingRequestResponse, type PairingRequestDto } from '@pocket-agent/protocol';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Laptop, QrCode, X } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest } from '@/lib/api';
import { enter } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, buzz, IconButton, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';

const PLATFORM: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

type Stage =
  | { kind: 'scan'; note?: string }
  | { kind: 'loading' }
  | { kind: 'confirm'; request: PairingRequestDto }
  | { kind: 'done'; request: PairingRequestDto };

/**
 * Pairing a PC by its QR code: `pocket-agent connect` (without a code) shows one. Scan it, check
 * that the code under it matches the one shown here, and approve; the PC connects by itself.
 */
export function ScanPcButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        label="Scan the PC’s QR code"
        icon={QrCode}
        variant="outline"
        full
        onPress={() => setOpen(true)}
        testID="scan-pc"
      />
      {open && <PairScanner onClose={() => setOpen(false)} />}
    </>
  );
}

function PairScanner({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>({ kind: 'scan' });
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scanned(data: string) {
    if (stage.kind !== 'scan') return;
    const id = pairingRequestId(data);
    if (!id) {
      setStage({
        kind: 'scan',
        note: 'That isn’t a Pocket Agent code. Run `pocket-agent connect` on the PC.',
      });
      return;
    }
    buzz(true);
    setStage({ kind: 'loading' });
    try {
      const { request } = await apiRequest(`/pairing/requests/${id}`, PairingRequestResponse);
      setStage(request.status === 'pending' ? { kind: 'confirm', request } : { kind: 'done', request });
    } catch (err) {
      setStage({ kind: 'scan', note: (err as Error).message });
    }
  }

  async function answer(request: PairingRequestDto, action: 'approve' | 'decline') {
    setBusy(action);
    setError(null);
    try {
      const r = await apiRequest(`/pairing/requests/${request.id}/${action}`, PairingRequestResponse, {
        method: 'POST',
      });
      buzz(true);
      setStage({ kind: 'done', request: r.request });
    } catch (err) {
      buzz(false);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const camera = permission?.granted && (stage.kind === 'scan' || stage.kind === 'loading');

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: camera ? '#000' : c.background }} testID="pair-scanner">
        {camera && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={stage.kind === 'scan' ? (r) => void scanned(r.data) : undefined}
          />
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingTop: insets.top + 8,
            paddingHorizontal: 12,
          }}
        >
          <IconButton icon={X} label="Close" tone={camera ? 'inverse' : 'default'} onPress={onClose} />
          <T variant="subheading" style={{ marginLeft: 4, color: camera ? '#fff' : c.foreground }}>
            Connect a PC
          </T>
        </View>

        {camera && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            {/* Where to hold the code. */}
            <View
              style={{
                width: 240,
                height: 240,
                borderRadius: radius.xxl,
                borderWidth: 3,
                borderColor: alpha('#ffffff', 0.85),
              }}
            />
            <View style={{ paddingHorizontal: 32, gap: 6 }}>
              <T center style={{ color: '#fff' }}>
                {stage.kind === 'loading'
                  ? 'Reading…'
                  : 'Point at the QR code from `pocket-agent connect` on your PC'}
              </T>
              {stage.kind === 'scan' && stage.note ? (
                <T center variant="small" style={{ color: alpha('#ffffff', 0.8) }}>
                  {stage.note}
                </T>
              ) : null}
            </View>
          </View>
        )}

        {!permission?.granted && (
          <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 14 }}>
            <T variant="heading">Allow the camera</T>
            <T tone="muted">
              The camera is used only here, to read the QR code your PC shows. Nothing is recorded.
            </T>
            {permission && !permission.canAskAgain ? (
              <Button label="Open settings" full onPress={() => void Linking.openSettings()} />
            ) : (
              <Button
                label="Allow camera"
                full
                onPress={() => void requestPermission()}
                testID="allow-camera"
              />
            )}
          </View>
        )}

        {(stage.kind === 'confirm' || stage.kind === 'done') && (
          <Animated.View
            entering={enter.rise(0)}
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: 24,
              paddingBottom: insets.bottom + 24,
              gap: 18,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.lg,
                  backgroundColor: c.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Laptop size={22} color={c.foreground} strokeWidth={2} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading" numberOfLines={1}>
                  {stage.request.name}
                </T>
                <T variant="small" tone="muted">
                  {PLATFORM[stage.request.platform] ?? stage.request.platform} · Pocket Agent{' '}
                  {stage.request.agentVersion}
                </T>
              </View>
            </View>
            <View
              style={{
                borderRadius: radius.xl,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: c.border,
                padding: 16,
                alignItems: 'center',
                gap: 4,
              }}
            >
              <T variant="caption" tone="muted">
                Check code (your PC shows the same)
              </T>
              <T
                testID="pair-check"
                style={{ fontFamily: fonts.monoMedium, fontSize: 30, lineHeight: 38, letterSpacing: 8 }}
              >
                {stage.request.check}
              </T>
            </View>
            {stage.kind === 'confirm' ? (
              <>
                <T variant="small" tone="muted">
                  Approve only if this is your PC and the codes match. It can then show your Claude Code
                  sessions here and run what you send it.
                </T>
                {error && <Notice>{error}</Notice>}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={busy === 'decline' ? 'Declining…' : 'Decline'}
                      variant="outline"
                      size="lg"
                      full
                      disabled={!!busy}
                      onPress={() => void answer(stage.request, 'decline')}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={busy === 'approve' ? 'Approving…' : 'Approve'}
                      size="lg"
                      full
                      loading={busy === 'approve'}
                      disabled={!!busy}
                      onPress={() => void answer(stage.request, 'approve')}
                      testID="pair-approve"
                    />
                  </View>
                </View>
              </>
            ) : (
              <View style={{ gap: 14 }} accessibilityLiveRegion="polite">
                <T>
                  {stage.request.status === 'declined'
                    ? 'Declined. The PC was not connected.'
                    : stage.request.status === 'expired'
                      ? 'This QR code expired. Run `pocket-agent connect` on the PC again.'
                      : 'Approved. Your PC is connecting; it shows “Paired” in a moment.'}
                </T>
                <Button label="Done" size="lg" full onPress={onClose} testID="pair-done" />
              </View>
            )}
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}
