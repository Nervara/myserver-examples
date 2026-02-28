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
        <title>Express on myserver | V2</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800;900&display=swap" rel="stylesheet">
        <style>
            :root {
                --accent-1: #3b82f6; /* Blueish */
                --accent-2: #8b5cf6; /* Purple */
                --accent-3: #ec4899; /* Pink */
                --bg: #030712;
                --surface-1: rgba(17, 24, 39, 0.6);
                --surface-2: rgba(31, 41, 55, 0.4);
                --border-light: rgba(255, 255, 255, 0.08);
                --text-main: #f8fafc;
                --text-dim: #94a3b8;
            }

            * { box-sizing: border-box; }

            body {
                font-family: 'Outfit', sans-serif;
                margin: 0;
                padding: 0;
                background-color: var(--bg);
                color: var(--text-main);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }

            /* --- Animated Mesh Background --- */
            .mesh-bg {
                position: absolute;
                top: 0; left: 0; width: 100vw; height: 100vh;
                overflow: hidden;
                z-index: 0;
                background: #000;
            }
            .orb {
                position: absolute;
                border-radius: 50%;
                filter: blur(100px);
                opacity: 0.6;
                animation: float-orb 20s infinite alternate cubic-bezier(0.4, 0, 0.2, 1);
            }
            .orb-1 { width: 600px; height: 600px; background: var(--accent-1); top: -200px; left: -100px; }
            .orb-2 { width: 800px; height: 800px; background: var(--accent-2); top: 50%; right: -200px; animation-delay: -5s; animation-direction: alternate-reverse; }
            .orb-3 { width: 500px; height: 500px; background: var(--accent-3); bottom: -200px; left: 30%; animation-delay: -10s; }
            
            @keyframes float-orb {
                0% { transform: translate(0, 0) scale(1); }
                50% { transform: translate(50px, 80px) scale(1.1); }
                100% { transform: translate(-80px, 40px) scale(0.9); }
            }

            /* --- Grid Overlay --- */
            .grid-overlay {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                background-image: 
                    linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px);
                background-size: 40px 40px;
                mask-image: radial-gradient(circle at center, black 40%, transparent 100%);
                -webkit-mask-image: radial-gradient(circle at center, black 40%, transparent 100%);
                z-index: 1;
            }

            /* --- Main Container --- */
            .app-container {
                position: relative;
                z-index: 10;
                width: 90%;
                max-width: 800px;
                display: flex;
                flex-direction: column;
                gap: 2rem;
                perspective: 1000px;
            }

            /* --- Cards --- */
            .glass-card {
                background: var(--surface-1);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border: 1px solid var(--border-light);
                border-radius: 32px;
                padding: 3rem;
                box-shadow: 
                    0 25px 50px -12px rgba(0, 0, 0, 0.7),
                    inset 0 1px 1px rgba(255, 255, 255, 0.1);
                transform-style: preserve-3d;
                animation: pop-in 1s cubic-bezier(0.16, 1, 0.3, 1);
                transition: transform 0.4s ease, border-color 0.4s ease;
            }
            .glass-card:hover {
                transform: translateY(-5px) rotateX(2deg) rotateY(-2deg);
                border-color: rgba(255,255,255,0.2);
            }

            @keyframes pop-in {
                0% { opacity: 0; transform: translateZ(-200px) translateY(40px) rotateX(-10deg); filter: blur(10px); }
                100% { opacity: 1; transform: translateZ(0) translateY(0) rotateX(0); filter: blur(0); }
            }

            /* --- Header Area --- */
            .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 2.5rem;
                border-bottom: 1px solid var(--border-light);
                padding-bottom: 2rem;
            }

            .title-area h1 {
                font-weight: 900;
                font-size: 3.5rem;
                margin: 0;
                line-height: 1;
                background: linear-gradient(135deg, #fff 0%, #cbd5e1 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                letter-spacing: -0.04em;
            }
            .title-area p {
                margin: 0.5rem 0 0 0;
                color: var(--text-dim);
                font-size: 1.1rem;
                font-weight: 300;
            }

            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 0.75rem;
                background: rgba(16, 185, 129, 0.1);
                border: 1px solid rgba(16, 185, 129, 0.2);
                padding: 0.75rem 1.5rem;
                border-radius: 99px;
                color: #34d399;
                font-weight: 600;
                font-size: 0.9rem;
                letter-spacing: 0.05em;
                text-transform: uppercase;
                box-shadow: 0 0 20px rgba(16, 185, 129, 0.1);
            }
            .ping-dot {
                width: 8px; height: 8px;
                background: #10b981;
                border-radius: 50%;
                position: relative;
            }
            .ping-dot::after {
                content: '';
                position: absolute;
                top: -4px; left: -4px; right: -4px; bottom: -4px;
                border: 2px solid #10b981;
                border-radius: 50%;
                animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
            }
            @keyframes ping {
                75%, 100% { transform: scale(2); opacity: 0; }
            }

            /* --- Bento Grid --- */
            .bento-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 1.5rem;
                opacity: 0;
                animation: fade-up 0.8s 0.3s forwards cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes fade-up {
                to { opacity: 1; transform: translateY(0); }
                from { opacity: 0; transform: translateY(20px); }
            }

            .bento-item {
                background: var(--surface-2);
                border: 1px solid var(--border-light);
                border-radius: 20px;
                padding: 1.5rem;
                display: flex;
                flex-direction: column;
                justify-content: center;
                transition: background 0.3s;
                position: relative;
                overflow: hidden;
            }
            .bento-item:hover {
                background: rgba(255,255,255,0.05);
            }
            /* Hover glow effect */
            .bento-item::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.1), transparent 50%);
                opacity: 0;
                transition: opacity 0.3s;
                pointer-events: none;
            }
            .bento-item:hover::before { opacity: 1; }

            .bento-item.wide { grid-column: span 2; }
            
            .item-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                color: var(--text-dim);
                margin-bottom: 0.5rem;
                font-weight: 600;
            }
            .item-data {
                font-size: 1.5rem;
                font-weight: 700;
                color: #fff;
                display: flex;
                align-items: baseline;
                gap: 0.5rem;
            }
            .item-data span { font-size: 0.9rem; color: var(--text-dim); font-weight: 400; }

            /* Loading mask for data */
            .loading-mask {
                display: inline-block;
                min-width: 60px;
                height: 1.5rem;
                background: linear-gradient(90deg, rgba(255,255,255,0.1) 25%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.1) 75%);
                background-size: 200% 100%;
                border-radius: 4px;
                animation: shimmer 1.5s infinite linear;
            }
            @keyframes shimmer { to { background-position: -200% 0; } }
            
        </style>
    </head>
    <body>
        <div class="mesh-bg">
            <div class="orb orb-1"></div>
            <div class="orb orb-2"></div>
            <div class="orb orb-3"></div>
        </div>
        <div class="grid-overlay"></div>

        <div class="app-container">
            <div class="glass-card">
                <div class="header">
                    <div class="title-area">
                        <h1>Express.js</h1>
                        <p>Nixpacks auto-detected Node.js backend running on myserver.</p>
                    </div>
                    <div class="status-badge">
                        <div class="ping-dot"></div>
                        Online
                    </div>
                </div>

                <div class="bento-grid">
                    <div class="bento-item wide">
                        <div class="item-label">Runtime Engine</div>
                        <div class="item-data" data-value="Node ${systemInfo.nodeVersion}"><div class="loading-mask"></div></div>
                    </div>
                    <div class="bento-item">
                        <div class="item-label">Platform</div>
                        <div class="item-data" data-value="${systemInfo.platform}"><div class="loading-mask"></div></div>
                    </div>
                    <div class="bento-item">
                        <div class="item-label">Architecture</div>
                        <div class="item-data" data-value="${systemInfo.arch}"><div class="loading-mask"></div></div>
                    </div>
                    <div class="bento-item">
                        <div class="item-label">Hardware Cores</div>
                        <div class="item-data" data-value="${systemInfo.cpus}"><span>cores</span><div class="loading-mask" style="display:none;"></div></div>
                    </div>
                    <div class="bento-item">
                        <div class="item-label">Server Uptime</div>
                        <div class="item-data" data-value="${Math.floor(systemInfo.uptime / 60)}"><span>mins</span><div class="loading-mask" style="display:none;"></div></div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            // Simulate data loading effect
            setTimeout(() => {
                const dataElements = document.querySelectorAll('.item-data');
                dataElements.forEach((el, index) => {
                    setTimeout(() => {
                        const val = el.getAttribute('data-value');
                        const span = el.querySelector('span'); // Preserve unit span if exists
                        const spanHtml = span ? span.outerHTML : '';
                        el.innerHTML = val + (spanHtml ? ' ' + spanHtml : '');
                        el.style.animation = 'fade-up 0.3s ease-out';
                    }, index * 100);
                });
            }, 800);

            // Mouse tracking for bento glow
            document.querySelectorAll('.bento-item').forEach(item => {
                item.addEventListener('mousemove', e => {
                    const rect = item.getBoundingClientRect();
                    item.style.setProperty('--mouse-x', \`\${e.clientX - rect.left}px\`);
                    item.style.setProperty('--mouse-y', \`\${e.clientY - rect.top}px\`);
                });
            });
        </script>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Express app listening at http://localhost:${port}`);
});
