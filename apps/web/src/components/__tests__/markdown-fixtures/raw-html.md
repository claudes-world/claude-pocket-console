# Raw HTML From Copied Docs

Some project documents include GitHub-flavored raw HTML. Marked currently keeps
these nodes in the emitted HTML, so the baseline should capture the exact shape.

<details>
<summary>Deployment checklist</summary>

- Build `apps/web`
- Restart the CPC server
- Check `/health`

</details>

Keyboard hints appear inline: press <kbd>Esc</kbd> to dismiss a sheet, or
<kbd>Ctrl</kbd> + <kbd>C</kbd> to stop a local dev server.

Line one<br>
Line two after a manual break.

<div data-cpc-note="copied-from-github">
  <strong>Note:</strong> this block is raw HTML and should be called out in any
  renderer parity review.
</div>

