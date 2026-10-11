/** The name a new room starts with: "James's room", from the first word of the display name. */
export function defaultRoomName(displayName: string | null | undefined): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? `${first}'s room`.slice(0, 80) : 'My room';
}
