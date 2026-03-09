const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch(request) {
    if (new URL(request.url).pathname === '/health') {
      return new Response('OK');
    }
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bun on myserver | V2 Playful</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #fce4ec; /* Light pink background */
            --card-color: #ffffff;
            --text-main: #4a4a4a;
            --text-light: #8e8e8e;
            --bun-pink: #f472b6;
            --bun-yellow: #fde047;
            --bun-blue: #38bdf8;
        }

        body {
            font-family: 'Fredoka', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden;
            position: relative;
        }

        /* Soft Neomorphic Card */
        .card {
            background: var(--card-color);
            border-radius: 40px;
            padding: 4rem 3rem;
            width: 100%;
            max-width: 500px;
            box-shadow: 
                20px 20px 60px #d6c2c9,
                -20px -20px 60px #ffffff;
            position: relative;
            z-index: 10;
            text-align: center;
            animation: float 6s ease-in-out infinite;
        }

        @keyframes float {
            0% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-15px) rotate(1deg); }
            100% { transform: translateY(0px) rotate(0deg); }
        }

        .hero-icon {
            font-size: 6rem;
            margin-bottom: 1rem;
            position: relative;
            display: inline-block;
        }
        .hero-icon::after {
            content: '';
            position: absolute;
            bottom: -20px;
            left: 50%;
            transform: translateX(-50%);
            width: 80%;
            height: 15px;
            background: rgba(0,0,0,0.1);
            border-radius: 50%;
            filter: blur(5px);
            animation: shadow-pulse 6s ease-in-out infinite;
        }

        @keyframes shadow-pulse {
            0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.1; }
            50% { transform: translateX(-50%) scale(0.8); opacity: 0.05; }
        }

        h1 {
            font-weight: 700;
            font-size: 3.5rem;
            margin: 0;
            color: #333;
            letter-spacing: -1px;
        }
        
        .subtitle {
            font-size: 1.25rem;
            color: var(--text-light);
            margin-bottom: 3rem;
            font-weight: 400;
            line-height: 1.4;
        }

        .badges-container {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            justify-content: center;
        }

        .badge {
            background: #f8f9fa;
            border-radius: 20px;
            padding: 0.8rem 1.5rem;
            font-size: 1rem;
            font-weight: 500;
            box-shadow: 
                inset 5px 5px 10px #e6e7e8,
                inset -5px -5px 10px #ffffff;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            cursor: default;
        }

        .badge:hover {
            transform: scale(1.1) rotate(-3deg);
            z-index: 2;
        }

        .badge.pink { color: var(--bun-pink); }
        .badge.blue { color: var(--bun-blue); }
        .badge.yellow { color: #d97706; } /* Darker yellow text for contrast */

        .particle {
            position: absolute;
            font-size: 2rem;
            pointer-events: none;
            z-index: 1;
            opacity: 0.6;
            animation: drift var(--duration) linear infinite;
        }

        @keyframes drift {
            0% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
            10% { opacity: 0.6; }
            90% { opacity: 0.6; }
            100% { transform: translateY(-20vh) rotate(360deg); opacity: 0; }
        }

    </style>
</head>
<body>
    
    <!-- Floating particles -->
    <div class="particle" style="left: 10%; --duration: 15s; font-size: 3rem;">⚡️</div>
    <div class="particle" style="left: 25%; --duration: 22s; font-size: 1.5rem;">🥟</div>
    <div class="particle" style="left: 40%; --duration: 18s; font-size: 2.5rem; animation-delay: 2s;">💨</div>
    <div class="particle" style="left: 65%; --duration: 25s; font-size: 2rem; animation-delay: 5s;">🚀</div>
    <div class="particle" style="left: 85%; --duration: 19s; font-size: 4rem; animation-delay: 1s;">📦</div>
    <div class="particle" style="left: 95%; --duration: 28s; font-size: 1rem; animation-delay: 8s;">⚡️</div>

    <div class="card">
        <div class="hero-icon">🥟</div>
        <h1>Bun</h1>
        <div class="subtitle">Insanely fast JavaScript runtime<br>deployed simply on myserver.</div>
        
        <div class="badges-container">
            <div class="badge pink">
                <span>⚡️</span> v${Bun.version}
            </div>
            <div class="badge blue">
                <span>💻</span> ${process.platform}
            </div>
            <div class="badge yellow">
                <span>⚙️</span> ${process.arch}
            </div>
        </div>
        
        <div style="margin-top: 3rem; font-size: 0.9rem; color: #a1a1aa; font-weight: 500;">
            Powered by Nixpacks Magic ✨
        </div>
    </div>

    <script>
        // Interactive bouncy click effect on card
        const card = document.querySelector('.card');
        card.addEventListener('mousedown', () => {
            card.style.transform = 'scale(0.95)';
            card.style.transition = 'transform 0.1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
        window.addEventListener('mouseup', () => {
            card.style.transform = '';
            card.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
    </script>
</body>
</html>
    `;
    return new Response(html, {
      headers: { "Content-Type": "text/html" }
    });
  },
});

console.log(`Listening on http://localhost:${server.port}...`);
