const express = require('express');
const redis = require('redis');
const app = express();
const port = 8080;

const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', err => console.log('Redis Client Error', err));

app.get('/', async (req, res) => {
    let hits = 0;
    let redisStatus = 'Disconnected';
    
    try {
        if (!client.isOpen) {
            await client.connect();
        }
        await client.incr('hits');
        hits = await client.get('hits');
        redisStatus = 'Connected';
    } catch (err) {
        console.error(err);
        redisStatus = 'Error';
    }

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Docker Compose on myserver</title>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;500;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0a0b;
            --card: #18181b;
            --primary: #f43f5e;
            --secondary: #8b5cf6;
            --text: #fafafa;
        }
        body {
            font-family: 'Manrope', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            width: 100%;
            max-width: 500px;
            padding: 2rem;
        }
        .card {
            background-color: var(--card);
            border: 1px solid #27272a;
            border-radius: 32px;
            padding: 3rem;
            text-align: center;
            box-shadow: 0 50px 100px -20px rgba(0,0,0,1);
        }
        .visual {
            font-size: 3rem;
            margin-bottom: 2rem;
            display: flex;
            justify-content: center;
            gap: 1rem;
        }
        h1 {
            font-weight: 800;
            font-size: 2.25rem;
            margin: 0 0 1rem 0;
            background: linear-gradient(to bottom right, #fff, #a1a1aa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .services {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin-top: 2rem;
        }
        .service-pill {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #27272a;
            padding: 1rem 1.5rem;
            border-radius: 16px;
        }
        .service-name {
            font-weight: 600;
            color: #e4e4e7;
        }
        .service-status {
            font-size: 0.875rem;
            color: ${redisStatus === 'Connected' ? '#10b981' : '#f43f5e'};
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .hits-display {
            margin-top: 2rem;
            padding: 2rem;
            background: linear-gradient(rgba(244, 63, 94, 0.1), rgba(139, 92, 246, 0.1));
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .hits-count {
            font-size: 3.5rem;
            font-weight: 800;
            display: block;
        }
        .hits-label {
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #71717a;
            margin-top: 0.5rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="visual">📦 🗄️</div>
            <h1>Docker Compose</h1>
            
            <div class="services">
                <div class="service-pill">
                    <span class="service-name">Web App</span>
                    <span class="service-status">● running</span>
                </div>
                <div class="service-pill">
                    <span class="service-name">Redis DB</span>
                    <span class="service-status">● ${redisStatus.toLowerCase()}</span>
                </div>
            </div>

            <div class="hits-display">
                <span class="hits-count">${hits}</span>
                <span class="hits-label">Database Hits</span>
            </div>
            
            <p style="margin-top: 2rem; color: #52525b; font-size: 0.875rem;">
                Multi-service orchestration on myserver.
            </p>
        </div>
    </div>
</body>
</html>
    `);
});

app.listen(port, () => {
    console.log(`Compose app listening at http://localhost:${port}`);
});
