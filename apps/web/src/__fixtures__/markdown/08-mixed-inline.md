# Mixed inline formatting

A single dense paragraph with **bold**, *italic*, ***bold-italic***, `inline code`, ~~strikethrough~~, and a [link](https://example.com) all interleaved into one flowing sentence so the renderer has to deal with many inline transitions in a row without any breaks between them at all.

Another paragraph that **combines `code inside bold`** and *[links inside italics](https://example.com)* and `**not bold inside code**` to verify escape semantics.

A line with emphasis edges: **bold at start** of a sentence, and another sentence ending with **bold at end**. Also *italic at start* and *italic at end*.

Adjacent inline tokens: **bold**`code` and *italic***bold** and `code`[link](https://example.com).

Strikethrough combos: ~~plain strike~~, ~~**bold strike**~~, ~~*italic strike*~~, ~~`code strike`~~.

Line 1 with trailing spaces to force a soft break  
Line 2 after the soft break.

Line A
Line B (single newline between — with `breaks: true`, marked renders this as `<br>`).
