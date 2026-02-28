package main

import (
	"fmt"
	"log"
	"os"
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
)

var startTime time.Time

func init() {
	startTime = time.Now()
}

func main() {
	app := fiber.New()

	app.Get("/", func(c *fiber.Ctx) error {
		uptime := time.Since(startTime).Truncate(time.Second).String()
		
		html := fmt.Sprintf(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Go Fiber on myserver</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #00add8;
            --bg: #111111;
            --card-bg: #1a1a1a;
            --text: #ffffff;
            --text-muted: #888888;
            --border: #333333;
        }
        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            width: 100%%;
            max-width: 600px;
            padding: 2rem;
        }
        .card {
            background-color: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 3rem;
            position: relative;
            overflow: hidden;
            box-shadow: 0 40px 100px -30px rgba(0, 0, 0, 0.5);
        }
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%%;
            height: 4px;
            background: linear-gradient(90deg, #00add8, #5dc9e2);
        }
        h1 {
            font-weight: 800;
            font-size: 2.5rem;
            margin: 0 0 1rem 0;
            letter-spacing: -0.03em;
        }
        p.subtitle {
            color: var(--text-muted);
            font-size: 1.1rem;
            line-height: 1.6;
            margin-bottom: 2.5rem;
        }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-bottom: 2.5rem;
        }
        .item {
            background-color: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border);
            padding: 1.5rem;
            border-radius: 12px;
        }
        .label {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.7rem;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
        }
        .value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 1.1rem;
            color: var(--primary);
            font-weight: 700;
        }
        .footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid var(--border);
            padding-top: 2rem;
            margin-top: 0.5rem;
        }
        .tag {
            background-color: rgba(0, 173, 216, 0.1);
            color: var(--primary);
            padding: 0.4rem 0.8rem;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 700;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1 style="display: flex; align-items: center; gap: 0.5rem;">
                Go Fiber
            </h1>
            <p class="subtitle">High-performance web framework written in Go, running seamlessly on myserver.</p>
            
            <div class="grid">
                <div class="item">
                    <div class="label">Go Version</div>
                    <div class="value">%s</div>
                </div>
                <div class="item">
                    <div class="label">OS/Arch</div>
                    <div class="value">%s/%s</div>
                </div>
                <div class="item">
                    <div class="label">Goroutines</div>
                    <div class="value">%d</div>
                </div>
                <div class="item">
                    <div class="label">Uptime</div>
                    <div class="value">%s</div>
                </div>
            </div>
            
            <div class="footer">
                <div class="tag">GO_FAST</div>
                <div style="color: var(--text-muted); font-size: 0.8rem;">Build: Nixpacks</div>
            </div>
        </div>
    </div>
</body>
</html>
`, runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.NumGoroutine(), uptime)

		c.Set(fiber.HeaderContentType, fiber.MIMETextHTML)
		return c.SendString(html)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Fatal(app.Listen(":" + port))
}
`, runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.NumGoroutine(), "0s") // Wait, I need to fix the uptime injection properly in the string formatting

	// Fixing the formatting string usage
/*
Actually I'll just write the file with the correct injection.
*/

	return nil
}
