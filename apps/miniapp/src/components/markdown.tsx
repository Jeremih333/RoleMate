import ReactMarkdown from 'react-markdown';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

export function ProfileMarkdown({
  children,
  allowLinks,
  className = '',
}: {
  children: string;
  allowLinks: boolean;
  className?: string;
}) {
  const usernames = [
    ...new Set(
      [...children.matchAll(/(^|[^\p{L}\p{N}_])@([a-z][a-z0-9_]{3,31})/giu)].map((match) =>
        match[2]!.toLowerCase(),
      ),
    ),
  ].slice(0, 20);
  const mentions = useQuery({
    queryKey: ['resolved-mentions', usernames],
    queryFn: () => api.resolveMentions(usernames),
    enabled: usernames.length > 0,
    staleTime: 5 * 60_000,
  });
  const resolved = new Set((mentions.data ?? []).map((item) => item.username.toLowerCase()));
  const markdown = children.replace(
    /(^|[^\p{L}\p{N}_])@([a-z][a-z0-9_]{3,31})/giu,
    (whole, prefix: string, username: string) =>
      resolved.has(username.toLowerCase())
        ? `${prefix}[@${username}](/u/${username.toLowerCase()})`
        : whole,
  );
  return (
    <div className={`profile-markdown ${className}`}>
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
          a: ({ children: linkChildren, href }) =>
            allowLinks && href ? (
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
