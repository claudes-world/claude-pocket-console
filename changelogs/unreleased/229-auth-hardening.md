---
type: fix
pr: 229
---
Harden auth middleware — ticket length+format validation (blocks newline bypass) + initData auth_date expiry with NaN guard + ambiguous ticket+path request rejection.
