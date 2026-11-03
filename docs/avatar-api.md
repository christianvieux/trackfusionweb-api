# Blob avatar API

The API stores each signed-in user's selected blob avatar as structured data.
The App and API share the same supported shapes, expressions, colors, and seed
format; unsupported or additional persisted fields are rejected.

## Public user response

`GET /users/info/:userId` includes an `avatar` property:

```json
{
  "id": 42,
  "username": "listener",
  "avatar": {
    "shape": "ghost",
    "expression": "neutral",
    "color": "#8B5CF6",
    "seed": "2f"
  }
}
```

Existing users without a saved selection receive `"avatar": null`. The App
uses its deterministic fallback for those users.

## Save the current user's avatar

`PUT /users/avatar` requires the normal authenticated browser session or JWT
cookie. The user ID always comes from the authenticated request; the endpoint
does not accept a client-selected user ID.

Request body:

```json
{
  "shape": "ghost",
  "expression": "neutral",
  "color": "#8B5CF6",
  "seed": "2f"
}
```

The body must contain exactly those four fields. A successful request returns
HTTP `200` with the normalized avatar. Invalid traits return `400`, and an
unauthenticated request returns `401`.

## Database rollout

Avatar data lives in `user_avatars`, keyed to `users.id` with cascade deletion.
`npm run db:init` is rerunnable and creates the table for both new and existing
databases. `npm run db:verify` confirms that the table and required columns are
present. Deployment and CI run initialization before verification, so this
change does not require deleting or recreating a database.

Before merging or deploying avatar changes, run:

```bash
npm test -- --runInBand
```

Changes to supported avatar traits must update the App constants, the API
allowlists, the `user_avatars` check constraints, and their contract tests in
the same change.
