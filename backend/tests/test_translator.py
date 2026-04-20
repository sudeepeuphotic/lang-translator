"""Hindi-Kannada translator backend tests."""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://speak-translate-chat.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Health
def test_health(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"


# Clear before tests for deterministic count
def test_clear_initial(session):
    r = session.delete(f"{API}/conversations")
    assert r.status_code == 200
    assert "deleted" in r.json()


# Translate Hindi -> Kannada
def test_translate_text_hi_to_kn(session):
    payload = {"text": "नमस्ते, आप कैसे हैं?", "source_lang": "hi", "target_lang": "kn"}
    r = session.post(f"{API}/translate-text", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("id", "source_text", "translated_text", "created_at", "source_lang", "target_lang"):
        assert k in d
    assert d["source_lang"] == "hi"
    assert d["target_lang"] == "kn"
    assert d["source_text"] == payload["text"]
    assert d["translated_text"].strip()
    # Kannada script contains chars in range \u0C80-\u0CFF
    assert any("\u0c80" <= c <= "\u0cff" for c in d["translated_text"]), f"Not Kannada: {d['translated_text']}"
    assert "_id" not in d


# Translate Kannada -> Hindi
def test_translate_text_kn_to_hi(session):
    payload = {"text": "ನಮಸ್ಕಾರ, ನೀವು ಹೇಗಿದ್ದೀರಿ?", "source_lang": "kn", "target_lang": "hi"}
    r = session.post(f"{API}/translate-text", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source_lang"] == "kn"
    assert d["target_lang"] == "hi"
    # Devanagari range
    assert any("\u0900" <= c <= "\u097f" for c in d["translated_text"]), f"Not Hindi: {d['translated_text']}"


# Empty text -> 400
def test_translate_empty_text(session):
    r = session.post(f"{API}/translate-text", json={"text": "   ", "source_lang": "hi", "target_lang": "kn"})
    assert r.status_code == 400


# Invalid lang -> 422 (pydantic)
def test_translate_invalid_lang(session):
    r = session.post(f"{API}/translate-text", json={"text": "hi", "source_lang": "fr", "target_lang": "kn"})
    assert r.status_code == 422


# Conversations list - should contain the two created entries, no _id field
def test_list_conversations(session):
    r = session.get(f"{API}/conversations?limit=50")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    for item in data:
        assert "_id" not in item
        for k in ("id", "source_text", "translated_text", "created_at"):
            assert k in item


# Translate-audio with empty file -> 400
def test_translate_audio_empty(session):
    files = {"audio": ("empty.m4a", b"", "audio/m4a")}
    data = {"source_lang": "hi", "target_lang": "kn"}
    r = requests.post(f"{API}/translate-audio", files=files, data=data, timeout=30)
    assert r.status_code == 400, r.text


# Translate-audio with invalid/garbage bytes -> 500 or 422 (cannot transcribe)
def test_translate_audio_invalid_bytes(session):
    files = {"audio": ("junk.m4a", b"\x00\x01\x02not-really-audio", "audio/m4a")}
    data = {"source_lang": "hi", "target_lang": "kn"}
    r = requests.post(f"{API}/translate-audio", files=files, data=data, timeout=60)
    # Expect a clean error, not 200
    assert r.status_code in (400, 422, 500), r.text
    assert "detail" in r.json()


# Delete clears all
def test_clear_conversations(session):
    r = session.delete(f"{API}/conversations")
    assert r.status_code == 200
    body = r.json()
    assert body.get("deleted", 0) >= 2
    # verify empty
    r2 = session.get(f"{API}/conversations")
    assert r2.status_code == 200
    assert r2.json() == []
