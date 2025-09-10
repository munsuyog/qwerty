#!/usr/bin/env python3
"""
train_finetune_namaste.py

Fine-tune medicalai/ClinicalBERT on NAMASTE_data.xlsx (MLM), build embeddings and an NN index.
Outputs (default):
  ./namaste_finetuned_model/   <- fine-tuned model + tokenizer
  ./namaste_embeddings.npy     <- normalized embeddings (rows x dim)
  ./namaste_rows.parquet       <- dataframe with constructed text (same order as embeddings)
  ./namaste_nn_index.joblib    <- sklearn NearestNeighbors object (fitted)

Example usage:
  python train_finetune_namaste.py --excel NAMASTE_data.xlsx --do_train --output_dir ./namaste_finetuned_model
"""
import os
import argparse
import math
import pickle
from typing import Optional

import numpy as np
import pandas as pd
import torch
from datasets import Dataset
from sklearn.neighbors import NearestNeighbors
import joblib

from transformers import (
    AutoTokenizer,
    AutoModelForMaskedLM,
    AutoModel,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)

# ---------------- Utilities ----------------
def get_device():
    return "cuda" if torch.cuda.is_available() else "cpu"

def mean_pooling(model_output, attention_mask):
    token_embeddings = model_output.last_hidden_state
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    sum_embeddings = torch.sum(token_embeddings * input_mask_expanded, dim=1)
    sum_mask = torch.clamp(input_mask_expanded.sum(dim=1), min=1e-9)
    return sum_embeddings / sum_mask

# ---------------- Data preparation ----------------
def load_and_prepare(excel_path: str, code_col_hint: Optional[str]=None):
    df = pd.read_excel(excel_path, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]

    # choose code column heuristically or via hint
    code_col = None
    if code_col_hint and code_col_hint in df.columns:
        code_col = code_col_hint
    else:
        candidates = [c for c in df.columns if any(k in c.lower() for k in ("namc", "code", "id", "term", "namc_code"))]
        code_col = candidates[0] if candidates else None

    # Build a 'text' field by concatenating all non-code columns (label: value)
    merge_cols = [c for c in df.columns if c != code_col]
    if not merge_cols:  # fallback
        merge_cols = [df.columns[0]]

    def row_to_text(row):
        parts = []
        for c in merge_cols:
            v = row.get(c, "")
            if pd.isna(v) or str(v).strip() == "":
                continue
            parts.append(f"{c}: {str(v).strip()}")
        return " ||| ".join(parts)

    df = df.copy()
    df["text"] = df.apply(row_to_text, axis=1)
    df["_code_col_"] = code_col
    return df, code_col

# ---------------- Tokenize -> HF Dataset ----------------
def make_tokenized_dataset(df, tokenizer, max_length=256):
    ds = Dataset.from_pandas(df[["text"]].rename(columns={"text":"text"}))
    def tok(examples):
        return tokenizer(examples["text"], truncation=True, max_length=max_length)
    tokenized = ds.map(tok, batched=True, remove_columns=["text"])
    return tokenized

# ---------------- Fine-tune MLM ----------------
def finetune_mlm(model_id, tokenizer, train_dataset, output_dir, epochs=3, per_device_train_batch_size=8, lr=5e-5):
    model = AutoModelForMaskedLM.from_pretrained(model_id)
    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=True, mlm_probability=0.15)

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=per_device_train_batch_size,
        logging_steps=50,
        save_steps=500,
        save_total_limit=2,
        fp16=torch.cuda.is_available(),  # use fp16 if GPU available
        learning_rate=lr,
        push_to_hub=False,
        evaluation_strategy="no",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        data_collator=data_collator,
        train_dataset=train_dataset,
    )

    trainer.train()
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    return output_dir

# ---------------- Build embeddings ----------------
def build_embeddings(df, model_or_path, tokenizer_or_path, batch_size=16, max_length=256):
    device = torch.device(get_device())
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_or_path, use_fast=True)
    model = AutoModel.from_pretrained(model_or_path)
    model.to(device)
    model.eval()

    texts = df["text"].fillna("").tolist()
    all_embs = []
    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            enc = tokenizer(batch, padding=True, truncation=True, max_length=max_length, return_tensors="pt")
            input_ids = enc["input_ids"].to(device)
            att = enc["attention_mask"].to(device)
            out = model(input_ids=input_ids, attention_mask=att, return_dict=True)
            emb = mean_pooling(out, att).cpu().numpy()
            all_embs.append(emb)
    embeddings = np.vstack(all_embs)
    # normalize
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms==0] = 1e-9
    embeddings = embeddings / norms
    return embeddings

# ---------------- Build NN index ----------------
def build_and_save_nn(embeddings, out_path, n_neighbors=10, metric="cosine", n_jobs=4):
    nn = NearestNeighbors(n_neighbors=n_neighbors, metric=metric, n_jobs=n_jobs)
    nn.fit(embeddings)
    joblib.dump(nn, out_path)
    return nn

# ---------------- Main ----------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", default="NAMASTE_data.xlsx", help="Excel file in same folder")
    parser.add_argument("--output_dir", default="./namaste_finetuned_model", help="where to save model/tokenizer")
    parser.add_argument("--do_train", action="store_true", help="If set, run MLM fine-tuning")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=8)
    parser.add_argument("--embed_batch", type=int, default=16)
    parser.add_argument("--max_length", type=int, default=256)
    parser.add_argument("--code_col", type=str, default=None, help="Optional: exact column name for NAMC code")
    parser.add_argument("--model_name", type=str, default="medicalai/ClinicalBERT")
    parser.add_argument("--nn_path", type=str, default="./namaste_nn_index.joblib")
    parser.add_argument("--emb_path", type=str, default="./namaste_embeddings.npy")
    parser.add_argument("--rows_path", type=str, default="./namaste_rows.parquet")
    args = parser.parse_args()

    assert os.path.exists(args.excel), f"Excel file not found: {args.excel}"
    os.makedirs(args.output_dir, exist_ok=True)

    print("Loading and preparing Excel...")
    df, code_col = load_and_prepare(args.excel, code_col_hint=args.code_col)
    print(f"Detected code column: {code_col}")

    tokenizer = AutoTokenizer.from_pretrained(args.model_name, use_fast=True)

    if args.do_train:
        print("Tokenizing dataset for MLM...")
        tokenized = make_tokenized_dataset(df, tokenizer, max_length=args.max_length)
        print(f"Dataset size: {len(tokenized)}")
        print("Starting MLM fine-tuning (this uses GPU if available)...")
        finetune_mlm(
            model_id=args.model_name,
            tokenizer=tokenizer,
            train_dataset=tokenized,
            output_dir=args.output_dir,
            epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
        )
        encoder_model_path = args.output_dir
        encoder_tokenizer_path = args.output_dir
    else:
        print("Skipping training. Using base model as encoder.")
        encoder_model_path = args.model_name
        encoder_tokenizer_path = args.model_name

    print("Building embeddings for each row (this will use the encoder model)...")
    embeddings = build_embeddings(df, encoder_model_path, encoder_tokenizer_path, batch_size=args.embed_batch, max_length=args.max_length)
    print(f"Embeddings shape: {embeddings.shape}")

    print(f"Saving embeddings to {args.emb_path}")
    np.save(args.emb_path, embeddings)

    print(f"Saving dataframe rows to {args.rows_path}")
    df.to_parquet(args.rows_path, index=False)

    print("Building NearestNeighbors index...")
    nn = build_and_save_nn(embeddings, args.nn_path, n_neighbors=20)
    print(f"Saved NN index to {args.nn_path}")

    print("Train + build finished. Artifacts saved:")
    print(" - model/tokenizer:", args.output_dir)
    print(" - embeddings:", args.emb_path)
    print(" - rows dataframe:", args.rows_path)
    print(" - nn index:", args.nn_path)

if __name__ == "__main__":
    main()
