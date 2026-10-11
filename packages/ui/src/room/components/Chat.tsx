'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { formatTimecode, type MessageRow } from '@watchparty/sync-core';
import { Icon } from '../../icons';
import { Avatar, cx, IconButton } from '../../primitives';
import { useNow, useRoom } from '../hooks';
import { systemText } from '../system-text';
import { useController } from './context';

const timeFormat = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }) : null;

export function ChatList({ onMessageMenu }: { onMessageMenu: (message: MessageRow) => void }) {
  const controller = useController();
  const { messages, hasOlder, loadingOlder } = useRoom(controller);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previousHeight = useRef(0);

  // Keep the newest message in view unless the member scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (previousHeight.current && el.scrollHeight > previousHeight.current && el.scrollTop < 40) {
      // Older messages were prepended: keep the same message under the reader's eye.
      el.scrollTop += el.scrollHeight - previousHeight.current;
    }
    previousHeight.current = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void controller.loadOlder();
      },
      { root, rootMargin: '80px 0px 0px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [controller]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-2"
      role="log"
      aria-label="Chat"
      aria-live="polite"
      data-testid="chat-log"
    >
      <div ref={sentinel} className="h-px shrink-0" />
      {hasOlder ? (
        <p className="py-2 text-center text-xs text-faint">{loadingOlder ? 'Loading earlier messages…' : 'Scroll up for earlier messages'}</p>
      ) : messages.length > 0 ? (
        <p className="py-2 text-center text-xs text-faint">Start of the room</p>
      ) : null}
      {messages.length === 0 ? (
        <div className="m-auto flex max-w-[16rem] flex-col items-center gap-2 py-8 text-center">
          <Icon name="chat" size={28} className="text-faint" />
          <p className="font-semibold">No messages yet</p>
          <p className="text-sm text-muted">Say hello, or pin a message to a moment so everyone sees it when they get there.</p>
        </div>
      ) : null}
      <ol className="flex flex-col gap-0.5">
        {messages.map((m, i) => (
          <ChatItem key={m.id} message={m} previous={messages[i - 1]} onMenu={() => onMessageMenu(m)} />
        ))}
      </ol>
    </div>
  );
}

function ChatItem({ message, previous, onMenu }: { message: MessageRow; previous?: MessageRow; onMenu: () => void }) {
  const controller = useController();
  if (message.kind === 'system') {
    const text = systemText(message, (id) => controller.nameOf(id));
    if (!text) return null;
    return (
      <li className="my-1.5 text-center text-xs text-faint" data-testid="system-message">
        {text}
      </li>
    );
  }
  const grouped =
    previous &&
    previous.kind !== 'system' &&
    previous.user_id === message.user_id &&
    Date.parse(message.created_at) - Date.parse(previous.created_at) < 120_000;
  const mine = message.user_id === controller.userId;
  const name = mine ? 'You' : controller.nameOf(message.user_id);
  return (
    <li className={cx('group flex items-start gap-2.5 rounded-lg', grouped ? 'pt-0' : 'pt-2')} data-testid="chat-message">
      <span className="w-8 shrink-0">
        {grouped ? null : <Avatar name={controller.nameOf(message.user_id)} src={controller.avatarOf(message.user_id)} size={32} />}
      </span>
      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex items-baseline gap-2 text-sm">
            <span className={cx('truncate font-semibold', !message.user_id && 'italic text-muted')}>{name}</span>
            <time className="shrink-0 text-xs text-faint" dateTime={message.created_at}>
              {timeFormat?.format(new Date(message.created_at))}
            </time>
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
          {message.kind === 'timed' && message.position_sec !== null ? (
            <span className="timecode mr-1.5 inline-flex items-center gap-1 rounded bg-amber/15 px-1.5 py-px align-[1px] text-xs text-amber">
              <Icon name="pin" size={12} />
              {formatTimecode(message.position_sec)}
            </span>
          ) : null}
          {message.body}
        </p>
      </div>
      <IconButton
        icon="more"
        label={`Options for ${name === 'You' ? 'your' : `${name}'s`} message`}
        onClick={onMenu}
        className="text-faint opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </li>
  );
}

export function ChatComposer() {
  const controller = useController();
  const room = useRoom(controller);
  useNow(pinnedPositionRefreshMs);
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(false);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const position = controller.currentPosition();

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await controller.sendChat(body, pinned);
    setSending(false);
    if (res.ok) {
      setText('');
      setPinned(false);
      input.current?.focus();
    }
  }

  return (
    <form
      className="flex flex-col gap-1 border-t border-line bg-surface-1 px-2 pb-2 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {pinned ? (
        <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-amber" data-testid="pin-caption">
          <Icon name="pin" size={12} />
          Pinned to <span className="timecode">{formatTimecode(position)}</span>
        </p>
      ) : null}
      <div className="flex items-end gap-1.5">
        <IconButton
          icon="pin"
          label={pinned ? 'Unpin from this moment' : 'Pin to this moment'}
          aria-pressed={pinned}
          tone={pinned ? 'active' : 'default'}
          onClick={() => setPinned((p) => !p)}
          data-testid="pin-toggle"
        />
        <label className="sr-only" htmlFor={inputId}>
          Message
        </label>
        <textarea
          id={inputId}
          data-testid="chat-input"
          ref={input}
          value={text}
          maxLength={1000}
          rows={1}
          placeholder={room.status === 'live' ? 'Message the room' : 'Connecting…'}
          disabled={room.status !== 'live'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-lg bg-surface-2 px-3 py-2.5 text-base text-text ring-1 ring-inset ring-line-strong placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-amber"
        />
        <IconButton icon="send" label="Send" type="submit" tone={text.trim() ? 'active' : 'default'} disabled={!text.trim() || sending} />
      </div>
    </form>
  );
}

const pinnedPositionRefreshMs = 500;
