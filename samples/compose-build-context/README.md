# compose-build-context

A Docker Compose sample whose primary service is built from a **nested
build context** (`build: app/web`), mirroring the
[docker/awesome-compose](https://github.com/docker/awesome-compose)
layout (e.g. `aspnetapp`'s `build: app/aspnetapp`).

```
compose-build-context/
├── docker-compose.yml      # web (build: app/web) + cache (redis:alpine, pre-built)
└── app/
    └── web/
        ├── Dockerfile       # node:20-slim, no deps
        └── server.js        # zero-dependency HTTP server on :80
```

## Why this sample exists

A local `build:` context only resolves when the source is on disk. That
means deploying **from a Git repo** so myserver clones the source —
**not** as inline paste-and-deploy compose. Inline compose writes only
the YAML body and has nothing to clone, so a `build:` directive fails
with:

```
unable to prepare context: path ".../app/web" not found
```

Use this sample to regression-test the *compose-build-from-source* path
and to demonstrate the correct deploy shape to customers who paste an
awesome-compose file and hit the missing-context error.

## Deploy on myserver

| Field | Value |
|---|---|
| Repo | `https://github.com/Nervara/myserver-examples.git` |
| Branch | `main` |
| Base directory | `/samples/compose-build-context` |
| Build pack | `dockercompose` |
| Ports exposes | `80` |

The `web` service is the routed upstream (first service → Caddy alias).
`cache` is an internal pre-built sibling proving the mixed
build + pull path. `GET /` returns JSON identifying the sample and
whether `cache` is reachable; `GET /healthz` returns `ok`.
