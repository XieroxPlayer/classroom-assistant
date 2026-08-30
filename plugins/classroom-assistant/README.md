# Classroom Assistant

Local Codex plugin for connecting chat to Google Classroom.

## What It Can Fetch

- Active Classroom courses.
- Published coursework and due dates.
- Classroom teaching materials.
- Attachment titles and links where the Classroom API returns them.

## Setup

1. Enable the Google Classroom API in Google Cloud Console.
2. Create an OAuth client ID for a Desktop app.
3. Download the OAuth JSON file.
4. Store it as `~/.classroom-assistant/credentials.json`. On Windows, `~` is your user profile folder.
   You can override this with `CLASSROOM_CREDENTIALS_PATH`; use `CLASSROOM_TOKEN_PATH` to override
   the generated token location.
5. Install or reload this plugin in Codex.

## First Authorization

Ask Codex:

```text
ใช้ Classroom Assistant เชื่อม Google Classroom
```

The plugin should call `classroom_start_auth` and return a Google authorization URL. Open it, approve access, then ask Codex to finish the authorization.

## Security Note

Do not commit or share OAuth credential JSON files or generated token files. By default, the generated
token is stored at `~/.classroom-assistant/classroom-token.json`.
