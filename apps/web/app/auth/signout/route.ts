import { NextResponse, type NextRequest } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await getServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
