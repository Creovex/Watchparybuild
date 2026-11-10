import { getBrowserClient } from './supabase/client';
import { errorSentence } from './errors';
import { FUNCTIONS_URL } from './env';
export interface Movie {
  id: string;
  owner_id: string;
  title: string;
  status: string;
  size_bytes: number;
  content_type: string;
  duration_sec: number;
  width: number;
  height: number;
  poster_path: string | null;
  created_at: string;
  ready_at: string | null;
}
export async function movieCall<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const client = getBrowserClient();
  let result;
  try {
    if (FUNCTIONS_URL) {
      const { data } = await client.auth.getSession();
      if (!data.session) throw new Error('Sign in first.');
      const response = await fetch(`${FUNCTIONS_URL.replace(/\/$/, '')}/${name}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      result = await response.json();
    } else {
      const { data, error } = await client.functions.invoke(name, { body });
      result = error ? await (error.context as Response).json() : data;
    }
  } catch {
    throw new Error('The movie service could not be reached. Try again.');
  }
  if (!result?.ok)
    throw new Error(
      result?.code === 'not_found' ? 'This movie is no longer in your library.' : errorSentence(result?.code),
    );
  return result.data as T;
}
