import { useState, useEffect, useRef } from "react";

// ============================================================
// STORAGE UTILITIES
// ============================================================
const storage = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

const getApiKey = () => storage.get("anthropic_api_key") || "";
const getHistory = () => storage.get("conversation_history") || [];
const saveHistory = (h) => storage.set("conversation_history", h);
const getFlashcards = () => storage.get("flashcards") || [];
const saveFlashcards = (f) => storage.set("flashcards", f);
const getTodayNews = () => {
  const today = new Date().toDateString();
  const stored = storage.get("today_news");
  if (stored && stored.date === today) return stored.news;
  return null;
};
const saveTodayNews = (news) => {
  storage.set("today_news", { date: new Date().toDateString(), news });
};

// SM-2 Algorithm
function sm2(card, quality) {
  let { repetitions = 0, easeFactor = 2.5, interval = 1 } = card;
  if (quality < 1) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 3;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (2 - quality) * (0.08 + (2 - quality) * 0.02));
  }
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  return { ...card, repetitions, easeFactor, interval, nextReview: nextReview.toISOString(), lastReview: new Date().toISOString() };
}

function getDueCards() {
  const cards = getFlashcards();
  const now = new Date();
  return cards.filter(c => !c.nextReview || new Date(c.nextReview) <= now);
}

// ============================================================
// API CALL
// ============================================================
async function callClaude(messages, systemPrompt, useWebSearch = false) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Clé API manquante");

  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: systemPrompt,
    messages,
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "interleaved-thinking-2025-05-14" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erreur API ${res.status}`);
  }
  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

// ============================================================
// PARSE NEWS
// ============================================================
function parseNewsItems(text) {
  const items = [];
  const blocks = text.split(/\n(?=#{1,2}\s|\*\*\d+[\.\)]|\d+[\.\)])/g);
  for (const block of blocks) {
    const lines = block.trim().split("\n").filter(Boolean);
    if (!lines.length) continue;
    const title = lines[0].replace(/^#+\s*/, "").replace(/^\*\*\d+[\.\)]\s*/, "").replace(/^\d+[\.\)]\s*/, "").replace(/\*\*/g, "").trim();
    if (!title || title.length < 5) continue;
    const body = lines.slice(1).join("\n");
    const sections = { event: "", context: "", reflection: "" };
    const eMatch = body.match(/ce qu['']il s['']est passé[^\n]*([\s\S]*?)(?=\*\s*contexte|##|$)/i);
    const cMatch = body.match(/contexte[^\n]*([\s\S]*?)(?=\*\s*pistes|##|$)/i);
    const rMatch = body.match(/pistes[^\n]*([\s\S]*?)(?=\*\s*ce qu|##|\d+\.|$)/i);
    sections.event = eMatch ? eMatch[1].trim() : body.substring(0, 200);
    sections.context = cMatch ? cMatch[1].trim() : "";
    sections.reflection = rMatch ? rMatch[1].trim() : "";
    items.push({ id: Date.now() + Math.random(), title, ...sections, raw: block });
  }
  return items.slice(0, 10);
}

// ============================================================
// ICONS
// ============================================================
const Icon = ({ name, size = 20 }) => {
  const icons = {
    home: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    newspaper: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    brain: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96-.46 2.5 2.5 0 01-1.07-4.58A3 3 0 015 11c0-.7.24-1.34.64-1.85A3 3 0 017 3.34 2.5 2.5 0 019.5 2zM14.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 004.96-.46 2.5 2.5 0 001.07-4.58A3 3 0 0019 11c0-.7-.24-1.34-.64-1.85A3 3 0 0017 3.34 2.5 2.5 0 0014.5 2z"/></svg>,
    history: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/><polyline points="12 7 12 12 16 14"/></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
    send: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    save: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  };
  return icons[name] || null;
};

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [page, setPage] = useState("home");
  const [pageParams, setPageParams] = useState({});

  const navigate = (p, params = {}) => { setPage(p); setPageParams(params); };

  const dueCount = getDueCards().length;

  return (
    <div style={styles.app}>
      <style>{globalCSS}</style>
      <div style={styles.content}>
        {page === "home" && <HomePage navigate={navigate} dueCount={dueCount} />}
        {page === "news" && <NewsPage navigate={navigate} />}
        {page === "explore" && <ExplorePage navigate={navigate} params={pageParams} />}
        {page === "history" && <HistoryPage navigate={navigate} />}
        {page === "quiz" && <QuizPage navigate={navigate} />}
        {page === "settings" && <SettingsPage navigate={navigate} />}
      </div>
      {page !== "home" && (
        <BottomNav current={page} navigate={navigate} dueCount={dueCount} />
      )}
    </div>
  );
}

// ============================================================
// HOME PAGE
// ============================================================
function HomePage({ navigate, dueCount }) {
  return (
    <div style={styles.homePage}>
      <div style={styles.homeHeader}>
        <div style={styles.homeLogoRow}>
          <span style={styles.homeLogo}>mémo</span>
          <span style={styles.homeLogoAccent}>actu</span>
        </div>
        <p style={styles.homeTagline}>Restez informé. Mémorisez durablement.</p>
      </div>

      <div style={styles.homeCards}>
        <HomeCard icon="newspaper" title="Actualités du jour" desc="10 sujets clés avec contexte et analyse" color="#E8F4FD" accent="#2196F3" onClick={() => navigate("news")} />
        <HomeCard icon="search" title="Explorer un sujet" desc="Posez vos questions sur n'importe quel sujet" color="#F0FDF4" accent="#22C55E" onClick={() => navigate("explore")} />
        <HomeCard icon="brain" title="Quiz du jour" desc={dueCount > 0 ? `${dueCount} carte${dueCount > 1 ? "s" : ""} à réviser aujourd'hui` : "Aucune révision pour aujourd'hui"} color="#FFF7ED" accent="#F97316" badge={dueCount > 0 ? dueCount : null} onClick={() => navigate("quiz")} />
        <HomeCard icon="history" title="Historique" desc="Retrouvez vos conversations passées" color="#FAF5FF" accent="#A855F7" onClick={() => navigate("history")} />
      </div>

      <button style={styles.settingsBtn} onClick={() => navigate("settings")}>
        <Icon name="settings" size={18} /> Paramètres
      </button>
    </div>
  );
}

function HomeCard({ icon, title, desc, color, accent, badge, onClick }) {
  return (
    <button style={{ ...styles.homeCard, background: color, borderLeft: `4px solid ${accent}` }} onClick={onClick} className="homeCard">
      <div style={{ ...styles.homeCardIcon, color: accent }}>
        <Icon name={icon} size={26} />
        {badge && <span style={{ ...styles.badge, background: accent }}>{badge}</span>}
      </div>
      <div>
        <div style={styles.homeCardTitle}>{title}</div>
        <div style={styles.homeCardDesc}>{desc}</div>
      </div>
    </button>
  );
}

// ============================================================
// NEWS PAGE
// ============================================================
function NewsPage({ navigate }) {
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    const cached = getTodayNews();
    if (cached) setNews(cached);
    else fetchNews();
  }, []);

  async function fetchNews() {
    setLoading(true);
    setError("");
    try {
      const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const text = await callClaude(
        [{ role: "user", content: `Donne-moi un résumé de l'actualité internationale du ${today} en 10 sujets majeurs. Pour chaque sujet, utilise exactement ce format:\n\n## [Titre du sujet]\n* Ce qu'il s'est passé : [2-3 phrases]\n* Contexte : [2-3 phrases de contexte historique ou géopolitique]\n* Pistes de réflexion : [1-2 questions pour approfondir]\n\nSépare chaque sujet clairement.` }],
        "Tu es un journaliste expert en actualité internationale. Tu fournis des résumés clairs, précis et pédagogiques.",
        true
      );
      const items = parseNewsItems(text);
      if (items.length === 0) {
        const fallback = [{ id: 1, title: "Actualités du jour", event: text, context: "", reflection: "", raw: text }];
        setNews(fallback);
        saveTodayNews(fallback);
      } else {
        setNews(items);
        saveTodayNews(items);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (selectedItem) {
    return <ConversationPage item={selectedItem} onBack={() => setSelectedItem(null)} context="news" />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>📰 Actualités du jour</h1>
        <span style={styles.pageDate}>{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
        {!loading && (
          <button style={styles.iconBtn} onClick={fetchNews} title="Rafraîchir">
            <Icon name="refresh" size={18} />
          </button>
        )}
      </div>
      {loading && <LoadingState text="Recherche des actualités du jour..." />}
      {error && <ErrorState msg={error} onRetry={fetchNews} />}
      {news && !loading && (
        <div style={styles.newsList}>
          {news.map((item, i) => (
            <button key={item.id} style={styles.newsCard} className="newsCard" onClick={() => setSelectedItem(item)}>
              <span style={styles.newsNum}>{i + 1}</span>
              <div style={styles.newsContent}>
                <div style={styles.newsTitle}>{item.title}</div>
                {item.event && <div style={styles.newsPreview}>{item.event.substring(0, 100)}…</div>}
              </div>
              <span style={styles.chevron}>›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// EXPLORE PAGE
// ============================================================
function ExplorePage({ navigate, params }) {
  const [query, setQuery] = useState(params.query || "");
  const [started, setStarted] = useState(false);
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startExploration() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const text = await callClaude(
        [{ role: "user", content: `Explique-moi le sujet suivant : "${query}"\n\nUtilise ce format :\n\n## ${query}\n* Ce qu'il s'est passé : [les faits essentiels]\n* Contexte : [contexte historique, géopolitique ou économique pour comprendre]\n* Pistes de réflexion : [2-3 questions pour approfondir]` }],
        "Tu es un expert polyvalent capable d'expliquer n'importe quel sujet d'actualité de façon claire, contextuelle et pédagogique.",
        true
      );
      setItem({ id: Date.now(), title: query, raw: text, event: text, context: "", reflection: "" });
      setStarted(true);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (started && item) {
    return <ConversationPage item={item} onBack={() => { setStarted(false); setItem(null); }} context="explore" />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>🔍 Explorer un sujet</h1>
      </div>
      <div style={styles.exploreBox}>
        <p style={styles.exploreHint}>De quoi souhaitez-vous parler aujourd'hui ?</p>
        <div style={styles.exploreInputRow}>
          <input
            style={styles.exploreInput}
            placeholder="Ex: Condamnation de YouTube, tensions en mer de Chine..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && startExploration()}
          />
          <button style={styles.sendBtn} onClick={startExploration} disabled={!query.trim() || loading}>
            <Icon name="send" size={18} />
          </button>
        </div>
        {error && <ErrorState msg={error} onRetry={startExploration} />}
        {loading && <LoadingState text={`Analyse de "${query}"…`} />}
      </div>
      <div style={styles.suggestionsTitle}>Suggestions</div>
      <div style={styles.suggestions}>
        {["Intelligence artificielle et emploi", "Tensions USA / Chine", "Crise climatique 2025", "Élections en Europe"].map(s => (
          <button key={s} style={styles.suggestionChip} onClick={() => setQuery(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// CONVERSATION PAGE
// ============================================================
function ConversationPage({ item, onBack, context }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState({ event: true, context: false, reflection: false });
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const apiMessages = [
        { role: "user", content: `Contexte du sujet : ${item.title}\n\n${item.raw || item.event}` },
        { role: "assistant", content: "Je comprends ce sujet. Posez vos questions, je suis là pour approfondir." },
        ...newMessages,
      ];
      const reply = await callClaude(apiMessages, "Tu es un expert pédagogue. Réponds de façon claire, précise et structurée aux questions sur l'actualité. Reste dans le contexte du sujet abordé.");
      setMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...newMessages, { role: "assistant", content: `Erreur : ${e.message}` }]);
    }
    setLoading(false);
  }

  function saveForQuiz() {
    const cards = getFlashcards();
    const conv = messages.filter(m => m.role === "user").map(m => m.content);
    const newCards = [{
      id: Date.now(),
      subject: item.title,
      question: `Que s'est-il passé concernant : ${item.title} ?`,
      answer: item.event || item.raw,
      context: item.context,
      conversation: conv,
      createdAt: new Date().toISOString(),
      repetitions: 0,
      easeFactor: 2.5,
      interval: 1,
      nextReview: new Date().toISOString(),
    }];
    saveFlashcards([...cards, ...newCards]);
    const hist = getHistory();
    saveHistory([...hist, {
      id: Date.now(),
      title: item.title,
      date: new Date().toISOString(),
      context,
      messages: [{ role: "system", content: item.raw || item.event }, ...messages],
    }]);
    setSaved(true);
  }

  const Section = ({ label, key2, content }) => (
    <div style={styles.section}>
      <button style={styles.sectionHeader} onClick={() => setExpanded(e => ({ ...e, [key2]: !e[key2] }))}>
        <span style={styles.sectionLabel}>{label}</span>
        <span style={{ transition: "transform .2s", transform: expanded[key2] ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
      </button>
      {expanded[key2] && <div style={styles.sectionBody}>{content || <em style={{ color: "#aaa" }}>—</em>}</div>}
    </div>
  );

  return (
    <div style={styles.convPage}>
      <div style={styles.convHeader}>
        <button style={styles.backBtn} onClick={onBack}><Icon name="back" size={20} /></button>
        <h2 style={styles.convTitle}>{item.title}</h2>
      </div>
      <div style={styles.convScroll}>
        <Section label="📌 Ce qu'il s'est passé" key2="event" content={item.event} />
        <Section label="🌍 Contexte" key2="context" content={item.context} />
        <Section label="💡 Pistes de réflexion" key2="reflection" content={item.reflection} />
        {messages.length > 0 && (
          <div style={styles.chatArea}>
            <div style={styles.chatDivider}>— Votre conversation —</div>
            {messages.map((m, i) => (
              <div key={i} style={{ ...styles.bubble, alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "#2196F3" : "#F3F4F6", color: m.role === "user" ? "#fff" : "#1a1a2e" }}>
                {m.content}
              </div>
            ))}
            {loading && <div style={{ ...styles.bubble, alignSelf: "flex-start", background: "#F3F4F6", color: "#888" }}>…</div>}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={styles.convFooter}>
        {!saved && messages.length > 0 && (
          <button style={styles.saveBtn} onClick={saveForQuiz}>
            <Icon name="save" size={16} /> Sauvegarder pour le quiz
          </button>
        )}
        {saved && <div style={styles.savedBadge}><Icon name="check" size={14} /> Sauvegardé !</div>}
        <div style={styles.inputRow}>
          <input
            style={styles.chatInput}
            placeholder="Posez une question…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
          />
          <button style={styles.sendBtn} onClick={send} disabled={!input.trim() || loading}>
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// HISTORY PAGE
// ============================================================
function HistoryPage({ navigate }) {
  const [history, setHistory] = useState(getHistory());

  function deleteItem(id) {
    const h = history.filter(x => x.id !== id);
    saveHistory(h);
    setHistory(h);
  }

  const cards = getFlashcards();
  const masteryColor = (title) => {
    const card = cards.find(c => c.subject === title);
    if (!card) return "#ccc";
    if (card.repetitions >= 5) return "#22C55E";
    if (card.repetitions >= 2) return "#F97316";
    return "#EF4444";
  };

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}><h1 style={styles.pageTitle}>🗂 Historique</h1></div>
      {history.length === 0 && (
        <div style={styles.empty}>
          <p>Aucun sujet sauvegardé pour l'instant.</p>
          <p style={{ fontSize: 13, color: "#aaa" }}>Explorez un sujet et sauvegardez-le pour le quiz.</p>
        </div>
      )}
      <div style={styles.historyList}>
        {[...history].reverse().map(item => (
          <div key={item.id} style={styles.historyCard}>
            <div style={{ ...styles.masteryDot, background: masteryColor(item.title) }} />
            <div style={styles.historyInfo}>
              <div style={styles.historyTitle}>{item.title}</div>
              <div style={styles.historyMeta}>
                {new Date(item.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                {" · "}{item.context === "news" ? "Actualités" : "Exploration"}
              </div>
            </div>
            <button style={styles.deleteBtn} onClick={() => deleteItem(item.id)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// QUIZ PAGE
// ============================================================
function QuizPage({ navigate }) {
  const [dueCards, setDueCards] = useState(getDueCards());
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState({ perfect: 0, hesitant: 0, failed: 0 });

  function answer(quality) {
    const allCards = getFlashcards();
    const cardId = dueCards[current].id;
    const updated = allCards.map(c => c.id === cardId ? sm2(c, quality) : c);
    saveFlashcards(updated);
    const r = { ...results };
    if (quality === 2) r.perfect++;
    else if (quality === 1) r.hesitant++;
    else r.failed++;
    setResults(r);
    if (current + 1 >= dueCards.length) setDone(true);
    else { setCurrent(current + 1); setRevealed(false); }
  }

  if (dueCards.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.pageHeader}><h1 style={styles.pageTitle}>🧠 Quiz du jour</h1></div>
        <div style={styles.empty}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <p style={{ fontWeight: 700, fontSize: 18 }}>Aucune révision aujourd'hui !</p>
          <p style={{ color: "#888", fontSize: 14 }}>Revenez demain ou explorez de nouveaux sujets.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.pageHeader}><h1 style={styles.pageTitle}>🧠 Quiz terminé !</h1></div>
        <div style={styles.quizSummary}>
          <div style={styles.quizSummaryItem}><span style={{ color: "#22C55E", fontSize: 28 }}>✓</span><span>{results.perfect} maîtrisé{results.perfect > 1 ? "s" : ""}</span></div>
          <div style={styles.quizSummaryItem}><span style={{ color: "#F97316", fontSize: 28 }}>~</span><span>{results.hesitant} hésitant{results.hesitant > 1 ? "s" : ""}</span></div>
          <div style={styles.quizSummaryItem}><span style={{ color: "#EF4444", fontSize: 28 }}>✗</span><span>{results.failed} raté{results.failed > 1 ? "s" : ""}</span></div>
        </div>
        <p style={{ textAlign: "center", color: "#888", fontSize: 13, marginTop: 16 }}>L'algorithme SM-2 a ajusté vos prochaines révisions.</p>
      </div>
    );
  }

  const card = dueCards[current];
  const progress = (current / dueCards.length) * 100;

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>🧠 Quiz</h1>
        <span style={styles.quizProgress}>{current + 1} / {dueCards.length}</span>
      </div>
      <div style={styles.progressBar}><div style={{ ...styles.progressFill, width: `${progress}%` }} /></div>
      <div style={styles.quizCard}>
        <div style={styles.quizSubject}>{card.subject}</div>
        <div style={styles.quizQuestion}>{card.question}</div>
        {!revealed && (
          <button style={styles.revealBtn} onClick={() => setRevealed(true)}>Voir la réponse</button>
        )}
        {revealed && (
          <div style={styles.quizAnswer}>
            <div style={styles.quizAnswerText}>{card.answer?.substring(0, 400)}{card.answer?.length > 400 ? "…" : ""}</div>
            <div style={styles.quizBtns}>
              <button style={{ ...styles.quizBtn, background: "#FEF2F2", color: "#EF4444" }} onClick={() => answer(0)}>✗ Je ne savais pas</button>
              <button style={{ ...styles.quizBtn, background: "#FFF7ED", color: "#F97316" }} onClick={() => answer(1)}>~ J'hésitais</button>
              <button style={{ ...styles.quizBtn, background: "#F0FDF4", color: "#22C55E" }} onClick={() => answer(2)}>✓ Je savais</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS PAGE
// ============================================================
function SettingsPage({ navigate }) {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(false);

  function save() {
    storage.set("anthropic_api_key", key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function clearData() {
    if (window.confirm("Effacer tout l'historique et les flashcards ?")) {
      localStorage.clear();
      storage.set("anthropic_api_key", key.trim());
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}><h1 style={styles.pageTitle}>⚙️ Paramètres</h1></div>
      <div style={styles.settingsSection}>
        <label style={styles.settingsLabel}>Clé API Anthropic</label>
        <input style={styles.settingsInput} type="password" placeholder="sk-ant-..." value={key} onChange={e => setKey(e.target.value)} />
        <p style={styles.settingsHint}>Obtenez votre clé sur <a href="https://console.anthropic.com" target="_blank" style={{ color: "#2196F3" }}>console.anthropic.com</a></p>
        <button style={styles.saveSettingsBtn} onClick={save}>
          {saved ? <><Icon name="check" size={16} /> Sauvegardé</> : "Sauvegarder la clé"}
        </button>
      </div>
      <div style={styles.settingsSection}>
        <label style={styles.settingsLabel}>Données locales</label>
        <p style={styles.settingsHint}>Historique : {getHistory().length} sujet(s) · Flashcards : {getFlashcards().length} carte(s)</p>
        <button style={{ ...styles.saveSettingsBtn, background: "#FEF2F2", color: "#EF4444", borderColor: "#FECACA" }} onClick={clearData}>
          <Icon name="trash" size={16} /> Effacer toutes les données
        </button>
      </div>
      <div style={styles.settingsSection}>
        <label style={styles.settingsLabel}>À propos</label>
        <p style={styles.settingsHint}>mémoActu v1.0 — PWA propulsée par Claude (Anthropic)<br />Algorithme de mémorisation : SM-2</p>
      </div>
    </div>
  );
}

// ============================================================
// BOTTOM NAV
// ============================================================
function BottomNav({ current, navigate, dueCount }) {
  const tabs = [
    { id: "news", icon: "newspaper", label: "Actu" },
    { id: "explore", icon: "search", label: "Explorer" },
    { id: "quiz", icon: "brain", label: "Quiz", badge: dueCount },
    { id: "history", icon: "history", label: "Historique" },
    { id: "settings", icon: "settings", label: "Réglages" },
  ];
  return (
    <nav style={styles.bottomNav}>
      {tabs.map(t => (
        <button key={t.id} style={{ ...styles.navBtn, color: current === t.id ? "#2196F3" : "#9CA3AF" }} onClick={() => navigate(t.id)}>
          <div style={{ position: "relative" }}>
            <Icon name={t.icon} size={22} />
            {t.badge > 0 && <span style={{ ...styles.badge, background: "#F97316", top: -4, right: -4 }}>{t.badge}</span>}
          </div>
          <span style={styles.navLabel}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ============================================================
// SHARED COMPONENTS
// ============================================================
function LoadingState({ text }) {
  return (
    <div style={styles.loading}>
      <div style={styles.spinner} className="spinner" />
      <p style={{ color: "#888", fontSize: 14, marginTop: 12 }}>{text}</p>
    </div>
  );
}

function ErrorState({ msg, onRetry }) {
  return (
    <div style={styles.error}>
      <p style={{ color: "#EF4444", fontWeight: 600 }}>Erreur</p>
      <p style={{ fontSize: 13, color: "#666" }}>{msg}</p>
      {onRetry && <button style={styles.retryBtn} onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================
const styles = {
  app: { fontFamily: "'Georgia', serif", background: "#FAFAFA", minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", position: "relative" },
  content: { flex: 1, overflowY: "auto", paddingBottom: 70 },
  homePage: { padding: "40px 20px 20px", display: "flex", flexDirection: "column", gap: 24 },
  homeHeader: { textAlign: "center", paddingBottom: 8 },
  homeLogoRow: { display: "flex", justifyContent: "center", alignItems: "baseline", gap: 2 },
  homeLogo: { fontSize: 36, fontWeight: 900, color: "#1a1a2e", letterSpacing: -1 },
  homeLogoAccent: { fontSize: 36, fontWeight: 900, color: "#2196F3", letterSpacing: -1 },
  homeTagline: { color: "#888", fontSize: 14, marginTop: 6 },
  homeCards: { display: "flex", flexDirection: "column", gap: 12 },
  homeCard: { display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", borderRadius: 14, border: "none", cursor: "pointer", textAlign: "left", transition: "transform .15s, box-shadow .15s", boxShadow: "0 2px 8px rgba(0,0,0,.06)" },
  homeCardIcon: { flexShrink: 0, position: "relative" },
  homeCardTitle: { fontWeight: 700, fontSize: 16, color: "#1a1a2e", marginBottom: 3 },
  homeCardDesc: { fontSize: 13, color: "#666" },
  settingsBtn: { display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: "#aaa", fontSize: 13, cursor: "pointer", alignSelf: "center", padding: 8 },
  page: { padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16, minHeight: "100vh" },
  pageHeader: { display: "flex", alignItems: "center", gap: 10, paddingBottom: 4 },
  pageTitle: { fontSize: 22, fontWeight: 800, color: "#1a1a2e", margin: 0, flex: 1 },
  pageDate: { fontSize: 12, color: "#aaa" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#666", padding: 6 },
  newsList: { display: "flex", flexDirection: "column", gap: 10 },
  newsCard: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #ECECEC", borderRadius: 12, padding: "14px 16px", cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.04)" },
  newsNum: { fontWeight: 800, fontSize: 18, color: "#2196F3", minWidth: 24 },
  newsContent: { flex: 1 },
  newsTitle: { fontWeight: 700, fontSize: 15, color: "#1a1a2e", marginBottom: 3 },
  newsPreview: { fontSize: 12, color: "#888", lineHeight: 1.4 },
  chevron: { color: "#ccc", fontSize: 22 },
  exploreBox: { background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,.06)" },
  exploreHint: { fontSize: 15, color: "#444", marginBottom: 14, fontWeight: 600 },
  exploreInputRow: { display: "flex", gap: 10 },
  exploreInput: { flex: 1, border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", fontSize: 14, outline: "none", fontFamily: "inherit" },
  suggestionsTitle: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1 },
  suggestions: { display: "flex", flexWrap: "wrap", gap: 8 },
  suggestionChip: { background: "#EFF6FF", color: "#2563EB", border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  convPage: { display: "flex", flexDirection: "column", height: "100vh", background: "#FAFAFA" },
  convHeader: { display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 12px", background: "#fff", borderBottom: "1px solid #ECECEC", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", cursor: "pointer", color: "#333", padding: 4 },
  convTitle: { fontSize: 16, fontWeight: 800, color: "#1a1a2e", margin: 0, flex: 1, lineHeight: 1.3 },
  convScroll: { flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 160 },
  section: { background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #ECECEC" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "none", border: "none", cursor: "pointer", width: "100%", fontWeight: 700, fontSize: 14, color: "#1a1a2e" },
  sectionLabel: { fontWeight: 700 },
  sectionBody: { padding: "4px 16px 14px", fontSize: 14, color: "#444", lineHeight: 1.7, whiteSpace: "pre-wrap" },
  chatArea: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8 },
  chatDivider: { textAlign: "center", fontSize: 12, color: "#bbb", fontStyle: "italic", margin: "8px 0" },
  bubble: { maxWidth: "85%", padding: "12px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" },
  convFooter: { position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", background: "#fff", borderTop: "1px solid #ECECEC", padding: "10px 14px 20px", display: "flex", flexDirection: "column", gap: 8 },
  inputRow: { display: "flex", gap: 8 },
  chatInput: { flex: 1, border: "1.5px solid #E5E7EB", borderRadius: 24, padding: "10px 16px", fontSize: 14, outline: "none", fontFamily: "inherit" },
  sendBtn: { background: "#2196F3", color: "#fff", border: "none", borderRadius: 24, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center" },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", borderRadius: 20, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600, alignSelf: "flex-start" },
  savedBadge: { display: "flex", alignItems: "center", gap: 6, color: "#22C55E", fontSize: 13, fontWeight: 700 },
  historyList: { display: "flex", flexDirection: "column", gap: 10 },
  historyCard: { display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #ECECEC" },
  masteryDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  historyInfo: { flex: 1 },
  historyTitle: { fontWeight: 700, fontSize: 15, color: "#1a1a2e" },
  historyMeta: { fontSize: 12, color: "#aaa", marginTop: 2 },
  deleteBtn: { background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 4 },
  quizProgress: { fontSize: 13, color: "#888", fontWeight: 700 },
  progressBar: { background: "#E5E7EB", borderRadius: 4, height: 6, overflow: "hidden" },
  progressFill: { background: "#2196F3", height: "100%", borderRadius: 4, transition: "width .4s ease" },
  quizCard: { background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 20px rgba(0,0,0,.08)", display: "flex", flexDirection: "column", gap: 16 },
  quizSubject: { fontSize: 12, fontWeight: 700, color: "#2196F3", textTransform: "uppercase", letterSpacing: 1 },
  quizQuestion: { fontSize: 18, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.5 },
  revealBtn: { background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  quizAnswer: { display: "flex", flexDirection: "column", gap: 16 },
  quizAnswerText: { fontSize: 14, color: "#444", lineHeight: 1.7, background: "#F9FAFB", borderRadius: 10, padding: 14 },
  quizBtns: { display: "flex", flexDirection: "column", gap: 8 },
  quizBtn: { border: "2px solid transparent", borderRadius: 10, padding: 14, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  quizSummary: { display: "flex", flexDirection: "column", gap: 16, padding: "20px 0" },
  quizSummaryItem: { display: "flex", alignItems: "center", gap: 16, fontSize: 18, fontWeight: 700, color: "#1a1a2e" },
  settingsSection: { background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #ECECEC", display: "flex", flexDirection: "column", gap: 10 },
  settingsLabel: { fontWeight: 800, fontSize: 15, color: "#1a1a2e" },
  settingsInput: { border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", fontSize: 14, outline: "none", fontFamily: "inherit" },
  settingsHint: { fontSize: 13, color: "#888", lineHeight: 1.6 },
  saveSettingsBtn: { background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  badge: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", padding: "0 4px" },
  loading: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 },
  spinner: { width: 32, height: 32, border: "3px solid #E5E7EB", borderTop: "3px solid #2196F3", borderRadius: "50%" },
  error: { background: "#FEF2F2", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 6 },
  retryBtn: { background: "#EF4444", color: "#fff", border: "none", borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700 },
  empty: { textAlign: "center", padding: "60px 20px", color: "#666" },
  bottomNav: { position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", background: "#fff", borderTop: "1px solid #ECECEC", display: "flex", padding: "8px 0 12px", zIndex: 100 },
  navBtn: { flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" },
  navLabel: { fontSize: 10, fontWeight: 600 },
};

const globalCSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { background: #F1F5F9; }
  .homeCard:active { transform: scale(0.97); }
  .newsCard:active { transform: scale(0.98); }
  .spinner { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  input, button, textarea { font-family: inherit; }
  ::-webkit-scrollbar { width: 0; }
`;
