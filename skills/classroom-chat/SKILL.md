---
name: classroom-chat
description: Use when the user wants to check classroom assignments, due dates, missing work, course materials, teacher-provided files, or ask about class tasks through chat. This skill expects classroom data from a connected Classroom tool, exported files, screenshots, pasted course data, or uploaded teaching materials.
---

# Classroom Chat

## Purpose

Help the user use chat as a practical classroom dashboard. Prioritize:

- Assignments and due dates.
- Missing, late, submitted, returned, or graded work.
- Files and learning materials shared by instructors.
- Clear next actions by course and deadline.

## Data Requirements

Do not invent classroom state. Use only data from one of these sources:

- The `classroom-assistant` MCP tools when they are available in the current session.
- Uploaded or local exported Classroom files.
- Screenshots, PDFs, docs, slides, spreadsheets, or pasted text from the class.
- User-provided course names, due dates, and attachment links.

If no classroom data is available, ask the user to connect or provide one of those sources.

## Google Classroom Tools

When the `classroom-assistant` MCP server is available:

- Use `classroom_status` first to check whether OAuth is configured.
- If it is not authorized, use `classroom_start_auth` and give the user the returned authorization URL.
- After the user approves access in the browser, use `classroom_finish_auth` with the returned state.
- Use `classroom_get_overview` to fetch courses and coursework.
- Use `classroom_get_materials` to fetch teaching files and attachments.

## Workflow

1. Identify the relevant course, date range, and task type.
2. Extract each item with course, title, due date, status, attachments, and teacher notes.
3. Sort active work by urgency: overdue first, then due today, then upcoming.
4. Group teaching files by course and class topic when possible.
5. Surface missing information such as unclear deadlines or inaccessible files.
6. End with a concise action list the user can follow.

## Response Style

- Use Thai by default when the user writes in Thai.
- Keep summaries short and task-focused.
- Use exact dates and times when available.
- Mark uncertain or missing data clearly.
- Separate "งานที่ต้องส่ง" from "ไฟล์การสอน" when both are present.

## Useful Prompts

- "เช็คงานที่ต้องส่งสัปดาห์นี้"
- "ดูว่ามีงานไหนเลยกำหนดแล้วบ้าง"
- "สรุปไฟล์ที่อาจารย์ส่งมาในวิชาเคมี"
- "เรียงงานตามวันที่ต้องส่งให้หน่อย"
