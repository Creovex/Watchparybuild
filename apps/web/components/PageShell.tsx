import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { getUser } from '@/lib/supabase/server';

/** Header, a centred column and the footer, for the informational pages. */
export async function PageShell({ children, width = 'max-w-3xl' }: { children: React.ReactNode; width?: string }) {
  const { supabase, user } = await getUser();
  let profile: { display_name: string; avatar_url: string | null } | null = null;
  if (user) {
    const { data } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle();
    profile = data;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader profile={profile} />
      <main className={`mx-auto w-full ${width} flex-1 px-4 py-8 sm:px-6 lg:py-12`}>{children}</main>
      <SiteFooter />
    </div>
  );
}
