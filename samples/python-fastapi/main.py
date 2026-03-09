from fastapi import FastAPI
import os

app = FastAPI()

@app.get("/health")
def health_check():
    return {"status": "OK"}

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI on Railpack", "framework": "fastapi"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
