---
type: fix
pr: 303
---
Terminal session listing is locale-proof: tmux mangled the tab separator in its `-F` templates to `_` under a non-UTF-8 locale, which garbled the session picker. Uses a printable `|` separator with field-count validation.
