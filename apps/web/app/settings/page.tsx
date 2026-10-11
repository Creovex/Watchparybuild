import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getUser } from '@/lib/supabase/server';
import { SettingsForm } from './SettingsForm';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/?next=/settings');
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, duck_level, plan')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) redirect('/');
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader profile={{ display_name: profile.display_name, avatar_url: profile.avatar_url }} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
        <SettingsForm
          userId={user.id}
          email={user.email ?? ''}
          initialName={profile.display_name}
          initialDuck={profile.duck_level}
          plan={profile.plan === 'paid' ? 'paid' : 'free'}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
