# Mermaid Test

This is a quick test of Mermaid rendering in CPC's MarkdownViewer.

## Flowchart

```mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Continue]
  B -->|No| D[Stop]
```

## Regular code block (should stay as code)

```js
const hello = "world";
console.log(hello);
```

Done.
