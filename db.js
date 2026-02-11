import Database from 'better-sqlite3';

const db = new Database('data.sqlite');

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  balance  INTEGER NOT NULL DEFAULT 0,
  last_daily TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS config (
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT
);

-- ✅ باند مؤقت (نخزن النهاية)
CREATE TABLE IF NOT EXISTS punishments (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,          -- 'ban'
  until_ms INTEGER NOT NULL,   -- timestamp ms
  reason TEXT,
  created_by TEXT,
  PRIMARY KEY (guild_id, user_id, type)
);
`);

export function ensureWallet(guildId, userId) {
  db.prepare(`INSERT OR IGNORE INTO wallets (guild_id, user_id, balance) VALUES (?, ?, 0)`)
    .run(guildId, userId);
}

export function getBalance(guildId, userId) {
  ensureWallet(guildId, userId);
  return db.prepare(`SELECT balance FROM wallets WHERE guild_id=? AND user_id=?`)
    .get(guildId, userId).balance;
}

export function addBalance(guildId, userId, amount) {
  ensureWallet(guildId, userId);
  db.prepare(`UPDATE wallets SET balance = balance + ? WHERE guild_id=? AND user_id=?`)
    .run(amount, guildId, userId);
  return getBalance(guildId, userId);
}

export function setLastDaily(guildId, userId, iso) {
  ensureWallet(guildId, userId);
  db.prepare(`UPDATE wallets SET last_daily=? WHERE guild_id=? AND user_id=?`)
    .run(iso, guildId, userId);
}

export function getLastDaily(guildId, userId) {
  ensureWallet(guildId, userId);
  return db.prepare(`SELECT last_daily FROM wallets WHERE guild_id=? AND user_id=?`)
    .get(guildId, userId).last_daily;
}

export function topBalances(guildId, limit = 10) {
  return db.prepare(`SELECT user_id, balance FROM wallets WHERE guild_id=? ORDER BY balance DESC LIMIT ?`)
    .all(guildId, limit);
}

export function setLogChannel(guildId, channelId) {
  db.prepare(`INSERT INTO config (guild_id, log_channel_id) VALUES (?, ?)
              ON CONFLICT(guild_id) DO UPDATE SET log_channel_id=excluded.log_channel_id`)
    .run(guildId, channelId);
}

export function getLogChannel(guildId) {
  const row = db.prepare(`SELECT log_channel_id FROM config WHERE guild_id=?`).get(guildId);
  return row?.log_channel_id || null;
}

/* ✅ Punishments (temp bans) */
export function addPunishment(guildId, userId, type, untilMs, reason, createdBy) {
  db.prepare(`
    INSERT INTO punishments (guild_id, user_id, type, until_ms, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, type) DO UPDATE SET
      until_ms=excluded.until_ms,
      reason=excluded.reason,
      created_by=excluded.created_by
  `).run(guildId, userId, type, untilMs, reason || null, createdBy || null);
}

export function removePunishment(guildId, userId, type) {
  db.prepare(`DELETE FROM punishments WHERE guild_id=? AND user_id=? AND type=?`)
    .run(guildId, userId, type);
}

export function duePunishments(nowMs) {
  return db.prepare(`SELECT guild_id, user_id, type, until_ms, reason FROM punishments WHERE until_ms <= ?`)
    .all(nowMs);
}
