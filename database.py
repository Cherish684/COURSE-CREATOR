import sqlite3
import hashlib
import os
import uuid

DB_PATH = 'courseforge.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        language TEXT DEFAULT 'English',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        topic TEXT NOT NULL,
        course_data TEXT NOT NULL,
        share_token TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS quiz_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        course_id INTEGER,
        module_title TEXT,
        score INTEGER,
        total INTEGER,
        difficulty TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        email TEXT,
        topic TEXT,
        rating INTEGER,
        message TEXT,
        sentiment TEXT DEFAULT 'Neutral',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS engagement_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        course_id INTEGER,
        module_title TEXT,
        total_time INTEGER DEFAULT 0,
        distracted_time INTEGER DEFAULT 0,
        focus_score INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')

    conn.commit()
    conn.close()

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def create_user(name, email, password):
    conn = get_db()
    try:
        conn.execute(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            (name, email, hash_password(password))
        )
        conn.commit()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        return dict(user)
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def get_user_by_email(email):
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    return dict(user) if user else None

def verify_user(email, password):
    user = get_user_by_email(email)
    if user and user['password_hash'] == hash_password(password):
        return user
    return None

def save_course(user_id, topic, course_data_json):
    share_token = str(uuid.uuid4()).replace('-', '')[:16]
    conn = get_db()
    cursor = conn.execute(
        'INSERT INTO courses (user_id, topic, course_data, share_token) VALUES (?, ?, ?, ?)',
        (user_id, topic, course_data_json, share_token)
    )
    course_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return course_id, share_token

def get_user_courses(user_id):
    conn = get_db()
    courses = conn.execute(
        'SELECT id, topic, share_token, created_at FROM courses WHERE user_id = ? ORDER BY created_at DESC',
        (user_id,)
    ).fetchall()
    conn.close()
    return [dict(c) for c in courses]

def get_course_by_token(token):
    conn = get_db()
    course = conn.execute('SELECT * FROM courses WHERE share_token = ?', (token,)).fetchone()
    conn.close()
    return dict(course) if course else None

def get_course_by_id(course_id):
    conn = get_db()
    course = conn.execute('SELECT * FROM courses WHERE id = ?', (course_id,)).fetchone()
    conn.close()
    return dict(course) if course else None

def save_feedback(user_id, name, email, topic, rating, message, sentiment):
    conn = get_db()
    conn.execute(
        'INSERT INTO feedback (user_id, name, email, topic, rating, message, sentiment) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (user_id, name, email, topic, rating, message, sentiment)
    )
    conn.commit()
    conn.close()

def get_user_feedback(user_id):
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC',
        (user_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_engagement(user_id, course_id, module_title, total_time, distracted_time, focus_score):
    conn = get_db()
    conn.execute(
        'INSERT INTO engagement_sessions (user_id, course_id, module_title, total_time, distracted_time, focus_score) VALUES (?, ?, ?, ?, ?, ?)',
        (user_id, course_id, module_title, total_time, distracted_time, focus_score)
    )
    conn.commit()
    conn.close()

def get_user_engagement(user_id):
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM engagement_sessions WHERE user_id = ? ORDER BY created_at DESC',
        (user_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_user_language(user_id, language):
    conn = get_db()
    conn.execute('UPDATE users SET language = ? WHERE id = ?', (language, user_id))
    conn.commit()
    conn.close()

def save_quiz_attempt(user_id, course_id, module_title, score, total, difficulty):
    conn = get_db()
    conn.execute(
        'INSERT INTO quiz_attempts (user_id, course_id, module_title, score, total, difficulty) VALUES (?, ?, ?, ?, ?, ?)',
        (user_id, course_id, module_title, score, total, difficulty)
    )
    conn.commit()
    conn.close()