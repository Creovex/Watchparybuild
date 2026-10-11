import { NextResponse, type NextRequest } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';

// Google sends people back here with a one time code; exchanging it sets the session cookie.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/home';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/home';
  if (code) {
    const supabase = await getServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/?signin=failed', url.origin));
}
