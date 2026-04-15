const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

// ===== ENV / ตั้งค่า =====
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;

// ── ส่ง Telegram ──────────────────────────────────────────
async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

// ── ดึงข่าวทอง ────────────────────────────────────────────
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
    return titles.length ? titles.join("\n") : "ไม่พบข่าวทองใหม่";
  } catch {
    return "ดึงข่าวไม่สำเร็จ";
  }
}

// ── วิเคราะห์กราฟ + ข่าว ด้วย Claude AI ──────────────────
async function analyzeWithAI(chartData, news) {
  const {
    action, price, entry, sl, tp1, tp2,
    ema21, ema50, ema200,
    support, resistance, atr,
    trend, smc, timeframe, ticker
  } = chartData;

  const prompt = `
คุณเป็น Smart Money Concept (SMC) Gold Trading Analyst ระดับ Professional

=== ข้อมูลกราฟจาก TradingView ===
Symbol     : ${ticker}
Timeframe  : ${timeframe}
ราคาปัจจุบัน: $${price}
แนวโน้ม    : ${trend}

--- EMA ---
EMA 21  : ${ema21}
EMA 50  : ${ema50}
EMA 200 : ${ema200}

--- Support / Resistance ---
Support    : ${support}
Resistance : ${resistance}

--- SMC Signal ---
${smc}
สัญญาณ Pine Script: ${action}
ATR (14): ${atr}

--- จุด Entry/SL/TP จาก Pine Script ---
Entry: ${entry}
SL   : ${sl}
TP1  : ${tp1}
TP2  : ${tp2}

=== ข่าวที่กระทบทองล่าสุด ===
${news}

=== คำสั่ง ===
วิเคราะห์รวม Chart + SMC + ข่าว แล้วตอบ JSON เท่านั้น ห้ามมีข้อความอื่น:
{
  "direction": "BUY หรือ SELL หรือ WAIT",
  "confidence": "HIGH หรือ MEDIUM หรือ LOW",
  "entry": ราคาเข้าที่แนะนำ (ตัวเลข),
  "sl": stop loss (ตัวเลข),
  "tp1": take profit 1 (ตัวเลข),
  "tp2": take profit 2 (ตัวเลข),
  "rr_ratio": "Risk:Reward เช่น 1:2.5",
  "smc_reason": "วิเคราะห์ SMC 1-2 ประโยค",
  "news_impact": "Positive หรือ Negative หรือ Neutral",
  "news_reason": "อธิบายข่าว 1 ประโยค",
  "final_reason": "สรุปรวม 1-2 ประโยค",
  "risk_level": "HIGH หรือ MEDIUM หรือ LOW"
}
`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const raw = data.content?.[0]?.text || "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ── สร้างข้อความ Telegram ─────────────────────────────────
function buildMessage(ai, chartData, news) {
  const dir = ai.direction;
  const dirEmoji  = dir === "BUY" ? "🟢" : dir === "SELL" ? "🔴" : "⏸";
  const confEmoji = ai.confidence === "HIGH" ? "🔥" : ai.confidence === "MEDIUM" ? "⚡" : "💤";
  const newsEmoji = ai.news_impact === "Positive" ? "📈" : ai.news_impact === "Negative" ? "📉" : "➡️";

  return `
${dirEmoji} <b>XAUUSD ${dir}</b>  ${confEmoji} ${ai.confidence} Confidence

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
• ${newsEmoji} ข่าว (${ai.news_impact}) : ${ai.news_reason}
• สรุป : ${ai.final_reason}

⚠️ ความเสี่ยง : ${ai.risk_level}

📰 <b>ข่าวที่ใช้วิเคราะห์</b>
${news.split("\n").slice(0, 3).map(n => `• ${n}`).join("\n")}

🕐 ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
⏱ Timeframe : ${chartData.timeframe}
`.trim();
}

// ── Webhook รับจาก TradingView ────────────────────────────
app.post("/webhook", async (req, res) => {
  console.log("📩 Alert:", req.body);
  try {
    const chartData = req.body;
    await sendTelegram(`⏳ <b>รับสัญญาณ ${chartData.ticker} ${chartData.action}</b>\nราคา: $${chartData.price}\nกำลังวิเคราะห์ SMC + ข่าว...`);
    const news = await getGoldNews();
    const ai   = await analyzeWithAI(chartData, news);
    const msg  = buildMessage(ai, chartData, news);
    await sendTelegram(msg);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌", err.message);
    await sendTelegram(`❌ Error: ${err.message}`);
    res.status(500).json({ ok: false });
  }
});

// ── ทดสอบ ─────────────────────────────────────────────────
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
    const ai   = await analyzeWithAI(mockData, news);
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
