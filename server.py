#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "latex-online.sqlite3"
DEFAULT_DOCUMENT_TITLE = "Untitled document"
SESSION_COOKIE_NAME = "latex_online_session"
SESSION_DURATION = timedelta(days=30)
PASSWORD_ITERATIONS = 200_000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_now_datetime() -> datetime:
    return datetime.now(timezone.utc)


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def normalize_title(value: object) -> str:
    title = str(value or "").strip()
    return title or DEFAULT_DOCUMENT_TITLE


def normalize_username(value: object) -> str:
    username = str(value or "").strip()
    return username


def validate_username(username: str) -> None:
    if len(username) < 3:
        raise ValueError("Username must be at least 3 characters.")
    if len(username) > 40:
        raise ValueError("Username must be 40 characters or fewer.")
    if any(character.isspace() for character in username):
        raise ValueError("Username cannot contain spaces.")


def validate_password(password: str) -> None:
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PASSWORD_ITERATIONS}"
        f"${salt.hex()}${password_hash.hex()}"
    )


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False

    try:
        algorithm, iterations_value, salt_hex, hash_hex = stored_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_value)
        salt = bytes.fromhex(salt_hex)
        expected_hash = bytes.fromhex(hash_hex)
    except ValueError:
        return False

    actual_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(actual_hash, expected_hash)


def ensure_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            create table if not exists users (
              id text primary key,
              google_sub text unique,
              email text,
              name text,
              picture_url text,
              username text unique,
              password_hash text,
              created_at text not null,
              updated_at text not null
            )
            """
        )
        user_columns = {
            row[1]
            for row in connection.execute("pragma table_info(users)").fetchall()
        }
        if "username" not in user_columns:
            connection.execute("alter table users add column username text")
        if "password_hash" not in user_columns:
            connection.execute("alter table users add column password_hash text")
        if "google_sub" not in user_columns:
            connection.execute("alter table users add column google_sub text")
        if "email" not in user_columns:
            connection.execute("alter table users add column email text")
        if "name" not in user_columns:
            connection.execute("alter table users add column name text")
        if "picture_url" not in user_columns:
            connection.execute("alter table users add column picture_url text")
        connection.execute(
            """
            create unique index if not exists users_username_idx
            on users(username)
            where username is not null
            """
        )

        connection.execute(
            """
            create table if not exists sessions (
              id text primary key,
              user_id text not null,
              created_at text not null,
              updated_at text not null,
              expires_at text not null,
              foreign key(user_id) references users(id)
            )
            """
        )
        connection.execute(
            """
            create table if not exists documents (
              id text primary key,
              owner_user_id text,
              title text not null,
              latex_source text not null,
              page_settings_json text not null,
              created_at text not null,
              updated_at text not null,
              foreign key(owner_user_id) references users(id)
            )
            """
        )

        document_columns = {
            row[1]
            for row in connection.execute("pragma table_info(documents)").fetchall()
        }
        if "owner_user_id" not in document_columns:
            connection.execute(
                "alter table documents add column owner_user_id text references users(id)"
            )

        connection.execute(
            """
            create index if not exists documents_owner_updated_idx
            on documents(owner_user_id, updated_at desc)
            """
        )
        connection.execute(
            """
            create index if not exists sessions_user_expires_idx
            on sessions(user_id, expires_at)
            """
        )


def open_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def row_to_user(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None

    username = row["username"] or "user"
    return {
        "id": row["id"],
        "username": username,
        "name": username,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_to_meta(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "ownerUserId": row["owner_user_id"],
        "title": row["title"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_to_document(row: sqlite3.Row) -> dict[str, Any]:
    return {
        **row_to_meta(row),
        "latexSource": row["latex_source"],
        "pageSettings": json.loads(row["page_settings_json"]),
    }


@dataclass
class AuthContext:
    user: dict[str, Any]
    session_id: str


class AppRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/auth/state":
            self.handle_get_auth_state()
            return
        if parsed.path == "/api/documents":
            self.handle_list_documents()
            return
        if parsed.path.startswith("/api/documents/"):
            self.handle_get_document(parsed.path)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/auth/register":
            self.handle_register()
            return
        if parsed.path == "/api/auth/login":
            self.handle_login()
            return
        if parsed.path == "/api/auth/logout":
            self.handle_sign_out()
            return
        if parsed.path == "/api/documents":
            self.handle_create_document()
            return
        self.send_error(404, "Not found")

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/documents/"):
            self.handle_update_document(parsed.path)
            return
        self.send_error(404, "Not found")

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        if not raw_body:
            return {}

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be valid JSON.") from error

        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")

        return payload

    def send_json(
        self,
        status_code: int,
        payload: dict[str, Any],
        *,
        headers: list[tuple[str, str]] | None = None,
    ) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        for header_name, header_value in headers or []:
            self.send_header(header_name, header_value)
        self.end_headers()
        self.wfile.write(encoded)

    def send_api_error(self, status_code: int, message: str) -> None:
        self.send_json(status_code, {"error": message})

    def build_session_cookie(self, value: str, *, expires_at: str | None) -> str:
        cookie = SimpleCookie()
        cookie[SESSION_COOKIE_NAME] = value
        cookie[SESSION_COOKIE_NAME]["path"] = "/"
        cookie[SESSION_COOKIE_NAME]["httponly"] = True
        cookie[SESSION_COOKIE_NAME]["samesite"] = "Lax"
        if expires_at:
            expires_dt = parse_datetime(expires_at)
            max_age = 0
            if expires_dt is not None:
                max_age = max(0, int((expires_dt - utc_now_datetime()).total_seconds()))
                cookie[SESSION_COOKIE_NAME]["expires"] = expires_dt.strftime(
                    "%a, %d %b %Y %H:%M:%S GMT"
                )
            cookie[SESSION_COOKIE_NAME]["max-age"] = max_age
        else:
            cookie[SESSION_COOKIE_NAME]["expires"] = "Thu, 01 Jan 1970 00:00:00 GMT"
            cookie[SESSION_COOKIE_NAME]["max-age"] = 0

        return cookie.output(header="", sep="").strip()

    def get_session_cookie_value(self) -> str | None:
        raw_cookie = self.headers.get("Cookie")
        if not raw_cookie:
            return None

        cookie = SimpleCookie()
        cookie.load(raw_cookie)
        morsel = cookie.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else None

    def get_auth_state_payload(
        self,
        auth_context: AuthContext | None,
    ) -> dict[str, Any]:
        user = auth_context.user if auth_context else None
        status = (
            f"Signed in as {user['username']}."
            if user
            else "Sign in to access cloud documents."
        )
        return {
            "configured": True,
            "user": user,
            "status": status,
        }

    def get_auth_context(self, connection: sqlite3.Connection) -> AuthContext | None:
        session_id = self.get_session_cookie_value()
        if not session_id:
            return None

        row = connection.execute(
            """
            select
              sessions.id as session_id,
              sessions.expires_at as session_expires_at,
              users.id,
              users.username,
              users.created_at,
              users.updated_at
            from sessions
            join users on users.id = sessions.user_id
            where sessions.id = ?
            """,
            (session_id,),
        ).fetchone()

        if row is None:
            return None

        expires_at = parse_datetime(row["session_expires_at"])
        if expires_at is None or expires_at <= utc_now_datetime():
            connection.execute("delete from sessions where id = ?", (session_id,))
            return None

        connection.execute(
            "update sessions set updated_at = ? where id = ?",
            (utc_now(), session_id),
        )

        return AuthContext(
          user=row_to_user(row),
          session_id=session_id,
        )

    def require_auth(self, connection: sqlite3.Connection) -> AuthContext:
        auth_context = self.get_auth_context(connection)
        if auth_context is None:
            raise PermissionError("Sign in to access cloud documents.")
        return auth_context

    def create_session(self, connection: sqlite3.Connection, user_id: str) -> tuple[str, str]:
        now = utc_now_datetime()
        expires_at = now + SESSION_DURATION
        session_id = secrets.token_urlsafe(32)
        connection.execute(
            """
            insert into sessions(id, user_id, created_at, updated_at, expires_at)
            values (?, ?, ?, ?, ?)
            """,
            (
                session_id,
                user_id,
                now.isoformat(),
                now.isoformat(),
                expires_at.isoformat(),
            ),
        )
        return session_id, expires_at.isoformat()

    def get_user_by_username(
        self,
        connection: sqlite3.Connection,
        username: str,
    ) -> sqlite3.Row | None:
        return connection.execute(
            """
            select id, username, password_hash, created_at, updated_at
            from users
            where username = ?
            """,
            (username,),
        ).fetchone()

    def handle_get_auth_state(self) -> None:
        with open_database() as connection:
            auth_context = self.get_auth_context(connection)
            payload = self.get_auth_state_payload(auth_context)

        self.send_json(200, payload)

    def handle_register(self) -> None:
        try:
            payload = self.read_json_body()
            username = normalize_username(payload.get("username"))
            password = str(payload.get("password") or "")
            validate_username(username)
            validate_password(password)
        except ValueError as error:
            self.send_api_error(400, str(error))
            return

        with open_database() as connection:
            existing_user = self.get_user_by_username(connection, username)
            if existing_user is not None:
                self.send_api_error(409, "That username is already taken.")
                return

            now = utc_now()
            user_id = str(uuid4())
            connection.execute(
                """
                insert into users(
                  id,
                  google_sub,
                  email,
                  name,
                  picture_url,
                  username,
                  password_hash,
                  created_at,
                  updated_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    f"local:{username}",
                    f"{username}@local",
                    username,
                    None,
                    username,
                    hash_password(password),
                    now,
                    now,
                ),
            )
            row = connection.execute(
                """
                select id, username, created_at, updated_at
                from users
                where id = ?
                """,
                (user_id,),
            ).fetchone()
            user = row_to_user(row)
            session_id, expires_at = self.create_session(connection, user_id)

        self.send_json(
            201,
            self.get_auth_state_payload(AuthContext(user=user, session_id=session_id)),
            headers=[
                ("Set-Cookie", self.build_session_cookie(session_id, expires_at=expires_at))
            ],
        )

    def handle_login(self) -> None:
        try:
            payload = self.read_json_body()
            username = normalize_username(payload.get("username"))
            password = str(payload.get("password") or "")
        except ValueError as error:
            self.send_api_error(400, str(error))
            return

        if not username or not password:
            self.send_api_error(400, "Username and password are required.")
            return

        with open_database() as connection:
            row = self.get_user_by_username(connection, username)
            if row is None or not verify_password(password, row["password_hash"]):
                self.send_api_error(401, "Invalid username or password.")
                return

            user = row_to_user(row)
            session_id, expires_at = self.create_session(connection, row["id"])

        self.send_json(
            200,
            self.get_auth_state_payload(AuthContext(user=user, session_id=session_id)),
            headers=[
                ("Set-Cookie", self.build_session_cookie(session_id, expires_at=expires_at))
            ],
        )

    def handle_sign_out(self) -> None:
        session_id = self.get_session_cookie_value()

        with open_database() as connection:
            if session_id:
                connection.execute("delete from sessions where id = ?", (session_id,))
            response_payload = self.get_auth_state_payload(None)

        self.send_json(
            200,
            response_payload,
            headers=[("Set-Cookie", self.build_session_cookie("", expires_at=None))],
        )

    def handle_list_documents(self) -> None:
        with open_database() as connection:
            try:
                auth_context = self.require_auth(connection)
            except PermissionError as error:
                self.send_api_error(401, str(error))
                return

            rows = connection.execute(
                """
                select id, owner_user_id, title, created_at, updated_at
                from documents
                where owner_user_id = ?
                order by updated_at desc, created_at desc
                """,
                (auth_context.user["id"],),
            ).fetchall()

        self.send_json(200, {"documents": [row_to_meta(row) for row in rows]})

    def handle_get_document(self, path: str) -> None:
        document_id = unquote(path.rsplit("/", 1)[-1])

        with open_database() as connection:
            try:
                auth_context = self.require_auth(connection)
            except PermissionError as error:
                self.send_api_error(401, str(error))
                return

            row = connection.execute(
                """
                select id, owner_user_id, title, latex_source, page_settings_json, created_at, updated_at
                from documents
                where id = ? and owner_user_id = ?
                """,
                (document_id, auth_context.user["id"]),
            ).fetchone()

        if row is None:
            self.send_api_error(404, "Document not found.")
            return

        self.send_json(200, {"document": row_to_document(row)})

    def handle_create_document(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as error:
            self.send_api_error(400, str(error))
            return

        with open_database() as connection:
            try:
                auth_context = self.require_auth(connection)
            except PermissionError as error:
                self.send_api_error(401, str(error))
                return

            now = utc_now()
            document_id = str(uuid4())
            title = normalize_title(payload.get("title"))
            latex_source = str(payload.get("latexSource", ""))
            page_settings = payload.get("pageSettings", {})

            connection.execute(
                """
                insert into documents (
                  id,
                  owner_user_id,
                  title,
                  latex_source,
                  page_settings_json,
                  created_at,
                  updated_at
                ) values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    auth_context.user["id"],
                    title,
                    latex_source,
                    json.dumps(page_settings),
                    now,
                    now,
                ),
            )
            row = connection.execute(
                """
                select id, owner_user_id, title, latex_source, page_settings_json, created_at, updated_at
                from documents
                where id = ?
                """,
                (document_id,),
            ).fetchone()

        self.send_json(201, {"document": row_to_document(row)})

    def handle_update_document(self, path: str) -> None:
        document_id = unquote(path.rsplit("/", 1)[-1])

        try:
            payload = self.read_json_body()
        except ValueError as error:
            self.send_api_error(400, str(error))
            return

        with open_database() as connection:
            try:
                auth_context = self.require_auth(connection)
            except PermissionError as error:
                self.send_api_error(401, str(error))
                return

            existing_row = connection.execute(
                """
                select id, owner_user_id, title, latex_source, page_settings_json, created_at, updated_at
                from documents
                where id = ? and owner_user_id = ?
                """,
                (document_id, auth_context.user["id"]),
            ).fetchone()

            if existing_row is None:
                self.send_api_error(404, "Document not found.")
                return

            title = normalize_title(payload.get("title", existing_row["title"]))
            latex_source = str(payload.get("latexSource", existing_row["latex_source"]))
            page_settings = payload.get(
                "pageSettings",
                json.loads(existing_row["page_settings_json"]),
            )
            updated_at = utc_now()

            connection.execute(
                """
                update documents
                set title = ?, latex_source = ?, page_settings_json = ?, updated_at = ?
                where id = ? and owner_user_id = ?
                """,
                (
                    title,
                    latex_source,
                    json.dumps(page_settings),
                    updated_at,
                    document_id,
                    auth_context.user["id"],
                ),
            )
            row = connection.execute(
                """
                select id, owner_user_id, title, latex_source, page_settings_json, created_at, updated_at
                from documents
                where id = ?
                """,
                (document_id,),
            ).fetchone()

        self.send_json(200, {"document": row_to_document(row)})


def main() -> None:
    ensure_database()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    server = ThreadingHTTPServer(("127.0.0.1", port), AppRequestHandler)
    print(f"Serving Latex Online at http://127.0.0.1:{port}/")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received, exiting.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
