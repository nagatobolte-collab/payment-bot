// payment-bot/services/orders.js
const fs = require("fs");
const path = require("path");

const ORDERS_FILE = path.join(__dirname, "../data/orders.json");

function loadOrders() {
    try { if (fs.existsSync(ORDERS_FILE)) return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); } catch (e) {}
    return {};
}

function saveOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function createOrder(userId, merchantOrderNo, amount, paymentUrl, gatewayOrderNo) {
    const orders = loadOrders();
    orders[merchantOrderNo] = {
        userId: String(userId),
        merchantOrderNo,
        gatewayOrderNo: gatewayOrderNo || null,
        amount: parseFloat(amount),
        paymentUrl,
        status: "pending",  // pending | success | failed | expired
        utr: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    saveOrders(orders);
    return orders[merchantOrderNo];
}

function getOrder(merchantOrderNo) {
    const orders = loadOrders();
    return orders[merchantOrderNo] || null;
}

function getOrderByGateway(gatewayOrderNo) {
    const orders = loadOrders();
    return Object.values(orders).find(o => o.gatewayOrderNo === gatewayOrderNo) || null;
}

function updateOrder(merchantOrderNo, updates) {
    const orders = loadOrders();
    if (!orders[merchantOrderNo]) return null;
    Object.assign(orders[merchantOrderNo], updates, { updatedAt: Date.now() });
    saveOrders(orders);
    return orders[merchantOrderNo];
}

function getUserOrders(userId) {
    const orders = loadOrders();
    return Object.values(orders)
        .filter(o => o.userId === String(userId))
        .sort((a, b) => b.createdAt - a.createdAt);
}

function getPendingOrders() {
    const orders = loadOrders();
    return Object.values(orders).filter(o => o.status === "pending");
}

// Payout orders
const PAYOUTS_FILE = path.join(__dirname, "../data/payouts.json");

function loadPayouts() {
    try { if (fs.existsSync(PAYOUTS_FILE)) return JSON.parse(fs.readFileSync(PAYOUTS_FILE, "utf8")); } catch (e) {}
    return {};
}
function savePayouts(payouts) { fs.writeFileSync(PAYOUTS_FILE, JSON.stringify(payouts, null, 2)); }

function createPayout(userId, transactionId, amount, bankDetails) {
    const payouts = loadPayouts();
    payouts[transactionId] = {
        userId: String(userId),
        transactionId,
        amount: parseFloat(amount),
        bankDetails,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    savePayouts(payouts);
    return payouts[transactionId];
}

function getPayout(transactionId) {
    const payouts = loadPayouts();
    return payouts[transactionId] || null;
}

function updatePayout(transactionId, updates) {
    const payouts = loadPayouts();
    if (!payouts[transactionId]) return null;
    Object.assign(payouts[transactionId], updates, { updatedAt: Date.now() });
    savePayouts(payouts);
    return payouts[transactionId];
}

function getUserPayouts(userId) {
    const payouts = loadPayouts();
    return Object.values(payouts)
        .filter(p => p.userId === String(userId))
        .sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = {
    createOrder, getOrder, getOrderByGateway, updateOrder, getUserOrders, getPendingOrders,
    createPayout, getPayout, updatePayout, getUserPayouts
};
