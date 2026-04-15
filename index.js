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

  const prompt = `
คุณเป็น SMC Gold Trading Analyst ระดับ Professional

Symbol: ${ticker} | Timeframe: ${timeframe} | ราคา: $${price} | แนวโน้ม: ${trend}
EMA 21/50/200: ${ema21} / ${ema50} / ${ema200}
Support: ${support} | Resistance: ${resistance} | ATR: ${atr}
SMC: ${smc} | สัญญาณ: ${action}
Entry: ${entry} | SL: ${sl} | TP1: ${tp1} | TP2: ${tp2}

ข่าวทอง: ${news}

ตอบ JSON เท่านั้น ห้ามมีข้อความอื่น:
{"direction":"BUY หรือ SELL หรือ WAIT","confidence":"HIGH หรือ MEDIUM หรือ LOW","entry":0,"sl":0,"tp1":0,"tp2":0,"rr_ratio":"1:2","smc_reason":"","news_impact":"Positive หรือ Negative หรือ Neutral","news_reason":"","final_reason":"","risk_level":"HIGH หรือ MEDIUM หรือ LOW"}
`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

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

app.post("/webhook", async (req, res) => {
  console.log("📩 Alert:", req.body);
  try {
    const chartData = req.body;
    await sendTelegram(`⏳ <b>รับสัญญาณ ${chartData.ticker} ${chartData.action}</b>\nราคา: $${chartData.price}\nกำลังวิเคราะห์...`);
    const news = await getGoldNews();
    const ai   = await analyzeWithGemini(chartData, news);
    const msg  = buildMessage(ai, chartData, news);
    await sendTelegram(msg);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌", err.message);
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
                            
