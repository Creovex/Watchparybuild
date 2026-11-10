import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { Movies } from './Movies';
export const metadata = { title: 'Your movies' };
export default async function MoviesPage() {
  const { user } = await getUser();
  if (!user) redirect('/?next=/movies');
  return <Movies owner={user.id} />;
}
