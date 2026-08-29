import ReactMarkdown from 'react-markdown';
import type { Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { ru } from '@rolemate/shared';
import { CustomEmojiGlyph } from './custom-emoji-glyph.js';
import { useCustomEmoji } from './custom-emoji-library.js';
import {
  CUSTOM_EMOJI_TOKEN_PATTERN,
  customEmojiHref,
  customEmojiIdFromHref,
  openCustomEmojiPack,
} from './custom-emoji-token.js';

export function ProfileMarkdown({
  children,
  allowLinks,
  className = '',
  dimEmphasis = false,
  contentRef,
}: {
  children: string;
  allowLinks: boolean;
  className?: string;
  dimEmphasis?: boolean;
  contentRef?: Ref<HTMLDivElement>;
}) {
  const mentionPattern =
    /(^|[^\p{L}\p{N}_])@((?:[a-z][a-z0-9_]{3,31}|[\u0430-\u044f\u0451][\u0430-\u044f\u04510-9_]{3,31}))/giu;
  const usernames = [
    ...new Set([...children.matchAll(mentionPattern)].map((match) => match[2]!.toLowerCase())),
  ].slice(0, 20);
  const mentions = useQuery({
    queryKey: ['resolved-mentions', usernames],
    queryFn: () => api.resolveMentions(usernames),
    enabled: usernames.length > 0,
    staleTime: 5 * 60_000,
  });
  const resolved = new Set((mentions.data ?? []).map((item) => item.username.toLowerCase()));
  const withMentions = children.replace(
    mentionPattern,
    (whole, prefix: string, username: string) =>
      resolved.has(username.toLowerCase())
        ? `${prefix}[@${username}](/u/${username.toLowerCase()})`
        : whole,
  );
  // A custom emoji is written in text as [ce:<id>]. Turning it into a link keeps
  // it inside the markdown pipeline that already sanitises everything, and the
  // link renderer below draws the glyph instead of an anchor.
  // The link text is a zero-width space: markdown needs something between the
  // brackets, but the glyph is what should be seen — a visible placeholder
  // showed up as a stray dot whenever the picture had not arrived yet.
  const markdown = withMentions.replace(
    CUSTOM_EMOJI_TOKEN_PATTERN,
    (_whole, id: string) => `[\u200b](${customEmojiHref(id)})`,
  );
  return (
    <div ref={contentRef} className={`profile-markdown ${className}`}>
      <ReactMarkdown
        skipHtml
        allowedElements={[
          'p',
          'strong',
          'em',
          'del',
          'ul',
          'ol',
          'li',
          'blockquote',
          'code',
          'br',
          'a',
        ]}
        components={{
          em: ({ children: emphasisChildren }) => (
            <em className={dimEmphasis ? 'roleplay-action' : undefined}>{emphasisChildren}</em>
          ),
          a: ({ children: linkChildren, href }) =>
            customEmojiIdFromHref(href) ? (
              <InlineCustomEmoji customEmojiId={customEmojiIdFromHref(href) ?? ''} />
            ) : allowLinks && href ? (
              <a
                href={href}
                {...(href.startsWith('/u/')
                  ? {}
                  : { target: '_blank', rel: 'noopener noreferrer' })}
              >
                {linkChildren}
              </a>
            ) : (
              <span>{linkChildren}</span>
            ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A custom emoji inside a piece of text.
 *
 * What kind of picture it is comes from the shared library rather than a guess:
 * assuming every one of them was animated meant fetching a Lottie document for
 * a plain still, a request per glyph that both failed and cost us dearly. Bytes
 * already in hand from the pack's archive are used when they are there, and
 * tapping opens the set the emoji came from.
 */
function InlineCustomEmoji({ customEmojiId }: { customEmojiId: string }) {
  const info = useCustomEmoji(customEmojiId);
  return (
    <button
      type="button"
      className="custom-emoji-inline"
      aria-label={ru.miniApp.social.customEmojiOpenPack}
      title={ru.miniApp.social.customEmojiOpenPack}
      onClick={() => openCustomEmojiPack(customEmojiId)}
    >
      <CustomEmojiGlyph
        customEmojiId={customEmojiId}
        renderKind={info?.renderKind ?? 'static'}
        label={info?.emoji ?? ''}
        size={20}
        // An emoji in text plays, the way it does in Telegram. Only a still is
        // ever loaded for one that has nothing to play, and the animation is
        // fetched once the glyph is actually on screen and then cached for a
        // year, so a page of them does not turn into a burst of requests.
        animate
        {...(info?.src ? { srcOverride: info.src } : {})}
        {...(info?.sourceType ? { sourceType: info.sourceType } : {})}
      />
    </button>
  );
}
