import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { Movies } from './Movies';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
export const metadata = { title: 'Your movies' };
export default async function MoviesPage() {
  const { user, supabase } = await getUser();
  if (!user) redirect('/?next=/movies');
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name,avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader profile={profile ?? { display_name: 'Your account', avatar_url: null }} />
      <Movies owner={user.id} />
      <SiteFooter />
    </div>
  );
}
