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
4. Update `config/classroom.config.json` if the OAuth JSON file is stored somewhere else.
5. Install or reload this plugin in Codex.

## First Authorization

Ask Codex:

```text
ใช้ Classroom Assistant เชื่อม Google Classroom
```

The plugin should call `classroom_start_auth` and return a Google authorization URL. Open it, approve access, then ask Codex to finish the authorization.

## Security Note

Do not commit or share OAuth credential JSON files or generated token files. The generated token is stored at `config/classroom-token.json`.
