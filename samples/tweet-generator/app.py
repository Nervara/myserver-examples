import json
import os
import random
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import psycopg2
from psycopg2 import OperationalError

# ----------------------------------------------------------------------
# Configuration from environment
# ----------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/anthropic").rstrip("/")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "DeepSeek-V4-Pro")
PORT = int(os.environ.get("PORT", 8080))

# ----------------------------------------------------------------------
# Fallback tweets (used when API key is missing or API call fails)
# ----------------------------------------------------------------------
FALLBACK_TWEETS = [
    "Just had the best coffee ever! #blessed",
    "Coding at 3am hits different.",
    "Sunny days and good vibes.",
    "I'm not procrastinating, I'm doing research.",
    "Pizza solves everything.",
    "That moment when your code works on the first try.",
    "Hello, World!",
    "Today is a good day to have a good day.",
    "I like big data and I cannot lie.",
    "Just deployed to production. Fingers crossed.",
    "Debugging: being the detective in a crime movie where you are also the murderer.",
    "My Docker container has more uptime than I do.",
    "It works on my machine.",
    "Coffee -> Code -> Repeat.",
]

# Thread-safe indicator that the database (and table) are ready.
db_ready = threading.Event()


def db_connect():
    """Create a new psycopg2 connection from DATABASE_URL."""
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL not set")
    return psycopg2.connect(DATABASE_URL)


def init_db_and_generate():
    """
    Background thread:
    - Retry-connect until the database is reachable.
    - Create the `tweets` table if needed.
    - Then loop forever generating one tweet every ~5 seconds.
    If the connection drops (e.g. during a restore that recreates the table),
    reconnect and continue without crashing.
    """
    conn = None
    while True:
        if conn is None or conn.closed:
            try:
                conn = db_connect()
                print("Connected to database.", flush=True)
            except Exception as e:
                print(f"DB connection failed: {e}. Retrying in 2 seconds...", flush=True)
                time.sleep(2)
                continue

        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS tweets (
                        id BIGSERIAL PRIMARY KEY,
                        body TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                conn.commit()
            print("Table 'tweets' ensured.", flush=True)
            db_ready.set()
        except Exception as e:
            print(f"Table creation failed: {e}. Reconnecting...", flush=True)
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(2)
            continue

        while True:
            tweet_body = generate_tweet()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO tweets (body, created_at) VALUES (%s, now()) RETURNING id",
                        (tweet_body,),
                    )
                    tweet_id = cur.fetchone()[0]
                    conn.commit()
                print(f"Inserted tweet id={tweet_id}: {tweet_body}", flush=True)
            except OperationalError as e:
                print(f"Insert failed (DB connection lost): {e}. Reconnecting...", flush=True)
                try:
                    conn.close()
                except Exception:
                    pass
                db_ready.clear()
                break
            except Exception as e:
                print(f"Insert error: {e}. Will retry next cycle.", flush=True)

            time.sleep(5)


def generate_tweet() -> str:
    """
    Generate a tweet via DeepSeek's Anthropic-shaped Messages API
    ({DEEPSEEK_BASE_URL}/v1/messages). Falls back to a random canned tweet on a
    missing key or ANY failure (network, non-200, parse). Never raises.
    """
    if not DEEPSEEK_API_KEY:
        print("Falling back to static tweet: missing DEEPSEEK_API_KEY", flush=True)
        return random.choice(FALLBACK_TWEETS)

    url = f"{DEEPSEEK_BASE_URL}/v1/messages"
    headers = {
        "x-api-key": DEEPSEEK_API_KEY,
        "authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEEPSEEK_MODEL,
        "max_tokens": 60,
        "system": "You are a witty tweeter. Write ONE short, fun tweet under 200 characters. Output only the tweet text, no quotes.",
        "messages": [{"role": "user", "content": "Write a tweet."}],
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            resp_json = json.loads(response.read().decode("utf-8"))
        blocks = resp_json.get("content", [])
        content = " ".join(
            b.get("text", "") for b in blocks
            if isinstance(b, dict) and b.get("type") == "text"
        ).strip()
        if not content:
            print("Falling back to static tweet: empty content in API response", flush=True)
            return random.choice(FALLBACK_TWEETS)
        return content[:200]
    except Exception as e:
        print(f"Falling back to static tweet: API call failed: {type(e).__name__}: {e}", flush=True)
        return random.choice(FALLBACK_TWEETS)


# ----------------------------------------------------------------------
# HTTP request handler - fresh DB connection per request (thread-safe).
# ----------------------------------------------------------------------
class RequestHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet access log

    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            if not db_ready.is_set():
                self.wfile.write(b"starting")
                return
            try:
                conn = db_connect()
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                conn.close()
                self.wfile.write(b"ok")
            except Exception:
                self.wfile.write(b"starting")
            return

        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()

            if not db_ready.is_set():
                self.wfile.write(_page("<p>Waiting for database to become available...</p>").encode("utf-8"))
                return

            try:
                conn = db_connect()
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM tweets")
                    count = cur.fetchone()[0]
                    cur.execute("SELECT id, body, created_at FROM tweets ORDER BY id DESC LIMIT 10")
                    rows = cur.fetchall()
                conn.close()
            except Exception as e:
                self.wfile.write(_page(f"<p>Error fetching tweets: {e}</p>").encode("utf-8"))
                return

            items = ""
            for tid, body, created_at in rows:
                ts = created_at.strftime("%Y-%m-%d %H:%M:%S UTC") if created_at else "unknown"
                items += f'<li><strong>#{tid}</strong>: {body}<br><span class="t">{ts}</span></li>\n'
            inner = (
                f'<p class="count">Total tweets: {count}</p>\n'
                "<h2>Latest tweets</h2>\n"
                f"<ul>\n{items}</ul>\n"
            )
            self.wfile.write(_page(inner).encode("utf-8"))
            return

        self.send_response(404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Not found")


def _page(inner: str) -> str:
    return (
        "<!DOCTYPE html><html><head><title>AI Tweet Generator</title>"
        '<meta http-equiv="refresh" content="5">'
        "<style>body{font-family:sans-serif;max-width:640px;margin:24px auto;padding:0 12px}"
        "h1{color:#222}.count{font-weight:bold;font-size:1.2em}ul{list-style:none;padding:0}"
        "li{border-bottom:1px solid #eee;padding:8px 0}.t{color:#888;font-size:.9em}</style>"
        "</head><body><h1>AI Tweet Generator</h1>"
        f"{inner}"
        "<p><em>Auto-refreshes every 5 seconds.</em></p></body></html>"
    )


def run_server():
    httpd = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    print(f"HTTP server listening on port {PORT}", flush=True)
    httpd.serve_forever()


def main():
    threading.Thread(target=init_db_and_generate, daemon=True).start()
    run_server()


if __name__ == "__main__":
    main()
