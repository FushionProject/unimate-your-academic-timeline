# UniMate working copy

The active product and release-review working copy is:

`/Users/ryanpalumbo/Desktop/unimate-release-candidate`

- Active branch: `release-candidate/v1`
- Local development URL: `http://localhost:8080`
- Start the app from this directory with `npm run dev -- --port 8080`.

`/Users/ryanpalumbo/Desktop/unimate-ui` is an older worktree of the same Git repository. It is not
a separate product repository. It contains unrelated uncommitted work and must not be used for
release-candidate edits or to start port 8080 until that work is intentionally reconciled.

Before making or testing product changes, verify both:

```sh
pwd
git branch --show-current
```

The expected values are the active path above and `release-candidate/v1`.
