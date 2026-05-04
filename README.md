# DoraMind

DoraMind is a self-hosted, modular AI assistant platform with multi-model capabilities (LLaMA, Mistral, Qwen via Ollama), RAG engine, memory, and scalable web architecture.

## Key Features

- Web chat with AI (multi-model)
- Code and document file understanding (RAG)
- Personalized memory
- Real-time streaming responses
- Modular architecture (API, Core Engine, AI Runtime, DB)
- Fully self-hosted

## Tech Stack

- Frontend: React.js (web)
- Backend: Node.js + Express.js
- Database: MongoDB
- AI Runtime: Ollama (LLaMA, Mistral, Qwen)

## Getting Started

1. Clone this repo
2. Follow `server/README.md` and `client/README.md` for local setup

## Architecture

User → Frontend → API → Auth → Prompt Builder → RAG → Model Router → LLM → Stream Response → Save to DB

---

*Phases:*
1. Backend/DB setup
2. AI integration (Ollama)
3. Model routing + prompt builder
4. Frontend (React)
5. RAG + memory
6. Optimization/scaling

---