'use client';

import { REACTION_LABEL, REACTIONS, type ReactionEmoji } from '@watchparty/sync-core';

/** The eight reactions, each a 44 pixel target with its name for screen readers. */
export function ReactionTray({ onReact }: { onReact: (emoji: ReactionEmoji) => void }) {
  return (
    <div role="group" aria-label="Reactions" className="grid grid-cols-8 gap-1">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          aria-label={REACTION_LABEL[emoji]}
          title={REACTION_LABEL[emoji]}
          className="flex size-11 items-center justify-center rounded-lg text-2xl transition-transform duration-100 hover:bg-surface-3 active:scale-90 motion-reduce:active:scale-100"
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}
