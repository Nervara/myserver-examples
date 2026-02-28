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
    <title>Flask on myserver | V2 Terminal</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --term-bg: #050505;
            --term-green: #39ff14;
            --term-green-dim: rgba(57, 255, 20, 0.4);
            --term-border: #111;
            --scan-line: rgba(57, 255, 20, 0.1);
        }

        body {
            font-family: 'Fira Code', monospace;
            background-color: var(--term-bg);
            color: var(--term-green);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden;
            position: relative;
        }

        /* Scanline Effect */
        body::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: linear-gradient(to bottom, transparent 50%, var(--scan-line) 51%);
            background-size: 100% 4px;
            pointer-events: none;
            z-index: 100;
        }

        /* CRT Flicker */
        .crt::before {
            content: " ";
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            right: 0;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
            z-index: 2;
            background-size: 100% 2px, 3px 100%;
            pointer-events: none;
        }

        .terminal-container {
            width: 100%;
            max-width: 800px;
            background: rgba(0, 10, 0, 0.8);
            border: 1px solid var(--term-green-dim);
            border-radius: 8px;
            padding: 2px;
            box-shadow: 0 0 20px rgba(57, 255, 20, 0.1), inset 0 0 30px rgba(57, 255, 20, 0.05);
            position: relative;
            z-index: 10;
        }

        .terminal-header {
            display: flex;
            background: var(--term-green-dim);
            color: #000;
            padding: 8px 16px;
            font-weight: 700;
            align-items: center;
            justify-content: space-between;
            border-radius: 4px 4px 0 0;
        }

        .terminal-body {
            padding: 2rem;
            min-height: 400px;
        }

        .sys-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            row-gap: 1rem;
            column-gap: 2rem;
            margin-top: 2rem;
            border-top: 1px dashed var(--term-green-dim);
            padding-top: 2rem;
            opacity: 0;
            animation: fadeIn 0.5s 2.5s forwards;
        }

        @keyframes fadeIn { to { opacity: 1; } }

        .info-row {
            display: flex;
            justify-content: space-between;
        }
        .info-label { color: var(--term-green-dim); }
        
        .cursor {
            display: inline-block;
            width: 10px;
            height: 1.2em;
            background: var(--term-green);
            vertical-align: text-bottom;
            animation: blink 1s step-end infinite;
        }
        @keyframes blink { 50% { opacity: 0; } }

        .typewriter {
            overflow: hidden;
            white-space: pre-wrap;
            border-right: 2px solid transparent; 
        }

        /* Glitch effect on title */
        .glitch {
            position: relative;
            font-size: 2rem;
            font-weight: 700;
            display: inline-block;
            margin-bottom: 1rem;
        }
        .glitch::before, .glitch::after {
            content: attr(data-text);
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        }
        .glitch::before {
            left: 2px;
            text-shadow: -1px 0 red;
            background: var(--term-bg);
            animation: glitch-anim-1 2s infinite linear alternate-reverse;
        }
        .glitch::after {
            left: -2px;
            text-shadow: -1px 0 blue;
            background: var(--term-bg);
            animation: glitch-anim-2 3s infinite linear alternate-reverse;
        }

        @keyframes glitch-anim-1 {
            0% { clip: rect(20px, 9999px, 85px, 0); }
            20% { clip: rect(4px, 9999px, 14px, 0); }
            40% { clip: rect(42px, 9999px, 5px, 0); }
            60% { clip: rect(65px, 9999px, 89px, 0); }
            80% { clip: rect(32px, 9999px, 66px, 0); }
            100% { clip: rect(10px, 9999px, 100px, 0); }
        }
        @keyframes glitch-anim-2 {
            0% { clip: rect(15px, 9999px, 90px, 0); }
            20% { clip: rect(23px, 9999px, 4px, 0); }
            40% { clip: rect(8px, 9999px, 63px, 0); }
            60% { clip: rect(98px, 9999px, 32px, 0); }
            80% { clip: rect(44px, 9999px, 9px, 0); }
            100% { clip: rect(72px, 9999px, 46px, 0); }
        }
        
        button.action-btn {
            background: transparent;
            color: var(--term-green);
            border: 1px solid var(--term-green);
            padding: 8px 16px;
            font-family: inherit;
            cursor: pointer;
            margin-top: 2rem;
            text-transform: uppercase;
            transition: all 0.2s;
            opacity: 0;
            animation: fadeIn 0.5s 3.5s forwards;
        }
        button.action-btn:hover {
            background: var(--term-green);
            color: var(--term-bg);
            box-shadow: 0 0 10px var(--term-green);
        }

    </style>
</head>
<body class="crt">
    <div class="terminal-container">
        <div class="terminal-header">
            <span>user@myserver:~</span>
            <span>FLASK_ENV=production</span>
        </div>
        <div class="terminal-body" id="term-body">
            <!-- Typweriter target -->
        </div>
    </div>

    <script>
        const sequences = [
            "Initializing myserver secure connection...",
            "Loading Nixpacks environment...",
            "Booting Flask web server [gunicorn]...",
            "Status: ACTIVE"
        ];
        
        const termBody = document.getElementById('term-body');
        let htmlContent = '<div class="glitch" data-text="FLASK_NODE_READY">FLASK_NODE_READY</div><br><br>';
        
        let seqIdx = 0;
        let charIdx = 0;
        let lineEl = null;

        function typeWriter() {
            if (seqIdx < sequences.length) {
                if (!lineEl) {
                    lineEl = document.createElement('div');
                    lineEl.innerHTML = '> <span class="text"></span><span class="cursor"></span>';
                    termBody.appendChild(lineEl);
                }
                
                if (charIdx < sequences[seqIdx].length) {
                    lineEl.querySelector('.text').innerHTML += sequences[seqIdx].charAt(charIdx);
                    charIdx++;
                    setTimeout(typeWriter, Math.random() * 30 + 20); // random typing speed
                } else {
                    lineEl.querySelector('.cursor').remove();
                    seqIdx++;
                    charIdx = 0;
                    lineEl = null;
                    setTimeout(typeWriter, 400); // pause between lines
                }
            } else {
                // Done writing sequences, append the static/faded-in sys info
                const sysInfoHTML = `
                    <div class="sys-info">
                        <div class="info-row"><span class="info-label">Python</span><span class="info-val">{{ py_version }}</span></div>
                        <div class="info-row"><span class="info-label">OS Kernel</span><span class="info-val">{{ os_info }}</span></div>
                        <div class="info-row"><span class="info-label">Architecture</span><span class="info-val">{{ arch }}</span></div>
                        <div class="info-row"><span class="info-label">Sys Uptime</span><span class="info-val">{{ uptime }}s</span></div>
                    </div>
                `;
                termBody.insertAdjacentHTML('beforeend', sysInfoHTML);
                termBody.insertAdjacentHTML('beforeend', '<br><br>> <span class="cursor"></span>');
            }
        }

        // Start animation
        termBody.innerHTML = htmlContent;
        setTimeout(typeWriter, 800);
    </script>
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
