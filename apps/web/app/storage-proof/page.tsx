import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { StorageProof } from './StorageProof';
export const metadata = { title: 'Movie storage check' };
export default async function StorageProofPage() {
  const { user } = await getUser();
  if (!user) redirect('/?next=/storage-proof');
  return <StorageProof />;
}
