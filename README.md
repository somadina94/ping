# PING

**PING** monitors a remote VPS health URL (default [`https://api.jahbyte.com/api/v1/health`](https://api.jahbyte.com/api/v1/health)) from a long-running Express service — typically on EC2 — and emails you when the target stays down. Built on Express 5 + TypeScript + Mongoose with validated config, Docker, Jest, and CI.

---

## What you get

- **VPS monitor**: Scheduled HTTPS probe of `MONITOR_URL`; deploy email on startup, SMTP alert only when a probe fails (with cooldown).
- **Config**: Zod-validated env; fail-fast rules for `staging` / `production`.
- **Runtime**: Mongo connects **before** HTTP listens; graceful shutdown on `SIGTERM` / `SIGINT`.
- **Health**: `GET /api/v1/health/live` (process), `GET /api/v1/health/ready` and `GET /api/v1/health` (Mongo readiness; used by Docker healthchecks). This is **PING's own** health, not the remote VPS URL.
- **Observability**: `pino` + `pino-http`, `x-request-id` on responses.
- **Security baseline**: Helmet, HPP, rate limits, body limits, CORS allowlist, mongo sanitize on body/params.
- **Quality**: ESLint, Prettier, Jest + Supertest, GitHub Actions CI.

---

## VPS health monitor (EC2)

Run PING on an EC2 instance (or any always-on host) that can reach the VPS over HTTPS:

1. Copy env: `cp .env.example .env`
2. Set `MONITOR_URL` (defaults to `https://api.jahbyte.com/api/v1/health`).
3. Set `ALERT_EMAIL` to your inbox.
4. Configure SMTP (`EMAIL_HOST`, `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, optional `EMAIL_FROM`).
5. Keep `MONITOR_ENABLED=true`, then start with `npm run docker:dev` / `docker compose up` / `npm start` after build.

On every process start (including each deploy), PING runs an immediate probe and emails a deploy alert (OK or FAIL). Recurring probes use `node-cron` with `MONITOR_CRON` (default `*/15 * * * *` → :00/:15/:30/:45). You only get another email when a probe fails (down alert + cooldown). Healthy / recovered probes are logged only, not emailed.

Ensure security groups / firewalls allow outbound HTTPS from EC2 to the VPS.

### GitHub Actions deploy

Pushes to `main` / `master` run verify, then deploy over SSH using these repository secrets:

| Secret                | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `EC2_HOST`            | EC2 public hostname or IP                                         |
| `EC2_USERNAME`        | SSH user (e.g. `ubuntu`)                                          |
| `EC2_SSH_PRIVATE_KEY` | Private key for that user                                         |
| `EC2_DEPLOY_PATH`     | Absolute app directory on the instance (e.g. `/home/ubuntu/ping`) |

On the instance, create that directory once, install Docker, and place a production `.env` there (rsync **never** overwrites `.env`). That server `.env` **must** include `EMAIL_HOST`, `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, and `ALERT_EMAIL` or deploy/down emails are skipped. The compose stack overrides `DATABASE` to the bundled `mongo` service so a host `localhost` URI does not break boot. The deploy job uses `sudo` to create/`chown` `EC2_DEPLOY_PATH` and run `deploy.sh`.

---

## Starting a new backend from this repo

Do this **once per project** so paths, secrets, and orchestration stay coherent.

1. **Copy the repo** (fork, template clone, or duplicate directory) and open it as the new project root.
2. **`package.json`**: change `name`, `description`, and optionally `author`.
3. **`src/constants/branding.ts`**: set product name / brand strings used in emails and logs.
4. **Docker names** (optional but recommended): in `docker-compose.yml`, `docker-compose.dev.yml`, and `container_name` fields, replace `ping` with your service name so multiple projects do not collide on the same machine.
5. **MongoDB**: choose Atlas or self-hosted; create DB user + network rules before first prod deploy.
6. **Secrets**: generate a **≥32 character** `JWT_SECRET` for staging/production (see [Boot validation](#boot-validation)).
7. **`.env`**: never commit real `.env`; keep `.env.example` updated when you add env vars.

---

## Recommended workflows (dev vs production)

| Goal                            | What to run                                           | MongoDB                                                                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Daily development in Docker** | `npm run docker:dev`                                  | **Official `mongo` image** + **named volume** (`mongo-dev`) in [`docker-compose.dev.yml`](docker-compose.dev.yml). Compose sets `DATABASE` to `mongodb://mongo:27017/...` unless you override `DOCKER_DATABASE`. |
| **Production / staging**        | `docker compose up --build -d` (or your orchestrator) | **Real** connection string: set `DATABASE` and use `DATABASE_PASSWORD` when the URI uses `<password>` / `<PASSWORD>` placeholders (see [`src/server.ts`](src/server.ts)). Typically Atlas (`mongodb+srv://...`). |

Do **not** rely on `docker run … host.docker.internal` for normal development: that expects MongoDB installed and listening **on your Mac**. If you only use Mongo inside Docker, **`npm run docker:dev`** is the supported path.

---

## Prerequisites

| Tool        | Notes                                                                                   |
| ----------- | --------------------------------------------------------------------------------------- |
| Node.js 22+ | Matches `Dockerfile` base image                                                         |
| npm         | `npm ci` used in Docker and CI                                                          |
| Docker      | Desktop or Engine + **Docker Compose v2** (for `docker compose` and optional `--watch`) |
| MongoDB     | Local install, dev container, or Atlas                                                  |

---

## Environment setup

```sh
cp .env.example .env
```

Edit `.env` for your machine and deployment. See [Environment reference](#environment-reference) and [MongoDB: where is the database?](#mongodb-where-is-the-database).

**Compose note:** `docker compose` loads `.env` from the project directory for variable substitution. The API service also uses `env_file: .env` so the container receives those values (with compose `environment:` entries overriding where specified in `docker-compose.dev.yml`).

---

## MongoDB: where is the database?

`localhost` inside a container is **not** your laptop. Point `DATABASE` at a host MongoDB can reach.

| Scenario                                              | Where Mongo runs                                                               | Typical `DATABASE` value                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **`npm run docker:dev` (recommended Docker dev)**     | `mongo` service in [`docker-compose.dev.yml`](docker-compose.dev.yml) + volume | Compose injects `mongodb://mongo:27017/...` (override with `DOCKER_DATABASE` in `.env`)      |
| Local `npm run dev`                                   | Mongo on your machine                                                          | `mongodb://localhost:27017/your-db`                                                          |
| Production [`docker-compose.yml`](docker-compose.yml) | Atlas / managed cluster                                                        | Full URI in `.env`; use `DATABASE_PASSWORD` for masked passwords                             |
| Optional: prod image smoke test with Mongo on host    | Mac / Windows host process                                                     | `mongodb://host.docker.internal:27017/...` **only if** Mongo is actually running on the host |

If you see `ECONNREFUSED` to `127.0.0.1:27017` from a container, the URI still targets **localhost inside the container**—use `npm run docker:dev` or a remote URI.

If you see `ECONNREFUSED` to **`192.168.x.x:27017`** while using `host.docker.internal`, Docker reached your host but **nothing is listening on port 27017** there—start host Mongo, or use **`npm run docker:dev`** instead.

---

## Development workflows

### A — Local Node (fastest iteration)

1. Start MongoDB locally (or use Atlas with IP allowlist).
2. Install and run:

```sh
npm ci
npm run dev
```

3. Verify: `http://localhost:3000/api/v1/health/live` (200). Readiness returns **503** until Mongo is connected; after Mongo is up, `npm run dev` connects first—then `/api/v1/health/ready` should be **200**.

### B — Docker Compose dev (API + Mongo + watch)

```sh
npm run docker:dev
```

- API and Mongo are on the same Docker network; compose sets `DATABASE` to the `mongo` service unless you override `DOCKER_DATABASE` in `.env`.
- Source sync + rebuild on lockfile changes are configured in `docker-compose.dev.yml`.

Stop (keep DB volume):

```sh
npm run docker:dev:down
```

Stop and **delete** persisted dev data:

```sh
docker compose -f docker-compose.dev.yml down -v
```

---

## Production workflows

### Boot validation

When `NODE_ENV` is **`staging`** or **`production`**, the process exits on startup if:

- `DATABASE` is missing
- `JWT_SECRET` is missing or shorter than **32** characters
- `FRONTEND_URL` contains `localhost`

Keep real secrets out of git; inject via `.env` on the server, your orchestrator, or a secret manager.

### Recommended production `.env` shape

Use your **real** Atlas (or managed) URI. If you prefer not to put the password in the URI, use a placeholder and `DATABASE_PASSWORD`:

```env
NODE_ENV=production
PORT=3000
DATABASE=mongodb+srv://MY_USER:<password>@cluster0.xxxxx.mongodb.net/myapp?retryWrites=true&w=majority
DATABASE_PASSWORD=your-mongodb-user-password
JWT_SECRET=use-openssl-or-password-manager-32chars-minimum
JWT_EXPIRES_IN=7d
JWT_COOKIE_EXPIRES_IN=7
API_URL=https://api.example.com
FRONTEND_URL=https://example.com
CORS_ORIGINS=https://example.com,https://admin.example.com
TRUST_PROXY=true
LOG_LEVEL=info
LOG_PRETTY=false
```

`<password>` / `<PASSWORD>` in `DATABASE` are replaced at startup using `DATABASE_PASSWORD` (see [`src/server.ts`](src/server.ts)).

Set `TRUST_PROXY=true` when behind nginx, Traefik, AWS ALB, Cloudflare, etc., so rate limiting and IPs are correct.

### Docker Compose (production file)

Build and run the API container (Mongo is **external** unless you extend the compose file):

```sh
docker compose up --build -d
```

Healthcheck calls `/api/v1/health/ready` inside the container.

### Production image only (`docker build`)

For **integration testing** the API image, pass the **same** `DATABASE` / `DATABASE_PASSWORD` you use in production (e.g. Atlas). Example:

```sh
docker build -t your-api:prod .
docker run --rm -p 3000:3000 --env-file .env your-api:prod
```

**Local Docker development** should use **`npm run docker:dev`** (Mongo container + volume), not ad hoc `docker run` against `localhost` or `host.docker.internal`.

Optional smoke test against Mongo **running on your host** (requires Mongo listening on the host; often **not** true if you only use Docker Mongo):

```sh
docker build -t ping:test .
npm run docker:run:host-mongo
# or: DOCKER_RUN_DATABASE=mongodb://host.docker.internal:27017/mydb npm run docker:run:host-mongo
```

Requirements:

- `.env` must use a **reachable** `DATABASE`. Inside Docker, **loopback hosts** (`localhost`, `127.0.0.1`) are rejected early with a clear error.
- On Mongo connection failure inside Docker, logs include hints pointing at **`npm run docker:dev`** and production URI setup.
- **`LOG_PRETTY=false`** (default) for this image; **`pino-pretty` is not installed**.

---

## Environment reference

| Variable                    | Required                             | Description                                                                           |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | Default `development`                | `development` \| `test` \| `staging` \| `production`                                  |
| `PORT`                      | Default `3000`                       | HTTP port                                                                             |
| `DATABASE`                  | Required for staging/production      | MongoDB connection URI; `<password>` placeholders replaced by `DATABASE_PASSWORD`     |
| `DATABASE_PASSWORD`         | Optional                             | Substituted into `DATABASE` for masked URIs                                           |
| `JWT_SECRET`                | Strong secret for staging/production | Min **32** chars when `NODE_ENV` is `staging` or `production`                         |
| `JWT_EXPIRES_IN`            | Default `90d`                        | JWT lifetime string                                                                   |
| `JWT_COOKIE_EXPIRES_IN`     | Default `90`                         | Cookie expiry (days)                                                                  |
| `API_URL`                   | Default local URL                    | Public API base URL                                                                   |
| `FRONTEND_URL`              | Default local URL                    | Must not be localhost in staging/production                                           |
| `CORS_ORIGINS`              | Defaults to `FRONTEND_URL`           | Comma-separated allowed origins (credentials enabled)                                 |
| `TRUST_PROXY`               | Default `false`                      | Set `true` behind reverse proxies                                                     |
| `RATE_LIMIT_WINDOW_MS`      | Default `3600000`                    | Rate limit window                                                                     |
| `RATE_LIMIT_MAX`            | Default `1000`                       | Max requests per window per IP (in-memory; use a store for multi-instance)            |
| `LOG_LEVEL`                 | Default `info`                       | Pino log level                                                                        |
| `LOG_PRETTY`                | Default `false`                      | Pretty logs; **true** only when `pino-pretty` is installed (local / `Dockerfile.dev`) |
| `COMPANY_NAME`              | Default `PING`                       | Used in email templates                                                               |
| `EMAIL_*`                   | Optional                             | SMTP; see `.env.example` — required for monitor alert delivery                        |
| `MONITOR_ENABLED`           | Default `true`                       | Enable remote VPS health probing                                                      |
| `MONITOR_URL`               | Default jahbyte health URL           | Remote HTTPS health endpoint to probe                                                 |
| `MONITOR_CRON`              | Default `*/15 * * * *`               | Cron schedule for probes (`:00` / `:15` / `:30` / `:45`)                              |
| `MONITOR_CRON_TIMEZONE`     | Optional                             | IANA timezone for cron (e.g. `UTC`); defaults to system local time                    |
| `MONITOR_TIMEOUT_MS`        | Default `10000`                      | Per-probe timeout                                                                     |
| `MONITOR_FAILURE_THRESHOLD` | Default `1`                          | Consecutive failures before down alert                                                |
| `MONITOR_ALERT_COOLDOWN_MS` | Default `900000`                     | Minimum time between down alerts while still failing                                  |
| `ALERT_EMAIL`               | Required when monitor enabled        | Inbox for deploy / down emails (not required in `NODE_ENV=test`)                      |

**Docker dev only (compose substitution):** `DOCKER_DATABASE` overrides the API `DATABASE` URL in `docker-compose.dev.yml` when set in `.env`.

---

## Scripts

| Script                          | Purpose                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev`                   | TS watch mode                                                                                     |
| `npm run build`                 | Compile + copy views                                                                              |
| `npm start`                     | Run compiled `dist/server.js`                                                                     |
| `npm run typecheck`             | `tsc --noEmit`                                                                                    |
| `npm run lint`                  | ESLint                                                                                            |
| `npm run format`                | Prettier write                                                                                    |
| `npm run format:check`          | Prettier check                                                                                    |
| `npm test`                      | Jest                                                                                              |
| `npm run docker:dev`            | Dev compose with watch                                                                            |
| `npm run docker:dev:down`       | Stop dev stack                                                                                    |
| `npm run docker:run:host-mongo` | Optional prod-image test **only if** Mongo runs on the host (`DOCKER_RUN_DATABASE` overrides URI) |

---

## API — Health

```http
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health
```

Use **`/ready`** (or `/` alias) for load balancers and Docker healthchecks.

---

## Observability and security (production-minded)

- **Logs**: JSON to stdout in production; aggregate with your platform (CloudWatch, Datadog, Loki, etc.).
- **Request IDs**: Propagate `x-request-id` from clients or accept server-generated IDs for tracing.
- **CORS**: Explicit origins only; reflects credential cookies—never mirror `origin: *` with credentials.
- **Rate limiting**: Default is in-memory; **multiple replicas** need Redis (or similar) as a shared store—plan before scaling horizontally.
- **MongoDB**: Use TLS + auth in production; rotate credentials; restrict network access.

---

## CI

`.github/workflows/ci.yml` runs:

`npm ci` → Prettier check → ESLint → TypeScript → tests → build → `docker compose config` validation → `docker build`.

On push to `main` / `master`, the `deploy` job syncs to EC2 (`EC2_*` secrets) and runs `deploy.sh`.

**Suggested repo settings:** require this workflow on `main`, forbid force-push, require PR reviews before merge.

---

## Troubleshooting

| Symptom                                                      | Likely cause                      | Fix                                                                                            |
| ------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `unable to determine transport target for "pino-pretty"`     | Pretty logs in prod image         | Set `LOG_PRETTY=false` or omit it                                                              |
| Fatal: `DATABASE host ... loopback` inside Docker            | `localhost` in URI from container | Use **`npm run docker:dev`** or a remote / Atlas `DATABASE`                                    |
| Extra log block after Mongo failure inside Docker            | Connection hints                  | Prefer **`npm run docker:dev`** for dev; production uses real `DATABASE` / `DATABASE_PASSWORD` |
| `ECONNREFUSED` to `192.168.*:27017` (Docker Desktop gateway) | Mongo not listening on host       | Use **`npm run docker:dev`** or Atlas URI in `--env-file .env`                                 |
| `ECONNREFUSED` to `localhost:27017` from container           | Mongo not in same network         | Use **`npm run docker:dev`** (`mongo` hostname) or Atlas URI                                   |
| Boot exits in production                                     | Validation failed                 | Fix `DATABASE`, length of `JWT_SECRET`, non-localhost `FRONTEND_URL`                           |
| CORS errors from browser                                     | Origin not allowlisted            | Add frontend URL to `CORS_ORIGINS`                                                             |
| `Loaded N configured env vars (0 from .env file)` in Docker  | No `.env` inside image            | Normal when using `--env-file` / compose `env_file`; vars still injected                       |

---

## License

MIT — see [`LICENSE`](./LICENSE).
