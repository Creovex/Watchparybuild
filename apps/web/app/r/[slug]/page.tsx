import { getUser } from '@/lib/supabase/server';
import { RoomEntry } from './RoomEntry';

export const metadata = { title: 'Room' };

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, user } = await getUser();
  let profile: { display_name: string; avatar_url: string | null; duck_level: number | null } | null = null;
  if (user) {
    const { data } = await supabase.from('profiles').select('display_name, avatar_url, duck_level').eq('id', user.id).maybeSingle();
    profile = data;
  }
  return (
    <RoomEntry
      slug={slug}
      me={user && profile ? { id: user.id, name: profile.display_name, avatarUrl: profile.avatar_url, duckLevel: profile.duck_level } : null}
    />
  );
}
