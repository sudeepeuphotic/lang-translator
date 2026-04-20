from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone

from emergentintegrations.llm.openai import OpenAISpeechToText
from emergentintegrations.llm.chat import LlmChat, UserMessage


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")


# -------------- Language helpers --------------
LANG_MAP = {
    "hi": {"name": "Hindi", "script": "हिंदी", "whisper": "hi"},
    "kn": {"name": "Kannada", "script": "ಕನ್ನಡ", "whisper": "kn"},
}

LangCode = Literal["hi", "kn"]


# -------------- Models --------------
class TranslateTextRequest(BaseModel):
    text: str
    source_lang: LangCode
    target_lang: LangCode


class ConversationEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_lang: LangCode
    target_lang: LangCode
    source_text: str
    translated_text: str
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class TranslateResponse(BaseModel):
    id: str
    source_lang: LangCode
    target_lang: LangCode
    source_text: str
    translated_text: str
    created_at: str


# -------------- LLM helper --------------
async def translate_text(text: str, source_lang: LangCode, target_lang: LangCode) -> str:
    src = LANG_MAP[source_lang]["name"]
    tgt = LANG_MAP[target_lang]["name"]
    system_message = (
        f"You are a professional translator. Translate the given text from {src} to {tgt}. "
        f"Respond with ONLY the translated text in {tgt} script. "
        f"Do not add quotes, explanations, transliterations, or any extra commentary. "
        f"Preserve tone and meaning. If the text is already in {tgt}, return it as-is."
    )
    chat = (
        LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"translate-{uuid.uuid4()}",
            system_message=system_message,
        )
        .with_model("openai", "gpt-5.2")
    )
    response = await chat.send_message(UserMessage(text=text))
    return response.strip()


# -------------- Routes --------------
@api_router.get("/")
async def root():
    return {"message": "Hindi-Kannada Translator API", "status": "ok"}


@api_router.post("/translate-audio", response_model=TranslateResponse)
async def translate_audio(
    audio: UploadFile = File(...),
    source_lang: LangCode = Form(...),
    target_lang: LangCode = Form(...),
):
    """Accept audio file, transcribe in source language, translate to target language,
    persist to Mongo and return result."""
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file")

        # Wrap bytes in a file-like with a name so the API knows the format
        filename = audio.filename or "audio.m4a"
        buf = io.BytesIO(audio_bytes)
        buf.name = filename

        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        transcription = await stt.transcribe(
            file=buf,
            model="whisper-1",
            response_format="json",
            language=LANG_MAP[source_lang]["whisper"],
        )
        source_text = (transcription.text or "").strip()

        if not source_text:
            raise HTTPException(
                status_code=422, detail="Could not understand audio. Please try again."
            )

        translated_text = await translate_text(source_text, source_lang, target_lang)

        entry = ConversationEntry(
            source_lang=source_lang,
            target_lang=target_lang,
            source_text=source_text,
            translated_text=translated_text,
        )
        await db.conversations.insert_one(entry.dict())

        return TranslateResponse(**entry.dict())
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("translate-audio failed")
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")


@api_router.post("/translate-text", response_model=TranslateResponse)
async def translate_text_endpoint(payload: TranslateTextRequest):
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Empty text")

        translated_text = await translate_text(
            payload.text, payload.source_lang, payload.target_lang
        )
        entry = ConversationEntry(
            source_lang=payload.source_lang,
            target_lang=payload.target_lang,
            source_text=payload.text.strip(),
            translated_text=translated_text,
        )
        await db.conversations.insert_one(entry.dict())
        return TranslateResponse(**entry.dict())
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("translate-text failed")
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")


@api_router.get("/conversations", response_model=List[TranslateResponse])
async def list_conversations(limit: int = 100):
    docs = await db.conversations.find(
        {}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return [TranslateResponse(**d) for d in docs]


@api_router.delete("/conversations")
async def clear_conversations():
    result = await db.conversations.delete_many({})
    return {"deleted": result.deleted_count}


# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
