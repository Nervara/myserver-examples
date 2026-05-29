# AI Tweet Generator

A tiny web service that continuously generates tweets with the **DeepSeek API**
(falling back to canned tweets if the API is unavailable) and stores them in
**PostgreSQL**. It serves a live-updating HTML page so you can watch the tweets
accumulate, and it exposes `/healthz` for platform health checks.

It exists to make **Postgres backup & restore** concrete on
[myserver](https://serverops.cloud): deploy the app, let it write timestamped
rows, take a backup, let it write more, restore, and watch the row count and
`max(created_at)` revert to the backup point.

## Environment variables

| Variable            | Description                                              | Default                              |
| ------------------- | -------------------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`      | Full Postgres connection string (`postgresql://...`)     | *required*                           |
| `DEEPSEEK_API_KEY`  | DeepSeek API key (fallback tweets used if missing)       | *(none)*                             |
| `DEEPSEEK_BASE_URL` | Base URL of the DeepSeek Anthropic-shaped Messages API   | `https://api.deepseek.com/anthropic` |
| `DEEPSEEK_MODEL`    | Model name                                               | `DeepSeek-V4-Pro`                    |
| `PORT`              | HTTP listen port                                         | `8080`                               |

The generator calls `${DEEPSEEK_BASE_URL}/v1/messages` (Anthropic Messages
shape: `x-api-key` + `anthropic-version` headers, top-level `system`, a
`messages` array, and a `content[].text` response). If the key is missing or
the call fails for any reason, it logs the reason and inserts a random canned
tweet instead — the loop never crashes.

## Endpoints

- `GET /` — HTML page: total tweet count + the 10 newest tweets, auto-refreshing every 5s.
- `GET /healthz` — `200 ok` when the DB is reachable, `200 starting` otherwise (lenient so a cold DB or an in-flight restore never fails the deploy).

## Deploy on myserver (build pack = Dockerfile)

1. Create a managed **Postgres** database resource.
2. Create the app with `build_pack=dockerfile`, pointed at this repo with
   `base_directory=/samples/tweet-generator` and `ports_exposes=8080`.
3. Set env vars: `DATABASE_URL` (from the DB resource's connection string),
   `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`.
4. Deploy and open the generated URL — tweets begin flowing within seconds.

## Backup / restore demo (through myserver)

myserver takes a **logical** Postgres backup the same way `pg_dump` does, against
the database container:

- Backup:  `docker exec <db> pg_dump -Fc -U <user> <db> | gzip > artifact`
- Restore: `gunzip -c artifact | docker exec -i <db> pg_restore -U <user> -d <db> --clean --if-exists`

Demo flow: create a DB backup schedule for this database and **Run** it (this
produces an actual backup *execution*). Record `count(*)` and
`max(created_at)`. Let more tweets accumulate, then **Restore** from that
execution — the count and `max(created_at)` revert to the backup point, while
the app keeps running and resumes inserting on top of the restored data.
