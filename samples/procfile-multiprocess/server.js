// web process — serves HTTP on $PORT (default 3000)
const http = require("http");
const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("web process OK — myserver procfile-multiprocess sample\n");
  })
  .listen(port, () => console.log(`[web] listening on ${port}`));
