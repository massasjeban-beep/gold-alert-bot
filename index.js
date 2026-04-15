const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;

async function sendTelegram(text) {
  const truncated = text.substring(0, 4000);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: truncated }),
  });
}

app.get("/test", async (req, res) => {
  try {
    await sendTelegram("⏳ ทดสอบ Gemini API...");

    const prompt = `Reply with exactly this text:
DIRECTION: BUY
CONFIDENCE: HIGH
ENTRY: 2685.50
SL: 2672.00
TP1: 2700.00
TP2: 2715.00
RR: 1:2
SMC_REASON: Bullish OB confirmed
NEWS_IMPACT: Neutral
NEWS_REASON: No major news
SUMMARY: Strong bullish setup
RISK: MEDIUM`;

    const res2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0 }
        }),
      }
    );

    const data = await res2.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "NO RESPONSE";
    
    await sendTelegram("📋 Gemini raw response:\n" + rawText);
    await sendTelegram("📊 Full data: " + JSON.stringify(data).substring(0, 500));
    
    res.send("✅ ดู Telegram ครับ");
  } catch (err) {
    await sendTelegram("❌ Error: " + err.message);
    res.send("❌ Error: " + err.message);
  }
});

app.get("/", (req, res) => res.send("✅ Debug Mode Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server port ${PORT}`));
