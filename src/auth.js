import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_USER_TABLE_ID || "tblH84os6uOYsy4AK";
const cookieName = "buzsu_panel_session";
function secret() { return process.env.SESSION_SECRET || process.env.CRON_SECRET || ""; }
function cookieHeader(value, maxAge = 60 * 60 * 24 * 7) { return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function parseCookies(request) { return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)])); }
function sign(value) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
export async function hashPassword(password) { const salt = randomBytes(16).toString("hex"); const derived = await scrypt(String(password), salt, 64); return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`; }
export async function verifyPassword(password, stored) { const [, salt, expectedHex] = String(stored || "").split("$"); if (!salt || !expectedHex) return false; const derived = Buffer.from(await scrypt(String(password), salt, 64)); const expected = Buffer.from(expectedHex, "hex"); return expected.length === derived.length && timingSafeEqual(expected, derived); }
export function setSession(response, user) { if (!secret()) throw new Error("SESSION_SECRET veya CRON_SECRET eksik."); const payload = Buffer.from(JSON.stringify({ id: user.id, username: user.username, role: user.role, exp: Date.now() + 7 * 86400000 })).toString("base64url"); response.setHeader("Set-Cookie", cookieHeader(`${payload}.${sign(payload)}`)); }
export function clearSession(response) { response.setHeader("Set-Cookie", cookieHeader("", 0)); }
export function getSession(request) { const raw = parseCookies(request)[cookieName] || ""; const [payload, signature] = raw.split("."); if (!payload || !signature || !secret() || sign(payload) !== signature) return null; try { const user = JSON.parse(Buffer.from(payload, "base64url").toString()); return user.exp > Date.now() ? user : null; } catch { return null; } }
async function airtable(path = "", options = {}) { const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, ...(options.headers || {}) } }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`); return data; }
export async function findUser(username) { const data = await airtable("?pageSize=100"); return (data.records || []).find((record) => String(record.fields?.["Kullanıcı Adı"] || "").toLocaleLowerCase("tr-TR") === String(username || "").trim().toLocaleLowerCase("tr-TR")) || null; }
export async function hasUsers() { const data = await airtable("?pageSize=1"); return (data.records || []).length > 0; }
export async function createUser({ username, password, role = "Editor" }) { return airtable("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { "Kullanıcı Adı": username.trim(), "Parola Özeti": await hashPassword(password), Rol: role, Aktif: true } }) }); }
export async function touchLogin(recordId) { await airtable(`/${recordId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { "Son Giriş": new Date().toISOString() } }) }); }
