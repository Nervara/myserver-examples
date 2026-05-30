// worker process — no HTTP port; a background loop. myserver auto-creates this
// as a child-process application when processes_from_procfile is enabled.
let n = 0;
console.log("[worker] started");
setInterval(() => console.log(`[worker] tick ${++n}`), 5000);
