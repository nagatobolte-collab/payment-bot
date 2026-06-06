// payment-bot/index.js — WatchPays Payment Bot (Full Version)
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const auth = require("./auth");
const orders = require("./services/orders");
const watchpays = require("./services/watchpays");
const { generateQR } = require("./services/qrgen");

require("events").defaultMaxListeners = 30;

const QR_DIR = path.join(__dirname, "qr");
const DATA_DIR = path.join(__dirname, "data");
[QR_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const OWNER_ID = String(config.OWNER_ID);
const PAYIN_FEE = config.PAYIN_FEE_PCT / 100;
const PAYOUT_FEE = config.PAYOUT_FEE_PCT / 100;

// ── BOT ──
const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
    filepath: false
});
console.log("💳 Payment Bot Started");

// ── WEBHOOK SERVER ──
const app = express();
app.use(express.json());

// Pay-in callback
app.post("/webhook/payin", async (req, res) => {
    try {
        const { orderNo, merchantOrder, status, amount } = req.body;
        console.log("PAYIN WEBHOOK:", req.body);
        res.send("success");

        const order = orders.getOrder(merchantOrder) || orders.getOrderByGateway(orderNo);
        if (!order) return;

        if (status === "success") {
            orders.updateOrder(order.merchantOrderNo, { status: "success", gatewayOrderNo: orderNo });
            const newBalance = auth.updateWallet(order.userId, parseFloat(amount));
            await bot.sendMessage(order.userId,
                "✅ *Payment Successful!*\n\n" +
                "💰 Amount: ₹" + amount + "\n" +
                "🧾 Order: `" + order.merchantOrderNo + "`\n" +
                "💼 New Balance: ₹" + (newBalance || 0).toFixed(2),
                { parse_mode: "Markdown" }
            );
            await bot.sendMessage(OWNER_ID,
                "💰 *Payment Received (Auto)*\n\n" +
                "👤 User: " + order.userId + "\n" +
                "💰 Amount: ₹" + amount + "\n" +
                "🧾 Order: `" + order.merchantOrderNo + "`",
                { parse_mode: "Markdown" }
            ).catch(() => {});
        } else {
            orders.updateOrder(order.merchantOrderNo, { status: "failed" });
            await bot.sendMessage(order.userId,
                "❌ *Payment Failed*\n\nOrder: `" + order.merchantOrderNo + "`\nPlease try again with 💳 Create Payment",
                { parse_mode: "Markdown" }
            );
        }
    } catch (e) { console.log("WEBHOOK ERROR:", e.message); }
});

// Payout callback
app.post("/webhook/payout", async (req, res) => {
    try {
        const { transaction_id, amount, status } = req.body;
        console.log("PAYOUT WEBHOOK:", req.body);
        res.send("success");

        const payout = orders.getPayout(transaction_id);
        if (!payout) return;

        if (status === "SUCCESS") {
            orders.updatePayout(transaction_id, { status: "success" });
            await bot.sendMessage(payout.userId,
                "✅ *Withdrawal Successful!*\n\n💸 Amount: ₹" + amount + "\n🔖 Transaction: `" + transaction_id + "`",
                { parse_mode: "Markdown" }
            );
        } else {
            orders.updatePayout(transaction_id, { status: "failed" });
            auth.updateWallet(payout.userId, parseFloat(payout.amount));
            await bot.sendMessage(payout.userId,
                "❌ *Withdrawal Failed*\n\nAmount ₹" + amount + " refunded to wallet.\nTransaction: `" + transaction_id + "`",
                { parse_mode: "Markdown" }
            );
        }
    } catch (e) { console.log("PAYOUT WEBHOOK ERROR:", e.message); }
});

app.listen(config.WEBHOOK_PORT, () => {
    console.log("🌐 Webhook server on port", config.WEBHOOK_PORT);
});

// ── SESSION STATES ──
const waitingAmount = {};
const waitingUTR = {};
const withdrawData = {};

// ── HELPERS ──
function mainKeyboard(chatId) {
    const isOwner = String(chatId) === OWNER_ID;
    const keyboard = [
        [{ text: "💳 Create Payment" }, { text: "💼 My Balance" }],
        [{ text: "📋 Collection Orders" }, { text: "💸 Withdrawals" }],
        [{ text: "📊 Fund Details" }, { text: "📈 Today Stats" }],
    ];
    if (isOwner) keyboard.push([{ text: "👑 Admin" }]);
    return { reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: false } };
}

function formatStatus(status) {
    const map = { pending: "⏳ Pending", success: "✅ Success", failed: "❌ Failed", expired: "⏰ Expired" };
    return map[status] || status;
}

function formatDate(ts) {
    return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function todayStart() {
    const t = new Date(); t.setHours(0,0,0,0); return t.getTime();
}

// ── /start ──
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = String(chatId);

    if (!auth.isAuthorized(userId, OWNER_ID)) {
        return bot.sendMessage(chatId,
            "🔒 *Access Denied*\n\nYou need an access key to use this bot.\n\nContact admin: @btcshadow\n\nAlready have a key? Paste it here.",
            { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
        );
    }

    const balance = auth.getWallet(userId);
    const welcomeText = String(chatId) === OWNER_ID
        ? "💳 *Payment Bot (Admin)*\n\n💼 Wallet: ₹" + balance.toFixed(2) + "\n\nSelect an option 👇"
        : "💳 *Payment Bot*\n\n💼 Your Balance: ₹" + balance.toFixed(2) + "\n\nSelect an option 👇";

    await bot.sendMessage(chatId, welcomeText, { parse_mode: "Markdown", ...mainKeyboard(chatId) });
});

// ── MAIN MESSAGE HANDLER ──
bot.on("message", async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = String(chatId);
        const text = msg.text;
        if (!text) return;

        // ── KEY ACTIVATION ──
        if (!auth.isAuthorized(userId, OWNER_ID)) {
            if (/^[A-F0-9]{8}-[A-F0-9]{4}$/i.test(text.trim())) {
                const ok = auth.redeemKey(text.trim(), userId, msg.from?.username || msg.from?.first_name || "");
                if (ok) {
                    return bot.sendMessage(chatId,
                        "✅ *Key Activated!*\n\nWelcome to Payment Bot!\n\nPress /start to begin.",
                        { parse_mode: "Markdown" }
                    );
                } else {
                    return bot.sendMessage(chatId, "❌ Invalid or already used key.");
                }
            }
            return;
        }

        // ── WAITING FOR AMOUNT ──
        if (waitingAmount[chatId]) {
            delete waitingAmount[chatId];
            const amount = parseFloat(text.trim());
            if (isNaN(amount) || amount < 200) {
                return bot.sendMessage(chatId, "❌ Invalid amount. Minimum ₹200.\n\nTry again with 💳 Create Payment");
            }

            const statusMsg = await bot.sendMessage(chatId, "⏳ Creating payment order...");
            const merchantOrderNo = watchpays.generateOrderNo(userId);

            try {
                const result = await watchpays.createPayinOrder(amount, merchantOrderNo, userId);
                if (!result.success) throw new Error(result.message || "API error");

                orders.createOrder(userId, merchantOrderNo, amount, result.payment_url, result.order_no);

                const qrPath = path.join(QR_DIR, merchantOrderNo + ".png");
                await generateQR(result.payment_url, qrPath);

                await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

                const fee = (amount * PAYIN_FEE).toFixed(2);
                const finalAmt = (amount - amount * PAYIN_FEE).toFixed(2);

                const photoMsg = await bot.sendPhoto(chatId, fs.createReadStream(qrPath), {
                    caption:
                        "💳 *Payment Created!*\n\n" +
                        "💰 Amount: ₹" + amount.toFixed(2) + "\n" +
                        "💸 Fee (11%): ₹" + fee + "\n" +
                        "✅ You receive: ₹" + finalAmt + "\n" +
                        "🧾 Order: `" + merchantOrderNo + "`\n\n" +
                        "⏱ Expires in: *05:00*\n\n" +
                        "👆 Scan QR or tap Pay Now to pay\n" +
                        "After paying, paste your *UTR number* here.",
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🔗 Pay Now", url: result.payment_url }
                        ]]
                    }
                });

                // Pre-set waitingUTR as backup
                waitingUTR[chatId] = merchantOrderNo;

                // Countdown timer — edit message every 30s
                const EXPIRE_SECS = 5 * 60;
                let elapsed = 0;
                const timerInterval = setInterval(async () => {
                    elapsed += 5;
                    const remaining = EXPIRE_SECS - elapsed;
                    if (remaining <= 0) {
                        clearInterval(timerInterval);
                        // Mark as expired if still pending
                        const o = orders.getOrder(merchantOrderNo);
                        if (o && o.status === "pending") {
                            orders.updateOrder(merchantOrderNo, { status: "expired" });
                            if (waitingUTR[chatId] === merchantOrderNo) delete waitingUTR[chatId];
                        }
                        await bot.editMessageCaption(
                            "❌ *Payment Expired*\n\n" +
                            "💰 Amount: ₹" + amount.toFixed(2) + "\n" +
                            "🧾 Order: `" + merchantOrderNo + "`\n\n" +
                            "Create a new payment with 💳 Create Payment",
                            { chat_id: chatId, message_id: photoMsg.message_id, parse_mode: "Markdown" }
                        ).catch(() => {});
                        return;
                    }
                    // Don't update if already paid
                    const o = orders.getOrder(merchantOrderNo);
                    if (o && o.status !== "pending") { clearInterval(timerInterval); return; }

                    const mins = String(Math.floor(remaining / 60)).padStart(2, "0");
                    const secs = String(remaining % 60).padStart(2, "0");
                    await bot.editMessageCaption(
                        "💳 *Payment Created!*\n\n" +
                        "💰 Amount: ₹" + amount.toFixed(2) + "\n" +
                        "💸 Fee (11%): ₹" + fee + "\n" +
                        "✅ You receive: ₹" + finalAmt + "\n" +
                        "🧾 Order: `" + merchantOrderNo + "`\n\n" +
                        "⏱ Expires in: *" + mins + ":" + secs + "*\n\n" +
                        "👆 Scan QR or tap Pay Now to pay\n" +
                        "After paying, paste your *UTR number* here.",
                        { chat_id: chatId, message_id: photoMsg.message_id, parse_mode: "Markdown",
                          reply_markup: { inline_keyboard: [[{ text: "🔗 Pay Now", url: result.payment_url }]] }
                        }
                    ).catch(() => {});
                }, 5000);

                setTimeout(() => { try { fs.unlinkSync(qrPath); } catch (e) {} }, 600000);

            } catch (err) {
                await bot.editMessageText("❌ Failed: " + err.message, {
                    chat_id: chatId, message_id: statusMsg.message_id
                });
            }
            return;
        }

        // ── WAITING FOR UTR (explicit) ──
        if (waitingUTR[chatId]) {
            const utr = text.trim().toUpperCase();
            if (utr.length < 6) return bot.sendMessage(chatId, "❌ Invalid UTR. Please enter a valid UTR number.");

            const merchantOrderNo = waitingUTR[chatId];
            delete waitingUTR[chatId];

            const order = orders.getOrder(merchantOrderNo);
            if (!order) return bot.sendMessage(chatId, "❌ Order not found.");
            if (order.status !== "pending") return bot.sendMessage(chatId, "⚠️ Order already " + order.status);

            orders.updateOrder(merchantOrderNo, { utr });
            await bot.sendMessage(chatId,
                "🔖 *UTR Submitted!*\n\n" +
                "UTR: `" + utr + "`\n" +
                "Order: `" + merchantOrderNo + "`\n\n" +
                "⏳ Verifying... You'll be notified once confirmed.",
                { parse_mode: "Markdown" }
            );
            await bot.sendMessage(OWNER_ID,
                "🔔 *UTR Submitted*\n\n👤 User: " + userId + "\n💰 ₹" + order.amount + "\n🧾 `" + merchantOrderNo + "`\n🔖 UTR: `" + utr + "`",
                { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[
                    { text: "✅ Confirm", callback_data: "confirm_" + merchantOrderNo },
                    { text: "❌ Reject", callback_data: "reject_" + merchantOrderNo }
                ]]}}
            ).catch(() => {});
            return;
        }

        // ── WAITING WITHDRAW STEPS ──
        if (withdrawData[chatId]) {
            const step = withdrawData[chatId].step;

            if (step === "amount") {
                const amount = parseFloat(text.trim());
                const balance = auth.getWallet(userId);
                if (isNaN(amount) || amount < 100) return bot.sendMessage(chatId, "❌ Minimum withdrawal ₹100.");
                if (amount > balance) return bot.sendMessage(chatId, "❌ Insufficient balance. Your balance: ₹" + balance.toFixed(2));
                withdrawData[chatId].amount = amount;
                withdrawData[chatId].step = "account";
                return bot.sendMessage(chatId, "🏦 Enter your *bank account number*:", { parse_mode: "Markdown" });
            }
            if (step === "account") {
                withdrawData[chatId].accountNumber = text.trim();
                withdrawData[chatId].step = "ifsc";
                return bot.sendMessage(chatId, "🔢 Enter *IFSC code*:", { parse_mode: "Markdown" });
            }
            if (step === "ifsc") {
                withdrawData[chatId].ifsc = text.trim().toUpperCase();
                withdrawData[chatId].step = "name";
                return bot.sendMessage(chatId, "👤 Enter *account holder name*:", { parse_mode: "Markdown" });
            }
            if (step === "name") {
                withdrawData[chatId].name = text.trim();
                withdrawData[chatId].step = "bank";
                return bot.sendMessage(chatId, "🏛 Enter *bank name* (e.g. HDFC Bank):", { parse_mode: "Markdown" });
            }
            if (step === "bank") {
                withdrawData[chatId].bankName = text.trim();
                const d = withdrawData[chatId];
                const fee = (d.amount * PAYOUT_FEE).toFixed(2);
                const receive = (d.amount - d.amount * PAYOUT_FEE).toFixed(2);
                return bot.sendMessage(chatId,
                    "📋 *Withdrawal Summary*\n\n" +
                    "💸 Amount: ₹" + d.amount + "\n" +
                    "🏦 Account: " + d.accountNumber + "\n" +
                    "🔢 IFSC: " + d.ifsc + "\n" +
                    "👤 Name: " + d.name + "\n" +
                    "🏛 Bank: " + d.bankName + "\n\n" +
                    "💸 Fee (" + config.PAYOUT_FEE_PCT + "%): ₹" + fee + "\n" +
                    "✅ You receive: ₹" + receive,
                    { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[
                        { text: "✅ Confirm Withdrawal", callback_data: "withdraw_confirm" },
                        { text: "❌ Cancel", callback_data: "withdraw_cancel" }
                    ]]}}
                );
            }
            return;
        }

        // ── AUTO-DETECT UTR ──
        // Detects 10-22 alphanumeric string and matches to pending order
        if (!text.startsWith("/")) {
            const utrPattern = /^[A-Z0-9]{10,22}$/i;
            if (utrPattern.test(text.trim())) {
                const userOrders = orders.getUserOrders(userId);
                const pendingOrder = userOrders.find(o => o.status === "pending" && !o.utr);
                if (pendingOrder) {
                    const utr = text.trim().toUpperCase();
                    orders.updateOrder(pendingOrder.merchantOrderNo, { utr });
                    await bot.sendMessage(chatId,
                        "🔖 *UTR Auto-Detected!*\n\n" +
                        "UTR: `" + utr + "`\n" +
                        "Order: `" + pendingOrder.merchantOrderNo + "`\n" +
                        "Amount: ₹" + pendingOrder.amount + "\n\n" +
                        "⏳ Verifying payment... You will be notified once confirmed.",
                        { parse_mode: "Markdown" }
                    );
                    await bot.sendMessage(OWNER_ID,
                        "🔔 *UTR Auto-Detected*\n\n" +
                        "👤 User: " + userId + "\n" +
                        "💰 Amount: ₹" + pendingOrder.amount + "\n" +
                        "🧾 Order: `" + pendingOrder.merchantOrderNo + "`\n" +
                        "🔖 UTR: `" + utr + "`",
                        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[
                            { text: "✅ Confirm", callback_data: "confirm_" + pendingOrder.merchantOrderNo },
                            { text: "❌ Reject", callback_data: "reject_" + pendingOrder.merchantOrderNo }
                        ]]}}
                    ).catch(() => {});
                    return;
                }
            }
        }

        // ── KEYBOARD BUTTONS ──
        if (text === "💳 Create Payment" || text === "/pay") {
            waitingAmount[chatId] = true;
            return bot.sendMessage(chatId,
                "💰 *Create Payment*\n\nEnter the amount in ₹:\n\n_(Minimum ₹200)_",
                { parse_mode: "Markdown" }
            );
        }

        if (text === "💼 My Balance") {
            const balance = auth.getWallet(userId);
            const userOrders = orders.getUserOrders(userId);
            const successOrders = userOrders.filter(o => o.status === "success");
            const totalReceived = successOrders.reduce((s,o) => s + o.amount, 0);
            return bot.sendMessage(chatId,
                "💼 *My Wallet*\n\n" +
                "💰 Available Balance: ₹" + balance.toFixed(2) + "\n" +
                "📊 Total Received: ₹" + totalReceived.toFixed(2) + "\n" +
                "✅ Successful Orders: " + successOrders.length,
                { parse_mode: "Markdown" }
            );
        }

        if (text === "📋 Collection Orders") {
            const userOrders = orders.getUserOrders(userId);
            if (userOrders.length === 0) return bot.sendMessage(chatId, "📋 No collection orders yet.\n\nUse 💳 Create Payment to get started.");
            const todayOrders = userOrders.filter(o => o.createdAt >= todayStart());
            const todaySuccess = todayOrders.filter(o => o.status === "success");
            const todayTotal = todaySuccess.reduce((s,o) => s + o.amount, 0);
            let text2 = "📋 *Collection Orders*\n\n";
            text2 += "Today: ₹" + todayTotal.toFixed(2) + " (" + todaySuccess.length + " orders)\n\n";
            userOrders.slice(0, 10).forEach((o, i) => {
                const fee = (o.amount * PAYIN_FEE).toFixed(2);
                const final = (o.amount - o.amount * PAYIN_FEE).toFixed(2);
                text2 += (i+1) + ". " + formatStatus(o.status) + "\n";
                text2 += "💰 ₹" + o.amount + " | Fee: ₹" + fee + " | Net: ₹" + final + "\n";
                text2 += "🧾 `" + o.merchantOrderNo + "`\n";
                if (o.utr) text2 += "🔖 UTR: `" + o.utr + "`\n";
                text2 += "📅 " + formatDate(o.createdAt) + "\n\n";
            });
            return bot.sendMessage(chatId, text2, { parse_mode: "Markdown" });
        }

        if (text === "💸 Withdrawals") {
            const userPayouts = orders.getUserPayouts(userId);
            if (userPayouts.length === 0) return bot.sendMessage(chatId, "💸 No withdrawal requests yet.\n\nUse 💸 Withdraw to request a payout.");
            const todayW = userPayouts.filter(p => p.status === "success" && p.createdAt >= todayStart());
            let text2 = "💸 *Withdrawal Requests*\n\n";
            text2 += "Today approved: ₹" + todayW.reduce((s,p) => s + p.amount, 0).toFixed(2) + "\n\n";
            userPayouts.slice(0, 10).forEach((p, i) => {
                text2 += (i+1) + ". " + formatStatus(p.status) + "\n";
                text2 += "💸 ₹" + p.amount + "\n";
                text2 += "🔖 `" + p.transactionId + "`\n";
                if (p.bankDetails) text2 += "🏦 " + (p.bankDetails.bankName||"") + " — " + (p.bankDetails.accountNumber||"") + "\n";
                text2 += "📅 " + formatDate(p.createdAt) + "\n\n";
            });
            return bot.sendMessage(chatId, text2, { parse_mode: "Markdown" });
        }

        if (text === "📊 Fund Details") {
            const userOrders = orders.getUserOrders(userId);
            const userPayouts = orders.getUserPayouts(userId);
            const ledger = [];
            userOrders.filter(o => o.status === "success").forEach(o => {
                ledger.push({ type: "Credit", amount: o.amount, fee: o.amount * PAYIN_FEE, id: o.merchantOrderNo, ts: o.createdAt });
            });
            userPayouts.filter(p => p.status === "success").forEach(p => {
                ledger.push({ type: "Debit", amount: p.amount, fee: 0, id: p.transactionId, ts: p.createdAt });
            });
            ledger.sort((a,b) => b.ts - a.ts);
            if (ledger.length === 0) return bot.sendMessage(chatId, "📊 No fund transactions yet.");
            let text2 = "📊 *Fund Details*\n_(Deposits & Withdrawals)_\n\n";
            ledger.slice(0, 10).forEach((l, i) => {
                text2 += (i+1) + ". " + (l.type === "Credit" ? "🟢 Credit" : "🔴 Debit") + "\n";
                text2 += "💰 ₹" + l.amount.toFixed(2);
                if (l.fee > 0) text2 += " | Fee: ₹" + l.fee.toFixed(2) + " | Net: ₹" + (l.amount - l.fee).toFixed(2);
                text2 += "\n🔖 `" + l.id + "`\n";
                text2 += "📅 " + formatDate(l.ts) + "\n\n";
            });
            return bot.sendMessage(chatId, text2, { parse_mode: "Markdown" });
        }

        if (text === "📈 Today Stats") {
            const userOrders = orders.getUserOrders(userId);
            const userPayouts = orders.getUserPayouts(userId);
            const todayOrders = userOrders.filter(o => o.createdAt >= todayStart());
            const successOrders = todayOrders.filter(o => o.status === "success");
            const collection = successOrders.reduce((s,o) => s + o.amount, 0);
            const fees = collection * PAYIN_FEE;
            const todayPayouts = userPayouts.filter(p => p.createdAt >= todayStart() && p.status === "success");
            const payoutTotal = todayPayouts.reduce((s,p) => s + p.amount, 0);
            const balance = auth.getWallet(userId);
            return bot.sendMessage(chatId,
                "📈 *Today Statistics*\n\n" +
                "💰 Total Collection: ₹" + collection.toFixed(2) + "\n" +
                "💸 Platform Fee (11%): ₹" + fees.toFixed(2) + "\n" +
                "✅ Net Received: ₹" + (collection - fees).toFixed(2) + "\n\n" +
                "📋 Orders: " + todayOrders.length + " total\n" +
                "✅ Success: " + successOrders.length + "\n" +
                "⏳ Pending: " + todayOrders.filter(o => o.status === "pending").length + "\n" +
                "❌ Failed: " + todayOrders.filter(o => o.status === "failed").length + "\n\n" +
                "💸 Withdrawals Today: ₹" + payoutTotal.toFixed(2) + "\n" +
                "💼 Current Balance: ₹" + balance.toFixed(2),
                { parse_mode: "Markdown" }
            );
        }

        if (text === "💸 Withdraw" || text === "💸 Withdraw Funds") {
            const balance = auth.getWallet(userId);
            if (balance < 100) {
                return bot.sendMessage(chatId,
                    "❌ *Insufficient Balance*\n\nBalance: ₹" + balance.toFixed(2) + "\nMinimum withdrawal: ₹100",
                    { parse_mode: "Markdown" }
                );
            }
            withdrawData[chatId] = { step: "amount" };
            return bot.sendMessage(chatId,
                "💸 *Withdraw Funds*\n\n" +
                "💼 Available: ₹" + balance.toFixed(2) + "\n" +
                "Fee: " + config.PAYOUT_FEE_PCT + "%\n\n" +
                "Enter withdrawal amount:",
                { parse_mode: "Markdown" }
            );
        }

        if (text === "👑 Admin" && String(chatId) === OWNER_ID) {
            return bot.sendMessage(chatId, "👑 *Admin Panel*", {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [
                    [{ text: "🔑 Generate Key", callback_data: "admin_genkey" }],
                    [{ text: "👥 All Users", callback_data: "admin_users" }],
                    [{ text: "📋 Pending Orders", callback_data: "admin_orders" }],
                    [{ text: "💰 Platform Stats", callback_data: "admin_stats" }],
                    [{ text: "🚫 Revoke User", callback_data: "admin_revoke_menu" }]
                ]}
            });
        }

    } catch (err) { console.log("MSG ERROR:", err.message); }
});

// ── CALLBACK QUERIES ──
bot.on("callback_query", async (query) => {
    try {
        const chatId = query.message.chat.id;
        const userId = String(chatId);
        const data = query.data;
        await bot.answerCallbackQuery(query.id).catch(() => {});

        // ── ADMIN: Confirm payment ──
        if (data.startsWith("confirm_") && String(chatId) === OWNER_ID) {
            const orderNo = data.replace("confirm_", "");
            const order = orders.getOrder(orderNo);
            if (!order || order.status !== "pending") return bot.sendMessage(chatId, "⚠️ Order not found or already processed.");
            orders.updateOrder(orderNo, { status: "success" });
            const newBalance = auth.updateWallet(order.userId, order.amount);
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
            await bot.sendMessage(chatId, "✅ Payment confirmed! ₹" + order.amount + " credited to user " + order.userId);
            await bot.sendMessage(order.userId,
                "✅ *Payment Confirmed!*\n\n" +
                "💰 Amount: ₹" + order.amount + "\n" +
                "🧾 Order: `" + orderNo + "`\n" +
                "💼 New Balance: ₹" + (newBalance || 0).toFixed(2),
                { parse_mode: "Markdown" }
            );
            return;
        }

        // ── ADMIN: Reject payment ──
        if (data.startsWith("reject_") && String(chatId) === OWNER_ID) {
            const orderNo = data.replace("reject_", "");
            const order = orders.getOrder(orderNo);
            if (!order) return bot.sendMessage(chatId, "⚠️ Order not found.");
            orders.updateOrder(orderNo, { status: "failed" });
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
            await bot.sendMessage(chatId, "❌ Payment rejected for order " + orderNo);
            await bot.sendMessage(order.userId,
                "❌ *Payment Rejected*\n\nOrder: `" + orderNo + "`\n\nContact support if you believe this is an error.",
                { parse_mode: "Markdown" }
            );
            return;
        }

        // ── WITHDRAW CONFIRM ──
        if (data === "withdraw_confirm") {
            const d = withdrawData[chatId];
            if (!d) return bot.sendMessage(chatId, "❌ Session expired. Try again.");
            delete withdrawData[chatId];

            const balance = auth.getWallet(userId);
            if (d.amount > balance) return bot.sendMessage(chatId, "❌ Insufficient balance.");

            auth.updateWallet(userId, -d.amount);
            const transactionId = watchpays.generateTransactionId();
            orders.createPayout(userId, transactionId, d.amount, d);

            const statusMsg = await bot.sendMessage(chatId, "⏳ Processing withdrawal...");

            try {
                const result = await watchpays.createPayoutOrder(transactionId, d.amount, d);
                if (result.status === "success") {
                    const fee = (d.amount * PAYOUT_FEE).toFixed(2);
                    await bot.editMessageText(
                        "✅ *Withdrawal Submitted!*\n\n" +
                        "💸 Amount: ₹" + d.amount + "\n" +
                        "💸 Fee: ₹" + fee + "\n" +
                        "🔖 Transaction: `" + transactionId + "`\n\n" +
                        "You'll be notified once processed.",
                        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "Markdown" }
                    );
                } else {
                    throw new Error(result.message || "Payout failed");
                }
            } catch (err) {
                auth.updateWallet(userId, d.amount);
                orders.updatePayout(transactionId, { status: "failed" });
                await bot.editMessageText(
                    "❌ Withdrawal failed: " + err.message + "\n\nAmount refunded to wallet.",
                    { chat_id: chatId, message_id: statusMsg.message_id }
                );
            }
            return;
        }

        if (data === "withdraw_cancel") {
            delete withdrawData[chatId];
            return bot.sendMessage(chatId, "❌ Withdrawal cancelled.", mainKeyboard(chatId));
        }

        // ── ADMIN PANEL CALLBACKS ──
        if (String(chatId) !== String(OWNER_ID)) return;

        if (data === "admin_revoke_menu") {
            const users = auth.getAllUsers();
            const ids = Object.keys(users);
            if (ids.length === 0) return bot.sendMessage(chatId, "No users to revoke.");
            const buttons = ids.map(uid => {
                const u = users[uid];
                return [{ text: "🚫 " + (u.username || uid), callback_data: "admin_revoke_" + uid }];
            });
            buttons.push([{ text: "🔙 Back", callback_data: "admin_back" }]);
            return bot.sendMessage(chatId, "🚫 *Select user to revoke:*", {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (data.startsWith("admin_revoke_")) {
            const targetId = data.replace("admin_revoke_", "");
            const users = auth.getAllUsers();
            if (!users[targetId]) return bot.sendMessage(chatId, "User not found.");
            const username = users[targetId].username || targetId;
            // Remove user
            delete users[targetId];
            const fs = require("fs");
            const path = require("path");
            fs.writeFileSync(path.join(__dirname, "data/payment-users.json"), JSON.stringify(users, null, 2));
            await bot.sendMessage(chatId, "✅ User " + username + " (" + targetId + ") revoked successfully.");
            // Notify user
            await bot.sendMessage(targetId,
                "🚫 *Your access has been revoked.*\n\nContact admin: @btcshadow",
                { parse_mode: "Markdown" }
            ).catch(() => {});
            return;
        }

        if (data === "admin_back") {
            return bot.sendMessage(chatId, "👑 *Admin Panel*", {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [
                    [{ text: "🔑 Generate Key", callback_data: "admin_genkey" }],
                    [{ text: "👥 All Users", callback_data: "admin_users" }],
                    [{ text: "📋 Pending Orders", callback_data: "admin_orders" }],
                    [{ text: "💰 Platform Stats", callback_data: "admin_stats" }],
                    [{ text: "🚫 Revoke User", callback_data: "admin_revoke_menu" }]
                ]}
            });
        }

        if (data === "admin_genkey") {
            const key = auth.generateKey(chatId);
            return bot.sendMessage(chatId,
                "🔑 *New Access Key Generated*\n\n`" + key + "`\n\nShare with user to activate.",
                { parse_mode: "Markdown" }
            );
        }

        if (data === "admin_users") {
            const users = auth.getAllUsers();
            const ids = Object.keys(users);
            if (ids.length === 0) return bot.sendMessage(chatId, "No users yet.");
            let t = "👥 All Users (" + ids.length + ")\n\n";
            ids.forEach(uid => {
                const u = users[uid];
                const name = (u.username || "Unknown").replace(/[_*`\[\]]/g, "\\$&");
                t += "👤 " + name + " (" + uid + ")\n";
                t += "💼 Balance: Rs" + (u.wallet || 0).toFixed(2) + "\n\n";
            });
            return bot.sendMessage(chatId, t);
        }

        if (data === "admin_orders") {
            const allOrders = orders.getPendingOrders();
            if (allOrders.length === 0) return bot.sendMessage(chatId, "✅ No pending orders.");
            let t = "📋 *Pending Orders (" + allOrders.length + ")*\n\n";
            allOrders.slice(0, 10).forEach((o, i) => {
                t += (i+1) + ". 💰 ₹" + o.amount + " — User: `" + o.userId + "`\n";
                t += "🧾 `" + o.merchantOrderNo + "`\n";
                if (o.utr) t += "🔖 UTR: `" + o.utr + "`\n";
                t += "\n";
            });
            return bot.sendMessage(chatId, t, {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: allOrders.slice(0,5).map(o => [
                    { text: "✅ " + o.merchantOrderNo, callback_data: "confirm_" + o.merchantOrderNo },
                    { text: "❌ Reject", callback_data: "reject_" + o.merchantOrderNo }
                ])}
            });
        }

        if (data === "admin_stats") {
            const users = auth.getAllUsers();
            let totalBalance = 0;
            Object.values(users).forEach(u => { totalBalance += u.wallet || 0; });
            const allOrdersList = orders.getPendingOrders();
            return bot.sendMessage(chatId,
                "📊 *Platform Stats*\n\n" +
                "👥 Total Users: " + Object.keys(users).length + "\n" +
                "💼 Total Wallets: ₹" + totalBalance.toFixed(2) + "\n" +
                "⏳ Pending Orders: " + allOrdersList.length,
                { parse_mode: "Markdown" }
            );
        }

    } catch (err) { console.log("CB ERROR:", err.message); }
});

// ── ERRORS ──
bot.on("polling_error", err => console.log("POLLING ERROR:", err.message));
bot.on("error", err => console.log("BOT ERROR:", err.message));
process.on("unhandledRejection", err => console.log("UNHANDLED:", err));
process.on("uncaughtException", err => console.log("UNCAUGHT:", err));
