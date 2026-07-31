import json
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from jose import jwt, JWTError
from passlib.context import CryptContext
from pymongo import MongoClient
from bson import ObjectId
import os
from dotenv import load_dotenv

load_dotenv()

from backend_core import run_generation

# ── Config ────────────────────────────────────────────────────────────────────
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
JWT_SECRET  = os.getenv("JWT_SECRET", "supersecretkey12345")

# ── DB ────────────────────────────────────────────────────────────────────────
mongo       = MongoClient(MONGODB_URI)
db          = mongo["datagen"]
users_col   = db["users"]
datasets_col = db["datasets"]
records_col  = db["datasetrecords"]

# ── Auth helpers ──────────────────────────────────────────────────────────────
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=["HS256"])
        return payload.get("_id")
    except JWTError:
        return None

# ── In-memory task store ──────────────────────────────────────────────────────
tasks: dict = {}  # task_id -> {state, progress, topic, userId, datasetId, records}

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Models ────────────────────────────────────────────────────────────────────
class AuthBody(BaseModel):
    email: str
    password: str = Field(..., max_length=72)

class StartBody(BaseModel):
    topic: str
    num_seed: int = 10
    max_outputs: int = 10
    dataset_type: str = "multi_turn"
    output_format: str = "openai"
    output_file: Optional[str] = None

# ── Auth ──────────────────────────────────────────────────────────────────────
@app.post("/api/auth/register")
def register(body: AuthBody):
    if users_col.find_one({"email": body.email}):
        raise HTTPException(400, "Email already exists")
    result = users_col.insert_one({"email": body.email, "password": pwd_ctx.hash(body.password)})
    token = jwt.encode({"_id": str(result.inserted_id)}, JWT_SECRET, algorithm="HS256")
    return {"token": token}

@app.post("/api/auth/login")
def login(body: AuthBody):
    user = users_col.find_one({"email": body.email})
    if not user or not pwd_ctx.verify(body.password, user["password"]):
        raise HTTPException(400, "Invalid credentials")
    token = jwt.encode({"_id": str(user["_id"])}, JWT_SECRET, algorithm="HS256")
    return {"token": token}

# ── Datasets ──────────────────────────────────────────────────────────────────
@app.get("/api/datasets")
def get_datasets(authorization: Optional[str] = Header(None)):
    user_id = verify_token(authorization)
    if not user_id:
        raise HTTPException(401, "Unauthorized")
        
    try:
        obj_id = ObjectId(user_id)
    except:
        obj_id = None
        
    query = {"status": "completed", "$or": [{"userId": user_id}]}
    if obj_id:
        query["$or"].append({"userId": obj_id})
        
    rows = list(datasets_col.find(query).sort("createdAt", -1))
    for r in rows:
        r["_id"] = str(r["_id"])
        r["userId"] = str(r["userId"])
    return rows

# ── Generation ────────────────────────────────────────────────────────────────
@app.get("/formats")
def get_formats():
    return {"formats": ["openai", "sharegpt", "alpaca"]}

@app.post("/start")
def start(body: StartBody, authorization: Optional[str] = Header(None)):
    user_id = verify_token(authorization)
    task_id  = str(int(time.time() * 1000))
    dataset_id = None

    if user_id:
        res = datasets_col.insert_one({
            "userId": user_id, "topic": body.topic,
            "status": "generating", "totalRecords": 0,
            "createdAt": datetime.utcnow()
        })
        dataset_id = str(res.inserted_id)

    tasks[task_id] = {
        "state": "running", "progress": 0, "topic": "Initializing...",
        "userId": user_id, "datasetId": dataset_id, "records": []
    }

    config = {
        "topic": body.topic, "num_seed": body.num_seed,
        "output_format": body.output_format, "max_outputs": body.max_outputs,
        "dataset_type": body.dataset_type,
    }

    def run():
        try:
            run_generation(config, tasks, task_id, records_col, datasets_col)
        except Exception as e:
            tasks[task_id]["state"] = "error"
            tasks[task_id]["topic"] = str(e)
            print(f"[Generation error] {e}")

    threading.Thread(target=run, daemon=True).start()
    return {"taskId": task_id, "datasetId": dataset_id}

@app.get("/status/{task_id}")
def status(task_id: str):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return {"state": task["state"], "progress": task["progress"], "topic": task["topic"]}

@app.get("/download")
def download(datasetId: Optional[str] = None, taskId: Optional[str] = None):
    def to_jsonl(records):
        for r in records:
            yield json.dumps(r) + "\n"

    headers = {"Content-Disposition": 'attachment; filename="dataset.jsonl"'}

    if datasetId:
        try:
            obj_id = ObjectId(datasetId)
        except:
            obj_id = None
            
        query = {"$or": [{"datasetId": datasetId}]}
        if obj_id:
            query["$or"].append({"datasetId": obj_id})
            
        rows = list(records_col.find(query, {"_id": 0, "record": 1}))
        return StreamingResponse(to_jsonl([r["record"] for r in rows]),
                                 media_type="application/jsonl", headers=headers)

    if taskId and taskId in tasks:
        return StreamingResponse(to_jsonl(tasks[taskId]["records"]),
                                 media_type="application/jsonl", headers=headers)

    raise HTTPException(404, "Dataset not found")

# ── Static (must be last) ─────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="frontend/public", html=True), name="static")
