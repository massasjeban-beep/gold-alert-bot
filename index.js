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
    return titles.length ? titles.join("\n") : "ไม่พบข่าวทองใหม่";
  } catch {
    return "ดึงข่าวไม่สำเร็จ";
  }
}

async function analyzeWithGemini(chartData, news) {
  const { action, price, entry, sl, tp1, tp2, ema21, ema50, ema200,
          support, resistance, atr, trend, smc, timeframe, ticker } = chartData;

  const prompt = `คุณเป็น SMC Gold Trading Analyst วิเคราะห์ทองคำ XAUUSD

ข้อมูลกราฟ:
- ราคาปัจจุบัน: $${price} แนวโน้ม: ${trend}
- EMA 21/50/200: ${ema21}/${ema50}/${ema200}
- Support: ${support} Resistance: ${resistance}
- SMC: ${smc} สัญญาณ: ${action}
- Entry: ${entry} SL: ${sl} TP1: ${tp1} TP2: ${tp2}

ข่าวทอง: ${news}

กรุณาวิเคราะห์และตอบในรูปแบบนี้:
Direction: BUY/SELL/WAIT
Confidence: HIGH/MEDIUM/LOW
Entry: (ราคา)
SL: (ราคา)
TP1: (ราคา)
TP2: (ราคา)
RR: (เช่น 1:2)
SMC: (วิเคราะห์ 1 ประโยค)
News: Positive/Negative/Neutral - (อธิบาย 1 ประโยค)
Summary: (สรุป 1 ประโยค)
Risk: HIGH/MEDIUM/LOW`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "วิเคราะห์ไม่สำเร็จ";
  
  // Parse text response
  const get = (key) => {
    const match = text.match(new RegExp(`${key}:\\s*(.+)`));
    return match ? match[1].trim() : "N/A";
  };

  return {
    direction:   get("Direction"),
    confidence:  get("Confidence"),
    entry:       get("Entry"),
    sl:          get("SL"),
    tp1:         get("TP1"),
    tp2:         get("TP2"),
    rr_ratio:    get("RR"),
    smc_reason:  get("SMC"),
    news_line:   get("News"),
    final_reason:get("Summary"),
    risk_level:  get("Risk"),
  };
}

function buildMessage(ai, chartData, news) {
  const dir = ai.direction || "WAIT";
  const dirEmoji  = dir.includes("BUY") ? "🟢" : dir.includes("SELL") ? "🔴" : "⏸";
  const conf = ai.confidence || "LOW";
  const confEmoji = conf.includes("HIGH") ? "🔥" : conf.includes("MEDIUM") ? "⚡" : "💤";

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
• 📰 ข่าว : ${ai.news_line}
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
