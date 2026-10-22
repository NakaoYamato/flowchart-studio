import os
import json
from typing import Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

app = FastAPI(title="FlowHierarchy Studio API")

BASE_DIR = Path(__file__).resolve().parent.parent
INDEX_HTML_PATH = BASE_DIR / "templates" / "index.html"
STATIC_DIR = BASE_DIR / "static"
COLLECTION_NAME = "flowchart_projects"

# ローカル uvicorn 用の static マウント
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

def get_firestore_db():
    """Firebaseを安全に初期化してFirestoreクライアントを返す"""
    if not firebase_admin._apps:
        raw_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not raw_json:
            raise HTTPException(
                status_code=500,
                detail="環境変数 FIREBASE_SERVICE_ACCOUNT_JSON が設定されていません。"
            )
        try:
            cleaned = raw_json.strip().strip("'").strip('"')
            cred_dict = json.loads(cleaned)
            if "private_key" in cred_dict:
                cred_dict["private_key"] = cred_dict["private_key"].replace("\\n", "\n")
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Firebase秘密鍵JSONの読み込みに失敗しました: {str(e)}"
            )
    return firestore.client()

async def list_projects_from_db():
    """Firestoreに保存されているプロジェクト一覧を取得する"""
    try:
        db = get_firestore_db()
        docs = db.collection(COLLECTION_NAME).stream()
        projects = []
        for d in docs:
            data = d.to_dict() or {}
            layers = data.get("layers", {})
            root_layer = layers.get("root", {})
            node_count = len(root_layer.get("nodes", [])) if isinstance(root_layer, dict) else 0
            projects.append({
                "projectId": data.get("projectId", d.id),
                "updatedAt": str(data.get("updatedAt", "")) if data.get("updatedAt") else "日時不明",
                "layerCount": len(layers) if isinstance(layers, dict) else 1,
                "rootNodeCount": node_count
            })
        projects.sort(key=lambda x: x["updatedAt"], reverse=True)
        return {"projects": projects}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"一覧取得エラー: {str(e)}")

@app.get("/static/{file_path:path}")
async def serve_static_files(file_path: str):
    """Vercel上で /static/... が api/index.py にルーティングされた場合も確実にファイルを返す"""
    target_file = (STATIC_DIR / file_path).resolve()
    if not str(target_file).startswith(str(STATIC_DIR.resolve())) or not target_file.is_file():
        raise HTTPException(status_code=404, detail="Static file not found")
    return FileResponse(target_file)

@app.get("/")
@app.get("/p/{path_project_id}")
@app.get("/api/index")
@app.get("/api/index.py")
async def serve_editor_or_api(
    path_project_id: Optional[str] = None,
    project_id: Optional[str] = None,
    action: Optional[str] = None
):
    if action == "list":
        return await list_projects_from_db()
    if project_id:
        return await load_project(project_id)
    if not INDEX_HTML_PATH.exists():
        raise HTTPException(status_code=404, detail="templates/index.html が見つかりません")
    return FileResponse(INDEX_HTML_PATH, media_type="text/html")

@app.get("/api/projects")
async def api_list_projects():
    return await list_projects_from_db()

@app.get("/api/projects/{project_id}")
async def load_project(project_id: str):
    try:
        db = get_firestore_db()
        doc_ref = db.collection(COLLECTION_NAME).document(project_id)
        doc = doc_ref.get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail=f"プロジェクト '{project_id}' はまだ保存されていません。")
        data = doc.to_dict()
        if "updatedAt" in data:
            data["updatedAt"] = str(data["updatedAt"])
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firestore読込エラー: {str(e)}")

@app.post("/")
@app.post("/p/{path_project_id}")
@app.post("/api/index")
@app.post("/api/index.py")
@app.post("/api/projects/{project_id}")
async def save_project(
    payload: Dict[str, Any],
    project_id: Optional[str] = None,
    path_project_id: Optional[str] = None,
    action: Optional[str] = None
):
    try:
        target_id = project_id or payload.get("projectId") or path_project_id or "default_project"
        db = get_firestore_db()
        doc_ref = db.collection(COLLECTION_NAME).document(target_id)

        if action == "delete" or payload.get("_action") == "delete":
            doc_ref.delete()
            return {"status": "deleted", "projectId": target_id}

        doc_ref.set({
            "projectId": target_id,
            "currentLayerId": payload.get("currentLayerId", "root"),
            "layers": payload.get("layers", {}),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        return {"status": "ok", "projectId": target_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firestore保存エラー: {str(e)}")