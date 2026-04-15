const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.substring(0, 4000) }),
  });
}

async function analyzeWithGemini(chartData) {
  const { action, price, entry, sl, tp1, tp2, ema21, ema50, ema200,
          support, resistance, trend, smc, timeframe, ticker } = chartData;

  const prompt = `You are a gold trading analyst. Reply ONLY with this exact format, no other text:
DIRECTION: BUY
CONFIDENCE: HIGH
ENTRY: ${entry}
SL: ${sl}
TP1: ${tp1}
TP2: ${tp2}
RR: 1:2
SMC_REASON: ${smc} confirms ${trend} bias
NEWS_IMPACT: Neutral
NEWS_REASON: No major news
SUMMARY: ${trend} trend with ${smc}
RISK: MEDIUM`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200 }
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    clearTimeout(timeout);
    return "";
  }
}

function parseAndBuild(geminiText, chartData) {
  const get = (key) => {
    const match = geminiText.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return match ? match[1].trim() : "N/A";
  };

  const dir = get("DIRECTION");
  const conf = get("CONFIDENCE");
  const dirEmoji = dir.includes("BUY") ? "🟢" : dir.includes("SELL") ? "🔴" : "⏸";
  const confEmoji = conf.includes("HIGH") ? "🔥" : conf.includes("MEDIUM") ? "⚡" : "💤";

  return `${dirEmoji} <b>XAUUSD ${dir}</b>  ${confEmoji} ${conf} Confidence

━━━━━━━━━━━━━━━━━
📊 <b>Technical (SMC + EMA)</b>
• Trend      : ${chartData.trend}
• EMA 21/50/200 : ${chartData.ema21} / ${chartData.ema50} / ${chartData.ema200}
• Support    : ${chartData.support}
• Resistance : ${chartData.resistance}
• SMC        : ${chartData.smc}

━━━━━━━━━━━━━━━━━
📍 <b>Trade Setup</b>
• Entry  : <b>$${get("ENTRY")}</b>
• SL     : $${get("SL")}
• TP1    : $${get("TP1")}
• TP2    : $${get("TP2")}
• R:R    : ${get("RR")}

━━━━━━━━━━━━━━━━━
🧠 <b>AI Analysis</b>
• SMC  : ${get("SMC_REASON")}
• ข่าว : ${get("NEWS_REASON")}
• สรุป : ${get("SUMMARY")}

⚠️ ความเสี่ยง : ${get("RISK")}
🕐 ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
⏱ Timeframe : ${chartData.timeframe}`.trim();
}

app.post("/webhook", async (req, res) => {
  try {
    const chartData = req.body;
    await sendTelegram(`⏳ <b>รับสัญญาณ ${chartData.ticker} ${chartData.action}</b>\nราคา: $${chartData.price}`);
    const geminiText = await analyzeWithGemini(chartData);
    const msg = parseAndBuild(geminiText, chartData);
    await sendTelegram(msg);
    res.status(200).json({ ok: true });
  } catch (err) {
    await sendTelegram(`❌ Error: ${err.message}`);
    res.status(500).json({ ok: false });
  }
});

app.get("/test", async (req, res) => {
  const mockData = {
    ticker: "XAUUSD", action: "BUY", price: 2685.50,
    entry: 2685.50, sl: 2672.00, tp1: 2700.00, tp2: 2715.00,
    ema21: 2678.30, ema50: 2660.10, ema200: 2580.00,
    support: 2670.00, resistance: 2710.00, atr: 8.5,
    trend: "BULLISH", smc: "Bullish OB + BOS detected", timeframe: "1H"
  };
  try {
    await sendTelegram("⏳ ทดสอบระบบ...");
    const geminiText = await analyzeWithGemini(mockData);
    await sendTelegram("📋 Raw:\n" + (geminiText || "EMPTY"));
    if (geminiText) {
      const msg = parseAndBuild(geminiText, mockData);
      await sendTelegram(msg);
    }
    res.send("✅ ดู Telegram ครับ");
  } catch (err) {
    res.send("❌ Error: " + err.message);
  }
});

app.get("/", (req, res) => res.send("✅ Gold SMC Alert System v3"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server port ${PORT}`));
    
