const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const pluginRoot = path.resolve(__dirname, "..");
const configPath = path.join(pluginRoot, "config", "classroom.config.json");
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLASSROOM_API = "https://classroom.googleapis.com/v1";

let inputBuffer = Buffer.alloc(0);
const authSessions = new Map();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
}

function resolvePluginPath(rawPath) {
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(pluginRoot, rawPath);
}

function loadConfig() {
  const config = readJson(configPath);
  return {
    ...config,
    credentialsPath: resolvePluginPath(config.credentialsPath),
    tokenPath: resolvePluginPath(config.tokenPath || "./config/classroom-token.json"),
  };
}

function loadClient(config) {
  const payload = readJson(config.credentialsPath);
  const client = payload.installed || payload.web;
  if (!client || !client.client_id || !client.client_secret) {
    throw new Error("Credential JSON must contain an installed or web OAuth client.");
  }
  return client;
}

function getToken(config) {
  if (!fs.existsSync(config.tokenPath)) return null;
  return readJson(config.tokenPath);
}

function saveToken(config, token) {
  writeJson(config.tokenPath, {
    ...token,
    created_at: Date.now(),
    expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : token.expires_at,
  });
}

function isExpired(token) {
  return !token.expires_at || Date.now() > token.expires_at - 60000;
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function ensureAccessToken() {
  const config = loadConfig();
  const client = loadClient(config);
  const token = getToken(config);
  if (!token) throw new Error("Not authorized yet. Run classroom_start_auth first.");
  if (!isExpired(token)) return token.access_token;
  if (!token.refresh_token) throw new Error("Token expired and has no refresh token. Authorize again.");

  const refreshed = await postForm(GOOGLE_TOKEN_URL, {
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });
  const merged = { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token };
  saveToken(config, merged);
  return merged.access_token;
}

async function classroomFetch(endpoint, query = {}) {
  const accessToken = await ensureAccessToken();
  const url = new URL(`${CLASSROOM_API}${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Classroom API HTTP ${response.status}`);
  }
  return payload;
}

async function fetchAll(endpoint, query, listKey) {
  const items = [];
  let pageToken = "";
  do {
    const payload = await classroomFetch(endpoint, { ...query, pageToken });
    if (Array.isArray(payload[listKey])) items.push(...payload[listKey]);
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return items;
}

function dueDateTime(work) {
  if (!work.dueDate) return null;
  const date = work.dueDate;
  const time = work.dueTime || {};
  return new Date(
    Date.UTC(
      date.year,
      (date.month || 1) - 1,
      date.day || 1,
      time.hours || 0,
      time.minutes || 0
    )
  ).toISOString();
}

function attachmentsFromMaterials(materials = []) {
  return materials.flatMap((item) => {
    const material = item.driveFile || item.youtubeVideo || item.link || item.form;
    if (!material) return [];
    const driveFile = material.driveFile;
    if (driveFile) {
      return [{
        title: driveFile.title || "Drive file",
        url: driveFile.alternateLink || driveFile.thumbnailUrl || null,
        type: "driveFile",
      }];
    }
    return [{
      title: material.title || material.url || "Attachment",
      url: material.url || material.alternateLink || null,
      type: item.driveFile ? "driveFile" : item.youtubeVideo ? "youtubeVideo" : item.link ? "link" : "form",
    }];
  });
}

async function startAuth() {
  const config = loadConfig();
  const client = loadClient(config);
  const server = http.createServer();
  const state = crypto.randomBytes(16).toString("hex");

  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const done = new Promise((resolve) => {
    server.on("request", async (req, res) => {
      const requestUrl = new URL(req.url, redirectUri);
      if (requestUrl.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      try {
        if (requestUrl.searchParams.get("state") !== state) throw new Error("OAuth state mismatch.");
        const code = requestUrl.searchParams.get("code");
        if (!code) throw new Error(requestUrl.searchParams.get("error") || "No authorization code returned.");
        const token = await postForm(GOOGLE_TOKEN_URL, {
          client_id: client.client_id,
          client_secret: client.client_secret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        });
        saveToken(config, token);
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Classroom Assistant is connected. You can close this tab.");
        resolve({ ok: true });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Authorization failed: ${error.message}`);
        resolve({ ok: false, error: error.message });
      } finally {
        server.close();
      }
    });
  });

  authSessions.set(state, done);
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scopes.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return {
    state,
    authUrl: authUrl.toString(),
    nextStep: "Open authUrl in your browser, approve access, then run classroom_finish_auth with the returned state.",
  };
}

async function finishAuth(args) {
  const state = args?.state;
  if (!state || !authSessions.has(state)) throw new Error("No active authorization session for that state.");
  const result = await authSessions.get(state);
  authSessions.delete(state);
  return result;
}

async function status() {
  const config = loadConfig();
  const token = getToken(config);
  return {
    configured: fs.existsSync(config.credentialsPath),
    authorized: Boolean(token?.access_token || token?.refresh_token),
    tokenPath: config.tokenPath,
    expiresAt: token?.expires_at ? new Date(token.expires_at).toISOString() : null,
  };
}

async function getCourses() {
  const courses = await fetchAll("/courses", { pageSize: 100, courseStates: "ACTIVE" }, "courses");
  return courses.map((course) => ({
    id: course.id,
    name: course.name,
    section: course.section || "",
    room: course.room || "",
    alternateLink: course.alternateLink || "",
  }));
}

async function getOverview(args = {}) {
  const limit = Number(args.limit || 50);
  const courses = await getCourses();
  const rows = [];
  for (const course of courses) {
    const workItems = await fetchAll(`/courses/${course.id}/courseWork`, {
      pageSize: 100,
      courseWorkStates: "PUBLISHED",
    }, "courseWork").catch(() => []);
    for (const work of workItems) {
      rows.push({
        courseId: course.id,
        courseName: course.name,
        id: work.id,
        title: work.title,
        description: work.description || "",
        state: work.state || "",
        workType: work.workType || "",
        dueAt: dueDateTime(work),
        alternateLink: work.alternateLink || "",
        attachments: attachmentsFromMaterials(work.materials),
      });
    }
  }
  rows.sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.title.localeCompare(b.title);
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return new Date(a.dueAt) - new Date(b.dueAt);
  });
  return { courses, coursework: rows.slice(0, limit), totalCoursework: rows.length };
}

async function getMaterials(args = {}) {
  const courseName = String(args.courseName || "").toLowerCase();
  const courses = (await getCourses()).filter((course) => !courseName || course.name.toLowerCase().includes(courseName));
  const materials = [];
  for (const course of courses) {
    const items = await fetchAll(`/courses/${course.id}/courseWorkMaterials`, {
      pageSize: 100,
      courseWorkMaterialStates: "PUBLISHED",
    }, "courseWorkMaterial").catch(() => []);
    for (const item of items) {
      materials.push({
        courseId: course.id,
        courseName: course.name,
        id: item.id,
        title: item.title,
        description: item.description || "",
        alternateLink: item.alternateLink || "",
        attachments: attachmentsFromMaterials(item.materials),
      });
    }
  }
  return { materials };
}

const tools = [
  {
    name: "classroom_start_auth",
    description: "Start Google OAuth for Classroom Assistant and return a browser authorization URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "classroom_finish_auth",
    description: "Finish a pending Google OAuth session after the user approved the browser prompt.",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string" } },
      required: ["state"],
    },
  },
  {
    name: "classroom_status",
    description: "Check whether Classroom Assistant has local credentials and an OAuth token.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "classroom_get_overview",
    description: "Get active courses and upcoming coursework from Google Classroom.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum coursework items to return." } },
    },
  },
  {
    name: "classroom_get_materials",
    description: "Get teaching materials and attachments from Google Classroom courses.",
    inputSchema: {
      type: "object",
      properties: { courseName: { type: "string", description: "Optional course name filter." } },
    },
  },
];

async function callTool(name, args) {
  if (name === "classroom_start_auth") return startAuth();
  if (name === "classroom_finish_auth") return finishAuth(args);
  if (name === "classroom_status") return status();
  if (name === "classroom_get_overview") return getOverview(args);
  if (name === "classroom_get_materials") return getMaterials(args);
  throw new Error(`Unknown tool: ${name}`);
}

function sendMessage(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, error) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: error?.message || String(error) },
  });
}

async function handleMessage(message) {
  if (message.method === "initialize") {
    sendResult(message.id, {
      protocolVersion: message.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "classroom-assistant", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    sendResult(message.id, { tools });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      sendResult(message.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (error) {
      sendError(message.id, error);
    }
    return;
  }
  if (message.id !== undefined) sendError(message.id, new Error(`Unsupported method: ${message.method}`));
}

function drainInput() {
  while (true) {
    const newline = inputBuffer.indexOf("\n");
    if (newline === -1) return;
    const body = inputBuffer.slice(0, newline).toString("utf8").trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!body) continue;
    Promise.resolve()
      .then(() => handleMessage(JSON.parse(body)))
      .catch((error) => sendError(null, error));
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInput();
});
