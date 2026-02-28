from flask import Flask, render_template_string
import os
import platform
import time

app = Flask(__name__)

# Start time for uptime calculation
start_time = time.time()

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flask on myserver</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #ec4899;
            --primary-dark: #be185d;
            --bg: #0c0a09;
            --card-bg: rgba(28, 25, 23, 0.8);
            --text: #fafaf9;
            --text-muted: #a8a29e;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background: radial-gradient(circle at top left, #292524 0%, #0c0a09 100%);
            color: var(--text);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            width: 100%;
            max-width: 600px;
            padding: 2rem;
        }
        .card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 32px;
            padding: 3.5rem;
            box-shadow: 0 40px 80px -20px rgba(0, 0, 0, 0.8);
            animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(40px); }
            to { opacity: 1; transform: translateY(0); }
        }
        h1 {
            font-weight: 800;
            font-size: 3rem;
            margin: 0 0 0.5rem 0;
            letter-spacing: -0.02em;
            background: linear-gradient(to right, #f472b6, #fb923c);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p.subtitle {
            color: var(--text-muted);
            font-size: 1.2rem;
            margin-bottom: 3rem;
            line-height: 1.6;
        }
        .stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-bottom: 3rem;
        }
        .stat-card {
            background: rgba(255, 255, 255, 0.03);
            padding: 1.5rem;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.03);
            transition: transform 0.3s ease;
        }
        .stat-card:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.05);
        }
        .label {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
            font-weight: 600;
        }
        .value {
            font-size: 1.2rem;
            font-weight: 600;
            color: #fff;
        }
        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.75rem;
            background: rgba(34, 197, 94, 0.1);
            color: #4ade80;
            padding: 0.6rem 1.2rem;
            border-radius: 100px;
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 2rem;
            border: 1px solid rgba(34, 197, 94, 0.2);
        }
        .ping {
            width: 10px;
            height: 10px;
            background: #22c55e;
            border-radius: 50%;
            position: relative;
        }
        .ping::after {
            content: '';
            position: absolute;
            width: 100%;
            height: 100%;
            background: inherit;
            border-radius: inherit;
            animation: ripple 1.5s infinite;
        }
        @keyframes ripple {
            from { transform: scale(1); opacity: 0.8; }
            to { transform: scale(3); opacity: 0; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="status-pill">
                <div class="ping"></div>
                Flask Instance Active
            </div>
            <h1>Flask</h1>
            <p class="subtitle">Python backend powered by Nixpacks autodetection on myserver.</p>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="label">Python Version</div>
                    <div class="value">{{ py_version }}</div>
                </div>
                <div class="stat-card">
                    <div class="label">OS Platform</div>
                    <div class="value">{{ os_info }}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Architecture</div>
                    <div class="value">{{ arch }}</div>
                </div>
                <div class="stat-card">
                    <div class="label">Uptime</div>
                    <div class="value">{{ uptime }}s</div>
                </div>
            </div>
            
            <div style="text-align: center; color: var(--text-muted); font-size: 0.9rem;">
                Sample Project Directory: <code>/samples/flask</code>
            </div>
        </div>
    </div>
</body>
</html>
"""

@app.route('/')
def hello():
    uptime = int(time.time() - start_time)
    return render_template_string(
        HTML_TEMPLATE,
        py_version=platform.python_version(),
        os_info=platform.system(),
        arch=platform.machine(),
        uptime=uptime
    )

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
