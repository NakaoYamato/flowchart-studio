import asyncio
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
from google import genai
from google.genai import types

load_dotenv()

app = FastAPI(title="FlowHierarchy Studio API")

BASE_DIR = Path(__file__).resolve().parent.parent
INDEX_HTML_PATH = BASE_DIR / "templates" / "index.html"
STATIC_DIR = BASE_DIR / "static"
COLLECTION_NAME = "flowchart_projects"

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

async def handle_ai_assist(payload: Dict[str, Any]):
    """方法B: Gemini API (無料枠対応 gemini-2.5-flash) を使って現在の階層やクラス図を自動生成・編集する"""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="環境変数 GEMINI_API_KEY が設定されていません。.env または VercelのEnvironment Variablesに設定してください。"
        )

    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="AIへの指示（プロンプト）が空です。")

    current_layer = payload.get("currentLayer", {})
    tags = payload.get("tags", [])
    is_class_mode = bool(current_layer.get("isClassDiagram"))

    system_instruction = f"""あなたはゲーム開発・ソフトウェア設計支援ツール「FlowHierarchy Studio」のAI設計アシスタントです。
ユーザーの指示に従い、現在開いているレイヤー（{"クラス図" if is_class_mode else "フローチャート階層"}）の `nodes` と `edges` を追加・編集・整理し、指定されたJSONフォーマットのみで出力してください。

【重要な座標・データ設計ルール】
1. 座標 (x, y) やサイズ (width, height) は必ず 24 の倍数（24pxグリッド）に揃えて重ならないように綺麗に配置してください。
   - 縦に並べる場合は y を +144〜+168 ずつずらす、横に並べる場合は x を +264〜+312 ずつずらすと綺麗に整列します。
2. 既存のノードやエッジで、ユーザーが削除を指示していないもの（特に `"isParentProxy": true` の親階層ノード）は消さずにそのまま維持してください。
3. ノードのスキーマ:
   - 矩形 (`type: "rect"`): width=192, height=84, color="#dbeafe", fontSize=14, textAlign="center", tags=[], locked=false, isParentProxy=false
   - コンテナ (`type: "container"`): width=384, height=264, color="#e2e8f0", textAlign="left" (中に入れる矩形の `parentGroupId` にコンテナの `id` を設定)
   - メモ (`type: "memo"`): width=192, height=108, color="#fef08a", textAlign="left", parentObjectType="node"|"edge"|null, parentObjectId=対象ID
   - クラス (`type: "class"`): width=276, height=192, color="#f3e8ff", fontSize=13, textAlign="left",
     `fields`: `[{{ "id": "fld_xxx", "access": "private"|"public"|"protected", "memberName": "hp", "dataType": "int" }}]`,
     `methods`: `[{{ "id": "mtd_xxx", "access": "public"|"private"|"protected", "memberName": "Attack", "args": "power: int", "returnType": "void" }}]`
4. エッジ（矢印）のスキーマ:
   - `{{ "id": "edge_xxx", "source": "元ノードID", "sourcePort": "bottom"|"right"|"top"|"left", "target": "先ノードID", "targetPort": "top"|"left"|"bottom"|"right", "relationType": "normal"|"inheritance"|"implementation"|"dependency", "label": "", "color": "#475569" }}`
   - クラス図の継承（子クラス extends 親クラス）の場合は、source=子クラスID, target=親クラスID, relationType="inheritance", label="extends" にしてください。
5. 利用可能なプロジェクトタグ一覧: {json.dumps(tags, ensure_ascii=False)}

【返却するJSON形式】
必ず以下のキーを持つJSONオブジェクトのみを返してください:
{{
  "reply": "どのような要素を追加・変更したかの簡潔な説明メッセージ（日本語）",
  "updatedLayer": {{ ...更新後の currentLayer オブジェクト全体 (id, name, nodes, edges 等を含む)... }}
}}
"""

    user_content = f"""【現在のレイヤーデータ (JSON)】
{json.dumps(current_layer, ensure_ascii=False)}

【ユーザーからの指示】
{prompt}
"""
# handle_ai_assist (または run_gemini_assist) 関数内の API 呼び出し部分を以下に差し替え
    # 503混雑時に自動で軽量モデルやリトライへ切り替えるリスト
    candidate_models = [
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.7-flash"
    ]

    client = genai.Client(api_key=api_key.strip())
    last_error = None

    for model_name in candidate_models:
        for attempt in range(2):  # 各モデル最大2回トライ
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=user_content,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        temperature=0.2,
                    ),
                )
                result_json = json.loads(response.text)
                return result_json
            except Exception as e:
                last_error = e
                err_str = str(e)
                # 503 (過負荷) や 429 (レート制限) の場合は1.5秒待ってリトライまたは次モデルへ
                if "503" in err_str or "UNAVAILABLE" in err_str or "429" in err_str:
                    await asyncio.sleep(1.5)
                    continue
                # 404 (モデル未対応) などの場合はすぐ次の候補モデルへ切り替え
                break

    raise HTTPException(
        status_code=503,
        detail=f"現在Geminiサーバーが大変混雑しています。数秒待ってから再実行してください (詳細: {str(last_error)})"
    )

@app.get("/static/{file_path:path}")
async def serve_static_files(file_path: str):
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

@app.post("/api/ai-assist")
async def api_ai_assist_direct(payload: Dict[str, Any]):
    return await handle_ai_assist(payload)

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
    # VercelでURLが書き換えられても action=ai_assist で確実にAI処理へ分岐できるようにする
    if action == "ai_assist" or payload.get("_action") == "ai_assist":
        return await handle_ai_assist(payload)

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
            "tags": payload.get("tags", []),
            "layers": payload.get("layers", {}),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        return {"status": "ok", "projectId": target_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firestore保存エラー: {str(e)}")