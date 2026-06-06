// payment-bot/auth.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const KEYS_FILE = path.join(DATA_DIR, "payment-keys.json");
const USERS_FILE = path.join(DATA_DIR, "payment-users.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadKeys() {
    try { if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch (e) {}
    return [];
}
function saveKeys(keys) { fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2)); }

function loadUsers() {
    try { if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch (e) {}
    return {};
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function generateKey(createdBy) {
    const key = crypto.randomUUID().split("-").slice(0, 2).join("-").toUpperCase();
    const keys = loadKeys();
    keys.push({ key, createdBy: String(createdBy), createdAt: Date.now(), usedBy: null, usedAt: null });
    saveKeys(keys);
    return key;
}

function redeemKey(keyStr, userId, username) {
    const keys = loadKeys();
    const found = keys.find(k => k.key === keyStr.trim().toUpperCase() && !k.usedBy);
    if (!found) return false;
    found.usedBy = String(userId);
    found.usedAt = Date.now();
    saveKeys(keys);
    const users = loadUsers();
    users[String(userId)] = { username: username || "", activatedAt: Date.now(), wallet: 0 };
    saveUsers(users);
    return true;
}

function isAuthorized(userId, ownerId) {
    if (String(userId) === String(ownerId)) return true;
    const users = loadUsers();
    return !!users[String(userId)];
}

function isOwner(userId, ownerId) { return String(userId) === String(ownerId); }

function getUser(userId) {
    const users = loadUsers();
    return users[String(userId)] || null;
}

function getAllUsers() { return loadUsers(); }
function getAllKeys() { return loadKeys(); }

function updateWallet(userId, amount) {
    const users = loadUsers();
    if (!users[String(userId)]) return false;
    users[String(userId)].wallet = (users[String(userId)].wallet || 0) + amount;
    saveUsers(users);
    return users[String(userId)].wallet;
}

function getWallet(userId) {
    const users = loadUsers();
    return users[String(userId)]?.wallet || 0;
}

module.exports = {
    generateKey, redeemKey, isAuthorized, isOwner,
    getUser, getAllUsers, getAllKeys, updateWallet, getWallet
};
