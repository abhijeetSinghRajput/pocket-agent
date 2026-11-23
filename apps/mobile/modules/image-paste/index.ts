import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** An image pasted from the keyboard, already copied into the app's cache. */
export interface PastedImage {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

interface ImagePasteNative {
  attach(viewTag: number): Promise<boolean>;
  detach(viewTag: number): Promise<void>;
  addListener(event: 'onImagePaste', listener: (e: { files: PastedImage[] }) => void): EventSubscription;
}

// Android only; elsewhere (iOS, web, an older build) pasting images is simply not offered.
const native = requireOptionalNativeModule<ImagePasteNative>('ImagePaste');

export const imagePasteAvailable = native !== null;

/**
 * Lets the text field with this native tag take images from the keyboard; `onPaste` gets them.
 * Returns a function that undoes it.
 */
export function enableImagePaste(viewTag: number, onPaste: (files: PastedImage[]) => void): () => void {
  if (!native) return () => undefined;
  const sub = native.addListener('onImagePaste', (e) => onPaste(e.files));
  void native.attach(viewTag).catch(() => undefined);
  return () => {
    sub.remove();
    void native.detach(viewTag).catch(() => undefined);
  };
}
