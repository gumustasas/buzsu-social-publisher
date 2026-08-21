import "dotenv/config";
import { clearSession, createUser, findUser, getSession, hasUsers, setSession, touchLogin, verifyPassword } from "../src/auth.js";
function cronAuthorized(request) { return Boolean(process.env.CRON_SECRET && request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`); }
function validCredentials(username, password) { return typeof username === "string" && username.trim().length >= 3 && typeof password === "string" && password.length >= 10; }
export default async function handler(request, response) {
  if (request.method !== "POST" && request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  try {
    if (request.method === "GET") return response.status(200).json({ ok: true, user: getSession(request) });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    if (body.action === "logout") { clearSession(response); return response.status(200).json({ ok: true }); }
    if (body.action === "setup") {
      if (!cronAuthorized(request)) return response.status(401).json({ error: "İlk admin kurulumu için CRON_SECRET gerekli." });
      if (await hasUsers()) return response.status(409).json({ error: "Admin zaten oluşturulmuş." });
      if (!validCredentials(body.username, body.password)) return response.status(400).json({ error: "Kullanıcı adı en az 3, parola en az 10 karakter olmalı." });
      const record = await createUser({ username: body.username, password: body.password, role: "Admin" }); setSession(response, { id: record.id, username: body.username.trim(), role: "Admin" });
      return response.status(201).json({ ok: true, user: { username: body.username.trim(), role: "Admin" } });
    }
    if (body.action === "login") { const record = await findUser(body.username); if (!record?.fields?.Aktif || !await verifyPassword(body.password, record.fields["Parola Özeti"])) return response.status(401).json({ error: "Kullanıcı adı veya parola hatalı." }); const user = { id: record.id, username: record.fields["Kullanıcı Adı"], role: record.fields.Rol || "Editor" }; setSession(response, user); await touchLogin(record.id); return response.status(200).json({ ok: true, user: { username: user.username, role: user.role } }); }
    if (body.action === "create-user") { const session = getSession(request); if (!session || session.role !== "Admin") return response.status(403).json({ error: "Admin yetkisi gerekli." }); if (!validCredentials(body.username, body.password) || !["Admin", "Editor"].includes(body.role)) return response.status(400).json({ error: "Kullanıcı bilgileri geçersiz." }); if (await findUser(body.username)) return response.status(409).json({ error: "Bu kullanıcı zaten var." }); const record = await createUser(body); return response.status(201).json({ ok: true, id: record.id }); }
    return response.status(400).json({ error: "Geçersiz işlem." });
  } catch (error) { console.error(error); return response.status(500).json({ ok: false, error: error.message }); }
}
