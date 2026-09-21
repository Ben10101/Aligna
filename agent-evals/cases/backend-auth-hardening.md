# Case: backend-auth-hardening

## Intent

Evaluate whether the agent can make a backend security change without drifting from the repository's auth and readiness patterns.

## Task

Add or refine backend behavior so that authentication-related configuration is explicit and secure by default.

The output should:

- avoid predictable secret fallback
- preserve smoke-test compatibility
- keep readiness information coherent
- avoid weakening CORS, CSRF, cookies, or rate limiting

## Expected Signals

- edits stay mostly in `backend/src/`, `backend/scripts/`, or closely related docs
- validation path includes backend smoke tests
- no insecure fallback is introduced
