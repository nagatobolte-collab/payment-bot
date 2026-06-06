// payment-bot/config.js
module.exports = {
    BOT_TOKEN: "8091014278:AAH4JbHsUf-2tL4SsgEQF7py3JLAerHCzY8",
    OWNER_ID: "7236119161",
    MERCHANT_ID: "100555028",
    PAYIN_API_KEY: "cc6b79d75566b050059c8ec16bf2315e",
    PAYOUT_API_KEY: "B02DF06C4A3AB6AE10C7237B54A2E8FF",
    PAYIN_FEE_PCT: 11.00,
    PAYOUT_FEE_PCT: 4.00,
    PAYIN_URL: "https://api.watchpays.com/v1/create",
    PAYOUT_URL: "http://api.watchpays.com/payout/payment.php",
    WEBHOOK_PORT: 3000,
    WEBHOOK_HOST: "http://194.238.17.87",
    PAYIN_CALLBACK: "http://194.238.17.87:3000/webhook/payin",
    PAYOUT_CALLBACK: "http://194.238.17.87:3000/webhook/payout",
};
