import os
import json
from typing import Dict, Any
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
import firebase_admin
from firebase_admin import credentials, firestore

# ローカル開発用の .env 読み込み
load_dotenv()

app = FastAPI(title="FlowHierarchy Studio API")

# プロジェクトのルートディレクトリと index.html のパス
BASE_DIR = Path(__file__).resolve().parent.parent
INDEX_HTML_PATH = BASE_DIR / "templates" / "index.html"

# Firebase Admin SDK の初期化（多重初期化防止）
if not firebase_admin._apps:
    service_account_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not service_account_str:
        raise RuntimeError("環境変数 FIREBASE_SERVICE_ACCOUNT_JSON が設定されていません。")
    
    cred_dict = json.loads(service_account_str)
    cred = credentials.Certificate(cred_dict)
    firebase_admin.initialize_app(cred)

db = firestore.client()
COLLECTION_NAME = "flowchart_projects"

@app.get("/")
@app.get("/api/index")
@app.get("/api/index.py")
async def serve_editor():
    """メインのフローチャートエディタ画面 (templates/index.html) をそのまま返す"""
    if not INDEX_HTML_PATH.exists():
        raise HTTPException(status_code=404, detail="templates/index.html が見つかりません")
    return FileResponse(INDEX_HTML_PATH, media_type="text/html")

@app.post("/api/projects/{project_id}")
async def save_project(project_id: str, payload: Dict[str, Any]):
    """フローチャートの全階層データをFirestore本番環境へ保存する"""
    try:
        doc_ref = db.collection(COLLECTION_NAME).document(project_id)
        doc_ref.set({
            "projectId": project_id,
            "currentLayerId": payload.get("currentLayerId", "root"),
            "layers": payload.get("layers", {}),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        return {"status": "ok", "projectId": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects/{project_id}")
async def load_project(project_id: str):
    """指定したproject_idのデータをFirestoreから読み込む"""
    try:
        doc_ref = db.collection(COLLECTION_NAME).document(project_id)
        doc = doc_ref.get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Project not found")
        data = doc.to_dict()
        if "updatedAt" in data:
            data["updatedAt"] = str(data["updatedAt"])
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))