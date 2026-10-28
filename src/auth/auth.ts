// Kimlik doğrulama ve yetkilendirme (sunucu tarafı).
// - Parolalar Bun.password (argon2id) ile saklanır.
// - Oturum jetonu yalnız HttpOnly çerezde; DB'de sha256 hash'i tutulur.
// - Rol denetimi her uçta sunucuda yapılır; arayüzdeki gizleme yalnız kullanılabilirlik içindir.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Role, User } from "../domain/types.ts";
import { nowIso, randomToken, sha256, stableId } from "../ids.ts";
import { log } from "../log.ts";
import type { Repo } from "../store/repo.ts";

export const SESSION_TTL_MS = 12 * 3_600_000;
export const ROLES: readonly Role[] = ["admin", "analyst", "viewer"];

export type Permission = "read" | "review" | "analyze" | "ingest" | "admin";
const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(["read"]),
  analyst: new Set(["read", "review", "analyze"]),
  admin: new Set(["read", "review", "analyze", "ingest", "admin"]),
};
export const can = (role: Role, p: Permission): boolean => GRANTS[role]?.has(p) ?? false;

export const MIN_PASSWORD_LEN = 12;

let dummyHash: string | null = null;

export async function createUser(repo: Repo, input: { email: string; name: string; role: Role; password: string }): Promise<User> {
  if (!ROLES.includes(input.role)) throw new Error("geçersiz rol");
  if (input.password.length < MIN_PASSWORD_LEN) throw new Error(`parola en az ${MIN_PASSWORD_LEN} karakter olmalı`);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("geçersiz e-posta");
  if (await repo.getUserByEmail(email)) throw new Error("bu e-posta zaten kayıtlı");
  const u: User = {
    user_id: stableId("usr", email), email, name: input.name.trim().slice(0, 120) || email, role: input.role,
    password_hash: await Bun.password.hash(input.password), disabled: false, created_at: nowIso(), version: 1,
  };
  await repo.upsertUser(u);
  return u;
}

export async function login(repo: Repo, email: string, password: string): Promise<{ token: string; user: User } | null> {
  const u = await repo.getUserByEmail(String(email || "").trim().toLowerCase());
  if (!u || u.disabled) {
    // Zamanlama farkıyla hesap varlığı sızdırılmasın: yine de bir doğrulama yap.
    dummyHash ??= await Bun.password.hash(randomToken(16));
    await Bun.password.verify(String(password || "x"), dummyHash).catch(() => false);
    return null;
  }
  const ok = await Bun.password.verify(String(password || ""), u.password_hash).catch(() => false);
  if (!ok) return null;
  const token = randomToken(32);
  await repo.insertSession({ token_hash: sha256(token), user_id: u.user_id, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(), revoked: false });
  return { token, user: u };
}

export async function sessionUser(repo: Repo, token: string | null): Promise<User | null> {
  if (!token || token.length > 200) return null;
  const s = await repo.getSession(sha256(token));
  if (!s || s.revoked || Date.parse(s.expires_at) < Date.now()) return null;
  const u = await repo.getUser(s.user_id);
  return u && !u.disabled ? u : null;
}

export async function logout(repo: Repo, token: string | null): Promise<void> {
  if (!token) return;
  const s = await repo.getSession(sha256(token));
  if (s) await repo.insertSession({ ...s, revoked: true });
}

/**
 * Hiç kullanıcı yoksa yönetici oluşturur. Parola env'de yoksa rastgele üretilir ve yalnız sahibinin
 * okuyabileceği (0600) dosyaya yazılır; log'a ASLA yazılmaz.
 */
export async function seedUsers(repo: Repo, o: { adminEmail: string; adminPassword: string; seedPasswordFile: string; demoUsers: boolean }): Promise<void> {
  if ((await repo.listUsers()).length) return;
  const lines: string[] = [];
  const adminPw = o.adminPassword || randomToken(18);
  await createUser(repo, { email: o.adminEmail, name: "Yönetici", role: "admin", password: adminPw });
  if (!o.adminPassword) lines.push(`${o.adminEmail}\t${adminPw}`);
  if (o.demoUsers) {
    for (const [email, role] of [["analist@sinyal.local", "analyst"], ["izleyici@sinyal.local", "viewer"]] as const) {
      const pw = randomToken(18);
      await createUser(repo, { email, name: role === "analyst" ? "Demo Analist" : "Demo İzleyici", role, password: pw });
      lines.push(`${email}\t${pw}`);
    }
  }
  if (lines.length) {
    await mkdir(dirname(o.seedPasswordFile), { recursive: true });
    await writeFile(o.seedPasswordFile, lines.join("\n") + "\n", { mode: 0o600 });
    await chmod(o.seedPasswordFile, 0o600);
    log("warn", "başlangıç parolaları üretildi; dosyadan okuyup ilk girişte değiştirin", { file: o.seedPasswordFile });
  }
}
