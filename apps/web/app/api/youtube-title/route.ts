import { NextResponse, type NextRequest } from 'next/server';

// The title of a YouTube video, to fill in a new room's name. Asked of YouTube's public oEmbed
// endpoint from the server, so the page's Content Security Policy stays limited to this site. Only
// a valid video id is accepted, so this cannot be used to fetch any other address.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!VIDEO_ID.test(id)) return NextResponse.json({ title: null }, { status: 400 });

  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, {
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ title: null }, { status: 404 });
    const body = (await res.json()) as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
    return NextResponse.json(
      { title: title || null },
      { headers: { 'Cache-Control': 'public, max-age=86400' } },
    );
  } catch {
    return NextResponse.json({ title: null }, { status: 502 });
  }
}
