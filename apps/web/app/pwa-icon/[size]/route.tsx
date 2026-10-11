import { iconResponse } from '@/lib/icon-art';

const SIZES: Record<string, { px: number; maskable: boolean }> = {
  '192': { px: 192, maskable: false },
  '512': { px: 512, maskable: false },
  'maskable-512': { px: 512, maskable: true },
};

export async function GET(_request: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const spec = SIZES[size];
  if (!spec) return new Response('Not found', { status: 404 });
  const response = iconResponse(spec.px, { maskable: spec.maskable });
  response.headers.set('Cache-Control', 'public, max-age=86400');
  return response;
}
