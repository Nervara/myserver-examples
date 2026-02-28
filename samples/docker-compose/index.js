const express = require('express');
const redis = require('redis');

const app = express();
const port = process.env.PORT || 3000;

// Configure Redis Client
const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => console.log('Redis Client Error', err));

let isRedisConnected = false;

async function startRedis() {
  try {
    await client.connect();
    isRedisConnected = true;
    console.log("Connected to Redis!");
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
  }
}

startRedis();

app.get('/', async (req, res) => {
  let hits = 0;
  let redisStatusClass = 'offline';
  let redisStatusText = 'Disconnected';

  if (isRedisConnected) {
    try {
      hits = await client.incr('hits');
      redisStatusClass = 'online';
      redisStatusText = 'Connected';
    } catch (error) {
       console.error("Failed to increment hits:", error);
    }
  }

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Docker Compose | myserver V2 Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0b1121;
            --panel-bg: #1e293b;
            --text-main: #f1f5f9;
            --text-muted: #94a3b8;
            --accent: #38bdf8;
            --redis-red: #ef4444;
            --node-green: #22c55e;
            --border: #334155;
        }

        body {
            font-family: 'Space Grotesk', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-image: radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 400px);
        }

        .dashboard {
            width: 90%;
            max-width: 900px;
            background: var(--panel-bg);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 3rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .header {
            text-align: center;
            margin-bottom: 3rem;
        }

        h1 {
            font-size: 2.5rem;
            margin: 0 0 0.5rem 0;
            background: linear-gradient(90deg, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .architecture {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2rem;
            position: relative;
        }

        .node, .redis {
            background: rgba(15, 23, 42, 0.8);
            border: 2px solid;
            border-radius: 16px;
            padding: 2rem;
            width: 200px;
            text-align: center;
            position: relative;
            z-index: 10;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        .node:hover, .redis:hover {
            transform: translateY(-5px);
        }

        .node { border-color: var(--node-green); box-shadow: 0 0 20px rgba(34, 197, 94, 0.2); }
        .redis { border-color: var(--redis-red); box-shadow: 0 0 20px rgba(239, 68, 68, 0.2); }

        .service-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
        }

        h3 { margin: 0 0 0.5rem 0; font-size: 1.2rem; }
        p { margin: 0; color: var(--text-muted); font-size: 0.9rem; }

        /* Animated connection line */
        .connection {
            display: flex;
            align-items: center;
            width: 150px;
            height: 2px;
            background: var(--border);
            position: relative;
            z-index: 1;
        }

        .data-packet {
            width: 10px;
            height: 10px;
            background: var(--accent);
            border-radius: 50%;
            position: absolute;
            left: 0;
            box-shadow: 0 0 10px var(--accent), 0 0 20px var(--accent);
            opacity: 0;
            /* If connected, play animation */
        }

        .online .data-packet {
            animation: send-packet 2s infinite cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes send-packet {
            0% { left: 0; opacity: 1; transform: scale(1); }
            50% { transform: scale(1.5); }
            90% { left: calc(100% - 10px); opacity: 1; transform: scale(1); }
            100% { left: calc(100% - 10px); opacity: 0; }
        }

        .pulse-dot {
            width: 12px; height: 12px;
            border-radius: 50%;
            margin: 0 auto 1rem;
        }
        .pulse-dot.online { background: #10b981; box-shadow: 0 0 15px #10b981; animation: pulse 2s infinite; }
        .pulse-dot.offline { background: #ef4444; box-shadow: 0 0 15px #ef4444; }

        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        .hits-display {
            font-size: 3rem;
            font-weight: 700;
            color: #fff;
            margin-top: 1rem;
            display: inline-block;
            background: rgba(0,0,0,0.3);
            padding: 0.5rem 1.5rem;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.05);
        }

        .status-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 99px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            margin-top: 1rem;
        }
        .status-badge.online { background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
        .status-badge.offline { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }

        .refresh-btn {
            display: block;
            margin: 3rem auto 0;
            background: linear-gradient(135deg, var(--accent), #2563eb);
            color: white;
            border: none;
            padding: 1rem 2.5rem;
            font-family: inherit;
            font-size: 1rem;
            font-weight: 700;
            border-radius: 99px;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 10px 20px rgba(56, 189, 248, 0.3);
        }
        .refresh-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 25px rgba(56, 189, 248, 0.4);
        }
        .refresh-btn:active {
            transform: translateY(1px);
        }

    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>Multi-Service Architecture</h1>
            <p style="color: var(--text-muted); font-size: 1.1rem;">Docker Compose / Node.js + Redis</p>
        </div>

        <div class="architecture ${redisStatusClass}">
            <!-- Web App Node -->
            <div class="node">
                <div class="pulse-dot online"></div>
                <div class="service-icon">🌐</div>
                <h3>Web App</h3>
                <p>Express.js</p>
                <div class="hits-display">${hits}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">Page Views</div>
            </div>

            <!-- Connection Pipeline -->
            <div class="connection">
                <div class="data-packet"></div>
                <div style="position: absolute; top: -25px; left: 50%; transform: translateX(-50%); font-size: 0.75rem; color: var(--text-muted);">TCP/6379</div>
            </div>

            <!-- Redis Node -->
            <div class="redis">
                <div class="pulse-dot ${redisStatusClass}"></div>
                <div class="service-icon">🗄️</div>
                <h3>Redis Cache</h3>
                <p>In-memory store</p>
                <div class="status-badge ${redisStatusClass}">${redisStatusText}</div>
            </div>
        </div>

        <button class="refresh-btn" onclick="location.reload()">Simulate Request</button>
    </div>
</body>
</html>
  `);
});

app.listen(port, () => {
  console.log(`Docker compose app listening at http://localhost:${port}`);
});
