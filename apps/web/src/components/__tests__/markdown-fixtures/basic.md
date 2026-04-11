# CPC Markdown Basics

The file viewer opens markdown from docs, notes, and generated plans. This
fixture keeps the everyday inline formatting stable before the renderer changes.

Operators often scan for **urgent actions**, _quiet context_, and links to
[the deployment guide](../../../../docs/guides/deploying.md) while standing in a
Telegram WebView. Inline code like `pnpm --filter @cpc/web build` should keep its
compact chip styling and should not disturb wrapping in a narrow viewport.

Use bold and italic together when a note is both **_important and tentative_**.
Use literal punctuation such as `apps/web/src/components/MarkdownViewer.tsx`,
`ALLOWED_TELEGRAM_USERS`, and `cpc.claude.do` without surprising escapes.

An external reference can point to [Telegram Mini Apps](https://core.telegram.org/bots/webapps),
and a local note can point to [touch handling](../../../../docs/conventions/touch-handling.md).
Both are common in CPC runbooks.

