# `packages/www` Railway deploy runbook

## Target

- Project ID: `631518da-37bf-4d31-867f-10908bd9022c`
- Environment ID: `cb2b2b96-f966-46cd-a594-19c1da4e8b91`
- Service ID: `5ce1c234-e1a8-4d0a-8ea0-79e3d413decd`
- Settings URL: `https://railway.com/project/631518da-37bf-4d31-867f-10908bd9022c/service/5ce1c234-e1a8-4d0a-8ea0-79e3d413decd/settings?environmentId=cb2b2b96-f966-46cd-a594-19c1da4e8b91`
- Public URL: `https://devhost.up.railway.app/`

## Preconditions

- Preferred entrypoint: `bun run deploy:www:railway`
- Run all commands from the repository root.
- Do not run `railway up` from `packages/www`.
- Railway CLI must be installed.
- Railway CLI must be authenticated.
- Set `RAILWAY_DASHBOARD_CONFIRMED=1` only after manually verifying the dashboard state below.

### Required Railway dashboard state

Verify in the service settings page before deploy:

- Config-as-code file is exactly `/packages/www/railway.toml`
- Root directory is unset

### Required Railway service variable

Verify before deploy:

- `DEVHOST_BIND_HOST=0.0.0.0`

## Deploy

### Automated path

```sh
RAILWAY_DASHBOARD_CONFIRMED=1 bun run deploy:www:railway
```

Optional preflight-only mode:

```sh
RAILWAY_DASHBOARD_CONFIRMED=1 DEPLOY_WWW_RAILWAY_SKIP_DEPLOY=1 bun run deploy:www:railway
```

### Manual steps used by the script

### 1. Install dependencies

```sh
bun install --frozen-lockfile
```

### 2. Link the checkout to the correct Railway target

```sh
railway link \
  --project 631518da-37bf-4d31-867f-10908bd9022c \
  --environment cb2b2b96-f966-46cd-a594-19c1da4e8b91 \
  --service 5ce1c234-e1a8-4d0a-8ea0-79e3d413decd
```

### 3. Verify the linked target

```sh
railway status --json
```

Required target:

- project ID `631518da-37bf-4d31-867f-10908bd9022c`
- environment ID `cb2b2b96-f966-46cd-a594-19c1da4e8b91`
- service ID `5ce1c234-e1a8-4d0a-8ea0-79e3d413decd`

### 4. Verify the required service variable

```sh
railway variable list --json
```

If missing or wrong:

```sh
railway variable set DEVHOST_BIND_HOST=0.0.0.0 --skip-deploys
```

### 5. Validate the app before deploy

```sh
bun run --cwd packages/www check
```

### 6. Deploy local code

```sh
railway up
```

Do not use `railway deploy` for this app.

## Verify the deployment

### 7. Verify the latest deployment status

```sh
railway status --json
```

Required latest deployment facts:

- latest deployment status is `SUCCESS`
- latest deployment `configFile` is not `null`
- latest deployment effective start command is `bun src/server.ts`

### 8. Inspect latest build logs

```sh
railway logs --build --latest --lines 200
```

### 9. Verify the public endpoint

```sh
curl -I https://devhost.up.railway.app/
```

This HTTP check is secondary. A successful response does not prove the latest deployment succeeded by itself.

## Stop immediately if

- Railway target IDs do not match
- `DEVHOST_BIND_HOST` is missing or not `0.0.0.0`
- service settings do not use `/packages/www/railway.toml`
- root directory is set
- latest deployment status is `FAILED`
- build logs contain `No start command detected`
