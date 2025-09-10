#!/usr/bin/env python3
"""
fastapi_namaste.py

Run:
    uvicorn fastapi_namaste:app --reload --host 0.0.0.0 --port 8000

Default artifacts (change paths below or pass via environment/modify constants):
  - Fine-tuned model/tokenizer directory: ./namaste_finetuned_model
  - Embeddings (numpy): ./namaste_embeddings.npy
  - Rows dataframe (parquet): ./namaste_rows.parquet
  - NearestNeighbors index (joblib): ./namaste_nn_index.joblib

This app provides:
  POST /query  -> JSON input { "query": "text or code", "top_k": 5 }
                 Returns JSON with exact_matches, semantic_matches, model_informed_summary.
"""

import os
import traceback
from typing import Optional, List, Dict, Any

import numpy as np
import pandas as pd
import joblib
import torch

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from transformers import AutoTokenizer, AutoModel

# ----------------------------
# Config / artifact paths (adjust if you store artifacts elsewhere)
# ----------------------------
ARTIFACTS_DIR = os.getenv("NAMASTE_MODEL_DIR", "./namaste_finetuned_model")
EMB_PATH = os.getenv("NAMASTE_EMB_PATH", "./namaste_embeddings.npy")
ROWS_PATH = os.getenv("NAMASTE_ROWS_PATH", "./namaste_rows.parquet")
NN_PATH = os.getenv("NAMASTE_NN_PATH", "./namaste_nn_index.joblib")

# CORS allowed origins (set to specific origins in production for security)
ALLOWED_ORIGINS = os.getenv("NAMASTE_ALLOWED_ORIGINS", "*").split(",") if os.getenv("NAMASTE_ALLOWED_ORIGINS") else ["*"]

# ----------------------------
# FastAPI app + CORS
# ----------------------------
app = FastAPI(title="NAMASTE ClinicalBERT Query API", version="1.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # set to ["https://your.domain"] in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Request/Response models
# ----------------------------
class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    code_col: Optional[str] = None  # override detected code column
    include_full_rows: Optional[bool] = False

class MatchRow(BaseModel):
    row_index: int
    score: Optional[float] = None
    fields: Dict[str, Any]

class QueryResponse(BaseModel):
    query: str
    exact_matches: List[Dict[str, Any]]
    semantic_matches: List[Dict[str, Any]]
    model_informed_summary: str

# ----------------------------
# Utilities: pooling, sentence splitting, etc.
# ----------------------------
def get_device():
    return "cuda" if torch.cuda.is_available() else "cpu"

def mean_pooling(model_output, attention_mask):
    token_embeddings = model_output.last_hidden_state
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    sum_embeddings = torch.sum(token_embeddings * input_mask_expanded, dim=1)
    sum_mask = torch.clamp(input_mask_expanded.sum(dim=1), min=1e-9)
    return sum_embeddings / sum_mask

import re
_SENTENCE_RE = re.compile(r'(?<=[\.\?\!])\s+')
def split_into_sentences(text: str):
    text = (text or "").replace("\n", " ").strip()
    if not text:
        return []
    parts = _SENTENCE_RE.split(text)
    if len(parts) <= 1 and "|||" in text:
        parts = [p.strip() for p in text.split("|||") if p.strip()]
    if len(parts) <= 1:
        parts = [p.strip() for p in re.split(r',\s*', text) if p.strip()]
    return parts

from sklearn.feature_extraction.text import TfidfVectorizer
def extractive_summary_from_texts(texts: List[str], top_n_sentences: int = 3) -> str:
    joined = " ".join(t for t in texts if t)
    sents = split_into_sentences(joined)
    if not sents:
        return ""
    vec = TfidfVectorizer(max_features=2000, stop_words="english")
    try:
        X = vec.fit_transform(sents)
        scores = X.sum(axis=1).A1
    except Exception:
        # fallback: pick first N sentences
        return " ".join(sents[:top_n_sentences])
    top_idx = sorted(range(len(sents)), key=lambda i: scores[i], reverse=True)[:top_n_sentences]
    top_idx_sorted = sorted(top_idx)
    summary = " ".join(sents[i] for i in top_idx_sorted)
    return summary

# JSON-safe row formatter
def row_to_serializable(row: pd.Series, include_full: bool=False):
    out = {}
    for k, v in row.items():
        if pd.isna(v):
            out[k] = None
        else:
            # convert numpy types
            if isinstance(v, (np.integer,)):
                out[k] = int(v)
            elif isinstance(v, (np.floating,)):
                out[k] = float(v)
            else:
                out[k] = v if not isinstance(v, (np.ndarray,)) else v.tolist()
    if not include_full and "text" in out:
        # keep text short (avoid huge payloads)
        out["text_snippet"] = (out["text"][:800] + "...") if isinstance(out["text"], str) and len(out["text"])>800 else out.get("text")
    return out

# ----------------------------
# Load artifacts at startup
# ----------------------------
print("Starting NAMASTE FastAPI app - loading artifacts...")
device = get_device()
try:
    if not os.path.isdir(ARTIFACTS_DIR):
        raise FileNotFoundError(f"Artifacts folder not found: {ARTIFACTS_DIR}")

    if not os.path.exists(EMB_PATH):
        raise FileNotFoundError(f"Embeddings file not found: {EMB_PATH}")
    if not os.path.exists(ROWS_PATH):
        raise FileNotFoundError(f"Rows parquet not found: {ROWS_PATH}")
    if not os.path.exists(NN_PATH):
        raise FileNotFoundError(f"NN index file not found: {NN_PATH}")

    print(f" Loading tokenizer & encoder model from: {ARTIFACTS_DIR} (device={device})")
    tokenizer = AutoTokenizer.from_pretrained(ARTIFACTS_DIR, use_fast=True)
    encoder = AutoModel.from_pretrained(ARTIFACTS_DIR)
    encoder.to(device)
    encoder.eval()

    print(" Loading dataframe...")
    rows_df = pd.read_parquet(ROWS_PATH)
    # ensure text column exists
    if "text" not in rows_df.columns:
        # try building it if possible (should have been saved earlier)
        rows_df["text"] = rows_df.astype(str).agg(" ".join, axis=1)

    print(" Loading embeddings and NN index...")
    embeddings = np.load(EMB_PATH)
    nn = joblib.load(NN_PATH)

    detected_code_col = rows_df["_code_col_"].iloc[0] if "_code_col_" in rows_df.columns else None
    print(f"Artifacts loaded. Rows: {len(rows_df)}, Embedding dim: {embeddings.shape[1]}, code_col detected: {detected_code_col}")

except Exception as e:
    print("Error loading artifacts:", str(e))
    traceback.print_exc()
    # Keep variables possibly undefined — endpoints will return 500 if called until fixed.
    tokenizer = None
    encoder = None
    rows_df = None
    embeddings = None
    nn = None
    detected_code_col = None

# ----------------------------
# Search helpers
# ----------------------------
def compute_query_embedding(query: str, max_length: int = 256):
    if tokenizer is None or encoder is None:
        raise RuntimeError("Model tokenizer/encoder not loaded")
    encoder.to(device)
    encoder.eval()
    enc = tokenizer([query], padding=True, truncation=True, max_length=max_length, return_tensors="pt")
    enc = {k: v.to(device) for k, v in enc.items()}
    with torch.no_grad():
        out = encoder(**enc, return_dict=True)
        q_emb = mean_pooling(out, enc["attention_mask"]).cpu().numpy()
    q_emb = q_emb / np.linalg.norm(q_emb, axis=1, keepdims=True)
    return q_emb

def semantic_search(query_emb: np.ndarray, top_k: int = 5):
    if nn is None:
        raise RuntimeError("NN index not loaded")
    top_k = min(top_k, embeddings.shape[0])
    dists, inds = nn.kneighbors(query_emb, n_neighbors=top_k)
    results = []
    for dist, idx in zip(dists[0], inds[0]):
        r = rows_df.iloc[int(idx)].to_dict()
        score = float(1.0 - dist) if dist <= 1.0 else float(-dist)
        r["_score"] = score
        r["_row_index"] = int(idx)
        results.append(r)
    return results

def find_exact_by_code(rows: pd.DataFrame, code_col: Optional[str], query: str):
    if code_col and code_col in rows.columns:
        mask = rows[code_col].astype(str).str.strip().str.lower() == query.strip().lower()
        if mask.any():
            return rows[mask].to_dict(orient="records")
    # try searching other columns with 'code' or 'namc' in name
    for c in rows.columns:
        if any(k in c.lower() for k in ("code", "namc", "id")):
            mask = rows[c].astype(str).str.contains(query, case=False, na=False)
            if mask.any():
                return rows[mask].to_dict(orient="records")
    return []

# ----------------------------
# Endpoints
# ----------------------------
@app.get("/health")
async def health():
    ok = tokenizer is not None and encoder is not None and rows_df is not None and embeddings is not None and nn is not None
    return {"status": "ok" if ok else "error", "device": device, "rows_loaded": len(rows_df) if rows_df is not None else 0}

@app.post("/query", response_model=QueryResponse)
async def query_endpoint(req: QueryRequest):
    if tokenizer is None or encoder is None:
        raise HTTPException(status_code=500, detail="Model artifacts not loaded on server. Check logs.")
    q = req.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Empty query provided.")

    # exact matches
    code_col = req.code_col if req.code_col else detected_code_col
    try:
        exact = find_exact_by_code(rows_df, code_col, q)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during exact-match search: {str(e)}")

    exact_serialized = [row_to_serializable(pd.Series(r), include_full=req.include_full_rows) for r in exact]

    # semantic matches
    try:
        q_emb = compute_query_embedding(q)
        sem = semantic_search(q_emb, top_k=req.top_k)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing semantic search: {str(e)}")

    sem_serialized = []
    for r in sem:
        s = row_to_serializable(pd.Series(r), include_full=req.include_full_rows)
        s["_score"] = r.get("_score", None)
        s["_row_index"] = r.get("_row_index", None)
        sem_serialized.append(s)

    # model-informed summary (extractive)
    try:
        top_texts = [r.get("text","") for r in sem]
        summary = extractive_summary_from_texts(top_texts, top_n_sentences=4)
    except Exception as e:
        summary = ""
    
    response = {
        "query": q,
        "exact_matches": exact_serialized,
        "semantic_matches": sem_serialized,
        "model_informed_summary": summary
    }
    return response

# ----------------------------
# If run as script (optional)
# ----------------------------
if __name__ == "__main__":
    import uvicorn
    print("Run with: uvicorn fastapi_namaste:app --reload --host 0.0.0.0 --port 8000")
    uvicorn.run("fastapi_namaste:app", host="0.0.0.0", port=8000, reload=True)
