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

BASE_DIR = Path(__file__).resolve().parent.parent
INDEX_HTML_PATH = BASE_DIR / "templates" / "index.html"
COLLECTION_NAME = "flowchart_projects"

def get_firestore_db():
    """Firebaseを安全に初期化してFirestoreクライアントを返す（エラー原因も明確化）"""
    if not firebase_admin._apps:
        raw_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not raw_json:
            raise HTTPException(
                status_code=500,
                detail="Vercelに環境変数 FIREBASE_SERVICE_ACCOUNT_JSON が設定されていません（またはRedeployが必要です）。"
            )
        try:
            # 貼り付け時に前後に余分なクォートが入っていた場合は除去
            cleaned = raw_json.strip().strip("'").strip('"')
            cred_dict = json.loads(cleaned)
            # Vercel環境変数で改行文字がエスケープされた場合の補正
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

@app.get("/")
@app.get("/api/index")
@app.get("/api/index.py")
async def serve_editor(project_id: str = None):
    """project_idパラメータがあればFirestoreから読込、なければメイン画面HTMLを返す"""
    if project_id:
        return await load_project(project_id)
    if not INDEX_HTML_PATH.exists():
        raise HTTPException(status_code=404, detail="templates/index.html が見つかりません")
    return FileResponse(INDEX_HTML_PATH, media_type="text/html")

@app.post("/")
@app.post("/api/index")
@app.post("/api/index.py")
@app.post("/api/projects/{project_id}")
async def save_project(payload: Dict[str, Any], project_id: str = None):
    """Firestore本番環境へ保存する（URL書き換えにも完全対応）"""
    try:
        # URLパスから取得できない場合はJSONの中身の projectId を使う
        target_id = project_id or payload.get("projectId") or "default_project"
        db = get_firestore_db()
        doc_ref = db.collection(COLLECTION_NAME).document(target_id)
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

@app.get("/api/projects/{project_id}")
async def load_project(project_id: str):
    """Firestoreから読み込む"""
    try:
        db = get_firestore_db()
        doc_ref = db.collection(COLLECTION_NAME).document(project_id)
        doc = doc_ref.get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail=f"指定されたID '{project_id}' のデータはまだ保存されていません。")
        data = doc.to_dict()
        if "updatedAt" in data:
            data["updatedAt"] = str(data["updatedAt"])
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firestore読込エラー: {str(e)}")