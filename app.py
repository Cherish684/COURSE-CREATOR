from flask import Flask, request, jsonify, send_from_directory, session
from flask_cors import CORS
from groq import Groq
import os, json, re, time, subprocess, tempfile, base64, mimetypes, uuid
import requests as req
from dotenv import load_dotenv
from database import (
    init_db, create_user, verify_user,
    save_course, get_user_courses, get_course_by_token,
    save_feedback, get_user_feedback, save_engagement, get_user_engagement,
    update_user_language, save_quiz_attempt
)
from feedback_analyzer import analyze_feedback
from distilbert_validator import validate_question_difficulty

load_dotenv()
init_db()

app = Flask(__name__, static_folder='.')
app.secret_key = os.getenv("SECRET_KEY", "coursecreator_secret_2024")
CORS(app, supports_credentials=True, origins="*")

GROQ_API_KEY       = os.getenv("GROQ_API_KEY")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
YOUTUBE_API_KEY    = os.getenv("YOUTUBE_API_KEY")
CF_ACCOUNT_ID      = os.getenv("CF_ACCOUNT_ID")
CF_API_TOKEN       = os.getenv("CF_API_TOKEN")

if not GROQ_API_KEY:       print("WARNING: GROQ_API_KEY not found in .env")
if not ASSEMBLYAI_API_KEY: print("WARNING: ASSEMBLYAI_API_KEY not found in .env")
if not YOUTUBE_API_KEY:    print("WARNING: YOUTUBE_API_KEY not found in .env")
if not CF_ACCOUNT_ID or not CF_API_TOKEN: print("WARNING: CF_ACCOUNT_ID / CF_API_TOKEN not found in .env (module images will not be generated)")

client       = Groq(api_key=GROQ_API_KEY)
MODEL        = "openai/gpt-oss-120b"
VISION_MODEL = "qwen/qwen3.8-27b"   # Groq vision model (Llama 4 Scout was retired)


def call_groq(prompt, max_tokens=4096, reasoning_effort="low", retries=3):
    """Call Groq. Retries on rate limits (429) and drops reasoning_effort if the API rejects it."""
    use_effort = True
    last_err   = "unknown error"
    for attempt in range(retries):
        try:
            kwargs = dict(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=max_tokens,
            )
            if use_effort:
                kwargs["extra_body"] = {"reasoning_effort": reasoning_effort}
            response = client.chat.completions.create(**kwargs)
            text = (response.choices[0].message.content or "").strip()
            if not text:
                raise ValueError("Groq returned an empty response.")
            return text
        except Exception as e:
            msg      = str(e)
            last_err = msg
            low      = msg.lower()
            if use_effort and "reasoning" in low and "429" not in low:
                use_effort = False            # this model/SDK doesn't accept it - retry without
                continue
            if "429" in msg or "rate_limit" in low or "rate limit" in low:
                if "per day" in low or "tokens per day" in low:
                    raise RuntimeError("Groq daily limit reached. Try again later. " + msg[:200])
                m    = re.search(r"try again in ([\d.]+)\s*(ms|s)", msg)
                wait = 15.0
                if m:
                    wait = float(m.group(1)) / (1000.0 if m.group(2) == "ms" else 1.0) + 1.5
                wait = min(max(wait, 2.0), 45.0)
                print(f"[GROQ] rate limited, waiting {wait:.0f}s (attempt {attempt + 1}/{retries})")
                time.sleep(wait)
                continue
            raise RuntimeError(f"Groq API error: {msg}")
    raise RuntimeError(f"Groq API error after {retries} attempts: {last_err}")


def clean_json_string(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    return raw.strip()


def parse_json_loose(raw: str):
    """Parse JSON from a model reply: strips fences, tolerates raw newlines inside strings,
    and falls back to the outermost {...} / [...] block."""
    raw = clean_json_string(raw)
    try:
        return json.loads(raw, strict=False)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        a, b = raw.find(open_c), raw.rfind(close_c)
        if a != -1 and b > a:
            try:
                return json.loads(raw[a:b + 1], strict=False)
            except json.JSONDecodeError:
                continue
    return json.loads(raw, strict=False)   # raise the original-style error


COURSE_PLAN = [
    (1, "Introduction to {t}",             "\U0001F680", "30 minutes", "Beginner"),
    (2, "Core Fundamentals of {t}",        "\U0001F4DA", "40 minutes", "Beginner"),
    (3, "Intermediate {t}",                "\u26A1",     "45 minutes", "Intermediate"),
    (4, "Advanced {t}",                    "\U0001F525", "50 minutes", "Advanced"),
    (5, "Practical Applications of {t}",   "\U0001F6E0\uFE0F", "45 minutes", "Intermediate"),
    (6, "Specialization and Expert Tracks", "\U0001F3AF", "50 minutes", "Advanced"),
    (7, "Conclusion and Your Path Forward", "\U0001F3C6", "30 minutes", "All Levels"),
]
COURSE_GROUPS = [[1, 2, 3], [4, 5], [6, 7]]   # 3 smaller calls instead of one huge one


def generate_course_group(topic, lang_note, ids, with_meta):
    """Ask Groq for the content of a few modules (and course title/description on the first call)."""
    plan   = {p[0]: p for p in COURSE_PLAN}
    listing = "\n".join(
        f'- id {i}: "{plan[i][1].format(t=topic)}" ({plan[i][4]})' for i in ids
    )
    meta_fmt  = '"course_title": "Complete Course Title", "description": "A compelling 2-sentence course description.", "estimated_duration": "X hours", ' if with_meta else ''
    prompt = f"""You are an expert course writer. Course topic: "{topic}".
{lang_note}
Write the content for the following modules of a 7-module course.

{listing}

Return ONLY a valid JSON object. No markdown. No code fences. No explanation.

{{
  {meta_fmt}"modules": [
    {{"id": {ids[0]}, "title": "module title", "learning_objectives": ["o1", "o2", "o3"], "content": "text", "key_takeaways": ["t1", "t2", "t3"]}}
  ]
}}

Rules:
- Include exactly these module ids: {ids}.
- Keep each title as listed above (translate it only if the course language is not English).
- Each "content" must be at least 300 words of real educational content, written as plain text with paragraphs separated by \\n\\n.
- Never use double quotes inside text values (use single quotes instead) and never put raw line breaks inside a string.
- Return ONLY the JSON object."""
    last_err = None
    for attempt in range(2):
        raw = call_groq(prompt, max_tokens=3500 if attempt == 0 else 4500)
        try:
            data = parse_json_loose(raw)
            if not isinstance(data, dict) or not data.get("modules"):
                raise ValueError("response had no modules")
            return data
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            print(f"[COURSE] group {ids} parse failed (attempt {attempt + 1}): {e}")
    raise ValueError(f"Could not read the AI response for modules {ids}: {last_err}")


def build_course(topic, lang_note):
    plan    = {p[0]: p for p in COURSE_PLAN}
    meta    = {}
    modules = {}
    for gi, ids in enumerate(COURSE_GROUPS):
        data = generate_course_group(topic, lang_note, ids, with_meta=(gi == 0))
        if gi == 0:
            meta = data
        for m in data.get("modules", []):
            try:
                mid = int(m.get("id"))
            except (TypeError, ValueError):
                continue
            if mid in plan:
                modules[mid] = m
    missing = [i for i in plan if i not in modules or not str(modules[i].get("content", "")).strip()]
    if missing:
        raise ValueError(f"AI did not return content for modules {missing}. Please try again.")
    final_modules = []
    for i in sorted(plan):
        _, title_t, icon, duration, difficulty = plan[i]
        m = modules[i]
        final_modules.append({
            "id": i,
            "title": m.get("title") or title_t.format(t=topic),
            "icon": icon,
            "duration": duration,
            "learning_objectives": m.get("learning_objectives") or [],
            "content": m.get("content", ""),
            "key_takeaways": m.get("key_takeaways") or [],
            "difficulty": difficulty,
        })
    return {
        "course_title": meta.get("course_title") or f"Complete Course on {topic}",
        "topic": topic,
        "description": meta.get("description") or f"A complete 7-module course on {topic}.",
        "estimated_duration": meta.get("estimated_duration") or "5 hours",
        "modules": final_modules,
    }


def get_current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    from database import get_db
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone()
    conn.close()
    return dict(user) if user else None


def check_ytdlp():
    try:
        result = subprocess.run(
            ['yt-dlp', '--version'],
            check=True, capture_output=True, text=True, timeout=10
        )
        print(f"[VIDEO QUIZ] yt-dlp version: {result.stdout.strip()}")
    except FileNotFoundError:
        raise RuntimeError("yt-dlp is not installed. Install: pip install yt-dlp")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"yt-dlp check failed: {e.stderr.strip()}")


# ============================================================
# STATIC ROUTES
# ============================================================

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/shared/<token>')
def shared_course_page(token):
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)


# ============================================================
# AUTH
# ============================================================

@app.route('/api/register', methods=['POST'])
def register():
    data     = request.json
    name     = data.get('name', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '').strip()
    if not name or not email or not password:
        return jsonify({'error': 'Name, email and password are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    user = create_user(name, email, password)
    if not user:
        return jsonify({'error': 'Email already registered'}), 409
    session['user_id'] = user['id']
    return jsonify({'success': True, 'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'language': user['language']}})


@app.route('/api/login', methods=['POST'])
def login():
    data     = request.json
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '').strip()
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400
    user = verify_user(email, password)
    if not user:
        return jsonify({'error': 'Invalid email or password'}), 401
    session['user_id'] = user['id']
    return jsonify({'success': True, 'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'language': user['language']}})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/me', methods=['GET'])
def me():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401
    return jsonify({'success': True, 'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'language': user['language']}})


@app.route('/api/update-language', methods=['POST'])
def update_language():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401
    language = request.json.get('language', 'English')
    update_user_language(user['id'], language)
    return jsonify({'success': True, 'language': language})


@app.route('/api/my-courses', methods=['GET'])
def my_courses():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in'}), 401
    courses = get_user_courses(user['id'])
    return jsonify({'success': True, 'courses': courses})


@app.route('/api/shared/<token>', methods=['GET'])
def get_shared_course(token):
    course = get_course_by_token(token)
    if not course:
        return jsonify({'error': 'Course not found'}), 404
    return jsonify({'success': True, 'course': json.loads(course['course_data']), 'topic': course['topic']})


# ============================================================
# ENGAGEMENT
# ============================================================

@app.route('/api/save-engagement', methods=['POST'])
def api_save_engagement():
    user = get_current_user()
    data = request.json
    uid  = user['id'] if user else None
    save_engagement(uid, data.get('course_id'), data.get('module_title', ''),
                    data.get('total_time', 0), data.get('distracted_time', 0), data.get('focus_score', 100))
    return jsonify({'success': True})


@app.route('/api/engagement-report', methods=['GET'])
def engagement_report():
    user = get_current_user()
    uid  = user['id'] if user else None
    if not uid:
        return jsonify({'success': True, 'sessions': []})
    sessions = get_user_engagement(uid)
    return jsonify({'success': True, 'sessions': sessions})


@app.route('/api/save-quiz-attempt', methods=['POST'])
def api_save_quiz_attempt():
    user = get_current_user()
    data = request.json
    uid  = user['id'] if user else None
    save_quiz_attempt(uid, data.get('course_id'), data.get('module_title', ''),
                      data.get('score', 0), data.get('total', 10), data.get('difficulty', 'easy'))
    return jsonify({'success': True})


# ============================================================
# COURSE GENERATION
# ============================================================

@app.route('/generate', methods=['POST'])
def generate_course():
    data     = request.json
    topic    = data.get('topic', '').strip()
    if not topic:
        return jsonify({'error': 'Topic is required'}), 400
    if not GROQ_API_KEY:
        return jsonify({'error': 'GROQ_API_KEY is not set in your .env file.'}), 500

    user      = get_current_user()
    language  = user['language'] if user else data.get('language', 'English')
    lang_note = f"Write all content in {language} language." if language != 'English' else ''

    try:
        course_data = build_course(topic, lang_note)

        for module in course_data.get('modules', []):
            module['image_url'] = None  # images are generated per module via /generate-module-image (Cloudflare)

        share_token = None
        course_id   = None
        if user:
            course_id, share_token = save_course(user['id'], topic, json.dumps(course_data))

        return jsonify({'success': True, 'course': course_data, 'course_id': course_id, 'share_token': share_token})
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Failed to parse course JSON: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# QUIZ
# ============================================================

@app.route('/generate-quiz', methods=['POST'])
def generate_quiz():
    data           = request.json
    topic          = data.get('topic', '')
    module_title   = data.get('module_title', '')
    module_content = data.get('module_content', '')
    difficulty     = data.get('difficulty', 'easy')

    if not GROQ_API_KEY:
        return jsonify({'error': 'GROQ_API_KEY is not set.'}), 500

    difficulty_map = {
        'easy':   'basic recall and understanding — simple factual questions',
        'medium': 'application and analysis — questions requiring deeper understanding',
        'hard':   'synthesis and expert-level reasoning — complex scenario-based questions'
    }
    difficulty_desc = difficulty_map.get(difficulty, 'basic recall')

    prompt = f"""You are an expert quiz creator. Create exactly 10 multiple choice questions.

Topic: {topic}
Module: {module_title}
Difficulty: {difficulty.upper()} — {difficulty_desc}
Content: {module_content[:800]}

Return ONLY a valid JSON array. No markdown. No code fences.

[
  {{
    "id": 1,
    "question": "Question text here?",
    "options": {{"A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D"}},
    "correct": "A",
    "explanation": "Brief reason why this answer is correct"
  }}
]
CRITICAL: Return ONLY the JSON array. Nothing else."""

    quiz_json_str = ''
    try:
        quiz_json_str = call_groq(prompt)
        quiz_json_str = clean_json_string(quiz_json_str)
        if not quiz_json_str:
            return jsonify({'error': 'Groq returned empty quiz response.'}), 500
        quiz_data = parse_json_loose(quiz_json_str)

        for q in quiz_data:
            matches, predicted = validate_question_difficulty(q.get('question', ''), difficulty)
            q['detected_difficulty'] = predicted if predicted else difficulty

        return jsonify({'success': True, 'quiz': quiz_data, 'difficulty': difficulty, 'module': module_title})
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Failed to parse quiz JSON: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# FEEDBACK
# ============================================================

@app.route('/submit-feedback', methods=['POST'])
def submit_feedback():

    data = request.json

    user = get_current_user()

    name = data.get('name', 'Anonymous')
    email_val = data.get('email', '')
    rating = data.get('rating', 5)
    message = data.get('message', '')
    topic = data.get('topic', '')

    if message:
        result = analyze_feedback(message)
        sentiment = result["sentiment"]
        confidence = result["confidence"]
    else:
        sentiment = "Neutral"
        confidence = 50.0

    uid = user['id'] if user else None

    save_feedback(
        uid,
        name,
        email_val,
        topic,
        rating,
        message,
        sentiment
    )

    return jsonify({
        'success': True,
        'sentiment': sentiment,
        'confidence': confidence,
        'message': f'Feedback saved! Sentiment: {sentiment} ({confidence}% confidence)'
    })
@app.route('/api/feedback', methods=['GET'])
def get_feedback():
    user = get_current_user()

    if not user:
        return jsonify({
            'success': True,
            'feedback': []
        })

    feedback = get_user_feedback(user['id'])

    return jsonify({
        'success': True,
        'feedback': feedback
    })


# ============================================================
# YOUTUBE SEARCH
# ============================================================

@app.route('/search-youtube', methods=['POST'])
def search_youtube():
    data  = request.json
    query = data.get('query', '').strip()
    if not query:
        return jsonify({'error': 'Query is required'}), 400
    if not YOUTUBE_API_KEY:
        return jsonify({'error': 'YOUTUBE_API_KEY not set in .env file'}), 500

    import urllib.request, urllib.parse
    params = urllib.parse.urlencode({
        'part': 'snippet', 'q': query, 'type': 'video',
        'maxResults': 8, 'key': YOUTUBE_API_KEY
    })
    url = f'https://www.googleapis.com/youtube/v3/search?{params}'
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = json.loads(resp.read().decode())
        videos = [{
            'id':        item['id']['videoId'],
            'title':     item['snippet']['title'],
            'channel':   item['snippet']['channelTitle'],
            'thumbnail': item['snippet']['thumbnails']['medium']['url']
        } for item in result.get('items', [])]
        return jsonify({'success': True, 'videos': videos})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# VIDEO QUIZ — YouTube captions (youtube-transcript-api) + RAG + Groq
# ============================================================

def fetch_youtube_transcript(video_id):
    """Get the video's captions (manual or auto-generated) - no download, no API key."""
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    try:
        fetched = api.fetch(video_id, languages=['en', 'en-US', 'en-GB', 'en-IN', 'hi'])
    except Exception as e:
        if type(e).__name__ != 'NoTranscriptFound':
            raise
        # no English/Hindi captions: use whatever language the video has
        chosen = None
        for t in api.list(video_id):
            chosen = t
            break
        if chosen is None:
            raise
        fetched = chosen.fetch()
    text = ' '.join(snippet.text for snippet in fetched)
    text = re.sub(r'\[[^\]]*\]', ' ', text)      # drop [Music], [Applause] ...
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def friendly_transcript_error(e):
    name = type(e).__name__
    if name in ('TranscriptsDisabled', 'NoTranscriptFound'):
        return 'This video has no captions available, so a transcript cannot be created. Please pick another video (most educational videos have captions).'
    if name in ('VideoUnavailable', 'VideoUnplayable', 'InvalidVideoId'):
        return 'This video is unavailable. Please pick another video.'
    if name == 'AgeRestricted':
        return 'This video is age-restricted, so captions cannot be fetched. Please pick another video.'
    if name in ('IpBlocked', 'RequestBlocked'):
        return 'YouTube is blocking caption requests from this network right now. Try again later, or from a different network.'
    return f'Could not get the transcript: {str(e)[:200]}'


def pick_relevant_chunks(chunks, video_title, video_id):
    """RAG step: ChromaDB similarity search; falls back to evenly spaced chunks if it is unavailable."""
    try:
        import chromadb
        from chromadb.utils import embedding_functions
        ef              = embedding_functions.DefaultEmbeddingFunction()
        chroma_client   = chromadb.Client()
        collection_name = f'vid_{video_id[:10]}'
        try:
            chroma_client.delete_collection(collection_name)
        except Exception:
            pass
        collection = chroma_client.create_collection(name=collection_name, embedding_function=ef)
        collection.add(documents=chunks, ids=[f'chunk_{i}' for i in range(len(chunks))])
        results = collection.query(
            query_texts=[f'key concepts and important topics about {video_title}'],
            n_results=min(5, len(chunks))
        )
        return ' '.join(results['documents'][0])
    except Exception as e:
        print(f"[VIDEO QUIZ] ChromaDB unavailable ({e}); using evenly spaced transcript chunks instead")
        if len(chunks) <= 3:
            return ' '.join(chunks)
        picks = [chunks[0], chunks[len(chunks) // 2], chunks[-1]]
        return ' '.join(picks)


@app.route('/generate-video-quiz', methods=['POST'])
def generate_video_quiz():
    data        = request.json
    video_id    = data.get('video_id', '').strip()
    video_title = data.get('video_title', 'Video')
    difficulty  = data.get('difficulty', 'easy')

    if not video_id:
        return jsonify({'error': 'video_id is required'}), 400
    if not GROQ_API_KEY:
        return jsonify({'error': 'GROQ_API_KEY not set in .env file'}), 500

    try:
        # STEP 1+2 - captions from YouTube (replaces yt-dlp + AssemblyAI)
        print(f"[VIDEO QUIZ] Fetching captions for video_id={video_id}...")
        try:
            transcript = fetch_youtube_transcript(video_id)
        except ImportError:
            return jsonify({'error': 'youtube-transcript-api is not installed. Run: pip install youtube-transcript-api'}), 500
        except Exception as e:
            print(f"[VIDEO QUIZ] caption error: {type(e).__name__}: {e}")
            return jsonify({'error': friendly_transcript_error(e)}), 400

        if not transcript or not transcript.strip():
            return jsonify({'error': 'Transcript was empty - this video may have no speech.'}), 400
        print(f"[VIDEO QUIZ] Transcript ready: {len(transcript)} chars")

        # STEP 3 - chunk + RAG
        chunk_size = 400
        words      = transcript.split()
        chunks     = [' '.join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size)]
        relevant_chunks = pick_relevant_chunks(chunks, video_title, video_id)

        # STEP 4 - generate MCQ quiz with Groq
        difficulty_map = {
            'easy':   'basic recall and understanding - simple factual questions',
            'medium': 'application and analysis - questions requiring deeper understanding',
            'hard':   'synthesis and expert-level reasoning - complex scenario-based questions'
        }
        difficulty_desc = difficulty_map.get(difficulty, 'basic recall')

        prompt = f"""You are an expert quiz creator. Create exactly 10 multiple choice questions.

Topic: {video_title}
Difficulty: {difficulty.upper()} - {difficulty_desc}
Content from video transcript (via RAG):
{relevant_chunks[:2500]}

Return ONLY a valid JSON array. No markdown. No code fences. No explanation.
Never use double quotes inside text values (use single quotes instead).

[
  {{
    "id": 1,
    "question": "Question text here?",
    "options": {{"A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D"}},
    "correct": "A",
    "explanation": "Brief reason why this answer is correct"
  }}
]
CRITICAL: Return ONLY the JSON array. Nothing else."""

        quiz_data = None
        last_err  = None
        for attempt in range(2):
            raw = call_groq(prompt, max_tokens=3000 if attempt == 0 else 4000)
            try:
                quiz_data = parse_json_loose(raw)
                if isinstance(quiz_data, dict):
                    quiz_data = quiz_data.get('quiz') or quiz_data.get('questions') or []
                if not quiz_data:
                    raise ValueError('no questions returned')
                break
            except (json.JSONDecodeError, ValueError) as e:
                last_err = e
                print(f"[VIDEO QUIZ] quiz parse failed (attempt {attempt + 1}): {e}")
        if not quiz_data:
            return jsonify({'error': f'Failed to parse quiz JSON: {last_err}'}), 500

        for q in quiz_data:
            _, predicted = validate_question_difficulty(q.get('question', ''), difficulty)
            if predicted:
                q['detected_difficulty'] = predicted

        return jsonify({
            'success':    True,
            'quiz':       quiz_data,
            'difficulty': difficulty,
            'transcript': transcript
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# MODULE IMAGES — Cloudflare Workers AI (FLUX.1 schnell, free tier)
# ============================================================

@app.route('/generate-module-image', methods=['POST'])
def generate_module_image():
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        return jsonify({'error': 'CF_ACCOUNT_ID / CF_API_TOKEN are not set in your .env file.'}), 500

    data   = request.json or {}
    prompt = (data.get('prompt') or '').strip()[:500]
    if not prompt:
        return jsonify({'error': 'prompt is required'}), 400

    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}
    try:
        resp = None
        for attempt in range(2):
            resp = req.post(url, headers=headers, json={"prompt": prompt, "steps": 4}, timeout=90)
            if resp.status_code == 429 and attempt == 0:
                time.sleep(4)
                continue
            break
        if not resp.ok:
            return jsonify({'error': f'Cloudflare error {resp.status_code}: {resp.text[:200]}'}), 502
        b64 = (resp.json().get('result') or {}).get('image')
        if not b64:
            return jsonify({'error': 'Cloudflare returned no image.'}), 502
        return jsonify({'success': True, 'image': f'data:image/jpeg;base64,{b64}'})
    except Exception as e:
        return jsonify({'error': f'Image generation failed: {str(e)}'}), 500


# ============================================================
# IMAGE CHAT — ORIGINAL VISION MODEL (NO RAG)
# ============================================================

def extract_pdf_text(raw, limit=6000):
    """Read text from a PDF. Returns None if no PDF library is installed."""
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
    except ImportError:
        return None
    import io
    try:
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:
        return f"[Could not read this PDF: {e}]"
    text = re.sub(r"\s+\n", "\n", text).strip()
    if not text:
        return "[This PDF has no readable text (it may be a scan). Upload its pages as images instead.]"
    return text[:limit]


def call_vision(messages):
    """Call the Groq vision model with retries for rate limits and unsupported options."""
    use_effort = True
    last_err   = "unknown error"
    for attempt in range(3):
        try:
            kwargs = dict(model=VISION_MODEL, messages=messages, temperature=0.5, max_tokens=2048)
            if use_effort:
                kwargs["extra_body"] = {"reasoning_effort": "none"}   # answer directly, no long thinking
            resp = client.chat.completions.create(**kwargs)
            text = resp.choices[0].message.content or ""
            text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
            if not text:
                raise ValueError("The model returned an empty answer.")
            return text
        except Exception as e:
            msg      = str(e)
            low      = msg.lower()
            last_err = msg
            if use_effort and "reasoning" in low and "429" not in low:
                use_effort = False
                continue
            if "429" in msg or "rate_limit" in low or "rate limit" in low:
                if "per day" in low:
                    raise RuntimeError("Groq daily limit reached. Try again later.")
                m    = re.search(r"try again in ([\d.]+)\s*(ms|s)", msg)
                wait = 15.0
                if m:
                    wait = float(m.group(1)) / (1000.0 if m.group(2) == "ms" else 1.0) + 1.5
                time.sleep(min(max(wait, 2.0), 45.0))
                continue
            raise
    raise RuntimeError(f"Rate limit still active after retries: {last_err[:200]}")


@app.route('/image-chat', methods=['POST'])
def image_chat():
    if not GROQ_API_KEY:
        return jsonify({'error': 'GROQ_API_KEY not set in .env file'}), 500

    message     = request.form.get('message', '').strip()
    history_raw = request.form.get('history', '[]')
    try:
        history = json.loads(history_raw)
    except Exception:
        history = []

    uploaded_files = request.files.getlist('files[]')
    user_content   = []

    image_count = 0
    for f in uploaded_files:
        raw  = f.read()
        mime = f.mimetype or mimetypes.guess_type(f.filename)[0] or 'image/jpeg'
        if mime == 'application/pdf' or (f.filename or '').lower().endswith('.pdf'):
            pdf_text = extract_pdf_text(raw)
            if pdf_text is None:
                return jsonify({'error': 'PDF reading needs the pypdf package. Run: python -m pip install pypdf'}), 500
            user_content.append({
                "type": "text",
                "text": f"[Attached PDF: {f.filename}]\n{pdf_text}"
            })
            continue
        image_count += 1
        if image_count > 5:                      # the model accepts at most 5 images per request
            continue
        b64 = base64.b64encode(raw).decode('utf-8')
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"}
        })

    if message:
        user_content.append({"type": "text", "text": message})
    elif not uploaded_files:
        return jsonify({'error': 'No message or files provided'}), 400

    system_prompt = (
        "You are a smart study assistant. The user will upload images or PDFs of textbook pages, "
        "handwritten notes, or diagrams. Your job is to carefully read and understand all uploaded content, "
        "then answer the user's questions based ONLY on that content. "
        "Be clear, concise, and educational. If something is a diagram, describe what it shows. "
        "If the user asks for questions, generate thoughtful study questions with answers. "
        "Always base your responses on what is visible in the uploaded files."
    )

    messages = [{"role": "system", "content": system_prompt}]
    for turn in history:
        role = turn.get('role', 'user')
        text = turn.get('text', '')
        if role in ('user', 'assistant') and text:
            messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": user_content})

    try:
        answer = call_vision(messages)
        return jsonify({'success': True, 'answer': answer})
    except Exception as e:
        return jsonify({'error': f'Vision API error: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=False, port=5000, use_reloader=False)