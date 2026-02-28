const express = require('express');
const os = require('os');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  const systemInfo = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    uptime: os.uptime(),
    nodeVersion: process.version
  };

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Express on myserver</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #6366f1;
                --primary-dark: #4f46e5;
                --bg: #0f172a;
                --card-bg: rgba(30, 41, 59, 0.7);
                --text: #f8fafc;
                --text-muted: #94a3b8;
            }
            body {
                font-family: 'Inter', sans-serif;
                background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
                color: var(--text);
                margin: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                overflow: hidden;
            }
            .container {
                position: relative;
                z-index: 10;
                width: 100%;
                max-width: 600px;
                padding: 2rem;
            }
            .card {
                background: var(--card-bg);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 3rem;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                animation: fadeIn 0.8s ease-out;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            h1 {
                font-weight: 800;
                font-size: 2.5rem;
                margin: 0 0 0.5rem 0;
                background: linear-gradient(to right, #818cf8, #c084fc);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            p.subtitle {
                color: var(--text-muted);
                font-size: 1.1rem;
                margin-bottom: 2.5rem;
            }
            .info-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 1.5rem;
                margin-bottom: 2.5rem;
            }
            .info-item {
                background: rgba(15, 23, 42, 0.5);
                padding: 1.25rem;
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }
            .info-label {
                color: var(--text-muted);
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-bottom: 0.5rem;
                font-weight: 600;
            }
            .info-value {
                font-family: 'monospace';
                font-weight: 600;
                font-size: 1.1rem;
                color: #e2e8f0;
            }
            .badge {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                background: rgba(99, 102, 241, 0.2);
                color: #818cf8;
                padding: 0.5rem 1rem;
                border-radius: 9999px;
                font-size: 0.875rem;
                font-weight: 600;
                border: 1px solid rgba(99, 102, 241, 0.3);
            }
            .dot {
                width: 8px;
                height: 8px;
                background: #818cf8;
                border-radius: 50%;
                box-shadow: 0 0 12px #818cf8;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.5); opacity: 0.5; }
                100% { transform: scale(1); opacity: 1; }
            }
            .bg-glow {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 400px;
                height: 400px;
                background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(0, 0, 0, 0) 70%);
                filter: blur(60px);
                z-index: 1;
            }
        </style>
    </head>
    <body>
        <div class="bg-glow"></div>
        <div class="container">
            <div class="card">
                <div class="badge">
                    <div class="dot"></div>
                    Deployed on myserver
                </div>
                <h1>Express.js</h1>
                <p class="subtitle">A minimal, working sample app successfully running in a container.</p>
                
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">Runtime</div>
                        <div class="info-value">Node ${systemInfo.nodeVersion}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Platform</div>
                        <div class="info-value">${systemInfo.platform}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Architecture</div>
                        <div class="info-value">${systemInfo.arch}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">CPUs</div>
                        <div class="info-value">${systemInfo.cpus} Cores</div>
                    </div>
                </div>
                
                <div style="text-align: center;">
                    <span style="color: var(--text-muted); font-size: 0.875rem;">Uptime: ${Math.floor(systemInfo.uptime / 60)} minutes</span>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Express app listening at http://localhost:${port}`);
});
