# RAG Backend Integration

The UG Advisor Frontend is now integrated with the Auntie Aba RAG backend.

## Setup

### 1. Start the RAG API Backend

From `/Users/nissi/auntie_aba_rag/`:

```bash
source venv/bin/activate
uvicorn api:app --host 127.0.0.1 --port 8000
```

The backend will be available at `http://localhost:8000`.

### 2. Configure Frontend

The frontend `.env` is already configured:
```
VITE_API_BASE=http://localhost:8000
```

### 3. Start the Frontend

From `/Users/nissi/ug_advisor_frontend/`:

```bash
npm run dev
```

Visit `http://localhost:5173` (or whatever Vite shows).

---

## Available API Functions

### RAG Chat (Full Pipeline)
```typescript
import { ragChat } from '@/api';

const result = await ragChat("What are Level 300 CS courses?", 5);
// Returns: { query, answer, sources }
```

### RAG Search (Retrieval Only)
```typescript
import { ragSearch } from '@/api';

const results = await ragSearch("gender equity definition", 5);
// Returns: { query, results[] with similarity scores }
```

### RAG Chunk (Upload & Process Documents)
```typescript
import { ragChunk } from '@/api';

const result = await ragChunk(file);
// Returns: { filename, chunker, total_chunks, chunks[] }
```

---

## Integration Example

To use RAG in a Vue component:

```vue
<template>
  <div>
    <input v-model="query" @keyup.enter="search" placeholder="Ask about courses...">
    <button @click="search">Search</button>
    
    <div v-if="loading">Loading...</div>
    <div v-if="answer" class="answer">
      <p>{{ answer }}</p>
      <ul>
        <li v-for="source in sources" :key="source.source_file">
          {{ source.source_file }} (Level {{ source.level }})
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ragChat } from '@/api';

const query = ref('');
const answer = ref('');
const sources = ref([]);
const loading = ref(false);

async function search() {
  if (!query.value) return;
  loading.value = true;
  try {
    const result = await ragChat(query.value, 5);
    answer.value = result.answer;
    sources.value = result.sources;
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}
</script>
```

---

## Fallback to Legacy API

If the RAG backend is unavailable, the frontend can still use the legacy modal deployment:

```typescript
// Automatically falls back to legacy API if RAG is down
import { chat } from '@/api';

const result = await chat(message, history);
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:8000` | RAG backend URL |

---

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /chat` | RAG backend | Full RAG (retrieve + generate) |
| `POST /search` | RAG backend | Retrieval only with similarity |
| `POST /chunk` | RAG backend | Upload document to chunk |
| `GET /health` | RAG backend | Health check |

---

## Troubleshooting

**Frontend can't reach backend:**
- Ensure RAG API is running on port 8000
- Check `VITE_API_BASE` in `.env`
- Browser console (F12) shows CORS errors → enable CORS in FastAPI (see below)

**Enable CORS in FastAPI** (if needed):
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or ["http://localhost:5173"] for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**API returns 404:**
- Verify the endpoint exists (check RAG API docs at `/docs`)
- Ensure VITE_API_BASE is correct
- Restart frontend dev server after changing `.env`
