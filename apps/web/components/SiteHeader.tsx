import Link from 'next/link';
import { Avatar } from '@watchparty/ui';
import { Wordmark } from './Wordmark';

export interface HeaderProfile {
  display_name: string;
  avatar_url: string | null;
}

/** Header for every page except the room, which gives the whole screen to the film. */
export function SiteHeader({ profile }: { profile?: HeaderProfile | null }) {
  return (
    <header className="safe-top border-b border-line/70">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark href={profile ? '/home' : '/'} />
        {profile ? (
          <nav aria-label="Main" className="flex items-center gap-1 text-sm font-semibold">
            <Link href="/home" className="hidden min-h-11 items-center rounded-lg px-3 hover:bg-surface-3 sm:inline-flex">
              Rooms
            </Link>
            <Link href="/new" className="hidden min-h-11 items-center rounded-lg px-3 hover:bg-surface-3 sm:inline-flex">
              New room
            </Link>
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg py-1 pl-1 pr-3 hover:bg-surface-3"
            >
              <Avatar name={profile.display_name} src={profile.avatar_url} size={32} />
              <span className="max-w-[10rem] truncate">{profile.display_name}</span>
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
