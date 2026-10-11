import { formatTimecode, SystemBody, type MessageRow } from '@watchparty/sync-core';

/** Builds the sentence for a system message from its code, so names stay current. */
export function systemText(message: MessageRow, nameOf: (userId: string | null) => string): string {
  let body: SystemBody = {};
  try {
    const parsed = SystemBody.safeParse(JSON.parse(message.body));
    if (parsed.success) body = parsed.data;
  } catch {
    body = {};
  }
  const name = nameOf(body.user_id ?? null);
  switch (message.system_code) {
    case 'waiting_for': {
      const names = (body.user_ids ?? []).map((id) => nameOf(id));
      return `Waiting for ${joinNames(names)} to catch up`;
    }
    case 'cue_ready':
      return `${name} is ready at ${formatTimecode(body.position_sec ?? 0)}`;
    case 'joined':
      return `${name} joined`;
    case 'left':
      return `${name} left`;
    case 'host_changed':
      return `${name} is now the host`;
    default:
      return '';
  }
}

export function joinNames(names: string[]): string {
  if (names.length === 0) return 'someone';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
