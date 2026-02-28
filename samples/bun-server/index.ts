const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch(request) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bun on myserver</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #fbf7ff;
            --accent: #ff00ff;
            --bg: #050505;
            --card-bg: #111111;
            --text: #ffffff;
            --text-muted: #888888;
        }
        body {
            font-family: 'Space Grotesk', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-image: 
                radial-gradient(circle at 20% 20%, rgba(255, 0, 255, 0.05) 0%, transparent 25%),
                radial-gradient(circle at 80% 80%, rgba(0, 255, 255, 0.05) 0%, transparent 25%);
        }
        .container {
            width: 100%;
            max-width: 600px;
            padding: 2rem;
        }
        .card {
            background-color: var(--card-bg);
            border: 1px solid #222;
            border-radius: 24px;
            padding: 4rem;
            position: relative;
            box-shadow: 0 40px 100px -30px rgba(0, 0, 0, 0.9);
            text-align: center;
        }
        .logo {
            font-size: 4rem;
            margin-bottom: 2rem;
        }
        h1 {
            font-weight: 700;
            font-size: 3.5rem;
            margin: 0 0 1rem 0;
            letter-spacing: -0.04em;
            background: linear-gradient(to bottom, #fff, #888);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            color: var(--text-muted);
            font-size: 1.25rem;
            line-height: 1.5;
            margin-bottom: 3rem;
            font-weight: 300;
        }
        .meta {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            align-items: center;
        }
        .meta-pill {
            background: #1a1a1a;
            border: 1px solid #333;
            padding: 0.75rem 1.5rem;
            border-radius: 12px;
            font-size: 1rem;
            color: #ccc;
            width: fit-content;
        }
        .meta-pill b {
            color: var(--accent);
            margin-right: 0.5rem;
        }
        .footer-tag {
            margin-top: 4rem;
            font-size: 0.8rem;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: #444;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="logo">🥬</div>
            <h1>Bun</h1>
            <p>Next-generation JavaScript runtime, package manager, and bundler on myserver.</p>
            
            <div class="meta">
                <div class="meta-pill"><b>Version</b> ${Bun.version}</div>
                <div class="meta-pill"><b>Platform</b> ${process.platform}</div>
                <div class="meta-pill"><b>Arch</b> ${process.arch}</div>
            </div>
            
            <div class="footer-tag">Optimized by Nixpacks</div>
        </div>
    </div>
</body>
</html>
    `;
    return new Response(html, {
      headers: { "Content-Type": "text/html" }
    });
  },
});

console.log(`Listening on http://localhost:${server.port}...`);
