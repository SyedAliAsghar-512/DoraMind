# DoraMind

DoraMind is a self-hosted, modular AI assistant platform with multi-model capabilities (LLaMA, Mistral, Qwen via Ollama), production-grade RAG engine, semantic search, conversation memory, and a scalable web architecture.

## Key Features

- Web chat with AI (multi-model via Ollama)
- **RAG (Retrieval-Augmented Generation)** — semantic search over uploaded documents
- Document upload with async background processing queue (BullMQ + Redis)
- Vector embeddings via Ollama (`nomic-embed-text`) stored in ChromaDB
- Streaming responses via WebSocket and SSE
- Personalized memory across sessions
- Fully self-hosted — no cloud dependencies

## Tech Stack

- **Frontend**: React.js
- **Backend**: Node.js 20 + Express (ES Modules)
- **Database**: MongoDB (metadata only)
- **Vector DB**: ChromaDB (semantic search)
- **Queue**: BullMQ + Redis (background document processing)
- **AI Runtime**: Ollama
  - Embedding model: `nomic-embed-text`
  - Chat model: `llama3.1:8b` (auto-routed)

## Getting Started

### Prerequisites

1. **Node.js 20+**
2. **MongoDB** — running locally or Atlas URI
3. **Redis** — `redis-server` (for BullMQ job queue)
4. **ChromaDB** — `pip install chromadb && chroma run --path ./chroma_db`
5. **Ollama** — <https://ollama.com>
   ```bash
   ollama pull nomic-embed-text   # embedding model
   ollama pull llama3.1:8b        # chat model
   ```

### Installation

```bash
cd backend
npm install
cp .env.example .env   # edit with your settings
npm run dev
```

### Environment Variables

```env
MONGO_URI=mongodb://localhost:27017/doramind
JWT_SECRET=your_secret_here
OLLAMA_URL=http://localhost:11434
CHROMA_URL=http://localhost:8000
REDIS_HOST=localhost
REDIS_PORT=6379
UPLOADS_DIR=./uploads       # where PDF page images are saved
EMBED_MODEL=nomic-embed-text
PORT=5000
```

## Architecture

```
User → Frontend → API (Express)
                    │
          ┌─────────┴──────────┐
          │                    │
   POST /api/docs/upload    WS /ws or POST /api/chat/:id/rag-stream
          │                    │
   uploadController         wsHandler / chatController (RAG)
          │                    │
   BullMQ Queue            embedText (Ollama)
          │                    │
   documentWorker      ChromaDB vector search
     ├─ pdfService          │
     ├─ docService      Build context prompt
     ├─ embeddingService     │
     └─ vectorDBService   streamOllamaChat (llama3.1:8b)
```

### Backend Module Structure

```
backend/src/
├── app.js                     Entry point
├── controllers/               New RAG controllers
│   ├── uploadController.js    Fast upload + BullMQ enqueue
│   └── chatController.js      RAG streaming chat (SSE)
├── workers/
│   └── documentWorker.js      BullMQ worker: extract → chunk → embed → store
├── queue/
│   └── index.js               BullMQ Queue + Redis connection
├── services/
│   ├── pdfService.js          PDF text + image extraction (pdfjs-dist)
│   ├── docService.js          DOCX (mammoth) + PPTX (JSZip) extraction
│   ├── embeddingService.js    Ollama nomic-embed-text embeddings
│   ├── vectorDBService.js     ChromaDB CRUD + semantic search
│   ├── ollamaService.js       Ollama chat + streaming
│   ├── modelRouter.js         Smart model routing
│   ├── promptBuilder.js       Prompt assembly
│   ├── memoryService.js       User memory extraction
│   └── wsHandler.js           WebSocket chat (uses vector search)
├── routes/
│   ├── uploadRoutes.js        /api/docs/*
│   ├── chatRoutes.js          /api/chat/* (incl. RAG stream)
│   ├── auth.js                /api/auth/*
│   ├── ai.js                  /api/ai/*
│   └── models.js              /api/models/*
├── controller/                Legacy controllers (kept for compatibility)
│   ├── chatController.js      Chat session CRUD
│   └── ...
└── models/
    ├── Document.js            Metadata only (no base64)
    ├── Chat.js
    ├── Memory.js
    └── User.js
```

### Upload Flow

1. `POST /api/docs/upload` → `uploadController.uploadDocument`
2. MD5 hash computed → check if already processed (dedup, Phase 2D)
3. Save metadata to MongoDB → **respond immediately** (<200 ms)
4. Enqueue `process-document` job in BullMQ
5. **Worker** (background):
   - Extract text: PDF via `pdfjs-dist`, DOCX via `mammoth`, PPTX via `JSZip`
   - Chunk into 300–500 token windows with 50-token overlap
   - Generate embeddings: `POST /api/embed` → Ollama `nomic-embed-text`
   - Store chunks + embeddings in ChromaDB
   - Update `Document.processed = true` in MongoDB

### Chat / RAG Flow

1. User sends message (WebSocket `chat` event or `POST /api/chat/:id/rag-stream`)
2. Embed query: `embedText(query)` → Ollama `nomic-embed-text`
3. Semantic search: `searchSimilarChunks(userId, queryVec, topK=8)` → ChromaDB
4. Build context: inject top-k chunks into system prompt
5. Stream response: `streamOllamaChat(model, messages)` → Ollama `llama3.1:8b`
6. Save assistant message to MongoDB

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/docs/upload` | Upload document (async processing) |
| GET | `/api/docs` | List user's documents |
| DELETE | `/api/docs/:id` | Delete document + ChromaDB chunks |
| GET | `/api/docs/:id/chunks` | Get document chunks |
| POST | `/api/chat/:id/rag-stream` | RAG chat with SSE streaming |
| GET | `/api/chat` | List chat sessions |
| POST | `/api/chat` | Create chat session |
| WS | `/ws` | WebSocket for real-time chat + RAG |
| GET | `/health` | Health check (Ollama + ChromaDB status) |

---

*Phases completed:*
1. ✅ Backend/DB setup
2. ✅ AI integration (Ollama)
3. ✅ Model routing + prompt builder
4. ✅ Frontend (React)
5. ✅ RAG + memory + vector search (ChromaDB)
6. ✅ Production architecture (BullMQ, Redis, ChromaDB, async processing)
