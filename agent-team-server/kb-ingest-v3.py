#!/usr/bin/env python3
"""
KB Ingest v3: Direct PersistentClient → writes to the same
chroma.sqlite3 the kb_api.py on :8096 reads from.
We kill kb_api.py momentarily, ingest, restart it.

This is THE source of truth for the KB.
After this, /api/search returns real chunks and agents get real RAG context.
"""
import os, sys, json
from pathlib import Path

# Same path kb_api.py uses
CHROMA_PATH = "/home/admin/.openclaw/workspace/rag-memory/embeddings"
KB_DIR = Path("/home/admin/.openclaw/workspace/knowledge-base")

def chunk_text(text, max_len=600):
    """Paragraph-aware chunking."""
    paras = [p.strip() for p in text.split("\n\n") if p.strip() and not p.strip().startswith("#")]
    chunks = []
    for p in paras:
        if len(p) <= max_len:
            chunks.append(p)
        else:
            buf = ""
            for sent in p.replace(". ", ".\n").split("\n"):
                if len(buf + " " + sent) >= max_len and buf:
                    chunks.append(buf.strip())
                    buf = sent
                else:
                    buf = (" " + sent if buf else sent)
            if buf.strip():
                chunks.append(buf.strip())
    return chunks

def main():
    files = sorted(KB_DIR.glob("*.md"))
    print(f"Found {len(files)} KB docs in {KB_DIR}")
    if not files:
        sys.exit(1)

    import chromadb
    from chromadb.config import Settings

    client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=Settings(anonymized_telemetry=False),
    )
    kc = client.get_or_create_collection(
        "knowledge_base",
        metadata={"description": "RAG Empire business knowledge"}
    )
    print(f"Collection 'knowledge_base' current: {kc.count()}")

    # Wipe
    try:
        existing = kc.get(include=[])
        if existing['ids']:
            print(f"Wiping {len(existing['ids'])} existing chunks...")
            kc.delete(ids=existing['ids'])
    except Exception as e:
        print(f"  pre-clean warning: {e}")

    all_docs, all_ids, all_metas = [], [], []
    for f in files:
        text = f.read_text()
        chunks = chunk_text(text, 600)
        for i, c in enumerate(chunks):
            all_docs.append(c)
            all_ids.append(f"{f.stem}-{i:03d}")
            all_metas.append({"source": f.name, "title": f.stem, "chunk": i})
        print(f"  {f.name}: {len(chunks)} chunks")
    print(f"\nTotal chunks: {len(all_docs)}")

    # Insert in batches
    batch = 100
    for i in range(0, len(all_docs), batch):
        kc.add(
            documents=all_docs[i:i+batch],
            ids=all_ids[i:i+batch],
            metadatas=all_metas[i:i+batch],
        )
        print(f"  inserted {min(i+batch, len(all_docs))}/{len(all_docs)}", end="\r")
    print()
    print(f"✅ KB ready: {kc.count()} chunks in 'knowledge_base'")

    # Test query
    print()
    print("=== Test query ===")
    r = kc.query(query_texts=["How does ReachInbox API work"], n_results=3)
    for i, doc in enumerate(r['documents'][0]):
        meta = r['metadatas'][0][i]
        print(f"  {i+1}. [{meta.get('source')}] {doc[:100]}...")

if __name__ == "__main__":
    main()
