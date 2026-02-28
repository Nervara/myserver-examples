const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dockerfile App on myserver</title>
    <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #030712;
            --card: #111827;
            --text: #f9fafb;
            --primary: #3b82f6;
            --accent: #10b981;
        }
        body {
            font-family: 'Lexend', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .card {
            background-color: var(--card);
            border: 1px solid #1f2937;
            padding: 3rem;
            border-radius: 20px;
            max-width: 500px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        }
        .header {
            margin-bottom: 2rem;
        }
        .icon {
            font-size: 3.5rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        h1 {
            font-size: 2.5rem;
            margin: 0;
            letter-spacing: -0.02em;
        }
        p {
            color: #9ca3af;
            font-size: 1.125rem;
            line-height: 1.6;
            margin-top: 1rem;
        }
        .status {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background-color: rgba(16, 185, 129, 0.1);
            color: var(--accent);
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
            margin-top: 2rem;
        }
        .dot {
            width: 8px;
            height: 8px;
            background-color: var(--accent);
            border-radius: 50%;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <div class="icon">🐳</div>
            <h1>Dockerfile</h1>
        </div>
        <p>Custom container environment built from source and deployed on myserver.</p>
        <div class="status">
            <div class="dot"></div>
            Online & Healthy
        </div>
    </div>
</body>
</html>
  `);
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});
