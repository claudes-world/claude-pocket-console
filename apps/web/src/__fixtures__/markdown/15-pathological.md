# Pathological shapes

Raw HTML mixed in (marked passes through by default):

<div class="custom-box" style="padding: 8px;">
  <p>Inline HTML paragraph with <strong>bold</strong> and a <a href="https://example.com">raw anchor</a>.</p>
</div>

Single-newline-as-break (relies on `breaks: true`):
Line A
Line B
Line C

Deeply nested list (5 levels):

- L1
  - L2
    - L3
      - L4
        - L5 leaf

Unicode smorgasbord: café, naïve, façade, résumé, 日本語, 中文, العربية, עברית, emoji: hello duck, math: α + β = γ, ∑ x_i, ∫ f(x) dx.

Inline HTML inside a paragraph: this is <span style="color: red;">red text</span> and <code>raw code</code> inside a normal paragraph.

A horizontal rule:

---

A heading immediately after the hr:

## Heading right after hr

Backtick-heavy inline: ``a`b`` and ``` ``nested`` ``` and ```` ```triple``` ````.

Escape sequences: \*not italic\*, \`not code\`, \[not link\](nope).

Empty code block:

```
```

Code block with no language:

```
plain text
multiple lines
  indented
```

A paragraph ending without a trailing newline and no more content after it.
