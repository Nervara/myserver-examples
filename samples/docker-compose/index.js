const express = require('express');
const redis = require('redis');
const { Client } = require('pg');

const app = express();
const port = process.env.PORT || 8080;

// Configure Redis Client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

let isRedisConnected = false;

async function startRedis() {
  try {
    await redisClient.connect();
    isRedisConnected = true;
    console.log("Connected to Redis!");
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
  }
}

startRedis();

// Configure Postgres Client
const pgClient = new Client({
  user: process.env.DB_USER || 'myuser',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'mydb',
  password: process.env.DB_PASSWORD || 'mypassword',
  port: process.env.DB_PORT || 5432,
});

let isPgConnected = false;

async function startPostgres() {
   try {
     await pgClient.connect();
     isPgConnected = true;
     console.log("Connected to PostgreSQL!");
     
     // Initialize table
     await pgClient.query(`
        CREATE TABLE IF NOT EXISTS access_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip VARCHAR(255)
        )
     `);
   } catch (error) {
     console.error("Failed to connect to PostgreSQL:", error);
   }
}

startPostgres();

app.get('/', async (req, res) => {
  let hits = 0;
  let redisStatusClass = 'offline';
  let redisStatusText = 'Disconnected';
  let pgStatusClass = 'offline';
  let pgStatusText = 'Disconnected';
  
  let userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  if (isRedisConnected) {
    try {
      hits = await redisClient.incr('hits');
      redisStatusClass = 'online';
      redisStatusText = 'Connected';
    } catch (error) {
       console.error("Failed to increment hits:", error);
    }
  }

  if (isPgConnected) {
     try {
        await pgClient.query('INSERT INTO access_logs(ip) VALUES($1)', [userIp]);
        pgStatusClass = 'online';
        pgStatusText = 'Connected';
     } catch (error) {
        console.error("Failed to log access in PG:", error);
     }
  }

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Docker Compose | Complex Architecture</title>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #050b14;
            --panel-bg: #111827;
            --text-main: #f8fafc;
            --text-muted: #64748b;
            --accent: #3b82f6;
            --nginx-green: #009639;
            --node-green: #22c55e;
            --redis-red: #ef4444;
            --pg-blue: #336791;
            --border: #1e293b;
            --line-color: #334155;
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
            background-image: 
                radial-gradient(circle at top right, rgba(59, 130, 246, 0.1), transparent 400px),
                linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
            background-size: 100% 100%, 30px 30px, 30px 30px;
        }

        .dashboard {
            width: 95%;
            max-width: 1200px;
            background: var(--panel-bg);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 3rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.1);
        }

        .header {
            text-align: center;
            margin-bottom: 4rem;
        }

        h1 {
            font-size: 3rem;
            margin: 0 0 0.5rem 0;
            background: linear-gradient(135deg, #60a5fa, #c084fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -1px;
        }

        .architecture {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2rem;
            position: relative;
            padding: 2rem 0;
        }

        .node-column {
            display: flex;
            flex-direction: column;
            gap: 3rem;
            position: relative;
            z-index: 10;
        }

        .node-item {
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 20px;
            padding: 2rem;
            width: 220px;
            text-align: center;
            position: relative;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            backdrop-filter: blur(10px);
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s ease;
        }

        .node-item:hover {
            transform: translateY(-8px) scale(1.02);
        }

        .nginx { border-top: 4px solid var(--nginx-green); }
        .web { border-top: 4px solid var(--node-green); }
        .redis { border-top: 4px solid var(--redis-red); }
        .postgres { border-top: 4px solid var(--pg-blue); }

        .nginx:hover { box-shadow: 0 15px 40px rgba(0, 150, 57, 0.2); }
        .web:hover { box-shadow: 0 15px 40px rgba(34, 197, 94, 0.2); }
        .redis:hover { box-shadow: 0 15px 40px rgba(239, 68, 68, 0.2); }
        .postgres:hover { box-shadow: 0 15px 40px rgba(51, 103, 145, 0.2); }

        .service-icon {
            font-size: 3.5rem;
            margin-bottom: 1rem;
            filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
        }

        h3 { margin: 0 0 0.5rem 0; font-size: 1.3rem; letter-spacing: -0.5px; }
        p { margin: 0; color: var(--text-muted); font-size: 0.9rem; }

        /* Connection Lines Base */
        .conn-line {
            position: absolute;
            background: var(--line-color);
            z-index: 1;
        }

        /* Nginx to Web */
        .conn-front {
            width: 80px;
            height: 2px;
            left: 260px; /* offset from Nginx width + padding margin */
            top: 50%;
            transform: translateY(-50%);
        }

        /* Web to Databses (Forked) */
        .conn-fork-horizontal {
            width: 60px;
            height: 2px;
            left: 600px;
            top: 50%;
            transform: translateY(-50%);
        }
        .conn-fork-vertical {
            width: 2px;
            height: calc(100% - 140px); /* Span across DBs */
            left: 660px;
            top: 50%;
            transform: translateY(-50%);
        }
        .conn-fork-top {
            width: 40px;
            height: 2px;
            left: 660px;
            top: 25%; /* align with top DB */
            transform: translateY(-50%);
        }
        .conn-fork-bottom {
            width: 40px;
            height: 2px;
            left: 660px;
            top: 75%; /* align with bottom DB */
            transform: translateY(-50%);
        }

        /* Animated Packets Container Setup */
        .network-layer {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none;
            z-index: 2;
        }

        .packet {
            width: 8px;
            height: 8px;
            background: #fff;
            border-radius: 50%;
            position: absolute;
            box-shadow: 0 0 10px #fff, 0 0 20px #fff;
            opacity: 0;
        }

        /* Frontend Packet Anim */
        .packet.p-front {
            background: #38bdf8;
            box-shadow: 0 0 10px #38bdf8, 0 0 20px #38bdf8;
            top: calc(50% - 4px);
            left: 260px;
            animation: move-front 2s infinite ease-in-out;
        }

        @keyframes move-front {
            0% { transform: translateX(0); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateX(80px); opacity: 0; }
        }

        /* Backend Top Packet Anim (to Redis) */
        .packet.p-back-top {
            background: #ef4444;
            box-shadow: 0 0 10px #ef4444, 0 0 20px #ef4444;
            top: calc(50% - 4px);
            left: 600px;
        }
        .redis.online ~ .network-layer .p-back-top {
             animation: move-top 2s infinite ease-in-out 0.5s;
        }

        @keyframes move-top {
            0% { transform: translate(0, 0); opacity: 0; }
            10% { opacity: 1; }
            50% { transform: translate(60px, 0); opacity: 1; }
            90% { transform: translate(60px, -135px); opacity: 1; }
            100% { transform: translate(100px, -135px); opacity: 0; }
        }

         /* Backend Bottom Packet Anim (to Postgres) */
        .packet.p-back-bottom {
            background: #3b82f6;
            box-shadow: 0 0 10px #3b82f6, 0 0 20px #3b82f6;
            top: calc(50% - 4px);
            left: 600px;
        }
        .postgres.online ~ .network-layer .p-back-bottom {
             animation: move-bottom 2.5s infinite ease-in-out 0.8s;
        }

        @keyframes move-bottom {
            0% { transform: translate(0, 0); opacity: 0; }
            10% { opacity: 1; }
            40% { transform: translate(60px, 0); opacity: 1; }
            90% { transform: translate(60px, 135px); opacity: 1; }
            100% { transform: translate(100px, 135px); opacity: 0; }
        }


        .pulse-dot {
            width: 12px; height: 12px;
            border-radius: 50%;
            margin: 0 auto 1.5rem;
        }
        .pulse-dot.online { background: #10b981; box-shadow: 0 0 15px #10b981; animation: pulse 2s infinite; }
        .pulse-dot.offline { background: #ef4444; box-shadow: 0 0 15px #ef4444; }

        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        .data-display {
            font-size: 2rem;
            font-weight: 700;
            color: #fff;
            margin-top: 1.5rem;
            display: inline-block;
            background: rgba(0,0,0,0.4);
            padding: 0.5rem 1.5rem;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.05);
            min-width: 60px;
        }

        .status-badge {
            display: inline-block;
            padding: 0.35rem 1rem;
            border-radius: 99px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            margin-top: 1.5rem;
            letter-spacing: 1px;
        }
        .status-badge.online { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
        .status-badge.offline { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }

        .refresh-btn {
            display: block;
            margin: 4rem auto 0;
            background: linear-gradient(135deg, #3b82f6, #6366f1);
            color: white;
            border: none;
            padding: 1.2rem 3rem;
            font-family: inherit;
            font-size: 1.1rem;
            font-weight: 700;
            border-radius: 99px;
            cursor: pointer;
            transition: all 0.3s;
            box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.2);
        }
        .refresh-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 30px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255,255,255,0.2);
        }
        .refresh-btn:active {
            transform: translateY(1px);
        }

        .network-label {
            position: absolute;
            font-size: 0.75rem;
            color: var(--text-muted);
            background: var(--panel-bg);
            padding: 0.2rem 0.5rem;
            border: 1px solid var(--border);
            border-radius: 4px;
            z-index: 5;
        }
        .nl-front { left: 275px; top: calc(50% - 25px); }
        .nl-back { left: 605px; top: calc(50% - 25px); }

    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>Scalable 3-Tier Architecture</h1>
            <p style="color: var(--text-muted); font-size: 1.2rem; margin-top: 0.5rem;">Docker Compose: Proxy / App / Cache / DB</p>
        </div>

        <div class="architecture">
            
            <!-- Proxy Tier -->
            <div class="node-column" style="z-index: 20;">
                <div class="node-item nginx">
                    <div class="pulse-dot online"></div>
                    <div class="service-icon">🛡️</div>
                    <h3>Nginx Reverse Proxy</h3>
                    <p>Load Balancer</p>
                    <div class="status-badge online">Routing</div>
                </div>
            </div>

            <!-- Frontend Network Connection -->
            <div class="conn-line conn-front"></div>
            <div class="network-label nl-front">net: frontend</div>

            <!-- Application Tier -->
            <div class="node-column" style="z-index: 20; transform: translateX(80px);">
                <div class="node-item web">
                    <div class="pulse-dot online"></div>
                    <div class="service-icon">⚡</div>
                    <h3>Node.js App</h3>
                    <p>Express server</p>
                    <div class="data-display">${hits}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">Total Requests</div>
                </div>
            </div>

             <!-- Backend Network Connections -->
            <div class="conn-line conn-fork-horizontal" style="transform: translateX(80px);"></div>
            <div class="conn-line conn-fork-vertical" style="transform: translateX(80px);"></div>
            <div class="conn-line conn-fork-top" style="transform: translateX(80px);"></div>
            <div class="conn-line conn-fork-bottom" style="transform: translateX(80px);"></div>
            <div class="network-label nl-back" style="transform: translateX(80px);">net: backend</div>

            <!-- Data Tier -->
            <div class="node-column redis ${redisStatusClass} postgres ${pgStatusClass}" style="z-index: 20; transform: translateX(120px);">
                <div class="node-item redis">
                    <div class="pulse-dot ${redisStatusClass}"></div>
                    <div class="service-icon">�</div>
                    <h3>Redis Cache</h3>
                    <p>In-memory store</p>
                    <div class="status-badge ${redisStatusClass}">${redisStatusText}</div>
                </div>

                <div class="node-item postgres">
                    <div class="pulse-dot ${pgStatusClass}"></div>
                    <div class="service-icon">💾</div>
                    <h3>PostgreSQL</h3>
                    <p>Relational DB</p>
                    <div class="status-badge ${pgStatusClass}">${pgStatusText}</div>
                </div>
            </div>

            <!-- Animated Particles -->
            <div class="network-layer">
                <div class="packet p-front"></div>
                <div class="packet p-back-top" style="transform: translateX(80px);"></div>
                <div class="packet p-back-bottom" style="transform: translateX(80px);"></div>
            </div>

        </div>

  `);
});

app.listen(port, () => {
  console.log(`Docker compose app listening at http://localhost:${port}`);
});
