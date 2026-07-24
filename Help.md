I'll analyze the backend in the api-server and create an architectural diagram for the project.Let me get a better overview of the repository structure:Now let me fetch more details about the routes and structure:Now I have enough information to analyze the backend and create an architectural diagram. Let me compile the findings.

## StoryForge Backend Analysis & Architecture Diagram

Based on my analysis of the `api-server` component and the overall project structure, here's a comprehensive breakdown:

### **API Server Overview**
The `artifacts/api-server/` is a **Node.js + Express** server that serves as the primary HTTP API gateway for the StoryForge platform.

**Key Details:**
- **Framework:** Express 5.2.1
- **Language:** TypeScript 5.9
- **Runtime:** Node.js 24
- **Build System:** esbuild (bundled as ESM)
- **Logging:** Pino + pino-http
- **Port:** 8080 (path `/api`)
- **Dependencies:**
  - `express` — HTTP server framework
  - `cors` — Cross-origin resource sharing
  - `cookie-parser` — Cookie parsing middleware
  - `pino-http` — Structured HTTP logging
  - `drizzle-orm` — ORM (references `@workspace/db`)
  - `@workspace/api-zod` — Shared Zod schemas for validation

**Current Implementation:**
- **Routes:** Currently minimal — only `GET /api/healthz` (health check)
- **Middleware Stack:**
  - `pinoHttp` — HTTP request/response logging with redaction of sensitive headers
  - `cors()` — CORS support
  - `express.json()` — JSON body parsing
  - `express.urlencoded()` — Form data parsing

---

### **Project Architecture Diagram**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           STORYFORGE PLATFORM                           │
└─────────────────────────────────────────────────────────────────────────┘

                              CLIENT LAYER
                    ┌──────────────────────────┐
                    │    Web App (React)       │  (artifacts/app)
                    │  - Vite + TailwindCSS    │
                    │  - React 19.1.0          │
                    │  - wouter (routing)      │
                    └──────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
    ┌─────────────────────────┐  ┌──────────────────────┐
    │  NODE.JS API SERVER     │  │  PYTHON FASTAPI      │
    │ (artifacts/api-server)  │  │  (artifacts/pipeline)│
    │                         │  │                      │
    │ Express 5 + TypeScript  │  │ FastAPI + uvicorn    │
    │ Port: 8080 → /api       │  │ Port: 5001 → /pipeline
    │                         │  │                      │
    │ Routes:                 │  │ Routes:              │
    │  └─ /api/healthz        │  │  ├─ /pipeline/auth   │
    │                         │  │  ├─ /pipeline/stories
    │ Middleware:             │  │  ├─ /pipeline/chars  │
    │  ├─ CORS                │  │  ├─ /pipeline/scenes │
    │  ├─ Logger (pino)       │  │  ├─ /pipeline/episodes
    │  ├─ JSON parsing        │  │  ├─ /pipeline/jobs   │
    │  └─ URL encoding        │  │  └─ /pipeline/upload │
    │                         │  │                      │
    │ Validation:             │  │ Models (Pydantic):   │
    │  └─ Zod (@workspace/)   │  │  ├─ Story            │
    │                         │  │  ├─ Character        │
    │                         │  │  ├─ Scene            │
    │                         │  │  ├─ Episode          │
    │                         │  │  └─ GenerationJob    │
    └─────────────────────────┘  └──────────────────────┘
                    │                   │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼──────────┐
                    │   DATABASE LAYER   │
                    └────────────────────┘
                              │
                ┌─────────────┬──────────────┐
                │             │              │
                ▼             ▼              ▼
        ┌────────────┐  ┌──────────┐  ┌──────────────┐
        │PostgreSQL  │  │CockroachDB
        │            │  │(Story DB)│  │(Story State) │
        │(Node API)  │  │          │  │(Embeddings)  │
        └────────────┘  │ asyncpg  │  │              │
                        │ SSL      │  │  Profiles &  │
                        │ JSONB    │  │  Generation  │
                        └──────────┘  └──────────────┘
                              │
                    ┌─────────▼──────────┐
                    │ EXTERNAL SERVICES  │
                    ├────────────────────┤
                    │ Qwen/DashScope API │
                    │  ├─ LLM (stories)  │
                    │  ├─ Image gen      │
                    │  └─ Video gen      │
                    │                    │
                    │ Backblaze B2       │
                    │  └─ Media storage  │
                    └────────────────────┘


                          WORKER LAYER
        ┌─────────────────┬─────────────────┬──────────────┐
        │                 │                 │              │
        ▼                 ▼                 ▼              ▼
  ┌──────────┐    ┌──────────────┐  ┌──────────┐   ┌───────────┐
  │Story     │    │Media Worker  │  │Audio     │   │Orchestrator
  │Worker    │    │              │  │Worker    │   │           │
  │          │    │ ├─ Scenes    │  │ ├─ TTS   │   │ Manages   │
  │├─Generate│    │ ├─ Image     │  │ └─ Voice │   │ pipeline  │
  ││Stories  │    │ ├─ Video     │  │ selection   │ jobs      │
  ││          │    │ └─ Assembly  │  └───────────┘ │          │
  │└─────────│    │ (moviepy)    │                │          │
  │ CockroachDB   └──────────────┘                └───────────┘
  │Job Queue     Job Queue for Media             Main Orchest.
  └──────────┘   (story_agent)                   (assembler)
```

---

### **Key Components Breakdown**

| Component | Language | Purpose | Tech Stack |
|-----------|----------|---------|-----------|
| **api-server** | TypeScript | HTTP API gateway | Express, Pino, Zod |
| **pipeline** | Python | Story/media generation | FastAPI, Qwen, MoviePy |
| **app** | TypeScript/React | UI console | React 19, Vite, TailwindCSS |
| **@workspace/db** | TypeScript | ORM + migrations | Drizzle ORM, Postgres |
| **@workspace/api-zod** | TypeScript | Shared validation | Zod v4 |

---

### **Data Flow: Story Generation**

```
User Request
    │
    ▼
React App (artifacts/app)
    │ POST /pipeline/stories
    ▼
Python FastAPI (artifacts/pipeline)
    │
    ├─ Auth validation
    ├─ Create story record (CockroachDB)
    └─ Enqueue generation job
         │
         ├─ Story Worker: Generate outline (Qwen LLM)
         ├─ Character Worker: Ref images (image gen)
         ├─ Media Worker: Scene clips (video gen)
         ├─ Audio Worker: Narration (TTS)
         └─ Orchestrator: Assemble final video (moviepy)
              │
              ▼
         Backblaze B2 (media storage)
         │
         ▼
React App (polls /pipeline/jobs/{job_id})
    │
    ▼
User views final video
```

---

### **API Server Current State**

The Node.js `api-server` is **minimal and structurally sound** but currently **underutilized**:
- ✅ Express app properly initialized with middleware
- ✅ Pino logging with request redaction
- ✅ Workspace references to shared `@workspace/db` and `@workspace/api-zod`
- ❌ Only health check route implemented; main logic in Python pipeline

**Future use case:** Could be extended to proxy pipeline endpoints, add Node-specific features (auth tokens, caching), or serve non-story-generation APIs.