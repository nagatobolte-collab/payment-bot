// payment-bot/services/watchpays.js
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const querystring = require("querystring");
const config = require("../config");

function md5(str) {
    return crypto.createHash("md5").update(str).digest("hex");
}

// ── PAY-IN ──

function generatePayinSignature(amount, merchantOrderNo) {
    const params = {
        amount: parseFloat(amount).toFixed(2),
        callback_url: config.PAYIN_CALLBACK,
        merchant_id: config.MERCHANT_ID,
        merchant_order_no: merchantOrderNo
    };
    // Sort alphabetically
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
    const signStr = sorted + "&key=" + config.PAYIN_API_KEY;
    return md5(signStr);
}

function createPayinOrder(amount, merchantOrderNo, extra = "") {
    return new Promise((resolve, reject) => {
        const signature = generatePayinSignature(amount, merchantOrderNo);
        const body = JSON.stringify({
            merchant_id: config.MERCHANT_ID,
            api_key: config.PAYIN_API_KEY,
            amount: parseFloat(amount).toFixed(2),
            merchant_order_no: merchantOrderNo,
            callback_url: config.PAYIN_CALLBACK,
            extra: extra,
            signature: signature
        });

        const url = new URL(config.PAYIN_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Invalid response: " + data)); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// ── PAYOUT ──

function generatePayoutSignature(params) {
    // md5(account_number + amount + bank_name + callback_url + ifsc + merchant_id + name + transaction_id + payout_key)
    const str = params.account_number + params.amount + params.bank_name +
        params.callback_url + params.ifsc + params.merchant_id +
        params.name + params.transaction_id + config.PAYOUT_API_KEY;
    return md5(str);
}

function createPayoutOrder(transactionId, amount, bankDetails) {
    return new Promise((resolve, reject) => {
        const params = {
            merchant_id: config.MERCHANT_ID,
            amount: parseFloat(amount),
            transaction_id: transactionId,
            account_number: bankDetails.accountNumber,
            ifsc: bankDetails.ifsc,
            name: bankDetails.name,
            bank_name: bankDetails.bankName,
            callback_url: config.PAYOUT_CALLBACK,
        };
        params.signature = generatePayoutSignature(params);

        const body = querystring.stringify(params);
        const url = new URL(config.PAYOUT_URL);
        const isHttps = url.protocol === "https:";
        const lib = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body)
            }
        };

        const req = lib.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Invalid response: " + data)); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// Generate unique order number
function generateOrderNo(userId) {
    return "ORD" + Date.now() + userId.toString().slice(-4);
}

function generateTransactionId() {
    return "WD_" + Date.now();
}

// Format amount
function formatAmount(amount) {
    return parseFloat(amount).toFixed(2);
}

module.exports = {
    createPayinOrder, createPayoutOrder,
    generateOrderNo, generateTransactionId, formatAmount, md5
};
