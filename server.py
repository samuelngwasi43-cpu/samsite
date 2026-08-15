import hashlib
import json
import mimetypes
import os
import secrets
import sqlite3
import io
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "school.db")


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_user_columns(conn):
    columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    if "profile_photo_url" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN profile_photo_url TEXT")
    if "bio" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN bio TEXT")
    if "phone" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN phone TEXT")
    if "matricule" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN matricule TEXT")
    if "plain_password" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN plain_password TEXT")


def generate_matricule(conn):
    while True:
        candidate = f"MAT{datetime.utcnow().strftime('%y%m%d%H%M%S')}{secrets.randbelow(1000):03d}"
        existing = conn.execute("SELECT 1 FROM users WHERE matricule = ?", (candidate,)).fetchone()
        if existing is None:
            return candidate


def ensure_schema(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS bulletins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            class_name TEXT NOT NULL,
            period TEXT NOT NULL,
            average REAL NOT NULL,
            comment TEXT NOT NULL,
            file_url TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        """
    )


def init_db():
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                class_name TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                profile_photo_url TEXT,
                bio TEXT,
                phone TEXT,
                matricule TEXT
            );

            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                class_name TEXT NOT NULL,
                teacher_id INTEGER NOT NULL,
                coefficient REAL NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS grades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                course_id INTEGER NOT NULL,
                homework REAL NOT NULL,
                exam REAL NOT NULL,
                semester TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS enrollments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                course_id INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                published INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        ensure_user_columns(conn)
        ensure_schema(conn)
        # audit logs
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_id INTEGER,
                action TEXT NOT NULL,
                details TEXT,
                created_at TEXT NOT NULL
            );
            """
        )
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count == 0:
            conn.executemany(
                """
                INSERT INTO users (name, email, password_hash, role, class_name, status, matricule, plain_password)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("Samuel", "samuel@gmail.com", hash_password("Etude@2026"), "ADMIN", "", "active", "", "Etude@2026"),
                    ("M. Diallo", "prof@ecole.fr", hash_password("Prof@2026"), "PROFESSOR", "Terminale A", "active", "", "Prof@2026"),
                    ("Aïcha Ndiaye", "aicha@ecole.fr", hash_password("Eleve@2026"), "STUDENT", "Terminale A", "active", "AICHA001", "Eleve@2026"),
                    ("Kader Fall", "kader@ecole.fr", hash_password("Eleve@2026"), "STUDENT", "Terminale B", "active", "KADER001", "Eleve@2026"),
                ],
            )
            now = datetime.utcnow().isoformat()
            conn.executemany(
                """
                INSERT INTO courses (title, class_name, teacher_id, coefficient, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    ("Mathématiques", "Terminale A", 2, 1.0, now),
                    ("Physique-Chimie", "Terminale A", 2, 1.0, now),
                    ("Histoire", "Terminale B", 2, 1.0, now),
                ],
            )
            conn.executemany(
                """
                INSERT INTO grades (student_id, course_id, homework, exam, semester, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (3, 1, 14.0, 16.0, "Semestre 1", now),
                    (3, 2, 12.0, 15.0, "Semestre 1", now),
                    (4, 1, 10.0, 12.0, "Semestre 1", now),
                ],
            )
            conn.executemany(
                """
                INSERT INTO announcements (title, body, published, created_at)
                VALUES (?, ?, ?, ?)
                """,
                [
                    ("Nouveau calendrier", "Le planning du trimestre est disponible.", 1, now),
                    ("Réunion des parents", "La réunion est prévue le mardi prochain.", 1, now),
                ],
            )


def get_dashboard_data(conn, viewer_role="STUDENT"):
    users = []
    for row in conn.execute("SELECT id, name, email, role, class_name, status, profile_photo_url, bio, phone, matricule, plain_password FROM users ORDER BY id"):
        u = dict(row)
        # N'exposer plain_password qu'à l'admin
        if viewer_role != "ADMIN":
            u.pop("plain_password", None)
        users.append(u)
    courses = [dict(row) for row in conn.execute("SELECT * FROM courses ORDER BY id")]
    grades = [dict(row) for row in conn.execute("SELECT * FROM grades ORDER BY id")]
    announcements = [dict(row) for row in conn.execute("SELECT * FROM announcements ORDER BY id DESC")]
    meetings = [dict(row) for row in conn.execute("SELECT * FROM meetings ORDER BY id DESC")]
    bulletins = [dict(row) for row in conn.execute("SELECT * FROM bulletins ORDER BY id DESC")]
    return {"users": users, "courses": courses, "grades": grades, "announcements": announcements, "meetings": meetings, "bulletins": bulletins}


def get_user_by_token(conn, token):
    row = conn.execute(
        "SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ?",
        (token,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def log_action(conn, actor_id, action, details=''):
    conn.execute(
        "INSERT INTO audit_logs (actor_id, action, details, created_at) VALUES (?, ?, ?, ?)",
        (actor_id, action, details, datetime.utcnow().isoformat()),
    )


class SchoolHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed.path)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed.path, method="POST")
            return
        self._send_json(404, {"error": "not found"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed.path, method="PUT")
            return
        self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed.path, method="DELETE")
            return
        self._send_json(404, {"error": "not found"})

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(body or "{}")

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, path, method="GET"):
        try:
            if path == "/api/health":
                self._send_json(200, {"status": "ok"})
                return

            if path == "/api/login" and method == "POST":
                self.handle_login()
                return

            if path == "/api/register/student" and method == "POST":
                self.handle_register_student()
                return

            if path == "/api/logout" and method == "POST":
                self.handle_logout()
                return

            if path == "/api/me":
                self.handle_me()
                return

            if path == "/api/dashboard":
                self.handle_dashboard()
                return

            if path == "/api/users":
                if method == "GET":
                    self.handle_list_users()
                else:
                    self.handle_create_user()
                return

            if path.startswith("/api/users/"):
                if method == "PUT":
                    self.handle_update_user(path)
                    return
                if method == "DELETE":
                    self.handle_delete_user(path)
                    return

            if path == "/api/courses":
                if method == "GET":
                    self.handle_list_courses()
                else:
                    self.handle_create_course()
                return

            if path.startswith("/api/courses/"):
                if method == "PUT":
                    self.handle_update_course(path)
                    return
                if method == "DELETE":
                    self.handle_delete_course(path)
                    return

            if path == "/api/announcements":
                if method == "GET":
                    self.handle_list_announcements()
                else:
                    self.handle_create_announcement()
                return

            if path == "/api/grades":
                if method == "GET":
                    self.handle_list_grades()
                else:
                    self.handle_create_grade()
                return

            if path == "/api/bulletins":
                if method == "GET":
                    self.handle_list_bulletins()
                else:
                    self.handle_create_bulletin()
                return

            if path == "/api/bulletins/export":
                if method == "GET":
                    self.handle_export_bulletins()
                    return
            if path == "/api/bulletins/export.pdf":
                if method == "GET":
                    self.handle_export_bulletins_pdf()
                    return

            if path == "/api/meetings":
                if method == "GET":
                    self.handle_list_meetings()
                else:
                    self.handle_create_meeting()
                return

            if path == "/api/logs":
                if method == "GET":
                    self.handle_list_logs()
                    return

            if path == "/api/enroll" and method == "POST":
                self.handle_enroll()
                return

            if path.startswith("/api/users/") and path.endswith("/reset_password") and method == "POST":
                self.handle_reset_password(path)
                return

            if path.startswith("/api/bulletin/") and method == "GET":
                # /api/bulletin/<id>/print
                if path.endswith("/print"):
                    self.handle_print_bulletin(path)
                    return

            self._send_json(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": str(exc)})

    def handle_login(self):
        payload = self._read_json_body()
        email = payload.get("email", "")
        password = payload.get("password", "")
        with get_connection() as conn:
            user_row = conn.execute(
                "SELECT * FROM users WHERE email = ? AND password_hash = ?",
                (email, hash_password(password)),
            ).fetchone()
            if user_row is None:
                self._send_json(401, {"error": "identifiants incorrects"})
                return
            token = secrets.token_urlsafe(24)
            conn.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user_row["id"], datetime.utcnow().isoformat()))
            dashboard = get_dashboard_data(conn, user_row["role"])
            self._send_json(200, {"token": token, "user": dict(user_row), "dashboard": dashboard})

    def handle_register_student(self):
        payload = self._read_json_body()
        name = payload.get("name", "").strip()
        email = payload.get("email", "").strip()
        password = payload.get("password", "")
        if not name or not email or not password:
            self._send_json(400, {"error": "nom, email et mot de passe requis"})
            return
        with get_connection() as conn:
            existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing is not None:
                self._send_json(409, {"error": "cet email est déjà utilisé"})
                return
            conn.execute(
                "INSERT INTO users (name, email, password_hash, role, class_name, status, profile_photo_url, bio, phone, matricule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    name,
                    email,
                    hash_password(password),
                    "STUDENT",
                    payload.get("className", ""),
                    "active",
                    payload.get("profilePhoto", ""),
                    payload.get("bio", ""),
                    payload.get("phone", ""),
                    payload.get("matricule") or generate_matricule(conn),
                ),
            )
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, "STUDENT")})

    def handle_logout(self):
        token = self._get_token_from_header()
        if token:
            with get_connection() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self._send_json(200, {"ok": True})

    def handle_me(self):
        token = self._get_token_from_header()
        if not token:
            self._send_json(401, {"error": "non autorisé"})
            return
        with get_connection() as conn:
            user = get_user_by_token(conn, token)
            if user is None:
                self._send_json(401, {"error": "session invalide"})
                return
            dashboard = get_dashboard_data(conn, user["role"])
            self._send_json(200, {"user": user, "dashboard": dashboard})

    def handle_dashboard(self):
        token = self._get_token_from_header()
        if not token:
            self._send_json(401, {"error": "non autorisé"})
            return
        with get_connection() as conn:
            user = get_user_by_token(conn, token)
            if user is None:
                self._send_json(401, {"error": "session invalide"})
                return
            self._send_json(200, get_dashboard_data(conn, user["role"]))

    def handle_list_users(self):
        self._require_auth()
        with get_connection() as conn:
            self._send_json(200, {"users": [dict(row) for row in conn.execute("SELECT * FROM users ORDER BY id")]})

    def handle_create_user(self):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        with get_connection() as conn:
            default_matricule = payload.get("matricule")
            if payload.get("role", "STUDENT") == "STUDENT" and not default_matricule:
                default_matricule = generate_matricule(conn)
            conn.execute(
                "INSERT INTO users (name, email, password_hash, plain_password, role, class_name, status, profile_photo_url, bio, phone, matricule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    payload["name"],
                    payload["email"],
                    hash_password(payload.get("password", "")),
                    payload.get("password", ""),
                    payload.get("role", "STUDENT"),
                    payload.get("className", ""),
                    "active",
                    payload.get("profilePhoto", ""),
                    payload.get("bio", ""),
                    payload.get("phone", ""),
                    default_matricule or "",
                ),
            )
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_update_user(self, path):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        user_id = int(path.rsplit("/", 1)[-1])
        payload = self._read_json_body()
        with get_connection() as conn:
            existing = conn.execute("SELECT profile_photo_url FROM users WHERE id = ?", (user_id,)).fetchone()
            profile_photo_value = existing["profile_photo_url"] if payload.get("profilePhoto") is None else payload.get("profilePhoto", "")
            conn.execute(
                "UPDATE users SET name = ?, email = ?, role = ?, class_name = ?, profile_photo_url = ?, bio = ?, phone = ?"
                + (", password_hash = ?, plain_password = ?" if payload.get('password') else "")
                + " WHERE id = ?",
                tuple(
                    list((
                        payload.get("name", ""),
                        payload.get("email", ""),
                        payload.get("role", "STUDENT"),
                        payload.get("className", ""),
                        profile_photo_value,
                        payload.get("bio", ""),
                        payload.get("phone", ""),
                    ))
                    + ([hash_password(payload["password"]), payload["password"]] if payload.get("password") else [])
                    + [user_id]
                ),
            )
            log_action(conn, user.get("id"), "update_user", f"user:{user_id}")
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_delete_user(self, path):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        user_id = int(path.rsplit("/", 1)[-1])
        with get_connection() as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_list_courses(self):
        self._require_auth()
        with get_connection() as conn:
            self._send_json(200, {"courses": [dict(row) for row in conn.execute("SELECT * FROM courses ORDER BY id")]})

    def handle_create_course(self):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        with get_connection() as conn:
            teacher_id = user["id"] if user["role"] == "PROFESSOR" else int(payload.get("teacherId", 0))
            conn.execute(
                "INSERT INTO courses (title, class_name, teacher_id, coefficient, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    payload["title"],
                    payload["className"],
                    teacher_id,
                    1.0,
                    datetime.utcnow().isoformat(),
                ),
            )
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_update_course(self, path):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        course_id = int(path.rsplit("/", 1)[-1])
        payload = self._read_json_body()
        with get_connection() as conn:
            course = conn.execute("SELECT teacher_id FROM courses WHERE id = ?", (course_id,)).fetchone()
            if course is None:
                self._send_json(404, {"error": "cours introuvable"})
                return
            if user["role"] == "PROFESSOR" and course["teacher_id"] != user["id"]:
                self._send_json(403, {"error": "accès refusé"})
                return
            teacher_id = course["teacher_id"]
            if user["role"] == "ADMIN":
                teacher_id = int(payload.get("teacherId", teacher_id))
            conn.execute(
                "UPDATE courses SET title = ?, class_name = ?, teacher_id = ? WHERE id = ?",
                (
                    payload.get("title", ""),
                    payload.get("className", ""),
                    teacher_id,
                    course_id,
                ),
            )
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_delete_course(self, path):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        course_id = int(path.rsplit("/", 1)[-1])
        with get_connection() as conn:
            course = conn.execute("SELECT teacher_id FROM courses WHERE id = ?", (course_id,)).fetchone()
            if course is None:
                self._send_json(404, {"error": "cours introuvable"})
                return
            if user["role"] == "PROFESSOR" and course["teacher_id"] != user["id"]:
                self._send_json(403, {"error": "accès refusé"})
                return
            conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_list_announcements(self):
        self._require_auth()
        with get_connection() as conn:
            self._send_json(200, {"announcements": [dict(row) for row in conn.execute("SELECT * FROM announcements ORDER BY id DESC")]})

    def handle_create_announcement(self):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO announcements (title, body, published, created_at) VALUES (?, ?, ?, ?)",
                (payload["title"], payload.get("body", ""), 1, datetime.utcnow().isoformat()),
            )
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_list_grades(self):
        self._require_auth()
        with get_connection() as conn:
            self._send_json(200, {"grades": [dict(row) for row in conn.execute("SELECT * FROM grades ORDER BY id")]})

    def handle_list_bulletins(self):
        self._require_auth()
        with get_connection() as conn:
            self._send_json(200, {"bulletins": [dict(row) for row in conn.execute("SELECT * FROM bulletins ORDER BY id DESC")]})

    def handle_export_bulletins(self):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        # optional class filter
        parsed = urlparse(self.path)
        q = parsed.query
        params = dict([part.split("=") for part in q.split("&") if part]) if q else {}
        class_name = params.get("class")
        with get_connection() as conn:
            if class_name:
                rows = conn.execute("SELECT bulletins.*, users.name as student_name, users.email as student_email FROM bulletins LEFT JOIN users ON bulletins.student_id = users.id WHERE bulletins.class_name = ? ORDER BY bulletins.id DESC", (class_name,)).fetchall()
            else:
                rows = conn.execute("SELECT bulletins.*, users.name as student_name, users.email as student_email FROM bulletins LEFT JOIN users ON bulletins.student_id = users.id ORDER BY bulletins.id DESC").fetchall()
            # build CSV
            headers = ["id", "student_id", "student_name", "student_email", "class_name", "period", "average", "comment", "file_url", "created_at"]
            lines = [",".join(headers)]
            for r in rows:
                vals = [str(r[h]) if r[h] is not None else "" for h in headers]
                # escape commas
                vals = [v.replace('"', '""') for v in vals]
                lines.append(
                    ",".join([f'"{v}"' for v in vals])
                )
            body = "\n".join(lines).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition", "attachment; filename=bulletins.csv")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def handle_export_bulletins_pdf(self):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        parsed = urlparse(self.path)
        q = parsed.query
        params = dict([part.split("=") for part in q.split("&") if part]) if q else {}
        class_name = params.get("class")
        with get_connection() as conn:
            if class_name:
                rows = conn.execute("SELECT bulletins.*, users.name as student_name, users.email as student_email FROM bulletins LEFT JOIN users ON bulletins.student_id = users.id WHERE bulletins.class_name = ? ORDER BY bulletins.id DESC", (class_name,)).fetchall()
            else:
                rows = conn.execute("SELECT bulletins.*, users.name as student_name, users.email as student_email FROM bulletins LEFT JOIN users ON bulletins.student_id = users.id ORDER BY bulletins.id DESC").fetchall()
            bulletins = [dict(r) for r in rows]
            pdf_bytes = generate_pdf_bytes(bulletins)
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", "attachment; filename=bulletins.pdf")
            self.send_header("Content-Length", str(len(pdf_bytes)))
            self.end_headers()
            self.wfile.write(pdf_bytes)



    def handle_print_bulletin(self, path):
        # /api/bulletin/<id>/print
        self._require_auth()
        bulletin_id = int(path.split("/")[-2])
        with get_connection() as conn:
            b = conn.execute("SELECT bulletins.*, users.name as student_name FROM bulletins LEFT JOIN users ON bulletins.student_id = users.id WHERE bulletins.id = ?", (bulletin_id,)).fetchone()
            if not b:
                self._send_json(404, {"error": "not found"})
                return
            html = f"""
            <html><head><meta charset='utf-8'><title>Bulletin {b['id']}</title></head><body>
            <h1>Bulletin - {b['student_name']}</h1>
            <p>Classe: {b['class_name']}</p>
            <p>Période: {b['period']}</p>
            <p>Moyenne: {b['average']}</p>
            <p>Commentaire: {b['comment']}</p>
            <p>Date: {b['created_at']}</p>
            </body></html>
            """
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def handle_create_bulletin(self):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        with get_connection() as conn:
            student_id = int(payload["studentId"])
            semester = payload.get("period", "Semestre 1")
            rows = conn.execute("SELECT homework, exam FROM grades WHERE student_id = ? AND semester = ?", (student_id, semester)).fetchall()
            if not rows:
                self._send_json(400, {"error": "Aucune note disponible pour cet élève et cette période."})
                return
            total = 0.0
            for r in rows:
                total += float(r["homework"]) + float(r["exam"])
            average = float(round(total / len(rows), 2))
            student_row = conn.execute("SELECT class_name FROM users WHERE id = ?", (student_id,)).fetchone()
            class_name = student_row["class_name"] if student_row else payload.get("className", "")
            conn.execute(
                "INSERT INTO bulletins (student_id, class_name, period, average, comment, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    student_id,
                    class_name,
                    semester,
                    average,
                    payload.get("comment", "Bulletin automatique généré"),
                    "",
                    datetime.utcnow().isoformat(),
                ),
            )
            log_action(conn, user.get("id"), "create_bulletin", f"student:{student_id} period:{semester} average:{average}")
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_list_meetings(self):
        self._require_auth()
        with get_connection() as conn:
            self._send_json(200, {"meetings": [dict(row) for row in conn.execute("SELECT * FROM meetings ORDER BY id DESC")]})

    def handle_create_meeting(self):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO meetings (title, body, published, created_at) VALUES (?, ?, ?, ?)",
                (payload["title"], payload.get("body", ""), 1, datetime.utcnow().isoformat()),
            )
            log_action(conn, user.get("id"), "create_meeting", payload.get("title", ""))
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_list_logs(self):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT audit_logs.id, audit_logs.actor_id, users.name as actor_name, audit_logs.action, audit_logs.details, audit_logs.created_at FROM audit_logs LEFT JOIN users ON audit_logs.actor_id = users.id ORDER BY audit_logs.id DESC"
            ).fetchall()
            logs = [dict(r) for r in rows]
            self._send_json(200, {"logs": logs})

    def handle_enroll(self):
        user = self._require_auth()
        # only students enroll themselves
        if user["role"] != "STUDENT":
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        course_id = int(payload.get("courseId", 0))
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO enrollments (student_id, course_id, created_at) VALUES (?, ?, ?)",
                (user.get("id"), course_id, datetime.utcnow().isoformat()),
            )
            log_action(conn, user.get("id"), "enroll_course", f"course:{course_id}")
            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def handle_reset_password(self, path):
        user = self._require_auth()
        if user["role"] != "ADMIN":
            self._send_json(403, {"error": "accès refusé"})
            return
        user_id = int(path.rsplit("/", 2)[-2])
        payload = self._read_json_body()
        new_pw = payload.get("password")
        if not new_pw:
            self._send_json(400, {"error": "password required"})
            return
        with get_connection() as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_pw), user_id))
            log_action(conn, user.get("id"), "reset_password", f"user:{user_id}")
            self._send_json(200, {"ok": True, "message": "password reset"})

    def handle_create_grade(self):
        user = self._require_auth()
        if user["role"] not in {"ADMIN", "PROFESSOR"}:
            self._send_json(403, {"error": "accès refusé"})
            return
        payload = self._read_json_body()
        with get_connection() as conn:
            student_id = int(payload["studentId"])
            course_id = int(payload["courseId"])
            homework = float(payload.get("homework", 0))
            exam = float(payload.get("exam", 0))
            if homework < 0 or homework > 8 or exam < 0 or exam > 12:
                self._send_json(400, {"error": "homework doit être entre 0 et 8, exam entre 0 et 12"})
                return
            conn.execute(
                "INSERT INTO grades (student_id, course_id, homework, exam, semester, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    student_id,
                    course_id,
                    homework,
                    exam,
                    payload.get("semester", "Semestre 1"),
                    datetime.utcnow().isoformat(),
                ),
            )
            # log the grade creation
            log_action(conn, user.get("id"), "create_grade", f"student:{payload.get('studentId')} course:{payload.get('courseId')} homework:{payload.get('homework')} exam:{payload.get('exam')}")

            # Recalculate student's global average for the semester and create a bulletin automatically
            student_id = int(payload["studentId"])
            semester = payload.get("semester", "Semestre 1")
            rows = conn.execute("SELECT homework, exam FROM grades WHERE student_id = ? AND semester = ?", (student_id, semester)).fetchall()
            if rows:
                total = 0.0
                for r in rows:
                    hw = float(r["homework"])
                    ex = float(r["exam"])
                    total += (hw + ex)
                avg = total / len(rows)
                # determine class name from student if none provided
                student_row = conn.execute("SELECT class_name FROM users WHERE id = ?", (student_id,)).fetchone()
                class_name = student_row["class_name"] if student_row else payload.get("className", "")
                conn.execute(
                    "INSERT INTO bulletins (student_id, class_name, period, average, comment, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        student_id,
                        class_name,
                        semester,
                        float(round(avg, 2)),
                        payload.get("comment", "Bulletin automatique généré"),
                        "",
                        datetime.utcnow().isoformat(),
                    ),
                )
                log_action(conn, user.get("id"), "auto_create_bulletin", f"student:{student_id} semester:{semester} avg:{avg}")

            self._send_json(200, {"ok": True, "dashboard": get_dashboard_data(conn, user["role"])})

    def _require_auth(self):
        token = self._get_token_from_header()
        if not token:
            self._send_json(401, {"error": "non autorisé"})
            raise RuntimeError("auth required")
        with get_connection() as conn:
            user = get_user_by_token(conn, token)
            if user is None:
                self._send_json(401, {"error": "session invalide"})
                raise RuntimeError("invalid session")
            return user

    def _get_token_from_header(self):
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            return header.split(" ", 1)[1]
        return None

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe_path = path.lstrip("/")
        file_path = os.path.join(BASE_DIR, safe_path)
        if not os.path.exists(file_path) or os.path.isdir(file_path):
            self._send_json(404, {"error": "not found"})
            return
        content_type, _ = mimetypes.guess_type(file_path)
        if content_type is None:
            content_type = "application/octet-stream"
        with open(file_path, "rb") as handle:
            content = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def generate_pdf_bytes(bulletins):
    """Generate a minimal valid PDF listing bulletin records."""
    # Build page content stream
    content_lines = ['BT', '/F1 11 Tf', '1 0 0 1 50 800 Tm', '14 TL']
    title = 'Bulletins scolaires - Samsite'
    title_safe = title.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    content_lines.append(f'/F1 14 Tf ({title_safe}) Tj')
    content_lines.append('T*')
    content_lines.append('/F1 11 Tf')
    for b in bulletins:
        line = (
            f"ID:{b.get('id')} | {b.get('student_name', '')} | "
            f"Classe: {b.get('class_name', '')} | "
            f"Periode: {b.get('period', '')} | "
            f"Moyenne: {b.get('average', '')}/20"
        )
        safe = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        content_lines.append(f'({safe}) Tj T*')
    content_lines.append('ET')
    stream_data = '\n'.join(content_lines).encode('utf-8')

    # PDF objects (1-indexed):
    # 1 = Catalog, 2 = Pages, 3 = Page, 4 = Font, 5 = Content stream
    pdf = io.BytesIO()
    pdf.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')

    offsets = {}

    offsets[1] = pdf.tell()
    pdf.write(b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

    offsets[2] = pdf.tell()
    pdf.write(b'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

    offsets[4] = pdf.tell()
    pdf.write(b'4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n')

    # Content stream object
    offsets[5] = pdf.tell()
    pdf.write(b'5 0 obj\n<< /Length %d >>\nstream\n' % len(stream_data))
    pdf.write(stream_data)
    pdf.write(b'\nendstream\nendobj\n')

    # Page object (references font 4 and content 5)
    offsets[3] = pdf.tell()
    pdf.write(
        b'3 0 obj\n'
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]\n'
        b'   /Resources << /Font << /F1 4 0 R >> >>\n'
        b'   /Contents 5 0 R >>\n'
        b'endobj\n'
    )

    xref_pos = pdf.tell()
    # xref table covers objects 0-5
    num_objects = 6
    pdf.write(b'xref\n0 %d\n' % num_objects)
    pdf.write(b'0000000000 65535 f \n')
    for i in range(1, num_objects):
        pdf.write(b'%010d 00000 n \n' % offsets[i])

    pdf.write(b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (num_objects, xref_pos))
    return pdf.getvalue()


def main():
    init_db()
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), SchoolHandler)
    print(f"Samsite server running on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
