# Wide code block (horizontal scroll target)

This fixture exists to pin down the PR #20 regression around wide code blocks and horizontal scrolling.

```ts
// This single line is intentionally very long to force horizontal scrolling inside the rendered <pre><code> container so we can diff how marked and react-markdown lay out the overflow behavior under the same CSS.
const veryLongIdentifier = { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5, zeta: 6, eta: 7, theta: 8, iota: 9, kappa: 10, lambda: 11, mu: 12, nu: 13, xi: 14, omicron: 15, pi: 16, rho: 17, sigma: 18, tau: 19, upsilon: 20, phi: 21, chi: 22, psi: 23, omega: 24 };
function doSomethingThatTakesAbsurdlyManyArgumentsAndReturnsAnAbsurdlyLongInlineTypeAnnotation(arg1: string, arg2: number, arg3: boolean, arg4: Record<string, unknown>, arg5: Array<{ id: string; value: number; metadata: Record<string, string> }>): Promise<{ ok: true; data: Array<{ id: string; value: number; metadata: Record<string, string> }> } | { ok: false; error: string }> {
  return Promise.resolve({ ok: true, data: arg5 });
}
```

And a short line afterwards to verify the following paragraph wraps normally after a wide code block:

```
$ curl -sSL https://example.com/some/very/long/path/that/should/not/wrap/inside/the/pre/block/because/pre/preserves/whitespace/and/horizontal/scroll/should/kick/in?query=param1&query=param2&query=param3
```

End of wide fixture.
