import ReactMarkdown from 'react-markdown';

export function ProfileMarkdown({
  children,
  allowLinks,
  className = '',
}: {
  children: string;
  allowLinks: boolean;
  className?: string;
}) {
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
              <a href={href} target="_blank" rel="noopener noreferrer">
                {linkChildren}
              </a>
            ) : (
              <span>{linkChildren}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
