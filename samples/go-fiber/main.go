package main

import (
	"fmt"
	"log"
	"os"
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

var startTime time.Time

func init() {
	startTime = time.Now()
}

func main() {
	app := fiber.New()

	// Default logger middleware
	app.Use(logger.New())

	app.Get("/", func(c *fiber.Ctx) error {
		uptime := time.Since(startTime).Truncate(time.Second).String()

		html := fmt.Sprintf(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Barbaros Captan - Sea War</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Pirata+One&family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --sky-top: #0b1021;
            --sky-bottom: #2b395e;
            --ocean-color: #0b2239;
            --wave-light: #163659;
            --ship-wood: #3e2723;
            --ship-dark: #1b100e;
            --sail: #d7ccc8;
            --fire: #ff5722;
        }

        body, html {
            margin: 0;
            padding: 0;
            width: 100%%;
            height: 100%%;
            background: linear-gradient(to bottom, var(--sky-top), var(--sky-bottom));
            font-family: 'Roboto', sans-serif;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
        }

        /* Lightning effect */
        .sky {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%%;
            height: 100%%;
            background: rgba(255, 255, 255, 0);
            animation: lightning 10s infinite;
            z-index: 0;
        }

        @keyframes lightning {
            0%%, 95%%, 98%%, 100%% { background: rgba(255, 255, 255, 0); }
            96%% { background: rgba(255, 255, 255, 0.4); }
            97%% { background: rgba(255, 255, 255, 0); }
            99%% { background: rgba(255, 255, 255, 0.6); }
        }

        .title-container {
            position: absolute;
            top: 10%%;
            text-align: center;
            z-index: 10;
            text-shadow: 2px 2px 10px rgba(0,0,0,0.8);
        }

        h1 {
            font-family: 'Pirata One', cursive;
            font-size: 5rem;
            margin: 0;
            color: #d4af37;
            letter-spacing: 2px;
        }
        
        h2 {
            font-family: 'Pirata One', cursive;
            font-size: 2rem;
            margin: 0;
            color: #e0e0e0;
        }

        /* The Main Ship */
        .ship-container {
            position: absolute;
            bottom: 30%%;
            width: 400px;
            height: 350px;
            z-index: 5;
            animation: bobbing 4s ease-in-out infinite alternate, sailing 20s linear infinite;
        }

        @keyframes bobbing {
            0%% { transform: translateY(0) rotate(-2deg); }
            100%% { transform: translateY(20px) rotate(2deg); }
        }

        @keyframes sailing {
            0%% { left: -400px; }
            50%% { left: calc(50%% - 200px); }
            100%% { left: 100vw; }
        }

        /* SVG Ship */
        .ship {
            width: 100%%;
            height: 100%%;
        }

        /* Cannons */
        .cannon-fire {
            position: absolute;
            width: 20px;
            height: 20px;
            background: radial-gradient(circle, #fff, #ffeb3b, #ff5722, transparent);
            border-radius: 50%%;
            opacity: 0;
        }

        .fire1 { bottom: 120px; left: 150px; animation: boom 3s infinite 0.5s; }
        .fire2 { bottom: 120px; left: 220px; animation: boom 4s infinite 2s; }
        .fire3 { bottom: 120px; left: 290px; animation: boom 3.5s infinite 1s; }

        @keyframes boom {
            0%% { transform: scale(0); opacity: 0; }
            10%% { transform: scale(3); opacity: 1; }
            20%% { transform: scale(1); opacity: 0; }
            100%% { opacity: 0; }
        }

        /* Cannonballs */
        .cannonball {
            position: absolute;
            width: 8px;
            height: 8px;
            background: #222;
            border-radius: 50%%;
            opacity: 0;
        }

        .ball1 { bottom: 125px; left: 150px; animation: shoot1 3s infinite 0.6s; }
        .ball2 { bottom: 125px; left: 220px; animation: shoot2 4s infinite 2.1s; }

        @keyframes shoot1 {
            0%% { bottom: 125px; left: 150px; opacity: 1; }
            20%% { bottom: 200px; left: -200px; opacity: 1; }
            21%% { opacity: 0; }
            100%% { opacity: 0; }
        }

        @keyframes shoot2 {
            0%% { bottom: 125px; left: 220px; opacity: 1; }
            20%% { bottom: 180px; left: 800px; opacity: 1; }
            21%% { opacity: 0; }
            100%% { opacity: 0; }
        }


        /* Ocean and Waves */
        .ocean {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%%;
            height: 35%%;
            background: var(--ocean-color);
            z-index: 8;
        }

        .wave {
            position: absolute;
            bottom: 100%%;
            width: 200vw;
            height: 100px;
            background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 1200 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><path d="M0,0 C150,60 350,0 600,60 C850,120 1050,60 1200,0 L1200,120 L0,120 Z" fill="%%23163659" opacity="0.8"/></svg>') repeat-x;
            background-size: 1000px 100px;
            animation: wave-move-1 7s linear infinite;
        }
        
        .wave2 {
            position: absolute;
            bottom: 100%%;
            width: 200vw;
            height: 80px;
            background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 1200 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><path d="M0,60 C150,120 350,60 600,120 C850,60 1050,120 1200,60 L1200,120 L0,120 Z" fill="%%230b2239"/></svg>') repeat-x;
            background-size: 1100px 80px;
            animation: wave-move-2 5s linear infinite;
        }

        @keyframes wave-move-1 {
            0%% { left: 0; }
            100%% { left: -1000px; }
        }

        @keyframes wave-move-2 {
            0%% { left: -1100px; }
            100%% { left: 0; }
        }

        .stats-panel {
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: rgba(0,0,0,0.6);
            border: 2px solid #d4af37;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            z-index: 20;
            backdrop-filter: blur(4px);
        }

        .stats-panel h3 { margin: 0 0 10px 0; color: #d4af37; border-bottom: 1px solid #d4af37; padding-bottom: 5px; }
        .stat-row { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 5px; }
        .stat-val { color: #00ffcc; }

        .health-link {
            position: absolute;
            top: 20px;
            right: 20px;
            color: #d4af37;
            text-decoration: none;
            border: 2px solid #d4af37;
            padding: 8px 16px;
            font-family: 'Pirata One', cursive;
            font-size: 1.2rem;
            z-index: 20;
            background: rgba(0,0,0,0.5);
            transition: all 0.3s ease;
        }

        .health-link:hover {
            background: #d4af37;
            color: #000;
        }
        
    </style>
</head>
<body>
    <div class="sky"></div>
    
    <a href="/health" class="health-link" target="_blank">[ /HEALTH ]</a>

    <div class="title-container">
        <h1>Barbaros Captan</h1>
        <h2>The Grand Admiral of the Sea</h2>
    </div>

    <!-- The Ship and Cannons -->
    <div class="ship-container">
        <!-- SVG Ship silhouette -->
        <svg class="ship" viewBox="0 0 400 350" xmlns="http://www.w3.org/2000/svg">
            <!-- Mast & Sails -->
            <path d="M 170 50 L 170 200 M 240 70 L 240 200 M 100 120 L 100 200" stroke="#1b100e" stroke-width="8" />
            
            <!-- Flags -->
            <path d="M 170 50 L 120 60 L 170 80 Z" fill="#b71c1c" />
            <circle cx="140" cy="65" r="4" fill="#fff"/>
            <path d="M 240 70 L 190 80 L 240 100 Z" fill="#b71c1c" />
            <circle cx="210" cy="85" r="4" fill="#fff"/>
            
            <!-- Main Sails -->
            <path d="M 170 90 Q 220 120 170 180 Q 120 150 170 90" fill="var(--sail)" stroke="#ccc" stroke-width="2"/>
            <path d="M 240 110 Q 290 140 240 190 Q 190 160 240 110" fill="var(--sail)" stroke="#ccc" stroke-width="2"/>
            <path d="M 100 130 Q 140 160 100 190 Q 60 160 100 130" fill="var(--sail)" stroke="#ccc" stroke-width="2"/>
            <path d="M 280 150 Q 340 180 280 220 Q 220 190 280 150" fill="var(--sail)" stroke="#ccc" stroke-width="2"/> <!-- back sail -->

            <!-- Flag poles crossing (Pirate skull vibe) -->
            <circle cx="170" cy="130" r="10" fill="#111"/>
            
            <!-- Hull -->
            <path d="M 40 200 L 360 200 Q 380 250 330 280 L 80 280 Q 20 250 40 200" fill="var(--ship-wood)" stroke="var(--ship-dark)" stroke-width="4"/>
            <!-- Ship details -->
            <line x1="60" y1="220" x2="340" y2="220" stroke="var(--ship-dark)" stroke-width="3"/>
            <line x1="70" y1="240" x2="330" y2="240" stroke="var(--ship-dark)" stroke-width="3"/>
            <line x1="80" y1="260" x2="320" y2="260" stroke="var(--ship-dark)" stroke-width="3"/>
            
            <!-- Cannon holes -->
            <circle cx="150" cy="230" r="6" fill="#000"/>
            <circle cx="220" cy="230" r="6" fill="#000"/>
            <circle cx="290" cy="230" r="6" fill="#000"/>
        </svg>

        <!-- Animations for firing -->
        <div class="cannon-fire fire1"></div>
        <div class="cannon-fire fire2"></div>
        <div class="cannon-fire fire3"></div>
        
        <div class="cannonball ball1"></div>
        <div class="cannonball ball2"></div>
    </div>

    <!-- The Ocean layers -->
    <div class="ocean">
        <div class="wave"></div>
        <div class="wave2"></div>
    </div>

    <!-- Fleet Info Panel -->
    <div class="stats-panel">
        <h3>Fleet Status Logs</h3>
        <div class="stat-row"><span>Go Version:</span> <span class="stat-val">%s</span></div>
        <div class="stat-row"><span>OS/Arch:</span> <span class="stat-val">%s/%s</span></div>
        <div class="stat-row"><span>Crew (Routines):</span> <span class="stat-val">%d</span></div>
        <div class="stat-row"><span>Voyage Uptime:</span> <span class="stat-val">%s</span></div>
    </div>

    <!-- Camera label -->
    <div id="cam-label" style="
        position: absolute; top: 20px; left: 20px;
        font-family: 'Pirata One', cursive; font-size: 1.1rem;
        color: rgba(212,175,55,0.85); z-index: 30;
        background: rgba(0,0,0,0.5); padding: 4px 14px;
        border: 1px solid rgba(212,175,55,0.4);
        text-shadow: 0 0 8px rgba(212,175,55,0.5);
        transition: opacity 0.5s;
    "></div>

    <script>
    // ── Cinematic camera angles ──────────────────────────────────────────
    const cameras = [
        {
            name: "⚓ Harbour Watch",
            scene: "perspective(900px) rotateX(0deg) rotateY(0deg) rotateZ(0deg)",
            origin: "50%% 50%%",
            bgShift: "50%% 50%%",
            duration: 6000
        },
        {
            name: "🦅 Crow's Nest",
            scene: "perspective(600px) rotateX(35deg) rotateY(0deg) rotateZ(0deg) translateY(-60px)",
            origin: "50%% 0%%",
            bgShift: "50%% 30%%",
            duration: 7000
        },
        {
            name: "⚔ Broadside",
            scene: "perspective(800px) rotateX(5deg) rotateY(-25deg) rotateZ(2deg)",
            origin: "70%% 50%%",
            bgShift: "60%% 50%%",
            duration: 6000
        },
        {
            name: "🌊 Wave Level",
            scene: "perspective(500px) rotateX(-8deg) rotateY(8deg) rotateZ(-3deg) translateY(40px)",
            origin: "50%% 80%%",
            bgShift: "50%% 70%%",
            duration: 7000
        },
        {
            name: "🧭 Bow Chase",
            scene: "perspective(700px) rotateX(12deg) rotateY(15deg) rotateZ(1deg) translateZ(30px)",
            origin: "30%% 50%%",
            bgShift: "40%% 50%%",
            duration: 6000
        },
        {
            name: "🌀 Storm Roll",
            scene: "perspective(650px) rotateX(6deg) rotateY(-10deg) rotateZ(-6deg)",
            origin: "50%% 50%%",
            bgShift: "50%% 50%%",
            duration: 5000
        }
    ];

    const scene = document.body;
    const label = document.getElementById('cam-label');
    let idx = 0;

    function applyCamera(cam) {
        scene.style.transition = "transform 2.5s cubic-bezier(0.45, 0, 0.55, 1), perspective-origin 2.5s ease, background-position 3s ease";
        scene.style.transform = cam.scene;
        scene.style.perspectiveOrigin = cam.origin;
        scene.style.backgroundPosition = cam.bgShift;

        // update label with fade
        label.style.opacity = '0';
        setTimeout(() => {
            label.textContent = cam.name;
            label.style.opacity = '1';
        }, 400);
    }

    function nextCamera() {
        applyCamera(cameras[idx]);
        setTimeout(nextCamera, cameras[idx].duration);
        idx = (idx + 1) %% cameras.length;
    }

    // small delay so page renders first
    setTimeout(nextCamera, 800);
    </script>
</body>
</html>

`, runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.NumGoroutine(), uptime)

		c.Set(fiber.HeaderContentType, fiber.MIMETextHTML)
		return c.SendString(html)
	})

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "healthy",
			"uptime": time.Since(startTime).String(),
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Fatal(app.Listen(":" + port))
}
