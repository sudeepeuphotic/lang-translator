# Bhasha Bridge — Hindi ↔ Kannada Conversation Translator

## Overview
A React Native Expo mobile app that lets two people seated face-to-face translate spoken conversation between **Hindi** and **Kannada** in real time. One person speaks in Hindi → app transcribes, translates, and speaks back in Kannada (and vice versa). Designed with a split-screen layout: the top half is rotated 180° so both users can see their panel the right way up.

## Core Features
- **Voice-first translation**: Tap mic → speak → release → hear translation on the other side.
  - Speech-to-Text: OpenAI **Whisper-1** (via emergentintegrations)
  - Translation: OpenAI **GPT-5.2** (via emergentintegrations)
  - Text-to-Speech: Device-native TTS (`expo-speech`, locales `hi-IN` / `kn-IN`)
- **Text input fallback**: Small "Aa" button in each panel for typed input (great for noisy environments).
- **Face-to-face split UI**: Top panel rotated 180° — two people across a table can both read their side.
- **Conversation history**: Persisted to MongoDB, viewable with replay & clear options.
- **Recording animation**: Pulsing ring around the mic while recording.
- **Cross-platform**: Native (iOS/Android via Expo Go) uses `expo-audio` recorder; web uses `MediaRecorder`.

## Backend API (FastAPI, `/api`)
| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/` | Health check |
| POST | `/api/translate-audio` | multipart: `audio` (file), `source_lang`, `target_lang` → transcribes + translates + persists |
| POST | `/api/translate-text` | JSON: `{text, source_lang, target_lang}` → translates + persists |
| GET  | `/api/conversations?limit=` | List history (newest first, `_id` excluded) |
| DELETE | `/api/conversations` | Clear history |

Languages supported: `hi`, `kn`.

## Stack
- **Frontend**: Expo SDK 54, expo-router, expo-audio, expo-speech, react-native-reanimated, lucide-react-native
- **Backend**: FastAPI, motor (MongoDB), emergentintegrations (Whisper + LLM)
- **DB**: MongoDB (collection `conversations`)
- **LLM Key**: Emergent Universal Key (`EMERGENT_LLM_KEY`)

## Environment
- `backend/.env`: `MONGO_URL`, `DB_NAME`, `EMERGENT_LLM_KEY`
- `frontend/.env`: `EXPO_PUBLIC_BACKEND_URL` (used by `fetch` calls)

## Next Ideas
- Auto language detection (speak without choosing a side)
- Offline fallback / caching recent phrases
- Shareable transcript export (PDF/WhatsApp)
- Premium tier: longer recordings, voice cloning, extra language pairs
