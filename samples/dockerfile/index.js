const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dockerfile App | myserver V2</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-base: #020617; /* Slate 950 */
            --blueprint-blue: #1e3a8a; /* Blue 900 */
            --blueprint-grid: rgba(59, 130, 246, 0.2); /* Blue 500 */
            --text-main: #f8fafc;
            --text-accent: #60a5fa; /* Blue 400 */
            --docker-blue: #0ea5e9; /* Sky 500 */
            --success: #10b981;
        }

        body {
            font-family: 'IBM Plex Sans', sans-serif;
            background-color: var(--blueprint-blue);
            color: var(--text-main);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden;
            position: relative;
        }

        /* Blueprint Grid Background */
        body::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background-image: 
                linear-gradient(var(--blueprint-grid) 1px, transparent 1px),
                linear-gradient(90deg, var(--blueprint-grid) 1px, transparent 1px),
                linear-gradient(rgba(59, 130, 246, 0.4) 1px, transparent 1px),
                linear-gradient(90deg, rgba(59, 130, 246, 0.4) 1px, transparent 1px);
            background-size: 20px 20px, 20px 20px, 100px 100px, 100px 100px;
            z-index: 0;
            animation: grid-drift 60s linear infinite;
        }

        @keyframes grid-drift {
            0% { background-position: 0 0, 0 0, 0 0, 0 0; }
            100% { background-position: 100px 100px, 100px 100px, 100px 100px, 100px 100px; }
        }

        /* Scanner Line */
        .scanner {
            position: absolute;
            top: -100px; left: 0; width: 100%; height: 10px;
            background: linear-gradient(to bottom, transparent, var(--docker-blue));
            box-shadow: 0 5px 20px 5px rgba(14, 165, 233, 0.4);
            z-index: 100;
            opacity: 0.5;
            animation: scan 8s ease-in-out infinite alternate;
            pointer-events: none;
        }

        @keyframes scan {
            0% { top: -100px; opacity: 0; }
            10% { opacity: 0.5; }
            90% { opacity: 0.5; }
            100% { top: 110vh; opacity: 0; }
        }

        .container {
            position: relative;
            z-index: 10;
            width: 90%;
            max-width: 600px;
        }

        .blueprint-card {
            background: rgba(2, 6, 23, 0.85); /* Dark slate overlay */
            backdrop-filter: blur(8px);
            border: 2px solid var(--text-accent);
            padding: 3rem;
            position: relative;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
            transform-style: preserve-3d;
            perspective: 1000px;
        }

        /* Technical Corner Accents */
        .blueprint-card::before, .blueprint-card::after {
            content: '';
            position: absolute;
            width: 20px; height: 20px;
            border: 2px solid #fff;
        }
        .blueprint-card::before { top: -5px; left: -5px; border-right: none; border-bottom: none; }
        .blueprint-card::after { bottom: -5px; right: -5px; border-left: none; border-top: none; }

        .corner-tl { position: absolute; top: -5px; right: -5px; width: 20px; height: 20px; border: 2px solid #fff; border-left: none; border-bottom: none; }
        .corner-br { position: absolute; bottom: -5px; left: -5px; width: 20px; height: 20px; border: 2px solid #fff; border-right: none; border-top: none; }

        .header {
            display: flex;
            align-items: flex-start;
            gap: 1.5rem;
            margin-bottom: 2rem;
            border-bottom: 1px dashed var(--text-accent);
            padding-bottom: 2rem;
        }

        .icon {
            font-size: 4rem;
            filter: drop-shadow(0 0 10px var(--docker-blue));
            animation: bounce 4s infinite cubic-bezier(0.28, 0.84, 0.42, 1);
        }

        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }

        .title-group {
            display: flex;
            flex-direction: column;
        }

        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin: 0 0 0.5rem 0;
            letter-spacing: -0.02em;
            text-transform: uppercase;
        }

        h1 span {
            color: var(--docker-blue);
        }

        .desc {
            color: var(--text-dim);
            font-size: 1.1rem;
            line-height: 1.5;
            margin: 0;
        }

        .data-list {
            list-style: none;
            padding: 0;
            margin: 0 0 2rem 0;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 0.9rem;
        }

        .data-list li {
            display: flex;
            margin-bottom: 0.75rem;
            color: #cbd5e1;
        }

        .data-list li::before {
            content: '>';
            color: var(--text-accent);
            margin-right: 1rem;
            font-weight: bold;
        }

        .label { min-width: 120px; color: var(--text-accent); }
        .val { color: #fff; }

        .status-bar {
            background: rgba(16, 185, 129, 0.1);
            border-left: 4px solid var(--success);
            padding: 1rem 1.5rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            font-weight: 600;
            box-shadow: inset 0 0 20px rgba(16, 185, 129, 0.05);
        }

        .status-dot {
            width: 12px; height: 12px;
            background: var(--success);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--success), 0 0 20px var(--success);
            animation: pulse-success 2s infinite;
        }

        @keyframes pulse-success {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        /* Tech rings */
        .ring {
            position: absolute;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            pointer-events: none;
        }
        .ring-1 { width: 400px; height: 400px; top: -100px; right: -100px; border-style: dashed; animation: spin 40s linear infinite; }
        .ring-2 { width: 300px; height: 300px; bottom: -50px; left: -100px; border-width: 2px; border-color: rgba(14, 165, 233, 0.2); animation: spin 30s linear infinite reverse; }

        @keyframes spin { 100% { transform: rotate(360deg); } }

    </style>
</head>
<body>
    <div class="scanner"></div>
    <div class="ring ring-1"></div>
    <div class="ring ring-2"></div>

    <div class="container">
        <div class="blueprint-card">
            <div class="corner-tl"></div>
            <div class="corner-br"></div>

            <div class="header">
                <div class="icon">🐳</div>
                <div class="title-group">
                    <h1>Docker<span>file</span></h1>
                    <p class="desc">Isolating environments with precision. Fully custom container built from user-provided instructions.</p>
                </div>
            </div>

            <ul class="data-list">
                <li><span class="label">IMAGE</span><span class="val">node:20-slim</span></li>
                <li><span class="label">WORKDIR</span><span class="val">/app</span></li>
                <li><span class="label">COMMAND</span><span class="val">["node", "index.js"]</span></li>
                <li><span class="label">NETWORK</span><span class="val">myserver-bridge</span></li>
            </ul>

            <div class="status-bar">
                <div class="status-dot"></div>
                <span style="letter-spacing: 0.05em;">CONTAINER HEALTHY & ONLINE</span>
            </div>
            
            <div style="position: absolute; bottom: -30px; right: 0; font-family: 'IBM Plex Mono'; font-size: 0.7rem; color: var(--text-accent);">
                SYS.BLD.2026 // MYSERVER RUNTIME
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});
