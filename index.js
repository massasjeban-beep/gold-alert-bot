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
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

async function getGoldNews() {
  try {
    const res = await fetch("https://feeds.reuters.com/reuters/businessNews", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const text = await res.text();
    const titles = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)]
      .map(m => (m[1] || m[2] || "").trim())
      .filter(t => /gold|xau|fed|rate|inflation|cpi|usd|war|crisis|dollar/i.test(t))
      .slice(0, 5);
    return titles.length ? titles.join("\n") : "No gold news found";
  } catch {
    return "Could not fetch news";
  }
}

async function analyzeWithGemini(chartData, news) {
  const { action, price, entry, sl, tp1, tp2, ema21, ema50, ema200,
          support, resistance, atr, trend, smc, timeframe, ticker } = chartData;

  const prompt = `You are a professional XAUUSD SMC Trading Analyst. Respond in ENGLISH ONLY.

Chart: ${ticker} ${timeframe} | Price: ${price} | Trend: ${trend}
EMA: ${ema21}/${ema50}/${ema200} | Support: ${support} | Resistance: ${resistance}
SMC: ${smc} | Signal: ${action}
Entry: ${entry} | SL: ${sl} | TP1: ${tp1} | TP2: ${tp2}
News: ${news}

Reply EXACTLY in this format (no extra text):
DIRECTION: BUY
CONFIDENCE: HIGH
ENTRY: ${entry}
SL: ${sl}
TP1: ${tp1}
TP2: ${tp2}
RR: 1:2
SMC_REASON: Bullish OB confirmed with BOS, price above EMA200
NEWS_IMPACT: Neutral
NEWS_REASON: No significant news affecting gold
SUMMARY: Strong bullish setup with SMC confirmation and trend alignment
RISK: MEDIUM`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
      }),
    }
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log("Gemini response:", text);

  const get = (key) => {
    const match = text.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return match ? match[1].trim() : "N/A";
  };

  return {
    direction:    get("DIRECTION"),
    confidence:   get("CONFIDENCE"),
    entry:        get("ENTRY"),
    sl:           get("SL"),
    tp1:          get("TP1"),
    tp2:          get("TP2"),
    rr_ratio:     get("RR"),
    smc_reason:   get("SMC_REASON"),
    news_impact:  get("NEWS_IMPACT"),
    news_reason:  get("NEWS_REASON"),
    final_reason: get("SUMMARY"),
    risk_level:   get("RISK"),
  };
}

function buildMessage(ai, chartData, news) {
  const dir = ai.direction || "WAIT";
  const dirEmoji  = dir.includes("BUY") ? "🟢" : dir.includes("SELL") ? "🔴" : "⏸";
  const conf = ai.confidence || "LOW";
  const confEmoji = conf.includes("HIGH") ? "🔥" : conf.includes("MEDIUM") ? "⚡" : "💤";
  const impact = ai.news_impact || "Neutral";
  const newsEmoji = impact.includes("Positive") ? "📈" : impact.includes("Negative") ? "📉" : "➡️";

  return `
${dirEmoji} <b>XAUUSD ${dir}</b>  ${confEmoji} ${conf} Confidence

━━━━━━━━━━━━━━━━━
📊 <b>Technical (SMC + EMA)</b>
• Trend      : ${chartData.trend}
• EMA 21/50/200 : ${chartData.ema21} / ${chartData.ema50} / ${chartData.ema200}
• Support    : ${chartData.support}
• Resistance : ${chartData.resistance}
• SMC        : ${chartData.smc}

━━━━━━━━━━━━━━━━━
📍 <b>Trade Setup</b>
• Entry  : <b>$${ai.entry}</b>
• SL     : $${ai.sl}
• TP1    : $${ai.tp1}
• TP2    : $${ai.tp2}
• R:R    : ${ai.rr_ratio}

━━━━━━━━━━━━━━━━━
🧠 <b>AI Analysis</b>
• SMC  : ${ai.smc_reason}
• ${newsEmoji} ข่าว (${impact}) : ${ai.news_reason}
• สรุป : ${ai.final_reason}

⚠️ ความเสี่ยง : ${ai.risk_level}

📰 <b>ข่าวที่ใช้วิเคราะห์</b>
${news.split("\n").slice(0, 3).map(n => `• ${n}`).join("\n")}

🕐 ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
⏱ Timeframe : ${chartData.timeframe}
`.trim();
}

app.post("/webhook", async (req, res) => {
  try {
    const chartData = req.body;
    await sendTelegram(`⏳ <b>รับสัญญาณ ${chartData.ticker} ${chartData.action}</b>\nราคา: $${chartData.price}\nกำลังวิเคราะห์...`);
    const news = await getGoldNews();
    const ai   = await analyzeWithGemini(chartData, news);
    const msg  = buildMessage(ai, chartData, news);
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
    await sendTelegram("⏳ ทดสอบระบบ กำลังวิเคราะห์...");
    const news = await getGoldNews();
    const ai   = await analyzeWithGemini(mockData, news);
    const msg  = buildMessage(ai, mockData, news);
    await sendTelegram(msg);
    res.send("✅ ส่งข้อความทดสอบแล้ว ตรวจสอบ Telegram");
  } catch (err) {
    res.send("❌ Error: " + err.message);
  }
});

app.get("/", (req, res) => res.send("✅ Gold SMC Alert System Running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server port ${PORT}`));
