const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch(request) {
    return new Response("Hello from Bun on myserver!");
  },
});

console.log(`Listening on http://localhost:${server.port}...`);
