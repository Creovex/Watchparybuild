import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getUser } from '@/lib/supabase/server';
import { NewRoomForm } from './NewRoomForm';

export const metadata = { title: 'Start a room' };

export default async function NewRoomPage() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/?next=/new');
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, plan')
    .eq('id', user.id)
    .maybeSingle();
  const cap = profile?.plan === 'paid' ? 10 : 3;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader profile={profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
        <NewRoomForm cap={cap} />
      </main>
      <SiteFooter />
    </div>
  );
}
