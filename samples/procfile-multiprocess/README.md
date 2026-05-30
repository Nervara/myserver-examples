# procfile-multiprocess

Minimal Node app (no deps) with a **Procfile defining two process types**:

```
web:    node server.js   # HTTP on $PORT (3000)
worker: node worker.js   # background loop, no port
```

## What it exercises
myserver's **Procfile auto-detect**: deploy this as a railpack app with
`processes_from_procfile` enabled, and myserver auto-creates a **child-process
application** named `worker` (running `node worker.js`) on the same build image.
The `web` entry stays the parent. Scale each independently.

- Pack: `railpack`
- Base directory: `/samples/procfile-multiprocess`
- Ports exposes: `3000`
