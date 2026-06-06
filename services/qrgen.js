// payment-bot/services/qrgen.js
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

/**
 * Generate QR code image for a URL using QuickChart API (free, no API key needed)
 * Returns path to saved QR image
 */
function generateQR(url, outputPath) {
    return new Promise((resolve, reject) => {
        const encoded = encodeURIComponent(url);
        const qrUrl = `https://quickchart.io/qr?text=${encoded}&size=300&margin=2`;

        const file = fs.createWriteStream(outputPath);
        https.get(qrUrl, (response) => {
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve(outputPath);
            });
        }).on("error", (err) => {
            fs.unlink(outputPath, () => {});
            reject(err);
        });
    });
}

module.exports = { generateQR };
