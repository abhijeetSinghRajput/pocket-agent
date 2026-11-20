import { ImageResponse } from 'next/og';

const SIZES = new Set([96, 180, 192, 512]);

/** App icon (the logo's terminal prompt) rendered at the requested size. */
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('Not found', { status: 404 });
  // Maskable icons keep the glyph inside the central safe zone.
  const maskable = new URL(req.url).searchParams.has('maskable');
  const glyph = Math.round(size * (maskable ? 0.42 : 0.56));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#5b5bd6',
        borderRadius: maskable || size === 180 ? 0 : size * 0.22,
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 8 4 4-4 4M13 16h5" />
      </svg>
    </div>,
    { width: size, height: size, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}
