# Edge Cases


## Consecutive Heading A
## Consecutive Heading B
### Consecutive Heading C

The blank lines above and the consecutive headings below should not create
unexpected empty paragraphs.

- Top level item
  - Nested item with `inline code`
    - Third level item
      1. Ordered detail
      2. Ordered detail with a [relative link](../../../../AGENTS.md)
- Second top level item

1. Ordered root
   - Unordered child
     > Quote inside a list item.
     >
     > ```bash
     > pnpm --filter @cpc/web test
     > ```

> A blockquote with a paragraph.
>
> - A quoted list item
> - Another quoted list item with `code`
>
> ```ts
> const source = "quoted code";
> ```

---

Text after a thematic break should remain visible and separated.

