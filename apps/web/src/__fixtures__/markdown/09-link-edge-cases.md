# Link edge cases

Inline link with parens in URL: [wiki article](https://en.wikipedia.org/wiki/Markdown_(software)).

Inline link with query + fragment: [search](https://example.com/path?query=foo&bar=baz#section-2).

Inline link with title: [hover me](https://example.com "Example title").

Autolink: <https://example.com/autolink>.

Autolink email: <someone@example.com>.

Reference-style link: see [the spec][ref-spec] for details.

Another reference: [inline ref][] works too.

Collapsed reference: [collapsed][].

Shortcut reference: [shortcut].

[ref-spec]: https://spec.commonmark.org/0.30/ "CommonMark 0.30"
[inline ref]: https://example.com/inline-ref
[collapsed]: https://example.com/collapsed
[shortcut]: https://example.com/shortcut

Link with special chars in text: [`code` in **bold** link text](https://example.com).

Image: ![alt text](https://shared.claude.do/public/placeholder.png "image title").

Link followed immediately by punctuation: see [example](https://example.com), then continue.

Bare URL (not autolinked without angle brackets): https://example.com/bare
