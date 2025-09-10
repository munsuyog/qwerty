#!/usr/bin/env python3
"""
query_namaste.py

Load artifacts created by train_finetune_namaste.py and query by NAMC code or text term.
Outputs a nicely structured set of sections printed to console and saved as JSON if requested.

Example:
  python query_namaste.py --query "NAMC1234" --artifacts_dir ./namaste_finetuned_model
  python query_namaste.py --query "arthralgia" --top_k 5 --save_out ./result.json
"""
import os
import json
import argparse
from typing import List
import numpy as np
import pandas as pd
import torch
from sklearn.feature_extraction.text import TfidfVectorizer
import joblib

from transformers import AutoTokenizer, AutoModel

# ---------------- Utilities ----------------
def get_device():
    return "cuda" if torch.cuda.is_available() else "cpu"

def mean_pooling(model_output, attention_mask):
    token_embeddings = model_output.last_hidden_state
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    sum_embeddings = torch.sum(token_embeddings * input_mask_expanded, dim=1)
    sum_mask = torch.clamp(input_mask_expanded.sum(dim=1), min=1e-9)
    return sum_embeddings / sum_mask

# Simple sentence splitter (avoid heavy NLTK requirements)
import re
_SENTENCE_RE = re.compile(r'(?<=[\.\?\!])\s+')
def split_into_sentences(text: str) -> List[str]:
    text = text.replace("\n", " ").strip()
    if not text:
        return []
    # First try explicit separators
    parts = _SENTENCE_RE.split(text)
    # fallback: if too few parts, split by ' ||| ' which we used to join columns
    if len(parts) <= 1 and "|||" in text:
        parts = [p.strip() for p in text.split("|||") if p.strip()]
    # final fallback: chunk by comma
    if len(parts) <= 1:
        parts = [p.strip() for p in re.split(r',\s*', text) if p.strip()]
    return parts

def extractive_summary_from_texts(texts: List[str], top_n_sentences: int = 3) -> str:
    joined = " ".join(t for t in texts if t)
    sents = split_into_sentences(joined)
    if not sents:
        return ""
    # vectorize sentences and score by sum of tf-idf weights
    vec = TfidfVectorizer(max_features=2000, stop_words="english")
    X = vec.fit_transform(sents)
    scores = X.sum(axis=1).A1  # sum tfidf weights per sentence
    # pick top sentences by score, preserve original order
    top_idx = sorted(range(len(sents)), key=lambda i: scores[i], reverse=True)[:top_n_sentences]
    top_idx_sorted = sorted(top_idx)
    summary = " ".join(sents[i] for i in top_idx_sorted)
    return summary

# ---------------- Main querying logic ----------------
def load_artifacts(artifacts_dir: str, emb_path: str, rows_path: str, nn_path: str):
    # preferred paths (if you saved elsewhere)
    emb = np.load(emb_path)
    rows = pd.read_parquet(rows_path)
    nn = joblib.load(nn_path)
    # load encoder model & tokenizer (AutoModel for embeddings)
    tokenizer = AutoTokenizer.from_pretrained(artifacts_dir)
    model = AutoModel.from_pretrained(artifacts_dir)
    return emb, rows, nn, tokenizer, model

def compute_query_embedding(query: str, tokenizer, model, device, max_length=256):
    model.to(device)
    model.eval()
    enc = tokenizer([query], padding=True, truncation=True, max_length=max_length, return_tensors="pt")
    enc = {k: v.to(device) for k, v in enc.items()}
    with torch.no_grad():
        out = model(**enc, return_dict=True)
        emb = mean_pooling(out, enc["attention_mask"]).cpu().numpy()
    # normalize
    emb = emb / np.linalg.norm(emb, axis=1, keepdims=True)
    return emb

def semantic_search(query_emb, nn, rows, top_k=5):
    dists, inds = nn.kneighbors(query_emb, n_neighbors=top_k)
    results = []
    for dist, idx in zip(dists[0], inds[0]):
        r = rows.iloc[int(idx)].to_dict()
        # convert distance to score (1 - dist) for cosine in sklearn (dist approx in [0,2])
        score = float(1.0 - dist) if dist <= 1.0 else float(-dist)
        r["_score"] = score
        r["_row_index"] = int(idx)
        results.append(r)
    return results

def find_exact_by_code(rows: pd.DataFrame, code_col: str, query: str):
    if code_col and code_col in rows.columns:
        mask = rows[code_col].astype(str).str.strip().str.lower() == query.strip().lower()
        if mask.any():
            return rows[mask].to_dict(orient="records")
    # also try to match if query appears in any code-like columns
    possible = []
    for c in rows.columns:
        if any(k in c.lower() for k in ("code", "namc", "id")):
            mask = rows[c].astype(str).str.contains(query, case=False, na=False)
            if mask.any():
                possible.extend(rows[mask].to_dict(orient="records"))
    return possible

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", type=str, required=True, help="NAMC code or term to search")
    parser.add_argument("--artifacts_dir", default="./namaste_finetuned_model", help="where the fine-tuned model/tokenizer are saved")
    parser.add_argument("--emb_path", default="./namaste_embeddings.npy")
    parser.add_argument("--rows_path", default="./namaste_rows.parquet")
    parser.add_argument("--nn_path", default="./namaste_nn_index.joblib")
    parser.add_argument("--top_k", type=int, default=5)
    parser.add_argument("--save_out", default=None, help="optional output JSON path to save structured results")
    parser.add_argument("--code_col", default=None, help="optional: name of the code column (if not detected earlier)")
    args = parser.parse_args()

    assert os.path.exists(args.emb_path), f"Embeddings not found: {args.emb_path}"
    assert os.path.exists(args.rows_path), f"Rows parquet not found: {args.rows_path}"
    assert os.path.exists(args.nn_path), f"NN index not found: {args.nn_path}"
    assert os.path.isdir(args.artifacts_dir), f"Artifacts dir not found: {args.artifacts_dir}"

    device = torch.device(get_device())
    print("Loading artifacts (this may take a bit)...")
    embeddings = np.load(args.emb_path)
    rows = pd.read_parquet(args.rows_path)
    nn = joblib.load(args.nn_path)
    tokenizer = AutoTokenizer.from_pretrained(args.artifacts_dir, use_fast=True)
    model = AutoModel.from_pretrained(args.artifacts_dir)
    code_col = args.code_col if args.code_col else (rows["_code_col_"].iloc[0] if "_code_col_" in rows.columns else None)

    query = args.query.strip()
    structured = {
        "query": query,
        "exact_matches": [],
        "semantic_matches": [],
        "model_informed_summary": "",
    }

    # 1) exact code matches
    exact = find_exact_by_code(rows, code_col, query)
    structured["exact_matches"] = exact

    # 2) semantic matches (if exact empty, still show them)
    print("Computing semantic search embedding (using fine-tuned encoder)...")
    q_emb = compute_query_embedding(query, tokenizer, model, device)
    sem = semantic_search(q_emb, nn, rows, top_k=args.top_k)
    structured["semantic_matches"] = sem

    # 3) model-informed extractive summary: use top semantic matches to extract best sentences
    top_texts = [r.get("text", "") for r in sem]
    summary = extractive_summary_from_texts(top_texts, top_n_sentences=4)
    structured["model_informed_summary"] = summary

    # print nice sections
    print("\n" + "="*40)
    print(f"Query: {query}")
    print("="*40 + "\n")

    # Section A: Exact matches
    print("SECTION A: Exact Excel row matches (if any)\n")
    if structured["exact_matches"]:
        for i, r in enumerate(structured["exact_matches"], 1):
            print(f"[Exact {i}]")
            # show code column if available
            if code_col and code_col in r:
                print(f" Code ({code_col}): {r.get(code_col)}")
            # show text snippet
            text_snip = (r.get("text","")[:800] + "...") if len(r.get("text",""))>800 else r.get("text","")
            print(" Text:", text_snip)
            # print other fields
            for k,v in r.items():
                if k in ("text", code_col, "_code_col_"):
                    continue
                print(f"   {k}: {v}")
            print("-"*30)
    else:
        print(" No exact matches found.\n")

    # Section B: Semantic matches
    print("\nSECTION B: Top semantic matches from ClinicalBERT embeddings\n")
    for i, r in enumerate(structured["semantic_matches"], 1):
        print(f"[Sem {i}] score: {r.get('_score'):.4f} row_index: {r.get('_row_index')}")
        if code_col and code_col in r:
            print(f" Code ({code_col}): {r.get(code_col)}")
        text_snip = (r.get("text","")[:800] + "...") if len(r.get("text",""))>800 else r.get("text","")
        print(" Text:", text_snip)
        print("-"*30)

    # Section C: Model-informed extractive summary
    print("\nSECTION C: Model-informed Extractive Summary (from top semantic matches)\n")
    if summary:
        print(summary)
    else:
        print("(No summary could be produced)")

    # Optionally save to JSON
    if args.save_out:
        with open(args.save_out, "w", encoding="utf-8") as fh:
            json.dump(structured, fh, indent=2, ensure_ascii=False)
        print(f"\nStructured result saved to {args.save_out}")

if __name__ == "__main__":
    main()
