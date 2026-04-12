# Mermaid Preview Fixture

Current production output parses mermaid as a fenced code block first; the
viewer then replaces `code.language-mermaid` with a React-rendered diagram. This
fixture pins the parser-level baseline that Wave 2 must account for.

```mermaid
flowchart TD
  Start([Open file])
  Detect{Markdown?}
  Render[Render with viewer]
  Mermaid{Contains mermaid fence?}
  Diagram[Mount MermaidDiagram]
  Done([Readable in Telegram])

  Start --> Detect
  Detect -->|yes| Render
  Detect -->|no| Done
  Render --> Mermaid
  Mermaid -->|yes| Diagram
  Mermaid -->|no| Done
  Diagram --> Done
```

Text after the diagram should remain a separate paragraph.

