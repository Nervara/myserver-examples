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
    <title>Go Fiber on myserver | V2 Cyberpunk</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #09090f;
            --main-neon: #00ffcc;
            --accent-neon: #ff00ff;
            --dark-card: #0c0c14;
            --text-main: #e0e0e0;
        }

        body {
            font-family: 'Rajdhani', sans-serif;
            background-color: var(--bg);
            color: var(--text-main);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-image: 
                linear-gradient(rgba(0, 255, 204, 0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0, 255, 204, 0.05) 1px, transparent 1px);
            background-size: 50px 50px;
            background-position: center center;
            overflow: hidden;
            perspective: 800px;
        }

        /* Animated Grid Floor */
        .floor {
            position: absolute;
            bottom: -50vh;
            width: 200vw;
            height: 100vh;
            background-image: 
                linear-gradient(transparent 30%, rgba(0, 255, 204, 0.4) 1px),
                linear-gradient(90deg, transparent 98%, rgba(0, 255, 204, 0.4) 1px);
            background-size: 100px 100px;
            transform: rotateX(80deg);
            transform-origin: top;
            animation: floor-move 4s linear infinite;
            z-index: 0;
            opacity: 0.3;
        }
        @keyframes floor-move {
            0% { transform: rotateX(80deg) translateY(0); }
            100% { transform: rotateX(80deg) translateY(100px); }
        }

        .container {
            position: relative;
            z-index: 10;
            width: 100%%;
            max-width: 650px;
            padding: 2rem;
            animation: drop-in 1s cubic-bezier(0.19, 1, 0.22, 1);
        }

        @keyframes drop-in {
            0% { transform: translateY(-100vh) scale(0.5); opacity: 0; }
            100% { transform: translateY(0) scale(1); opacity: 1; }
        }

        .cyber-card {
            background: var(--dark-card);
            border: 1px solid var(--accent-neon);
            padding: 3rem;
            position: relative;
            box-shadow: 
                0 0 20px rgba(255, 0, 255, 0.2),
                inset 0 0 20px rgba(0, 255, 204, 0.1);
            clip-path: polygon(
                0 0, 
                calc(100%% - 30px) 0, 
                100%% 30px, 
                100%% 100%%, 
                30px 100%%, 
                0 calc(100%% - 30px)
            );
        }

        /* Glowing Corners */
        .cyber-card::before, .cyber-card::after {
            content: '';
            position: absolute;
            width: 40px;
            height: 40px;
            border: 3px solid var(--main-neon);
            filter: drop-shadow(0 0 10px var(--main-neon));
        }
        .cyber-card::before { top: 0; left: 0; border-right: none; border-bottom: none; }
        .cyber-card::after { bottom: 0; right: 0; border-left: none; border-top: none; }

        h1 {
            font-size: 3.5rem;
            margin: 0 0 0.5rem 0;
            text-transform: uppercase;
            font-weight: 700;
            letter-spacing: 2px;
            color: #fff;
            text-shadow: 
                -2px -2px 0 var(--accent-neon),
                2px 2px 0 var(--main-neon);
            animation: glitch-text 4s infinite;
        }

        @keyframes glitch-text {
            0%, 5%, 10%, 15%, 100% { text-shadow: -2px -2px 0 var(--accent-neon), 2px 2px 0 var(--main-neon); }
            7% { text-shadow: -4px 0 0 var(--main-neon), 4px 2px 0 var(--accent-neon); }
            12% { text-shadow: 2px -4px 0 var(--accent-neon), -2px 4px 0 var(--main-neon); }
        }

        .subtitle {
            font-size: 1.2rem;
            color: #aaa;
            margin-bottom: 2.5rem;
            border-left: 3px solid var(--main-neon);
            padding-left: 15px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            position: relative;
        }

        .stat-box {
            background: rgba(0, 255, 204, 0.05);
            border: 1px solid rgba(0, 255, 204, 0.2);
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
        }

        .stat-box:hover {
            background: rgba(0, 255, 204, 0.1);
            border-color: var(--main-neon);
            box-shadow: 0 0 15px rgba(0, 255, 204, 0.3);
            transform: scale(1.02);
        }

        .stat-box::before {
            content: '';
            position: absolute;
            top: 0; left: -100%%; width: 50%%; height: 100%%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transform: skewX(-20deg);
            animation: scan 4s infinite cubic-bezier(0.19, 1, 0.22, 1);
        }

        @keyframes scan {
            0% { left: -100%%; }
            50%, 100% { left: 200%%; }
        }

        .stat-label {
            font-family: 'Share Tech Mono', monospace;
            font-size: 0.8rem;
            color: var(--main-neon);
            text-transform: uppercase;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .stat-label::before {
            content: '';
            display: inline-block;
            width: 8px; height: 8px;
            background: var(--main-neon);
        }

        .stat-value {
            font-family: 'Share Tech Mono', monospace;
            font-size: 1.4rem;
            font-weight: 400;
            color: #fff;
        }

        .deco-line {
            height: 2px;
            background: linear-gradient(90deg, transparent, var(--accent-neon), transparent);
            margin: 2rem 0;
            width: 100%%;
        }

        .health-btn {
            color: var(--main-neon);
            text-decoration: none;
            border: 1px solid var(--main-neon);
            padding: 4px 12px;
            transition: all 0.3s ease;
            background: rgba(0, 255, 204, 0.05);
        }

        .health-btn:hover {
            background: rgba(0, 255, 204, 0.2);
            box-shadow: 0 0 10px rgba(0, 255, 204, 0.4);
            color: #fff;
        }
        
    </style>
</head>
<body>
    <div class="floor"></div>
    <div class="container">
        <div class="cyber-card">
            <h1>Go Fiber</h1>
            <div class="subtitle">SYS.CORE // ACTIVE // V.24.1</div>
            
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-label">RUNTIME_ENV</div>
                    <div class="stat-value">%s</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">OS_ARCH</div>
                    <div class="stat-value">%s/%s</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">THREADS</div>
                    <div class="stat-value">%d</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">SYS_UPTIME</div>
                    <div class="stat-value" id="uptime">%s</div>
                </div>
            </div>

            <div class="deco-line"></div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; font-family: 'Share Tech Mono', monospace; color: #666; font-size: 0.9rem;">
                <span>NET_STATUS: CONNECTED</span>
                <a href="/health" class="health-btn" target="_blank">[ /HEALTH ]</a>
            </div>
        </div>
    </div>
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
