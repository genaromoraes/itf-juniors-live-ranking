import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";

const LIVE_RANKING_FILE = path.resolve(
  "data/clean/live_ranking_with_drops.csv"
);

const WEEK_TOURNAMENTS_FILE = path.resolve("data/clean/week_tournaments.csv");
const WEEK_PLAYER_RESULTS_FILE = path.resolve(
  "data/clean/week_player_results.csv"
);
const WEEK_MATCHES_FILE = path.resolve("data/clean/week_matches.csv");
const WEEK_LIVE_LEDGER_ROWS_FILE = path.resolve(
  "data/clean/week_live_ledger_rows.csv"
);
const DROPPED_POINTS_FILE = path.resolve("data/clean/live_dropped_points.csv");
const LIVE_COMBINED_LEDGER_FILE = path.resolve(
  "data/clean/live_combined_ledger_with_drops.csv"
);

const OUT_DIR_EXPORTS = path.resolve("data/exports");

const HTML_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "live_ranking.html");
const INDEX_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "index.html");
const CNAME_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "CNAME");
const FAVICON_SOURCE_FILE = path.resolve("assets/favicon.png");
const FAVICON_OUTPUT_FILE = path.join(OUT_DIR_EXPORTS, "favicon.png");
const CUSTOM_DOMAIN = "www.juniorsliveranking.com.br";
const SITE_URL = `https://${CUSTOM_DOMAIN}`;
const ADSENSE_CLIENT_ID = "ca-pub-5423465092890611";
const ADSENSE_SCRIPT = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}" crossorigin="anonymous"></script>`;

const STATIC_PAGES = [
  {
    fileName: "sobre.html",
    title: "Sobre",
    description:
      "O Juniors Live Ranking acompanha o ranking juvenil internacional com dados públicos e atualização automatizada.",
    sections: [
      {
        heading: "Sobre o projeto",
        paragraphs: [
          "O Juniors Live Ranking é uma ferramenta independente para acompanhar projeções e ranking oficial do circuito juvenil internacional.",
          "A página reúne dados públicos, resultados semanais e cálculos automatizados para facilitar a leitura do cenário competitivo.",
        ],
      },
      {
        heading: "Independência",
        paragraphs: [
          "Este site não é afiliado, endossado ou administrado pela ITF ou por qualquer entidade oficial de tênis.",
          "As informações são organizadas para consulta pública e podem sofrer ajustes conforme fontes oficiais sejam atualizadas.",
        ],
      },
    ],
  },
  {
    fileName: "contato.html",
    title: "Contato",
    description:
      "Entre em contato com o Juniors Live Ranking para avisos, correções e sugestões.",
    sections: [
      {
        heading: "Contato",
        paragraphs: [
          'E-mail: <a href="mailto:infotenisbr@gmail.com">infotenisbr@gmail.com</a>.',
          'Para avisos, correções e sugestões, entre em contato pelo perfil <a href="https://x.com/InfoTenisBrasil" target="_blank" rel="noopener">X @InfoTenisBrasil</a>.',
          "Ao enviar uma correção, inclua o nome do atleta, categoria, torneio e link público da fonte quando possível.",
        ],
      },
    ],
  },
  {
    fileName: "privacidade.html",
    title: "Política de Privacidade",
    description:
      "Política de Privacidade do Juniors Live Ranking.",
    sections: [
      {
        heading: "Dados coletados",
        paragraphs: [
          "O site exibe informações esportivas públicas sobre atletas, rankings, torneios e pontuações.",
          "Não há cadastro de usuários, área logada ou coleta direta de dados pessoais sensíveis pelo site.",
        ],
      },
      {
        heading: "Cookies, métricas e anúncios",
        paragraphs: [
          "O site poderá usar ferramentas de métricas e publicidade, como Google AdSense, que podem utilizar cookies ou tecnologias semelhantes conforme suas próprias políticas.",
          "Essas ferramentas ajudam a medir audiência, proteger contra abuso e exibir anúncios relevantes.",
        ],
      },
      {
        heading: "Contato",
        paragraphs: [
          'Dúvidas sobre privacidade podem ser enviadas para <a href="mailto:infotenisbr@gmail.com">infotenisbr@gmail.com</a>.',
          'Dúvidas sobre privacidade podem ser enviadas pelo perfil <a href="https://x.com/InfoTenisBrasil" target="_blank" rel="noopener">X @InfoTenisBrasil</a>.',
        ],
      },
    ],
  },
  {
    fileName: "termos.html",
    title: "Termos de Uso",
    description:
      "Termos de Uso e aviso de independência do Juniors Live Ranking.",
    sections: [
      {
        heading: "Uso das informações",
        paragraphs: [
          "O conteúdo do site é fornecido para fins informativos e pode conter diferenças temporárias em relação a fontes oficiais.",
          "Antes de tomar decisões esportivas, administrativas ou comerciais, consulte sempre as fontes oficiais aplicáveis.",
        ],
      },
      {
        heading: "Fontes e cálculos",
        paragraphs: [
          "As projeções são geradas automaticamente a partir dos dados disponíveis no momento da atualização.",
          "Resultados, rankings e pontuações podem mudar após correções, atrasos de publicação ou revisões oficiais.",
        ],
      },
      {
        heading: "Independência",
        paragraphs: [
          "O Juniors Live Ranking é um site independente e não representa a ITF ou qualquer entidade oficial de tênis.",
        ],
      },
    ],
  },
];

async function ensureDirs() {
  await fs.mkdir(OUT_DIR_EXPORTS, { recursive: true });
}

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const n = Number(cleaned);

  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  const n = toNumber(value);

  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value) {
  const text = cleanText(value);

  if (!text) return "";

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIsoInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatIsoDatePt(value) {
  const text = cleanText(value);
  if (!isIsoDate(text)) return text;
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function buildRolloverNotice(weekTournaments, rankingDate, today = new Date()) {
  const weekStarts = weekTournaments
    .map((row) => cleanText(row.week_start))
    .filter(isIsoDate)
    .sort();
  const weekEnds = weekTournaments
    .map((row) => cleanText(row.week_end))
    .filter(isIsoDate)
    .sort();

  if (!weekStarts.length || !weekEnds.length || !isIsoDate(rankingDate)) {
    return null;
  }

  const weekStart = weekStarts[0];
  const weekEnd = weekEnds[weekEnds.length - 1];
  const todayIso = todayIsoInSaoPaulo(today);

  if (rankingDate !== weekStart || todayIso < weekEnd) {
    return null;
  }

  return {
    weekStart,
    weekEnd,
    expectedRankingDate: addDays(weekEnd, 1),
  };
}

function buildStaticPage(page) {
  const navLinks = [
    { href: "./", label: "Ranking" },
    ...STATIC_PAGES.map((item) => ({
      href: item.fileName,
      label: item.title,
    })),
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} | Juniors Live Ranking</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <link rel="canonical" href="${SITE_URL}/${escapeHtml(page.fileName)}" />
  <link rel="icon" href="favicon.png" type="image/png" />
  ${ADSENSE_SCRIPT}
  <style>
    :root {
      color-scheme: light;
      --bg: #f5fbf9;
      --panel: #ffffff;
      --text: #132322;
      --muted: #5d706f;
      --green: #08756d;
      --border: #d8e7e4;
      --shadow: 0 18px 50px rgba(16, 42, 39, 0.10);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(220, 244, 236, 0.9), transparent 32rem),
        linear-gradient(180deg, #f5fbf9 0%, #ffffff 48%, #eef8f5 100%);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }

    .page {
      width: min(920px, calc(100% - 36px));
      margin: 0 auto;
      padding: 28px 0 42px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 24px;
    }

    .brand {
      color: var(--green);
      font-size: 26px;
      line-height: 1;
      font-weight: 800;
      text-decoration: none;
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    nav a,
    .back-link {
      color: var(--green);
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
    }

    .panel {
      background: rgba(255, 255, 255, 0.84);
      border: 1px solid rgba(216, 231, 228, 0.9);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 34px;
    }

    h1 {
      margin: 0 0 12px;
      color: var(--green);
      font-size: 34px;
      line-height: 1.05;
    }

    .description {
      margin: 0 0 28px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.55;
    }

    section + section {
      margin-top: 26px;
      padding-top: 22px;
      border-top: 1px solid var(--border);
    }

    h2 {
      margin: 0 0 10px;
      font-size: 18px;
      line-height: 1.2;
    }

    p {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.65;
    }

    p:last-child {
      margin-bottom: 0;
    }

    a {
      color: var(--green);
    }

    footer {
      margin-top: 22px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      nav {
        justify-content: flex-start;
      }

      .panel {
        padding: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="topbar">
      <a class="brand" href="./">Juniors Live Ranking</a>
      <nav aria-label="Navegação principal">
        ${navLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("\n        ")}
      </nav>
    </header>

    <main class="panel">
      <h1>${escapeHtml(page.title)}</h1>
      <p class="description">${escapeHtml(page.description)}</p>
      ${page.sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n        ")}
      </section>`).join("\n")}
    </main>

    <footer>
      Juniors Live Ranking é um projeto independente. Última atualização desta página: 20/06/2026.
    </footer>
  </div>
</body>
</html>`;
}

function countryCodeToIso2(countryCode) {
  const code = cleanText(countryCode).toUpperCase();

  if (!code || code.length !== 3) return "";

  const iso3ToIso2 = {
    ALG: "DZ",
    ARG: "AR",
    ARM: "AM",
    AUS: "AU",
    AUT: "AT",
    AZE: "AZ",
    BEL: "BE",
    BIH: "BA",
    BLR: "BY",
    BOL: "BO",
    BOT: "BW",
    BRA: "BR",
    BUL: "BG",
    CAN: "CA",
    CHI: "CL",
    CHN: "CN",
    COL: "CO",
    CRO: "HR",
    CYP: "CY",
    CZE: "CZ",
    DEN: "DK",
    DOM: "DO",
    ECU: "EC",
    EGY: "EG",
    ESA: "SV",
    ESP: "ES",
    EST: "EE",
    FIN: "FI",
    FRA: "FR",
    GBR: "GB",
    GEO: "GE",
    GER: "DE",
    GRE: "GR",
    GUA: "GT",
    HKG: "HK",
    HUN: "HU",
    IND: "IN",
    INA: "ID",
    IRL: "IE",
    ISR: "IL",
    ITA: "IT",
    JAM: "JM",
    JPN: "JP",
    KAZ: "KZ",
    KEN: "KE",
    KGZ: "KG",
    KOR: "KR",
    KSA: "SA",
    LAT: "LV",
    LIE: "LI",
    LTU: "LT",
    MAR: "MA",
    MAS: "MY",
    MDA: "MD",
    MDV: "MV",
    MEX: "MX",
    MKD: "MK",
    MON: "MC",
    NAM: "NA",
    NED: "NL",
    NEP: "NP",
    NGR: "NG",
    NOR: "NO",
    NZL: "NZ",
    PAK: "PK",
    PAR: "PY",
    PER: "PE",
    POL: "PL",
    POR: "PT",
    PUR: "PR",
    ROU: "RO",
    RSA: "ZA",
    RUS: "RU",
    SLO: "SI",
    SGP: "SG",
    SRB: "RS",
    SRI: "LK",
    SVK: "SK",
    SUI: "CH",
    SWE: "SE",
    THA: "TH",
    TJK: "TJ",
    TKM: "TM",
    TPE: "TW",
    TUN: "TN",
    TUR: "TR",
    UGA: "UG",
    UKR: "UA",
    URU: "UY",
    USA: "US",
    UZB: "UZ",
    VEN: "VE",
    ZIM: "ZW",
  };

  const iso2 = iso3ToIso2[code];

  if (!iso2) return "";

  return iso2.toLowerCase();
}

function getGenderLabel(value) {
  const text = cleanText(value).toUpperCase();

  if (text === "M") return "Masculino";
  if (text === "F") return "Feminino";

  return text || "Indefinido";
}

function getBestSingles(row) {
  return [
    row.best_singles_1,
    row.best_singles_2,
    row.best_singles_3,
    row.best_singles_4,
    row.best_singles_5,
    row.best_singles_6,
  ]
    .map(cleanText)
    .filter(Boolean);
}

function getBestDoubles(row) {
  return [
    row.best_doubles_1,
    row.best_doubles_2,
    row.best_doubles_3,
    row.best_doubles_4,
    row.best_doubles_5,
    row.best_doubles_6,
  ]
    .map(cleanText)
    .filter(Boolean);
}

function getPlayingThisWeek(row) {
  const singles = getBestSingles(row).filter((item) => item.includes("LIVE"));
  const doubles = getBestDoubles(row).filter((item) => item.includes("LIVE"));

  const liveItems = [...singles, ...doubles];

  if (!liveItems.length) return "";

  const first = liveItems[0];
  const parts = first.split("|").map((part) => part.trim());

  const tournament = parts[4] || "";
  const round = parts[3] || "";

  const singlesSummary = singles.length
    ? `Simples: ${getLiveRoundLabel(singles[0])}`
    : "";

  const doublesSummary = doubles.length
    ? `Duplas: ${getLiveRoundLabel(doubles[0])}`
    : "";

  return {
    tournament,
    round,
    singlesSummary,
    doublesSummary,
  };
}

function getLiveRoundLabel(resultText) {
  const parts = cleanText(resultText).split("|").map((part) => part.trim());

  return parts[3] || "";
}

function normalizeWeekEventType(row) {
  const eventType = cleanText(row.event_type).toLowerCase();
  const matchType = cleanText(row.match_type_code).toUpperCase();

  if (eventType === "singles" || matchType === "S") return "singles";
  if (eventType === "doubles" || matchType === "D") return "doubles";

  return eventType || matchType.toLowerCase();
}

function getWeekTournamentKey(row) {
  return cleanText(row.tournament_key) || cleanText(row.tournament_name);
}

function buildLiveRoundMap(weekLiveLedgerRows) {
  const map = new Map();

  for (const row of weekLiveLedgerRows) {
    const playerId = cleanText(row.player_id);
    const tournamentKey = getWeekTournamentKey(row);
    const eventType = normalizeWeekEventType(row);
    const round = cleanText(row.round);

    if (!playerId || !tournamentKey || !eventType || !round) continue;

    map.set([playerId, tournamentKey, eventType].join("|"), round);
  }

  return map;
}

function getClassificationLabel(row) {
  const classification = cleanText(row.event_classification_code).toUpperCase();
  const classificationDesc = cleanText(row.event_classification_desc).toLowerCase();

  if (
    classification === "Q" ||
    classificationDesc.includes("qual") ||
    classificationDesc.includes("qualification")
  ) {
    return "Qualy";
  }

  return "";
}

function getParticipationRoundLabel(row, round) {
  const status = cleanText(row.status).toLowerCase();
  const classificationLabel = getClassificationLabel(row);
  const visibleRound = getDisplayRoundLabel(round);
  const displayRound = classificationLabel ? `${classificationLabel} ${visibleRound}` : visibleRound;

  if (status === "eliminated") {
    return `${displayRound} ❌`;
  }

  return displayRound;
}

function getDisplayRoundLabel(round) {
  const text = cleanText(round);

  if (/^1st\s+round$/i.test(text)) return "R1";
  if (/^2nd\s+round$/i.test(text)) return "R2";
  if (/^3rd\s+round$/i.test(text)) return "R3";

  return text;
}

function buildWeekParticipationMap(weekPlayerResults, weekLiveLedgerRows, weekMatches = []) {
  const liveRoundMap = buildLiveRoundMap(weekLiveLedgerRows);
  const map = new Map();
  const priorityByEvent = new Map();
  const maxRoundOrderByEvent = new Map();
  const today = new Date().toISOString().slice(0, 10);

  function getClassificationPriority(row) {
    const classification = cleanText(row.event_classification_code).toUpperCase();

    if (classification === "M") return 2;
    if (classification === "Q") return 1;
    return 0;
  }

  function getParticipationEventKey(playerId, tournamentKey, eventType) {
    return [playerId, tournamentKey, eventType].join("|");
  }

  function getDrawEventKey(row) {
    return [
      getWeekTournamentKey(row),
      cleanText(row.player_type_code),
      cleanText(row.match_type_code),
      cleanText(row.event_classification_code),
    ].join("|");
  }

  function getTechnicalRoundFromOrder(row) {
    const order = toNumber(row.highest_round_order);
    const maxOrder = maxRoundOrderByEvent.get(getDrawEventKey(row)) || 0;

    if (!order || !maxOrder) return "";

    const firstRoundIndex = ROUND_ORDER.indexOf("F") - maxOrder + 1;
    const roundIndex = firstRoundIndex + order - 1;

    return ROUND_ORDER[roundIndex] || "";
  }

  for (const row of weekMatches) {
    const eventKey = getDrawEventKey(row);
    const order = toNumber(row.round_order);

    if (!eventKey || !order) continue;

    maxRoundOrderByEvent.set(eventKey, Math.max(maxRoundOrderByEvent.get(eventKey) || 0, order));
  }

  for (const row of weekPlayerResults) {
    const eventKey = getDrawEventKey(row);
    const order = toNumber(row.highest_round_order);

    if (!eventKey || !order) continue;

    maxRoundOrderByEvent.set(eventKey, Math.max(maxRoundOrderByEvent.get(eventKey) || 0, order));
  }

  for (const row of weekPlayerResults) {
    const playerId = cleanText(row.player_id);
    const tournamentKey = getWeekTournamentKey(row);
    const tournament = cleanText(row.tournament_name);
    const category = cleanText(row.category || row.tournament_category);
    const endDate = cleanText(row.end_date);
    const eventType = normalizeWeekEventType(row);

    if (!playerId || !tournamentKey || !tournament || !eventType) continue;

    const eventKey = getParticipationEventKey(playerId, tournamentKey, eventType);
    const priority = getClassificationPriority(row);
    const currentPriority = priorityByEvent.get(eventKey) ?? -1;

    if (priority < currentPriority) continue;

    const participation =
      map.get(playerId) ||
      {
        tournament,
        tournamentKey,
        category,
        endDate,
        isFinishedByDate: endDate ? endDate <= today : false,
        singlesSummary: "",
        doublesSummary: "",
        singlesStatus: "",
        doublesStatus: "",
        singlesRound: "",
        doublesRound: "",
      };

    if (participation.tournamentKey !== tournamentKey) continue;

    const liveRound =
      priority >= currentPriority
        ? liveRoundMap.get([playerId, tournamentKey, eventType].join("|")) ||
          liveRoundMap.get([playerId, tournament, eventType].join("|"))
        : "";
    const round = liveRound || cleanText(row.highest_round_name);
    const roundLabel = round ? getParticipationRoundLabel(row, round) : "";
    const technicalRound = normalizeProjectionRound(liveRound) || getTechnicalRoundFromOrder(row);

    if (eventType === "singles") {
      participation.singlesStatus = cleanText(row.status).toLowerCase();
      participation.singlesRound = technicalRound;

      if (roundLabel) {
        participation.singlesSummary = `Simples: ${roundLabel}`;
      }
    }

    if (eventType === "doubles") {
      participation.doublesStatus = cleanText(row.status).toLowerCase();
      participation.doublesRound = technicalRound;

      if (roundLabel) {
        participation.doublesSummary = `Duplas: ${roundLabel}`;
      }
    }

    priorityByEvent.set(eventKey, priority);
    map.set(playerId, participation);
  }

  return map;
}

function getRankingImpact(row) {
  const points = toNumber(row.points);
  const eventType = cleanText(row.event_type).toLowerCase();

  if (eventType === "doubles") {
    return Number((points * 0.25).toFixed(2));
  }

  return points;
}

function getEventShortLabel(row) {
  const eventType = cleanText(row.event_type).toLowerCase();

  if (eventType === "singles") return "Simples";
  if (eventType === "doubles") return "Duplas";

  return eventType.toUpperCase();
}

function getTournamentYear(row) {
  const startDate = cleanText(row.start_date);
  const match = startDate.match(/\d{4}/);

  return match ? match[0] : "";
}

function getDetailKey(detail) {
  return [
    cleanText(detail.event),
    cleanText(detail.tournament),
    cleanText(detail.category),
    cleanText(detail.year),
  ].join("|");
}

function buildPointDetail(row) {
  const impactPoints = getRankingImpact(row);

  return {
    event: getEventShortLabel(row),
    tournament: cleanText(row.tournament_name),
    category: cleanText(row.category),
    year: getTournamentYear(row),
    impact_points: impactPoints,
  };
}

function parseBestResultForDetail(resultText, eventType, { includeLive = false } = {}) {
  const parts = cleanText(resultText).split("|").map((part) => part.trim());

  if (parts.length < 6) return null;

  const source = cleanText(parts[1]).toUpperCase();

  if (source === "LIVE" && !includeLive) return null;

  return {
    event: eventType === "doubles" ? "Duplas" : "Simples",
    tournament: cleanText(parts[4]),
    category: cleanText(parts[2]),
    year: getTournamentYear({ start_date: cleanText(parts[5]) }),
    impact_points:
      eventType === "doubles"
        ? Number((toNumber(parts[0]) * 0.25).toFixed(2))
        : toNumber(parts[0]),
    source,
  };
}

function getCountingLiveDetailsForRow(row) {
  const bestItems = [
    ...getBestSingles(row).map((item) => ({ item, eventType: "singles" })),
    ...getBestDoubles(row).map((item) => ({ item, eventType: "doubles" })),
  ];

  return bestItems
    .map(({ item, eventType }) =>
      parseBestResultForDetail(item, eventType, { includeLive: true })
    )
    .filter((detail) => detail && detail.source === "LIVE")
    .map(({ source, ...detail }) => detail);
}

function buildPointDetailsMap(weekLiveLedgerRows, droppedRows, rankingRows) {
  const map = new Map();

  function getPlayerDetails(playerId) {
    if (!map.has(playerId)) {
      map.set(playerId, { live: [], drops: [] });
    }

    return map.get(playerId);
  }

  for (const row of droppedRows) {
    const playerId = cleanText(row.player_id);
    const impactPoints = getRankingImpact(row);
    const wasCountable =
      cleanText(row.countable_status) === "countable" ||
      cleanText(row.is_countable_at_collection).toLowerCase() === "true";

    if (!playerId || impactPoints <= 0 || !wasCountable) continue;

    getPlayerDetails(playerId).drops.push(buildPointDetail(row));
  }

  for (const row of rankingRows) {
    const playerId = cleanText(row.player_id);

    if (!playerId) continue;

    const details = getPlayerDetails(playerId);
    const existingKeys = new Set([
      ...details.live.map(getDetailKey),
      ...details.drops.map(getDetailKey),
    ]);

    for (const liveDetail of getCountingLiveDetailsForRow(row)) {
      if (existingKeys.has(getDetailKey(liveDetail))) continue;

      details.live.push(liveDetail);
      existingKeys.add(getDetailKey(liveDetail));
    }

  }

  for (const details of map.values()) {
    details.live.sort((a, b) => b.impact_points - a.impact_points);
    details.drops.sort((a, b) => b.impact_points - a.impact_points);
  }

  return map;
}

function sortLedgerResults(rows) {
  return [...rows].sort((a, b) => {
    const pointsDiff = toNumber(b.points) - toNumber(a.points);

    if (pointsDiff !== 0) return pointsDiff;

    const liveA = cleanText(a.source_type) === "live" ? 1 : 0;
    const liveB = cleanText(b.source_type) === "live" ? 1 : 0;

    if (liveA !== liveB) return liveB - liveA;

    return cleanText(b.start_date).localeCompare(cleanText(a.start_date));
  });
}

function buildResultKey(row) {
  return [
    cleanText(row.player_id),
    cleanText(row.event_type),
    cleanText(row.tournament_name),
    cleanText(row.category),
    cleanText(row.start_date),
    cleanText(row.round),
    toNumber(row.points),
    cleanText(row.source_type),
  ].join("|");
}

function buildPointCartelMap(combinedLedgerRows) {
  const byPlayer = new Map();

  for (const row of combinedLedgerRows) {
    const playerId = cleanText(row.player_id);
    const eventType = cleanText(row.event_type);

    if (!playerId) continue;
    if (eventType !== "singles" && eventType !== "doubles") continue;

    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, { singles: [], doubles: [] });
    }

    byPlayer.get(playerId)[eventType].push(row);
  }

  const map = new Map();

  for (const [playerId, groups] of byPlayer.entries()) {
    const cartel = { singles: [], doubles: [] };

    for (const eventType of ["singles", "doubles"]) {
      const sorted = sortLedgerResults(groups[eventType]);
      const countingKeys = new Set(
        sorted.slice(0, 6).map((row) => buildResultKey(row))
      );

      cartel[eventType] = sorted.map((row) => ({
        eventType,
        tournament: cleanText(row.tournament_name),
        category: cleanText(row.category),
        round: cleanText(row.round),
        date: cleanText(row.start_date),
        points: toNumber(row.points),
        surface: cleanText(row.surface),
        surfaceCode: cleanText(row.surface_code).toUpperCase(),
        surfaceKey: getSurfaceKey(row.surface, row.surface_code),
        source: cleanText(row.source_type) === "live" ? "LIVE" : "",
        counting: countingKeys.has(buildResultKey(row)),
      }));
    }

    map.set(playerId, cartel);
  }

  return map;
}

const ROUND_ORDER = ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"];

const POINTS_BY_CATEGORY = {
  singles: {
    JGS: { R128: 0, R64: 0, R32: 90, R16: 180, QF: 300, SF: 490, F: 700, W: 1000 },
    J500: { R128: 0, R64: 0, R32: 45, R16: 90, QF: 150, SF: 250, F: 350, W: 500 },
    J300: { R128: 0, R64: 0, R32: 30, R16: 60, QF: 100, SF: 140, F: 210, W: 300 },
    J200: { R128: 0, R64: 0, R32: 18, R16: 36, QF: 60, SF: 100, F: 140, W: 200 },
    J100: { R128: 0, R64: 0, R32: 5, R16: 10, QF: 20, SF: 36, F: 60, W: 100 },
    J60: { R128: 0, R64: 0, R32: 0, R16: 5, QF: 10, SF: 18, F: 36, W: 60 },
    J30: { R128: 0, R64: 0, R32: 0, R16: 2, QF: 5, SF: 9, F: 18, W: 30 },
  },
  doubles: {
    JGS: { R128: 0, R64: 0, R32: 0, R16: 135, QF: 225, SF: 367, F: 525, W: 750 },
    J500: { R128: 0, R64: 0, R32: 0, R16: 67, QF: 112, SF: 187, F: 262, W: 375 },
    J300: { R128: 0, R64: 0, R32: 0, R16: 45, QF: 75, SF: 105, F: 157, W: 225 },
    J200: { R128: 0, R64: 0, R32: 0, R16: 27, QF: 45, SF: 75, F: 105, W: 150 },
    J100: { R128: 0, R64: 0, R32: 0, R16: 7, QF: 15, SF: 27, F: 45, W: 75 },
    J60: { R128: 0, R64: 0, R32: 0, R16: 0, QF: 7, SF: 14, F: 27, W: 45 },
    J30: { R128: 0, R64: 0, R32: 0, R16: 0, QF: 3, SF: 6, F: 13, W: 25 },
  },
};

function parseLiveResult(resultText) {
  const parts = cleanText(resultText).split("|").map((part) => part.trim());
  const pointsText = parts[0] || "";
  const category = parts[2] || "";
  const round = parts[3] || "";

  return {
    points: toNumber(pointsText),
    category,
    round,
  };
}

function getLiveResultsFromBest(bestResults) {
  return bestResults.filter((item) => item.toUpperCase().includes("LIVE"));
}

function normalizeProjectionRound(value) {
  const text = cleanText(value)
    .replace("❌", "")
    .replace("🏆", "W")
    .replace(/^Simples:\s*/i, "")
    .replace(/^Duplas:\s*/i, "")
    .replace(/^Singles\s*/i, "")
    .replace(/^Doubles\s*/i, "")
    .replace(/^Qualy\s*/i, "")
    .trim()
    .toUpperCase();

  if (text === "WR") return "W";
  if (text === "1ST ROUND" || text === "R1") return "R32";

  const match = text.match(/\b(R128|R64|R32|R16|QF|SF|F|W)\b/);
  return match ? match[1] : "";
}

function getParticipationRound(participation, eventType) {
  if (!participation) return "";

  const technicalRound =
    eventType === "singles"
      ? cleanText(participation.singlesRound)
      : cleanText(participation.doublesRound);

  if (technicalRound) return technicalRound;

  const summary =
    eventType === "singles"
      ? participation.singlesSummary
      : participation.doublesSummary;

  return normalizeProjectionRound(summary);
}

function getProjectedTotalFromTopSix(bestResults, livePoints, multiplier, targetRawPoints) {
  const parsedResults = bestResults
    .map((item) => ({
      text: item,
      result: parseLiveResult(item),
      isLive: item.toUpperCase().includes("LIVE"),
    }))
    .filter((item) => Number.isFinite(item.result.points));
  const liveIndex = parsedResults.findIndex((item) => item.isLive);
  const currentRawPoints = parsedResults
    .map((item) => item.result.points)
    .sort((a, b) => b - a)
    .slice(0, 6);
  const projectedRawPoints = parsedResults.map((item) => item.result.points);

  if (liveIndex >= 0) {
    projectedRawPoints[liveIndex] = targetRawPoints;
  } else {
    projectedRawPoints.push(targetRawPoints);
  }

  const currentContribution = currentRawPoints.reduce((sum, points) => sum + points, 0);
  const projectedContribution = projectedRawPoints
    .sort((a, b) => b - a)
    .slice(0, 6)
    .reduce((sum, points) => sum + points, 0);

  return livePoints + (projectedContribution - currentContribution) * multiplier;
}

function getProjectedScenario(bestResults, livePoints, eventType, multiplier, participation) {
  const liveItems = getLiveResultsFromBest(bestResults);
  const participationRound = getParticipationRound(participation, eventType);

  if (!liveItems.length && !participationRound) return { nextRound: null, title: null };

  const liveResult = parseLiveResult(liveItems[0]);
  const category = liveResult.category || cleanText(participation?.category) || "JGS";
  const eventPoints = POINTS_BY_CATEGORY[eventType] || POINTS_BY_CATEGORY.singles;
  const categoryPoints = eventPoints[category] || eventPoints.JGS;
  const currentRound = normalizeProjectionRound(liveResult.round) || participationRound;

  const currentIndex = ROUND_ORDER.indexOf(currentRound);
  const nextRound = currentIndex >= 0 && currentIndex < ROUND_ORDER.length - 1
    ? ROUND_ORDER[currentIndex + 1]
    : null;

  const nextRoundScenario = nextRound
    ? {
        eventType,
        targetRound: nextRound,
        projectedTotal: getProjectedTotalFromTopSix(
          bestResults,
          livePoints,
          multiplier,
          categoryPoints[nextRound] || 0
        ),
      }
    : null;

  const titleScenario = currentRound !== "W"
    ? {
        eventType,
        targetRound: "W",
        projectedTotal: getProjectedTotalFromTopSix(
          bestResults,
          livePoints,
          multiplier,
          categoryPoints.W || 0
        ),
      }
    : null;

  return { nextRound: nextRoundScenario, title: titleScenario };
}

function combineProjectedScenarios(singlesScenario, doublesScenario, livePoints) {
  if (!singlesScenario || !doublesScenario) return null;

  const singlesGain = singlesScenario.projectedTotal - livePoints;
  const doublesGain = doublesScenario.projectedTotal - livePoints;
  const sameRound = singlesScenario.targetRound === doublesScenario.targetRound;

  return {
    eventType: "combined",
    targetRound: sameRound
      ? singlesScenario.targetRound
      : `${singlesScenario.targetRound}/${doublesScenario.targetRound}`,
    projectedTotal: livePoints + singlesGain + doublesGain,
  };
}

function getMeaningfulProjectionScenarios(scenarios, livePoints) {
  const meaningful = scenarios.filter(
    (scenario) => scenario && scenario.projectedTotal > livePoints
  );
  const bestIndividualTotal = meaningful
    .filter((scenario) => scenario.eventType !== "combined")
    .reduce((max, scenario) => Math.max(max, scenario.projectedTotal), livePoints);

  return meaningful.filter(
    (scenario) =>
      scenario.eventType !== "combined" ||
      scenario.projectedTotal > bestIndividualTotal
  );
}

function shouldProjectEvent(row, weekParticipationMap, eventType) {
  const participation = weekParticipationMap.get(cleanText(row.player_id));

  if (!participation) return false;
  if (participation.isFinishedByDate) return false;

  const status =
    eventType === "singles"
      ? cleanText(participation.singlesStatus).toLowerCase()
      : cleanText(participation.doublesStatus).toLowerCase();

  return status === "still_alive_or_champion" || status === "not_started_or_unknown";
}

function buildDataForHtml(
  rows,
  weekParticipationMap = new Map(),
  pointDetailsMap = new Map(),
  pointCartelMap = new Map()
) {
  return rows.map((row) => ({
    live_rank: toNumber(row.live_rank),
    official_rank: toNumber(row.official_rank),
    rank_change_vs_official: toNumber(row.rank_change_vs_official),

    player_id: cleanText(row.player_id),
    player_name: cleanText(row.player_name),
    gender: cleanText(row.gender),
    gender_label: getGenderLabel(row.gender),

    country: cleanText(row.country),
    country_iso2: countryCodeToIso2(row.country),
    country_name: cleanText(row.country_name),
    birth_year: cleanText(row.birth_year),

    official_points: toNumber(row.official_points_for_comparison),
    live_points: toNumber(row.live_points),
    points_change_vs_official: toNumber(row.points_change_vs_official),

    singles_points: toNumber(row.singles_points),
    doubles_points_raw: toNumber(row.doubles_points_raw),
    doubles_points_weighted: toNumber(row.doubles_points_weighted),

    has_live_result: cleanText(row.has_live_result),
    has_dropped_result: cleanText(row.has_dropped_result),

    live_rows_available: toNumber(row.live_rows_available),
    live_raw_points_available: toNumber(row.live_raw_points_available),
    live_singles_results_counting: toNumber(row.live_singles_results_counting),
    live_doubles_results_counting: toNumber(row.live_doubles_results_counting),

    dropped_rows_count: toNumber(row.dropped_rows_count),
    dropped_singles_raw: toNumber(row.dropped_singles_raw),
    dropped_doubles_raw: toNumber(row.dropped_doubles_raw),
    estimated_weighted_dropped: toNumber(row.estimated_weighted_dropped),

    best_singles: getBestSingles(row),
    best_doubles: getBestDoubles(row),

    playing_this_week:
      weekParticipationMap.get(cleanText(row.player_id)) || getPlayingThisWeek(row),
    point_details:
      pointDetailsMap.get(cleanText(row.player_id)) ||
      { live: [], drops: [] },
    point_cartel:
      pointCartelMap.get(cleanText(row.player_id)) || { singles: [], doubles: [] },

    next_round_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const participation = weekParticipationMap.get(cleanText(row.player_id));
      const singlesScenario = shouldProjectEvent(row, weekParticipationMap, "singles")
        ? getProjectedScenario(singles, livePoints, "singles", 1, participation)
        : { nextRound: null, title: null };
      const doublesScenario = shouldProjectEvent(row, weekParticipationMap, "doubles")
        ? getProjectedScenario(doubles, livePoints, "doubles", 0.25, participation)
        : { nextRound: null, title: null };
      const combinedScenario = combineProjectedScenarios(
        singlesScenario.nextRound,
        doublesScenario.nextRound,
        livePoints
      );

      return getMeaningfulProjectionScenarios([
        singlesScenario.nextRound,
        doublesScenario.nextRound,
        combinedScenario,
      ], livePoints);
    })(),

    title_scenarios: (() => {
      const livePoints = toNumber(row.live_points);
      const singles = getBestSingles(row);
      const doubles = getBestDoubles(row);
      const participation = weekParticipationMap.get(cleanText(row.player_id));
      const singlesScenario = shouldProjectEvent(row, weekParticipationMap, "singles")
        ? getProjectedScenario(singles, livePoints, "singles", 1, participation)
        : { nextRound: null, title: null };
      const doublesScenario = shouldProjectEvent(row, weekParticipationMap, "doubles")
        ? getProjectedScenario(doubles, livePoints, "doubles", 0.25, participation)
        : { nextRound: null, title: null };
      const combinedScenario = combineProjectedScenarios(
        singlesScenario.title,
        doublesScenario.title,
        livePoints
      );

      return getMeaningfulProjectionScenarios([
        singlesScenario.title,
        doublesScenario.title,
        combinedScenario,
      ], livePoints);
    })(),

    ranking_date: cleanText(row.ranking_date),
    calculated_at: cleanText(row.calculated_at),
  }));
}

function groupWeekTournaments(tournaments) {
  const map = new Map();

  function getTournamentDisplayName(name, category) {
    const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return name.replace(new RegExp(`^${escapedCategory}\\s+`, "i"), "");
  }

  for (const row of tournaments) {
    const category = cleanText(row.category || row.tournament_category || "OUTROS");
    const name = cleanText(row.tournament_name);
    const country = cleanText(row.host_nation_code || row.country || row.hostNationCode);
    const surface = cleanText(row.surface);
    const surfaceCode = cleanText(row.surface_code).toUpperCase();
    const surfaceKey = getSurfaceKey(surface, surfaceCode);

    if (!name) continue;

    if (!map.has(category)) {
      map.set(category, {
        category,
        items: [],
      });
    }

    map.get(category).items.push({
      name,
      displayName: getTournamentDisplayName(name, category),
      country,
      surface,
      surfaceCode,
      surfaceKey,
    });
  }

  return [...map.values()]
    .sort((a, b) => {
      const order = {
        JGS: 1,
        J500: 2,
        J300: 3,
        J200: 4,
        J100: 5,
        J60: 6,
        J30: 7,
      };

      return (order[a.category] || 99) - (order[b.category] || 99);
    })
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    }));
}

function getSurfaceKey(surface, surfaceCode = "") {
  const code = cleanText(surfaceCode).toUpperCase();
  const text = cleanText(surface).toLowerCase();

  if (code === "C" || text.includes("clay") || text.includes("saibro")) return "clay";
  if (code === "G" || text.includes("grass") || text.includes("grama")) return "grass";
  if (code === "H" || text.includes("hard") || text.includes("duro")) return "hard";
  if (code === "A" || text.includes("carpet") || text.includes("carpete")) return "carpet";

  return "other";
}

function getStats(rows) {
  const boys = rows.filter((row) => cleanText(row.gender) === "M");
  const girls = rows.filter((row) => cleanText(row.gender) === "F");

  const withLive = rows.filter(
    (row) => cleanText(row.has_live_result) === "true"
  );

  const withDrops = rows.filter(
    (row) => cleanText(row.has_dropped_result) === "true"
  );

  const biggestRise = [...rows]
    .filter((row) => toNumber(row.rank_change_vs_official) > 0)
    .sort(
      (a, b) =>
        toNumber(b.rank_change_vs_official) -
        toNumber(a.rank_change_vs_official)
    )[0];

  const biggestFall = [...rows]
    .filter((row) => toNumber(row.rank_change_vs_official) < 0)
    .sort(
      (a, b) =>
        toNumber(a.rank_change_vs_official) -
        toNumber(b.rank_change_vs_official)
    )[0];

  return {
    total: rows.length,
    boys: boys.length,
    girls: girls.length,
    withLive: withLive.length,
    withDrops: withDrops.length,
    biggestRise,
    biggestFall,
  };
}

function buildHtml(
  rows,
  weekTournaments,
  weekParticipationMap,
  pointDetailsMap,
  pointCartelMap
) {
  const data = buildDataForHtml(
    rows,
    weekParticipationMap,
    pointDetailsMap,
    pointCartelMap
  );
  const stats = getStats(rows);
  const tournamentGroups = groupWeekTournaments(weekTournaments);

  const calculatedAt = rows[0]?.calculated_at || new Date().toISOString();
  const rankingDate = rows[0]?.ranking_date || "";
  const rolloverNotice = buildRolloverNotice(weekTournaments, rankingDate);

  const biggestRise = stats.biggestRise;
  const biggestFall = stats.biggestFall;

  const dataJson = JSON.stringify(data);
  const tournamentGroupsJson = JSON.stringify(tournamentGroups);
  const pointsByCategoryJson = JSON.stringify(POINTS_BY_CATEGORY);
  const rolloverNoticeJson = JSON.stringify(rolloverNotice);
  const rolloverNoticeText = rolloverNotice
    ? `Os resultados até ${formatIsoDatePt(rolloverNotice.weekEnd)} já estão considerados nesta projeção; a nova semana começa automaticamente assim que a ITF publicar a base oficial de ${formatIsoDatePt(rolloverNotice.expectedRankingDate)}.`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ITF Juniors Live Ranking</title>
  <link rel="icon" href="favicon.png" type="image/png" />
  ${ADSENSE_SCRIPT}
  <script>
    document.documentElement.dataset.theme = localStorage.getItem("itf-live-theme") || "light";
  </script>
  <style>
    :root {
      --bg: #f5f8f7;
      --bg-glow: #e7f3ef;
      --bg-bottom: #f9fbfa;
      --panel: rgba(255, 255, 255, 0.94);
      --panel-solid: #ffffff;
      --panel-soft: #f7faf9;
      --text: #142432;
      --muted: #66788a;
      --muted-soft: #8a9aaa;
      --border: #dfe9e6;
      --border-soft: #edf3f1;
      --green-dark: #08756d;
      --green: #12805f;
      --green-soft: #dff7ee;
      --red: #d74855;
      --red-soft: #ffe8eb;
      --yellow: #a66a12;
      --yellow-soft: #fff2d7;
      --blue: #276f9f;
      --blue-soft: #e8f3fb;
      --shadow: 0 18px 50px rgba(26, 45, 57, 0.08);
      --shadow-soft: 0 8px 24px rgba(26, 45, 57, 0.06);
      --radius: 16px;
      --radius-sm: 10px;
    }

    :root[data-theme="dark"] {
      --bg: #101820;
      --bg-glow: #14252b;
      --bg-bottom: #0d141a;
      --panel: rgba(18, 28, 36, 0.94);
      --panel-solid: #121c24;
      --panel-soft: #17242d;
      --text: #e7eef2;
      --muted: #9aacb8;
      --muted-soft: #71838f;
      --border: #2a3a44;
      --border-soft: #21313a;
      --green-dark: #61c6b8;
      --green: #72d5ad;
      --green-soft: rgba(97, 198, 184, 0.16);
      --red: #ff8390;
      --red-soft: rgba(255, 131, 144, 0.15);
      --yellow: #f3c36c;
      --yellow-soft: rgba(243, 195, 108, 0.16);
      --blue: #8cc8f1;
      --blue-soft: rgba(140, 200, 241, 0.16);
      --shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      --shadow-soft: 0 8px 24px rgba(0, 0, 0, 0.22);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(220, 244, 236, 0.84), transparent 32rem),
        linear-gradient(180deg, var(--bg-glow) 0%, var(--bg) 34%, var(--bg-bottom) 100%);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    :root[data-theme="dark"] body {
      background:
        radial-gradient(circle at top left, rgba(32, 88, 96, 0.42), transparent 32rem),
        linear-gradient(180deg, var(--bg-glow) 0%, var(--bg) 38%, var(--bg-bottom) 100%);
    }

    .page {
      width: min(1760px, calc(100% - 48px));
      margin: 0 auto;
      padding: 16px 0 24px;
    }

    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: start;
      margin-bottom: 18px;
    }

    .brand-lockup {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }

    .brand-logo {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      object-fit: cover;
      background: #ffffff;
      border: 1px solid rgba(8, 117, 109, 0.14);
      box-shadow: 0 8px 20px rgba(8, 117, 109, 0.12);
    }

    h1 {
      margin: 0;
      max-width: 780px;
      font-size: clamp(32px, 3vw, 42px);
      line-height: 0.98;
      letter-spacing: -0.04em;
      color: var(--green-dark);
      font-weight: 800;
    }

    .creator {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      color: var(--muted);
      font-weight: 500;
      font-size: 11px;
      line-height: 1.2;
    }

    .creator a {
      color: var(--green-dark);
      text-decoration: none;
      font-weight: 600;
    }

    .site-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: center;
      margin-top: 18px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.4;
    }

    .site-footer a {
      color: var(--green-dark);
      text-decoration: none;
      font-weight: 650;
    }

    .info-section {
      margin-top: 14px;
      padding: 18px 2px 2px;
      border-top: 1px solid var(--border-soft);
    }

    .info-section h2 {
      margin: 0 0 6px;
      color: var(--green-dark);
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .info-intro {
      max-width: 860px;
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .info-item {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--border-soft);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.48);
    }

    .info-item h3 {
      margin: 0 0 6px;
      color: var(--text);
      font-size: 12px;
      line-height: 1.25;
    }

    .info-item p {
      margin: 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .beta {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      background: rgba(8, 117, 109, 0.1);
      color: var(--green-dark);
      border: 1px solid rgba(8, 117, 109, 0.12);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .top-controls {
      display: flex;
      gap: 6px;
      padding: 5px;
      background: rgba(255, 255, 255, 0.58);
      border: 1px solid rgba(255, 255, 255, 0.74);
      border-radius: 18px;
      box-shadow: var(--shadow-soft);
      backdrop-filter: blur(18px);
    }

    .mini-control {
      display: grid;
      gap: 3px;
    }

    .mini-control label,
    .filter label {
      font-size: 9px;
      font-weight: 500;
      color: var(--muted);
      letter-spacing: 0.01em;
    }

    select,
    input {
      min-height: 28px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.9);
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
      outline: none;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    input {
      width: 100%;
    }

    select:focus,
    input:focus {
      border-color: rgba(8, 117, 109, 0.38);
      box-shadow: 0 0 0 4px rgba(8, 117, 109, 0.1);
      background: #ffffff;
    }

    input:disabled {
      color: var(--muted);
      background: rgba(255, 255, 255, 0.62);
    }

    :root[data-theme="dark"] .top-controls,
    :root[data-theme="dark"] .filters {
      background: rgba(18, 28, 36, 0.74);
      border-color: rgba(255, 255, 255, 0.08);
    }

    :root[data-theme="dark"] select,
    :root[data-theme="dark"] input,
    :root[data-theme="dark"] .toggle-button {
      color: var(--text);
      background: rgba(17, 27, 35, 0.9);
      border-color: var(--border);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
    }

    :root[data-theme="dark"] select:focus,
    :root[data-theme="dark"] input:focus {
      background: #111b23;
      border-color: rgba(97, 198, 184, 0.48);
      box-shadow: 0 0 0 4px rgba(97, 198, 184, 0.12);
    }

    :root[data-theme="dark"] input:disabled {
      color: var(--muted);
      background: rgba(17, 27, 35, 0.62);
    }

    .filters {
      position: relative;
      z-index: 40;
      display: grid;
      grid-template-columns: minmax(210px, 1.05fr) minmax(140px, 0.62fr) minmax(310px, 1fr) 206px 130px 150px 130px;
      gap: 7px;
      align-items: end;
      margin-bottom: 8px;
      padding: 7px;
      background: rgba(255, 255, 255, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.74);
      border-radius: var(--radius);
      box-shadow: var(--shadow-soft);
      backdrop-filter: blur(18px);
    }

    .rollover-notice {
      display: grid;
      gap: 3px;
      margin: 0 0 10px;
      padding: 10px 12px;
      color: #5f4312;
      background: linear-gradient(135deg, rgba(255, 247, 226, 0.96), rgba(242, 252, 247, 0.94));
      border: 1px solid rgba(203, 147, 42, 0.26);
      border-radius: 12px;
      box-shadow: var(--shadow-soft);
    }

    .rollover-notice strong {
      font-size: 13px;
      line-height: 1.25;
    }

    .rollover-notice span {
      color: #735520;
      font-size: 12px;
      font-weight: 650;
      line-height: 1.35;
    }

    :root[data-theme="dark"] .rollover-notice {
      color: #ffe3a8;
      background: linear-gradient(135deg, rgba(72, 55, 22, 0.72), rgba(24, 46, 43, 0.72));
      border-color: rgba(255, 204, 112, 0.2);
    }

    :root[data-theme="dark"] .rollover-notice span {
      color: #f6d9a0;
    }

    .filter {
      display: grid;
      gap: 3px;
    }

    .country-filter {
      position: relative;
    }

    .country-input-wrap {
      position: relative;
    }

    .country-input-wrap input {
      padding-right: 46px;
    }

    .country-clear {
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
      border: 0;
      padding: 2px 4px;
      background: transparent;
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
      display: none;
    }

    .country-filter.has-country .country-clear {
      display: inline-flex;
    }

    .country-suggestions {
      position: absolute;
      z-index: 30;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      display: none;
      max-height: 212px;
      overflow-y: auto;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel-solid);
      box-shadow: var(--shadow);
    }

    .country-filter.suggestions-open .country-suggestions {
      display: grid;
      gap: 3px;
    }

    .country-suggestion {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      border: 0;
      border-radius: 8px;
      padding: 7px 8px;
      background: transparent;
      color: var(--text);
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      cursor: pointer;
    }

    .country-suggestion:hover,
    .country-suggestion:focus {
      background: var(--panel-soft);
      outline: none;
    }

    .country-suggestion-code {
      color: var(--muted);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.06em;
    }

    .country-no-results {
      padding: 8px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
    }

    .toggle-filter {
      align-self: stretch;
    }

    .segmented-control {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 28px;
      padding: 3px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(238, 244, 246, 0.82);
      gap: 3px;
    }

    .segmented-control button {
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease;
    }

    .segmented-control button.active {
      background: #ffffff;
      color: var(--text);
      box-shadow: 0 4px 12px rgba(26, 45, 57, 0.08);
    }

    :root[data-theme="dark"] .segmented-control {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--border);
    }

    :root[data-theme="dark"] .segmented-control button.active {
      background: rgba(255, 255, 255, 0.1);
    }

    .language-toggle {
      grid-template-columns: 1fr 1fr 1fr;
      width: 142px;
    }

    .ranking-mode-control {
      grid-template-columns: minmax(76px, 1.1fr) minmax(60px, 0.9fr) minmax(54px, 0.75fr) minmax(54px, 0.75fr);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .toggle-button {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 7px;
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.9);
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
    }

    .toggle-button input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .toggle-track {
      width: 25px;
      height: 14px;
      border-radius: 999px;
      background: #d7e0df;
      position: relative;
      flex: 0 0 auto;
      transition: background 160ms ease;
    }

    .toggle-track::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
      transition: transform 160ms ease;
    }

    .toggle-button input:checked + .toggle-track {
      background: var(--green-dark);
    }

    .toggle-button input:checked + .toggle-track::after {
      transform: translateX(11px);
    }

    .toggle-button:has(input:checked) {
      color: var(--text);
      border-color: rgba(8, 117, 109, 0.25);
      background: rgba(255, 255, 255, 0.96);
    }

    :root[data-theme="dark"] .toggle-button:has(input:checked) {
      border-color: rgba(97, 198, 184, 0.36);
      background: rgba(25, 42, 50, 0.96);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      gap: 8px;
      align-items: start;
    }

    .ranking-card,
    .side-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(18px);
    }

    .ranking-card-header {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 5px 10px;
      padding: 7px 8px;
      border-bottom: 1px solid var(--border-soft);
    }

    .formula {
      color: var(--muted);
      font-size: 9px;
      line-height: 1.1;
      white-space: nowrap;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 10px;
    }

    thead {
      background: rgba(247, 250, 249, 0.92);
    }

    :root[data-theme="dark"] thead {
      background: rgba(23, 36, 45, 0.92);
    }

    th {
      text-align: left;
      color: var(--muted);
      font-size: 9px;
      line-height: 1.05;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 5px 5px;
      border-bottom: 1px solid var(--border-soft);
      font-weight: 700;
      white-space: nowrap;
    }

    .sort-header {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      text-transform: inherit;
      letter-spacing: inherit;
      cursor: pointer;
    }

    .sort-header:hover,
    .sort-header.active {
      color: var(--green-dark);
    }

    .sort-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: rgba(8, 117, 109, 0.08);
      color: var(--green-dark);
      font-size: 7px;
      line-height: 1;
      opacity: 0.36;
    }

    .sort-header.active .sort-indicator {
      opacity: 1;
    }

    td {
      padding: 3px 5px;
      border-bottom: 1px solid var(--border-soft);
      vertical-align: middle;
      line-height: 1.05;
    }

    tbody tr {
      cursor: pointer;
      transition: background 140ms ease, box-shadow 140ms ease;
    }

    tbody tr:nth-child(even) {
      background: rgba(18, 60, 74, 0.018);
    }

    tbody tr:hover {
      background: rgba(235, 247, 243, 0.56);
    }

    tbody tr.selected {
      background: rgba(224, 244, 237, 0.82);
      box-shadow: 4px 0 0 var(--green-dark) inset;
    }

    :root[data-theme="dark"] tbody tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.018);
    }

    :root[data-theme="dark"] tbody tr:hover {
      background: rgba(97, 198, 184, 0.08);
    }

    :root[data-theme="dark"] tbody tr.selected {
      background: rgba(97, 198, 184, 0.14);
    }

    .rank {
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .rank-meta {
      margin-top: 2px;
      color: var(--muted);
      font-size: 8px;
      font-weight: 500;
      line-height: 1.05;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .rank-change {
      display: inline-flex;
      min-width: 18px;
      justify-content: center;
      align-items: center;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      margin-left: 4px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .up {
      background: var(--green-soft);
      color: var(--green);
    }

    .down {
      background: var(--red-soft);
      color: var(--red);
    }

    .same {
      background: #edf2f5;
      color: var(--muted);
    }

    .player {
      min-width: 170px;
    }

    .player-name {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
      line-height: 1.08;
      font-size: 11px;
      letter-spacing: -0.01em;
      word-break: normal;
      overflow-wrap: anywhere;
    }

    .country-flag {
      width: 16px;
      height: 11px;
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(20, 36, 50, 0.14), 0 4px 10px rgba(20, 36, 50, 0.08);
      flex: 0 0 auto;
      object-fit: cover;
    }

    .player-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 400;
      line-height: 1.25;
    }

    .points {
      font-weight: 700;
      color: var(--text);
      font-size: 11px;
      white-space: nowrap;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .points-cell {
      min-width: 156px;
    }

    .points-main {
      display: flex;
      align-items: center;
      gap: 3px;
      flex-wrap: wrap;
    }

    .points-balance {
      display: inline-flex;
      align-items: center;
      min-height: 14px;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      border: 1px solid transparent;
      font-variant-numeric: tabular-nums;
    }

    .points-balance.positive {
      color: #087047;
      background: #e4f8ed;
      border-color: #b9ecd0;
    }

    .points-balance.negative {
      color: #b42334;
      background: #ffe8eb;
      border-color: #ffc6ce;
    }

    .points-balance.neutral {
      color: var(--muted);
      background: #edf2f5;
      border-color: #dbe5ea;
    }

    :root[data-theme="dark"] .points-balance.positive {
      color: var(--green);
      background: var(--green-soft);
      border-color: rgba(114, 213, 173, 0.26);
    }

    :root[data-theme="dark"] .points-balance.negative {
      color: var(--red);
      background: var(--red-soft);
      border-color: rgba(255, 131, 144, 0.28);
    }

    :root[data-theme="dark"] .points-balance.neutral,
    :root[data-theme="dark"] .same {
      color: var(--muted);
      background: rgba(255, 255, 255, 0.06);
      border-color: var(--border);
    }

    .points-info-button {
      margin-top: 0;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.78);
      color: var(--green-dark);
      border-radius: 999px;
      width: 16px;
      height: 16px;
      padding: 0;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      box-shadow: none;
      opacity: 0;
      transform: translateY(1px);
      transition: opacity 140ms ease, border-color 140ms ease, background 140ms ease, transform 140ms ease;
    }

    tbody tr:hover .points-info-button,
    tbody tr.selected .points-info-button,
    .points-cell:focus-within .points-info-button,
    .points-info-button.active {
      opacity: 1;
      transform: translateY(0);
    }

    .points-info-button:hover,
    .points-info-button.active {
      background: #ffffff;
      border-color: rgba(8, 117, 109, 0.26);
    }

    :root[data-theme="dark"] .points-info-button {
      background: rgba(17, 27, 35, 0.82);
    }

    :root[data-theme="dark"] .points-info-button:hover,
    :root[data-theme="dark"] .points-info-button.active {
      background: rgba(25, 42, 50, 0.96);
      border-color: rgba(97, 198, 184, 0.34);
    }

    .points-detail {
      margin-top: 4px;
      padding: 5px 6px;
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      background: rgba(247, 250, 249, 0.82);
      color: var(--text);
    }

    :root[data-theme="dark"] .points-detail {
      background: rgba(17, 27, 35, 0.86);
    }

    .points-detail-section + .points-detail-section {
      margin-top: 4px;
    }

    .points-detail-title {
      color: var(--muted);
      font-size: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .points-detail-line {
      margin-top: 2px;
      font-size: 8px;
      line-height: 1.14;
      color: #3d5264;
      overflow-wrap: anywhere;
    }

    .points-detail-impact {
      font-weight: 700;
      white-space: nowrap;
    }

    .small {
      color: var(--muted);
      font-size: 8px;
      line-height: 1.12;
    }

    .week-cell {
      min-width: 160px;
      font-weight: 600;
      line-height: 1.04;
      letter-spacing: -0.01em;
      word-break: normal;
      overflow-wrap: anywhere;
    }

    .week-tournament {
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }

    .tournament-name {
      color: var(--cat-color, var(--text));
      font-weight: 700;
    }

    .week-tournament .tournament-name,
    .result-title.tournament-name {
      color: var(--cat-color, var(--text));
    }

    .week-sub {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
      color: var(--muted);
      font-size: 9px;
      font-weight: 500;
      line-height: 1.12;
    }

    .week-result-item {
      color: var(--muted);
      white-space: nowrap;
    }

    .week-result-item strong {
      color: var(--cat-color, var(--text));
      font-weight: 600;
    }

    .week-result-item.title strong {
      font-weight: 700;
    }

    .week-result-item.title {
      font-weight: 700;
    }

    .week-result-item.eliminated strong {
      color: var(--muted);
    }

    .projection-list {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 2px;
      min-width: 0;
      max-width: none;
      line-height: 1;
    }

    .projection-item {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: 16px;
      padding: 1px 4px;
      border: 1px solid var(--cat-border, var(--border));
      border-radius: 999px;
      background: var(--cat-soft, rgba(247, 250, 249, 0.9));
      color: var(--cat-color, var(--text));
      font-size: 8.5px;
      font-weight: 600;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .projection-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
    }

    .projection-main {
      color: var(--cat-color, var(--text));
      font-weight: 700;
    }

    .projection-points {
      color: var(--muted);
      font-weight: 600;
    }

    .projection-item .trophy {
      font-size: 12px;
      line-height: 0.8;
      vertical-align: -1px;
    }

    .week-result-separator {
      color: var(--muted-soft);
    }

    .week-result-item .out {
      color: var(--red);
      font-weight: 700;
      font-size: 13px;
      line-height: 0.8;
    }

    .week-result-item .trophy {
      font-size: 13px;
      line-height: 0.8;
      vertical-align: -1px;
    }

    .dash {
      color: var(--muted);
    }

    .status-pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 1px 4px;
      font-size: 8px;
      font-weight: 700;
      margin-right: 4px;
      white-space: nowrap;
      letter-spacing: 0.04em;
    }

    .live {
      background: var(--green-soft);
      color: var(--green);
    }

    .drop {
      background: var(--yellow-soft);
      color: var(--yellow);
    }

    .new {
      background: var(--blue-soft);
      color: var(--blue);
    }

    .category-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 14px;
      border-radius: 999px;
      padding: 1px 5px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      color: var(--cat-color, var(--green-dark));
      background: var(--cat-bg, var(--green-soft));
      border: 1px solid var(--cat-border, rgba(8, 117, 109, 0.14));
    }

    .cat-jgs,
    .cat-j500,
    .cat-j300,
    .cat-j200,
    .cat-j100,
    .cat-j60,
    .cat-j30 {
      --cat-color: #4f5f6b;
      --cat-bg: rgba(247, 250, 249, 0.9);
      --cat-soft: rgba(247, 250, 249, 0.9);
      --cat-border: rgba(79, 95, 107, 0.22);
    }

    :root[data-theme="dark"] .cat-jgs,
    :root[data-theme="dark"] .cat-j500,
    :root[data-theme="dark"] .cat-j300,
    :root[data-theme="dark"] .cat-j200,
    :root[data-theme="dark"] .cat-j100,
    :root[data-theme="dark"] .cat-j60,
    :root[data-theme="dark"] .cat-j30 {
      --cat-color: var(--muted);
      --cat-bg: rgba(255, 255, 255, 0.05);
      --cat-soft: rgba(255, 255, 255, 0.05);
      --cat-border: rgba(255, 255, 255, 0.12);
    }

    .surface-clay {
      --cat-color: #e87822;
      --cat-bg: rgba(232, 120, 34, 0.13);
      --cat-soft: rgba(232, 120, 34, 0.13);
      --cat-border: rgba(232, 120, 34, 0.42);
    }

    .surface-grass {
      --cat-color: #2f9b57;
      --cat-bg: rgba(47, 155, 87, 0.13);
      --cat-soft: rgba(47, 155, 87, 0.13);
      --cat-border: rgba(47, 155, 87, 0.42);
    }

    .surface-hard {
      --cat-color: #2569a8;
      --cat-bg: rgba(37, 105, 168, 0.13);
      --cat-soft: rgba(37, 105, 168, 0.13);
      --cat-border: rgba(37, 105, 168, 0.42);
    }

    .surface-carpet,
    .surface-other {
      --cat-color: #8a56c5;
      --cat-bg: rgba(138, 86, 197, 0.13);
      --cat-soft: rgba(138, 86, 197, 0.13);
      --cat-border: rgba(138, 86, 197, 0.42);
    }

    :root[data-theme="dark"] .surface-clay {
      --cat-color: #e87822;
      --cat-bg: rgba(232, 120, 34, 0.18);
      --cat-soft: rgba(232, 120, 34, 0.16);
      --cat-border: rgba(232, 120, 34, 0.46);
    }

    :root[data-theme="dark"] .surface-grass {
      --cat-color: #2f9b57;
      --cat-bg: rgba(47, 155, 87, 0.18);
      --cat-soft: rgba(47, 155, 87, 0.16);
      --cat-border: rgba(47, 155, 87, 0.46);
    }

    :root[data-theme="dark"] .surface-hard {
      --cat-color: #2569a8;
      --cat-bg: rgba(37, 105, 168, 0.2);
      --cat-soft: rgba(37, 105, 168, 0.18);
      --cat-border: rgba(37, 105, 168, 0.5);
    }

    :root[data-theme="dark"] .surface-carpet,
    :root[data-theme="dark"] .surface-other {
      --cat-color: #8a56c5;
      --cat-bg: rgba(138, 86, 197, 0.2);
      --cat-soft: rgba(138, 86, 197, 0.18);
      --cat-border: rgba(138, 86, 197, 0.5);
    }

    .side {
      display: grid;
      gap: 7px;
    }

    .side-card h3 {
      margin: 0 0 6px;
      font-size: 12px;
      letter-spacing: -0.03em;
      line-height: 1.2;
      font-weight: 700;
    }

    .side-card {
      padding: 7px;
    }

    .profile-modal {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(15, 23, 32, 0.48);
      backdrop-filter: blur(6px);
    }

    .profile-modal.open {
      display: flex;
    }

    .profile-dialog {
      width: min(1040px, 100%);
      max-height: min(88vh, 760px);
      padding: 12px;
      overflow: auto;
      overscroll-behavior: contain;
    }

    .profile-dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 7px;
      padding-bottom: 7px;
      border-bottom: 1px solid var(--border-soft);
    }

    .profile-dialog-header h3 {
      margin: 0;
    }

    .modal-close-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.8);
      color: var(--text);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }

    .modal-close-button:hover {
      border-color: rgba(8, 117, 109, 0.26);
      color: var(--green-dark);
      background: #ffffff;
    }

    :root[data-theme="dark"] .modal-close-button {
      background: rgba(17, 27, 35, 0.82);
    }

    :root[data-theme="dark"] .modal-close-button:hover {
      background: rgba(25, 42, 50, 0.96);
      border-color: rgba(97, 198, 184, 0.34);
    }

    .tournament-group {
      display: grid;
      grid-template-columns: 32px 1fr;
      align-items: center;
      gap: 5px;
      padding: 3px 0;
      border-top: 1px solid var(--border-soft);
    }

    .tournament-group:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .tournament-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      line-height: 1.18;
      font-weight: 500;
    }

    .week-tournament-name {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 1px 5px;
      background: var(--cat-soft, rgba(247, 250, 249, 0.82));
      border: 1px solid var(--cat-border, var(--border-soft));
      color: var(--cat-color, var(--muted));
      font-weight: 600;
      line-height: 1.1;
    }

    :root[data-theme="dark"] .week-tournament-name {
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--border);
    }

    .profile-empty {
      color: var(--muted);
      line-height: 1.15;
      font-size: 10px;
      padding: 1px 0;
    }

    .profile-head {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }

    .profile-flag {
      display: flex;
      align-items: center;
      padding-top: 2px;
    }

    .profile-flag .country-flag {
      width: 22px;
      height: 15px;
    }

    .profile-name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }

    .profile-meta {
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.08;
    }

    .profile-line {
      font-size: 9px;
      color: var(--muted);
      line-height: 1.14;
      margin-bottom: 4px;
    }

    .profile-line strong {
      color: var(--text);
    }

    .profile-section {
      margin-top: 9px;
    }

    .profile-section-title {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      margin-bottom: 3px;
      letter-spacing: -0.01em;
    }

    .profile-section-meta {
      color: var(--muted);
      font-size: 8px;
      font-weight: 500;
      white-space: nowrap;
    }

    .profile-overview {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
      align-items: stretch;
      margin: 8px 0 10px;
    }

    .profile-overview.single {
      grid-template-columns: 1fr;
    }

    .profile-overview-card {
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      padding: 10px;
      background: rgba(247, 250, 249, 0.58);
      min-width: 0;
    }

    :root[data-theme="dark"] .profile-overview-card {
      background: rgba(17, 27, 35, 0.52);
    }

    .cartel-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      margin-top: 10px;
    }

    .cartel-grid .profile-section {
      min-width: 0;
      margin-top: 0;
    }

    .surface-chart {
      display: grid;
      grid-template-columns: 136px minmax(0, 1fr);
      gap: 16px;
      align-items: center;
      padding: 8px 0 2px;
    }

    .surface-donut {
      width: 128px;
      height: 128px;
      border-radius: 50%;
      background: conic-gradient(var(--border) 0 360deg);
      position: relative;
      box-shadow: 0 0 0 1px var(--border-soft) inset;
    }

    .surface-donut::after {
      content: "";
      position: absolute;
      inset: 33px;
      border-radius: 50%;
      background: var(--panel-solid);
      box-shadow: 0 0 0 1px var(--border-soft);
    }

    :root[data-theme="dark"] .surface-donut::after {
      background: var(--panel-solid);
    }

    .surface-legend {
      display: grid;
      grid-template-columns: 1fr;
      gap: 7px;
      min-width: 0;
    }

    .surface-legend-item {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr);
      gap: 6px;
      align-items: center;
      min-width: 0;
      font-size: 10px;
      line-height: 1.16;
      color: var(--muted);
    }

    .surface-legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--surface-color);
      box-shadow: 0 0 0 1px rgba(20, 36, 50, 0.08);
    }

    .surface-legend-label {
      white-space: normal;
    }

    .surface-legend-label strong {
      color: var(--text);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .simulator {
      display: grid;
      gap: 8px;
    }

    .simulator-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
    }

    .simulator-field {
      display: grid;
      gap: 2px;
    }

    .simulator-field label {
      color: var(--muted);
      font-size: 9px;
      font-weight: 700;
    }

    .simulator-result {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      min-height: 20px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.1;
    }

    .simulator-pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 6px;
      background: rgba(8, 117, 109, 0.08);
      color: var(--green-dark);
      border: 1px solid rgba(8, 117, 109, 0.14);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    :root[data-theme="dark"] .simulator-pill {
      background: rgba(97, 198, 184, 0.12);
      border-color: rgba(97, 198, 184, 0.22);
    }

    .result-list {
      display: grid;
      gap: 2px;
    }

    .result-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      min-height: 26px;
      border-left: 2px solid transparent;
      border-bottom: 1px solid var(--border-soft);
      padding: 3px 2px 3px 5px;
      font-size: 9px;
      line-height: 1.08;
    }

    .result-card.counting {
      border-left-color: var(--green-dark);
      background: linear-gradient(90deg, rgba(8, 117, 109, 0.06), transparent 34%);
    }

    .result-card.not-counting {
      opacity: 0.58;
    }

    :root[data-theme="dark"] .result-card {
      border-bottom-color: var(--border-soft);
    }

    :root[data-theme="dark"] .result-card.counting {
      border-left-color: var(--green-dark);
      background: linear-gradient(90deg, rgba(97, 198, 184, 0.1), transparent 34%);
    }

    :root[data-theme="dark"] .result-card.not-counting {
      background: transparent;
    }

    .result-main {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      min-width: 0;
    }

    .result-title {
      font-weight: 600;
      line-height: 1.08;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-heading {
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }

    .result-category-scope {
      display: contents;
    }

    .result-card.not-counting .result-title {
      font-weight: 500;
    }

    .result-points {
      font-weight: 700;
      color: var(--green-dark);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      text-align: right;
    }

    .result-meta {
      margin-top: 1px;
      color: var(--muted);
      font-size: 8px;
      line-height: 1.05;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-status-dot {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      margin-top: 4px;
      background: var(--border);
      flex: 0 0 auto;
    }

    .result-card.counting .result-status-dot {
      background: var(--green-dark);
    }

    .result-status {
      float: right;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 8px;
      font-weight: 700;
      border-radius: 999px;
      background: #edf4f2;
      padding: 1px 5px;
    }

    :root[data-theme="dark"] .result-status {
      background: rgba(255, 255, 255, 0.06);
    }

    .result-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 1px 3px;
      font-size: 8px;
      font-weight: 500;
      white-space: nowrap;
      color: color-mix(in srgb, var(--cat-color, var(--muted)) 72%, var(--muted));
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--cat-border, var(--border)) 60%, transparent);
    }

    .result-card.not-counting .result-badge {
      color: var(--muted);
      background: transparent;
      border-color: var(--border-soft);
    }

    .summary-row {
      color: var(--muted);
      font-size: 9px;
      display: flex;
      gap: 5px;
      align-items: baseline;
      white-space: nowrap;
    }

    .summary-row strong {
      color: var(--text);
    }

    .table-hint {
      flex-basis: 100%;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      width: fit-content;
      max-width: 100%;
      color: var(--muted);
      font-size: 9.5px;
      line-height: 1.25;
      font-weight: 600;
      padding: 2px 0;
    }

    .table-hint::before {
      content: "";
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--green-dark);
      flex: 0 0 auto;
    }

    :root[data-theme="dark"] .table-hint {
      color: var(--muted);
    }
input,
select,
button {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
}

table,
th,
td,
.points,
.rank,
.rank-change,
.result-points {
  font-variant-numeric: tabular-nums;
}

.player-name,
.week-cell,
.tournament-list,
.profile-name,
.result-card {
  hyphens: auto;
}

td:nth-child(6),
td:nth-child(7) {
  white-space: nowrap;
  min-width: 126px;
}

body.official-ranking-view .live-only {
  display: none;
}

body.official-ranking-view .weekly-only {
  display: none;
}

body.official-ranking-view .ranking-card {
  max-width: 860px;
}

body.official-ranking-view .side {
  display: none;
}

    body.official-ranking-view .layout {
      grid-template-columns: minmax(0, 860px);
    }

    body.modal-open {
      overflow: hidden;
    }
    @media (max-width: 1200px) {
      .page {
        width: min(100% - 24px, 100%);
        padding-top: 26px;
      }

      .header {
        grid-template-columns: 1fr;
        gap: 18px;
      }

      .top-controls {
        justify-self: start;
      }

      .brand-lockup {
        grid-template-columns: 48px minmax(0, 1fr);
      }

      .brand-logo {
        width: 48px;
        height: 48px;
      }

      .filters {
        grid-template-columns: 1fr 1fr;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .ranking-card {
        overflow-x: auto;
      }

      .info-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      table {
        min-width: 820px;
      }
    }

    @media (max-width: 720px) {
      .page {
        width: min(100% - 16px, 100%);
        padding-bottom: 36px;
      }

      .filters {
        grid-template-columns: 1fr;
        padding: 12px;
      }

      .top-controls {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      .brand-lockup {
        grid-template-columns: 42px minmax(0, 1fr);
        gap: 9px;
      }

      .brand-logo {
        width: 42px;
        height: 42px;
        border-radius: 10px;
      }

      .ranking-card-header {
        padding: 10px 10px 8px;
      }

      .info-grid {
        grid-template-columns: 1fr;
      }

      .profile-modal {
        align-items: stretch;
        padding: 10px;
      }

      .profile-dialog {
        max-height: calc(100vh - 20px);
      }

      .profile-overview {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .cartel-grid {
        grid-template-columns: 1fr;
      }

      .simulator-card {
        grid-column: 1 / -1;
      }

      .simulator-grid,
      .surface-chart {
        grid-template-columns: 1fr;
      }

      .surface-chart {
        justify-items: center;
        gap: 8px;
      }

      .surface-donut {
        width: 82px;
        height: 82px;
      }

      .surface-donut::after {
        inset: 22px;
      }

      .surface-legend {
        gap: 5px;
      }

      .surface-legend-item {
        grid-template-columns: 8px minmax(0, 1fr);
        gap: 5px;
        font-size: 9px;
      }

      .surface-legend-swatch {
        width: 8px;
        height: 8px;
      }

    }
  </style>
</head>
<body>
  <div class="page">
    <header class="header">
      <div class="brand-lockup">
        <img class="brand-logo" src="favicon.png" alt="" width="52" height="52" />
        <div>
          <h1>ITF Juniors Live Ranking</h1>
          <div class="creator">
            <span id="creatorLabel">Criado por</span>
            <a href="https://x.com/InfoTenisBrasil" target="_blank">X @InfoTenisBrasil</a>
            <span class="beta">BETA TEST</span>
          </div>
        </div>
      </div>

      <div class="top-controls">
        <div class="mini-control">
          <label id="themeLabel">Tema</label>
          <label class="toggle-button theme-toggle" for="themeToggle">
            <input id="themeToggle" type="checkbox" />
            <span class="toggle-track"></span>
            <span id="darkModeLabel">Escuro</span>
          </label>
        </div>

        <div class="mini-control">
          <label id="languageLabel">Idioma</label>
          <div class="segmented-control language-toggle" role="group" aria-label="Idioma">
            <button type="button" class="active" data-language-option="pt-BR">PT-BR</button>
            <button type="button" data-language-option="en">EN</button>
            <button type="button" data-language-option="es">ES</button>
          </div>
        </div>
      </div>
    </header>

    <section class="filters">
      <div class="filter">
        <label id="athleteSearchLabel">Buscar atleta</label>
        <input id="searchInput" type="text" placeholder="Nome do atleta" />
      </div>

      <div class="filter country-filter" id="countryFilterBox">
        <label id="countrySearchLabel">Buscar país</label>
        <div class="country-input-wrap">
          <input id="countrySearchInput" type="text" placeholder="Digite e selecione o país" autocomplete="off" />
          <button class="country-clear" id="countryClearButton" type="button" aria-label="Limpar país">×</button>
        </div>
        <div class="country-suggestions" id="countrySuggestions" role="listbox" aria-label="Sugestões de país"></div>
      </div>

      <div class="filter">
        <label id="rankingModeLabel">Ranking</label>
        <div class="segmented-control ranking-mode-control" role="group" aria-label="Tipo de ranking">
          <button type="button" class="active" data-ranking-mode-option="ALL">Completo</button>
          <button type="button" data-ranking-mode-option="TURNOVER" id="turnoverRankingButton">Virada</button>
          <button type="button" data-ranking-mode-option="2010_PLUS">2010+</button>
          <button type="button" data-ranking-mode-option="2011_PLUS">2011+</button>
        </div>
        <select id="generationRankingFilter" class="visually-hidden" aria-label="Tipo de ranking">
          <option value="ALL" selected>Completo</option>
          <option value="TURNOVER">Virada</option>
          <option value="2010_PLUS">2010+</option>
          <option value="2011_PLUS">2011+</option>
        </select>
      </div>

      <div class="filter">
        <label id="categoryLabel">Categoria</label>
        <div class="segmented-control" role="group" aria-label="Filtrar categoria">
          <button type="button" class="active" data-gender-option="M">Masculino</button>
          <button type="button" data-gender-option="F">Feminino</button>
        </div>
        <select id="genderFilter" class="visually-hidden" aria-label="Categoria">
          <option value="M" selected>Masculino</option>
          <option value="F">Feminino</option>
        </select>
      </div>

      <div class="filter toggle-filter weekly-only">
        <label id="weeklyFilterLabel">Filtro semanal</label>
        <label class="toggle-button" for="playingOnlyFilter">
          <input id="playingOnlyFilter" type="checkbox" />
          <span class="toggle-track"></span>
          <span id="playingLabel">Jogando</span>
        </label>
      </div>

      <div class="filter">
        <label id="sortLabel">Ordenar por</label>
        <select id="sortFilter">
          <option value="RANK" selected>Ranking ao vivo</option>
          <option value="OFFICIAL_RANK">Ranking oficial</option>
        </select>
      </div>

      <div class="filter">
        <label id="updatedAtLabel">Última atualização (UTC-3)</label>
        <input value="${escapeHtml(formatDateTime(calculatedAt))}" disabled />
      </div>
    </section>

    ${rolloverNotice ? `
    <section class="rollover-notice" id="rolloverNotice" aria-live="polite">
      <strong id="rolloverNoticeTitle">Semana encerrada, aguardando ranking oficial da ITF.</strong>
      <span id="rolloverNoticeText">${escapeHtml(rolloverNoticeText)}</span>
    </section>
    ` : ""}

    <main class="layout">
      <section class="ranking-card">
        <div class="ranking-card-header">
          <span class="formula weekly-only" id="formulaLabel">Pontos = ∑ 6 melhores resultados de simples + ∑ 25% dos 6 melhores resultados de duplas</span>
          <span class="summary-row">
            <span id="visibleSummary">Carregando...</span>
            <span id="rankingContext">Base oficial: ${escapeHtml(rankingDate || "não informado")}</span>
          </span>
          <span class="table-hint" id="tableHint">Clique em um atleta para abrir o painel com os detalhes.</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>
                <button class="sort-header active" type="button" data-sort-header="RANK" onclick="setTableSort('RANK')">
                  <span id="rankHeaderLabel">Ranking<br />ao vivo</span>
                  <span class="sort-indicator" data-sort-indicator="RANK">↑</span>
                </button>
              </th>
              <th>
                <button class="sort-header" type="button" data-sort-header="PLAYER" onclick="setTableSort('PLAYER')">
                  <span id="playerHeaderLabel">Atleta</span>
                  <span class="sort-indicator" data-sort-indicator="PLAYER">↕</span>
                </button>
              </th>
              <th>
                <button class="sort-header" type="button" data-sort-header="YEAR" onclick="setTableSort('YEAR')">
                  <span id="yearHeaderLabel">Ano</span>
                  <span class="sort-indicator" data-sort-indicator="YEAR">↕</span>
                </button>
              </th>
              <th id="pointsHeaderLabel">Pontos ao vivo</th>
              <th class="live-only" id="playingThisWeekHeader">Jogando esta<br />semana</th>
              <th class="live-only" id="nextRoundHeader">Projeção<br />próx. rodada</th>
              <th class="live-only" id="titleProjectionHeader">Projeção<br />título</th>
            </tr>
          </thead>
          <tbody id="rankingBody"></tbody>
        </table>
      </section>

      <aside class="side">
        <section class="side-card">
          <h3 id="weekTournamentsTitle">Torneios da semana</h3>
          <div id="weekTournaments"></div>
        </section>
      </aside>
    </main>

    <section class="info-section" aria-labelledby="siteInfoTitle">
      <h2 id="siteInfoTitle">O que é o Juniors Live Ranking</h2>
      <p class="info-intro">
        O Juniors Live Ranking acompanha atletas juvenis em uma leitura prática: ranking oficial, projeções ao vivo, pontos da semana e cenários de próxima rodada. A tabela é atualizada automaticamente a partir dos dados disponíveis no momento de cada execução.
      </p>
      <div class="info-grid">
        <article class="info-item">
          <h3>Ranking oficial</h3>
          <p>Mostra a posição e a pontuação publicadas como base oficial para a semana.</p>
        </article>
        <article class="info-item">
          <h3>Ranking ao vivo</h3>
          <p>Projeta mudanças com resultados semanais, pontos entrando e pontos que deixam de contar.</p>
        </article>
        <article class="info-item">
          <h3>Atualização</h3>
          <p>O robô recalcula o site em execuções programadas e pode refletir correções posteriores das fontes.</p>
        </article>
        <article class="info-item">
          <h3>Site independente</h3>
          <p>Este projeto não é afiliado ou administrado pela ITF. Consulte fontes oficiais para decisões finais.</p>
        </article>
      </div>
    </section>

    <footer class="site-footer">
      <a href="sobre.html">Sobre</a>
      <a href="contato.html">Contato</a>
      <a href="privacidade.html">Política de Privacidade</a>
      <a href="termos.html">Termos de Uso</a>
      <span>Site independente, sem afiliação oficial com a ITF.</span>
    </footer>

    <div class="profile-modal" id="profileModal" aria-hidden="true" onclick="closeProfileModal()">
      <section class="side-card profile-dialog" id="profileCard" role="dialog" aria-modal="true" aria-labelledby="profileDialogTitle" onclick="event.stopPropagation()">
        <div class="profile-dialog-header">
          <h3 id="profileDialogTitle">Pontuações do atleta</h3>
          <button class="modal-close-button" type="button" aria-label="Fechar" onclick="closeProfileModal()">×</button>
        </div>
        <div class="profile-empty" id="profileEmptyText">
          Clique em um atleta da tabela para ver o resumo de pontuação.
        </div>
      </section>
    </div>
  </div>

  <script>
    const rankingData = ${dataJson};
    const tournamentGroups = ${tournamentGroupsJson};
    const pointsByCategory = ${pointsByCategoryJson};
    const rolloverNotice = ${rolloverNoticeJson};
    const officialRankingDate = ${JSON.stringify(rankingDate || "não informado")};

    const searchInput = document.getElementById("searchInput");
    const countryFilterBox = document.getElementById("countryFilterBox");
    const countrySearchInput = document.getElementById("countrySearchInput");
    const countrySuggestions = document.getElementById("countrySuggestions");
    const countryClearButton = document.getElementById("countryClearButton");
    const generationRankingFilter = document.getElementById("generationRankingFilter");
    const rankingModeButtons = Array.from(document.querySelectorAll("[data-ranking-mode-option]"));
    const turnoverRankingButton = document.getElementById("turnoverRankingButton");
    const languageButtons = Array.from(document.querySelectorAll("[data-language-option]"));
    const themeToggle = document.getElementById("themeToggle");
    const genderFilter = document.getElementById("genderFilter");
    const genderButtons = Array.from(document.querySelectorAll("[data-gender-option]"));
    const sortFilter = document.getElementById("sortFilter");
    const playingOnlyFilter = document.getElementById("playingOnlyFilter");
    const rankingBody = document.getElementById("rankingBody");
    const visibleSummary = document.getElementById("visibleSummary");
    const weekTournaments = document.getElementById("weekTournaments");
    const profileModal = document.getElementById("profileModal");
    const profileCard = document.getElementById("profileCard");

    let selectedPlayerId = "";
    let expandedPointsPlayerId = "";
    let selectedCountry = null;
    let sortColumn = "RANK";
    let sortDirection = "asc";
    let currentLanguage = localStorage.getItem("itf-live-language") || "pt-BR";

    const translations = {
      "pt-BR": {
        createdBy: "Criado por",
        theme: "Tema",
        dark: "Escuro",
        language: "Idioma",
        athleteSearch: "Buscar atleta",
        athletePlaceholder: "Nome do atleta",
        countrySearch: "Buscar país",
        countryPlaceholder: "Digite e selecione o país",
        clearCountry: "Limpar país",
        countrySuggestions: "Sugestões de país",
        noCountryResults: "Nenhum país encontrado",
        ranking: "Ranking",
        rankingType: "Tipo de ranking",
        fullRanking: "Completo",
        turnoverBase: "Virada",
        turnover: "Virada de ano",
        turnoverTitle: "Ranking sem atletas nascidos em ",
        category: "Categoria",
        filterCategory: "Filtrar categoria",
        boys: "Masculino",
        girls: "Feminino",
        sortBy: "Ordenar por",
        liveRanking: "Ranking ao vivo",
        officialRanking: "Ranking oficial",
        weeklyFilter: "Filtro semanal",
        playing: "Jogando",
        updatedAt: "Última atualização (UTC-3)",
        formula: "Pontos = ∑ 6 melhores resultados de simples + ∑ 25% dos 6 melhores resultados de duplas",
        loading: "Carregando...",
        officialBase: "Base oficial",
        officialItfRanking: "Ranking oficial ITF",
        liveRankHeader: "Ranking<br />ao vivo",
        officialRankHeader: "Ranking<br />oficial",
        athlete: "Atleta",
        year: "Ano",
        livePoints: "Pontos ao vivo",
        officialPoints: "Pontuação oficial",
        playingThisWeek: "Jogando esta<br />semana",
        nextRoundProjection: "Projeção<br />próx. rodada",
        titleProjection: "Projeção<br />título",
        weekTournaments: "Torneios da semana",
        athletePoints: "Pontuações do atleta",
        close: "Fechar",
        profileEmpty: "Clique em um atleta da tabela para ver o resumo de pontuação.",
        tableHint: "Clique em um atleta para abrir o painel com os detalhes.",
        noResult: "Sem resultado registrado.",
        counting: "Contando",
        notCounting: "Não contando",
        tournament: "Torneio",
        surfacePoints: "Pontos por piso",
        noSurface: "Sem piso identificado nos resultados que contam.",
        categoryPoints: "Pontos por nível",
        noCategoryPoints: "Sem categoria identificada nos resultados que contam.",
        clay: "Saibro",
        grass: "Grama",
        hard: "Hard",
        carpet: "Carpet",
        other: "Outros",
        champion: "Campeão",
        final: "Final",
        semi: "Semi",
        quarter: "Quartas",
        weekSimulator: "Simulador da semana",
        singles: "Simples",
        doubles: "Duplas",
        rolloverNoticeTitle: "Semana encerrada, aguardando ranking oficial da ITF.",
        rolloverNoticeText: "Os resultados até {{weekEnd}} já estão considerados nesta projeção; a nova semana começa automaticamente assim que a ITF publicar a base oficial de {{expectedRankingDate}}.",
        selectRound: "Selecione uma rodada para simular.",
        live: "ao vivo",
        official: "oficial",
        playersShown: "jogadores exibidos",
        positionsShort: "pos.",
        pointsShort: "pts",
        showPointDetails: "Ver detalhes dos pontos",
        hidePointDetails: "Ocultar detalhes dos pontos",
        entering: "Entrando",
        dropping: "Caindo",
        weekTournament: "Torneio da semana",
      },
      en: {
        createdBy: "Created by",
        theme: "Theme",
        dark: "Dark",
        language: "Language",
        athleteSearch: "Search player",
        athletePlaceholder: "Player name",
        countrySearch: "Search country",
        countryPlaceholder: "Type and select a country",
        clearCountry: "Clear country",
        countrySuggestions: "Country suggestions",
        noCountryResults: "No country found",
        ranking: "Ranking",
        rankingType: "Ranking type",
        fullRanking: "Full",
        turnoverBase: "Turnover",
        turnover: "Year-end turnover",
        turnoverTitle: "Ranking without players born in ",
        category: "Category",
        filterCategory: "Filter category",
        boys: "Boys",
        girls: "Girls",
        sortBy: "Sort by",
        liveRanking: "Live ranking",
        officialRanking: "Official ranking",
        weeklyFilter: "Weekly filter",
        playing: "Playing",
        updatedAt: "Last update (UTC-3)",
        formula: "Points = ∑ best 6 singles results + ∑ 25% of best 6 doubles results",
        loading: "Loading...",
        officialBase: "Official base",
        officialItfRanking: "Official ITF ranking",
        liveRankHeader: "Live<br />ranking",
        officialRankHeader: "Official<br />ranking",
        athlete: "Player",
        year: "Year",
        livePoints: "Live points",
        officialPoints: "Official points",
        playingThisWeek: "Playing this<br />week",
        nextRoundProjection: "Next round<br />projection",
        titleProjection: "Title<br />projection",
        weekTournaments: "This week's tournaments",
        athletePoints: "Player points",
        close: "Close",
        profileEmpty: "Click a player in the table to see the points summary.",
        tableHint: "Click a player to open the details panel.",
        noResult: "No result recorded.",
        counting: "Counting",
        notCounting: "Not counting",
        tournament: "Tournament",
        surfacePoints: "Points by surface",
        noSurface: "No surface identified in counting results.",
        categoryPoints: "Points by level",
        noCategoryPoints: "No level identified in counting results.",
        clay: "Clay",
        grass: "Grass",
        hard: "Hard",
        carpet: "Carpet",
        other: "Other",
        champion: "Champion",
        final: "Final",
        semi: "Semi",
        quarter: "Quarterfinals",
        weekSimulator: "Week simulator",
        singles: "Singles",
        doubles: "Doubles",
        rolloverNoticeTitle: "Week complete, waiting for the official ITF ranking.",
        rolloverNoticeText: "Results through {{weekEnd}} are already included in this projection; the new week starts automatically once the ITF publishes the official {{expectedRankingDate}} base.",
        selectRound: "Select a round to simulate.",
        live: "live",
        official: "official",
        playersShown: "players shown",
        positionsShort: "pos.",
        pointsShort: "pts",
        showPointDetails: "Show point details",
        hidePointDetails: "Hide point details",
        entering: "Adding",
        dropping: "Dropping",
        weekTournament: "This week's tournament",
      },
      es: {
        createdBy: "Creado por",
        theme: "Tema",
        dark: "Oscuro",
        language: "Idioma",
        athleteSearch: "Buscar jugador",
        athletePlaceholder: "Nombre del jugador",
        countrySearch: "Buscar país",
        countryPlaceholder: "Escribe y selecciona un país",
        clearCountry: "Limpiar país",
        countrySuggestions: "Sugerencias de país",
        noCountryResults: "No se encontró ningún país",
        ranking: "Ranking",
        rankingType: "Tipo de ranking",
        fullRanking: "Completo",
        turnoverBase: "Cambio de año",
        turnover: "Cambio de año",
        turnoverTitle: "Ranking sin jugadores nacidos en ",
        category: "Categoría",
        filterCategory: "Filtrar categoría",
        boys: "Masculino",
        girls: "Femenino",
        sortBy: "Ordenar por",
        liveRanking: "Ranking en vivo",
        officialRanking: "Ranking oficial",
        weeklyFilter: "Filtro semanal",
        playing: "Jugando",
        updatedAt: "Última actualización (UTC-3)",
        formula: "Puntos = ∑ mejores 6 resultados de singles + ∑ 25% de los mejores 6 resultados de dobles",
        loading: "Cargando...",
        officialBase: "Base oficial",
        officialItfRanking: "Ranking oficial ITF",
        liveRankHeader: "Ranking<br />en vivo",
        officialRankHeader: "Ranking<br />oficial",
        athlete: "Jugador",
        year: "Año",
        livePoints: "Puntos en vivo",
        officialPoints: "Puntos oficiales",
        playingThisWeek: "Jugando esta<br />semana",
        nextRoundProjection: "Proyección<br />próx. ronda",
        titleProjection: "Proyección<br />título",
        weekTournaments: "Torneos de la semana",
        athletePoints: "Puntos del jugador",
        close: "Cerrar",
        profileEmpty: "Haz clic en un jugador de la tabla para ver el resumen de puntos.",
        tableHint: "Haz clic en un jugador para abrir el panel de detalles.",
        noResult: "No hay resultado registrado.",
        counting: "Contando",
        notCounting: "No contando",
        tournament: "Torneo",
        surfacePoints: "Puntos por superficie",
        noSurface: "No se identificó superficie en los resultados que cuentan.",
        categoryPoints: "Puntos por nivel",
        noCategoryPoints: "No se identificó nivel en los resultados que cuentan.",
        clay: "Arcilla",
        grass: "Césped",
        hard: "Dura",
        carpet: "Carpeta",
        other: "Otros",
        champion: "Campeón",
        final: "Final",
        semi: "Semi",
        quarter: "Cuartos",
        weekSimulator: "Simulador semanal",
        singles: "Singles",
        doubles: "Dobles",
        rolloverNoticeTitle: "Semana finalizada, esperando el ranking oficial de la ITF.",
        rolloverNoticeText: "Los resultados hasta {{weekEnd}} ya están incluidos en esta proyección; la nueva semana empieza automáticamente cuando la ITF publique la base oficial de {{expectedRankingDate}}.",
        selectRound: "Selecciona una ronda para simular.",
        live: "en vivo",
        official: "oficial",
        playersShown: "jugadores mostrados",
        positionsShort: "pos.",
        pointsShort: "pts",
        showPointDetails: "Ver detalles de puntos",
        hidePointDetails: "Ocultar detalles de puntos",
        entering: "Sumando",
        dropping: "Cayendo",
        weekTournament: "Torneo de la semana",
      },
    };

    function t(key) {
      return translations[currentLanguage]?.[key] || translations["pt-BR"][key] || key;
    }

    const countryOptions = [...rankingData.reduce((map, row) => {
      const code = String(row.country || "").trim().toUpperCase();
      if (!code) return map;

      const current = map.get(code) || {
        code,
        name: row.country_name || code,
        iso2: row.country_iso2 || "",
        count: 0,
      };

      current.name = current.name || row.country_name || code;
      current.iso2 = current.iso2 || row.country_iso2 || "";
      current.count += 1;
      map.set(code, current);
      return map;
    }, new Map()).values()].sort((a, b) =>
      normalizeSearchText(a.name).localeCompare(normalizeSearchText(b.name), "pt-BR")
    );

    const tournamentSurfaceMap = new Map();
    for (const group of tournamentGroups) {
      for (const item of group.items || []) {
        const surfaceKey = item.surfaceKey || getSurfaceKeyClient(item.surface, item.surfaceCode);
        const names = [
          item.name,
          item.displayName,
          getTournamentDisplayNameClient(item.name, group.category),
        ].filter(Boolean);

        for (const name of names) {
          tournamentSurfaceMap.set(
            getTournamentSurfaceLookupKey(name, group.category),
            surfaceKey
          );
        }
      }
    }

    function applyTheme(theme) {
      const normalizedTheme = theme === "dark" ? "dark" : "light";

      document.documentElement.dataset.theme = normalizedTheme;
      themeToggle.checked = normalizedTheme === "dark";
      localStorage.setItem("itf-live-theme", normalizedTheme);
    }

    function escapeHtmlClient(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function normalizeSearchText(value) {
      return String(value ?? "")
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .trim();
    }

    function includesSearch(value, search) {
      if (!search) return true;
      return normalizeSearchText(value).includes(search);
    }

    function setText(id, value) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }

    function setHtml(id, value) {
      const element = document.getElementById(id);
      if (element) element.innerHTML = value;
    }

    function formatIsoDateForLanguage(value) {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || ""))) {
        return value || "";
      }
      const [year, month, day] = value.split("-").map(Number);
      const locale = currentLanguage === "en" ? "en-US" : currentLanguage === "es" ? "es-ES" : "pt-BR";
      return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
        timeZone: "UTC",
      });
    }

    function updateRolloverNotice() {
      if (!rolloverNotice) return;
      const weekEnd = formatIsoDateForLanguage(rolloverNotice.weekEnd);
      const expectedRankingDate = formatIsoDateForLanguage(rolloverNotice.expectedRankingDate);
      const text = t("rolloverNoticeText")
        .replaceAll("{{weekEnd}}", weekEnd)
        .replaceAll("{{expectedRankingDate}}", expectedRankingDate);
      setText("rolloverNoticeTitle", t("rolloverNoticeTitle"));
      setText("rolloverNoticeText", text);
    }

    function applyLanguage(language) {
      currentLanguage = ["pt-BR", "en", "es"].includes(language) ? language : "pt-BR";
      localStorage.setItem("itf-live-language", currentLanguage);
      document.documentElement.lang = currentLanguage;

      languageButtons.forEach((button) => {
        const active = button.getAttribute("data-language-option") === currentLanguage;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });

      setText("creatorLabel", t("createdBy"));
      setText("themeLabel", t("theme"));
      setText("darkModeLabel", t("dark"));
      setText("languageLabel", t("language"));
      setText("athleteSearchLabel", t("athleteSearch"));
      setText("countrySearchLabel", t("countrySearch"));
      setText("rankingModeLabel", t("ranking"));
      setText("categoryLabel", t("category"));
      setText("sortLabel", t("sortBy"));
      setText("weeklyFilterLabel", t("weeklyFilter"));
      setText("playingLabel", t("playing"));
      setText("updatedAtLabel", t("updatedAt"));
      setText("formulaLabel", t("formula"));
      setText("tableHint", t("tableHint"));
      setHtml("playingThisWeekHeader", t("playingThisWeek"));
      setHtml("nextRoundHeader", t("nextRoundProjection"));
      setHtml("titleProjectionHeader", t("titleProjection"));
      setText("weekTournamentsTitle", t("weekTournaments"));
      setText("profileDialogTitle", t("athletePoints"));
      setText("profileEmptyText", t("profileEmpty"));
      updateRolloverNotice();

      searchInput.placeholder = t("athletePlaceholder");
      countrySearchInput.placeholder = t("countryPlaceholder");
      countryClearButton.setAttribute("aria-label", t("clearCountry"));
      countrySuggestions.setAttribute("aria-label", t("countrySuggestions"));
      document.querySelector("[aria-label='Tipo de ranking']")?.setAttribute("aria-label", t("rankingType"));
      document.querySelector("[aria-label='Filtrar categoria']")?.setAttribute("aria-label", t("filterCategory"));

      genderButtons.forEach((button) => {
        button.textContent = button.getAttribute("data-gender-option") === "M" ? t("boys") : t("girls");
      });
      Array.from(genderFilter.options).forEach((option) => {
        option.textContent = option.value === "M" ? t("boys") : t("girls");
      });
      Array.from(sortFilter.options).forEach((option) => {
        option.textContent = option.value === "OFFICIAL_RANK" ? t("officialRanking") : t("liveRanking");
      });

      populateGenerationRankingFilter();
      updateSortHeaders();
      renderCountrySuggestionsIfOpen();
      if (selectedPlayerId) {
        const row = rankingData.find((item) => item.player_id === selectedPlayerId);
        renderProfile(row || null);
      } else {
        renderProfile(null);
      }
      renderTable();
    }

    function renderCountrySuggestionsIfOpen() {
      if (countryFilterBox.classList.contains("suggestions-open")) {
        renderCountrySuggestions();
      }
    }

    function getCountryDisplayName(country) {
      if (!country) return "";
      return country.name && country.name !== country.code
        ? country.code + " - " + country.name
        : country.code;
    }

    function getCountrySuggestions(query) {
      const search = normalizeSearchText(query);
      if (!search) return countryOptions.slice(0, 12);

      return countryOptions
        .filter((country) =>
          includesSearch(country.code, search) ||
          includesSearch(country.name, search)
        )
        .slice(0, 12);
    }

    function setCountrySuggestionsOpen(open) {
      countryFilterBox.classList.toggle("suggestions-open", open);
    }

    function renderCountrySuggestions() {
      const suggestions = getCountrySuggestions(countrySearchInput.value);

      if (!suggestions.length) {
        countrySuggestions.innerHTML = '<div class="country-no-results">' + t("noCountryResults") + '</div>';
        setCountrySuggestionsOpen(true);
        return;
      }

      countrySuggestions.innerHTML = suggestions.map((country) => {
        const label = escapeHtmlClient(country.name || country.code);
        const code = escapeHtmlClient(country.code);

        return \`
          <button class="country-suggestion" type="button" role="option" data-country-code="\${code}">
            <span>\${label}</span>
            <span class="country-suggestion-code">\${code}</span>
          </button>
        \`;
      }).join("");
      setCountrySuggestionsOpen(true);
    }

    function selectCountry(country) {
      selectedCountry = country || null;
      countrySearchInput.value = getCountryDisplayName(selectedCountry);
      countryFilterBox.classList.toggle("has-country", Boolean(selectedCountry));
      setCountrySuggestionsOpen(false);
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    }

    function clearCountrySelection() {
      selectedCountry = null;
      countrySearchInput.value = "";
      countryFilterBox.classList.remove("has-country");
      setCountrySuggestionsOpen(false);
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    }

    function handleCountryInput() {
      if (selectedCountry) {
        selectedCountry = null;
        countryFilterBox.classList.remove("has-country");
        selectedPlayerId = "";
        renderProfile(null);
        renderTable();
      }

      renderCountrySuggestions();
    }

    function getCategoryClass(category) {
      const key = String(category || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");

      return key ? "cat-" + key : "";
    }

    function getSurfaceKeyClient(surface, surfaceCode) {
      const code = String(surfaceCode || "").trim().toUpperCase();
      const text = normalizeSearchText(surface);

      if (code === "C" || text.includes("clay") || text.includes("saibro")) return "clay";
      if (code === "G" || text.includes("grass") || text.includes("grama")) return "grass";
      if (code === "H" || text.includes("hard") || text.includes("duro")) return "hard";
      if (code === "A" || text.includes("carpet") || text.includes("carpete")) return "carpet";

      return "";
    }

    function getSurfaceClass(surfaceKey) {
      return surfaceKey ? "surface-" + surfaceKey : "";
    }

    function getSurfaceLabel(surfaceKey) {
      if (surfaceKey === "clay") return t("clay");
      if (surfaceKey === "grass") return t("grass");
      if (surfaceKey === "hard") return t("hard");
      if (surfaceKey === "carpet") return t("carpet");
      return t("other");
    }

    function getSurfaceColor(surfaceKey) {
      if (surfaceKey === "clay") return "#e87822";
      if (surfaceKey === "grass") return "#2f9b57";
      if (surfaceKey === "hard") return "#2569a8";
      if (surfaceKey === "carpet") return "#8a56c5";
      return "#8a56c5";
    }

    function getCategoryColor(category) {
      const key = String(category || "").toUpperCase();
      if (key === "JGS") return "#8a56c5";
      if (key === "J500") return "#2569a8";
      if (key === "J300") return "#08756d";
      if (key === "J200") return "#2f9b57";
      if (key === "J100") return "#e87822";
      if (key === "J60") return "#c2410c";
      if (key === "J30") return "#64748b";
      return "#8a56c5";
    }

    function getTournamentSurfaceLookupKey(tournament, category) {
      return [
        normalizeSearchText(getTournamentDisplayNameClient(tournament, category)),
        normalizeSearchText(category),
      ].join("|");
    }

    function getCategoryChipHtml(category) {
      if (!category) return "";

      const className = [
        "category-chip",
        getCategoryClass(category),
      ].filter(Boolean).join(" ");

      return '<span class="' + className + '">' +
             escapeHtmlClient(category) +
             '</span>';
    }

    function getTournamentDisplayNameClient(name, category) {
      const text = String(name || "").trim();
      const categoryText = String(category || "").trim();

      if (!text || !categoryText) return text;

      const prefix = categoryText.toLowerCase() + " ";
      return text.toLowerCase().startsWith(prefix)
        ? text.slice(categoryText.length).trimStart()
        : text;
    }

    function formatNumberClient(value) {
      const n = Number(value || 0);

      const locale = currentLanguage === "en"
        ? "en-US"
        : currentLanguage === "es"
          ? "es-ES"
          : "pt-BR";

      return n.toLocaleString(locale, {
        minimumFractionDigits: n % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      });
    }

    function formatRankClient(value) {
      const n = Number(value || 0);
      return n ? "#" + n : "NR";
    }

    function getAvailableBirthYears() {
      return [...new Set(
        rankingData
          .map((row) => Number(row.birth_year || 0))
          .filter((year) => year > 0)
      )].sort((a, b) => a - b);
    }

    function getOutgoingBirthYear() {
      const calculatedAt = rankingData[0]?.calculated_at
        ? new Date(rankingData[0].calculated_at)
        : new Date();
      const currentYear = Number.isNaN(calculatedAt.getTime())
        ? new Date().getFullYear()
        : calculatedAt.getFullYear();
      const expectedOutgoingYear = currentYear - 18;
      const years = getAvailableBirthYears();

      return years.includes(expectedOutgoingYear)
        ? expectedOutgoingYear
        : years[0] || expectedOutgoingYear;
    }

    function populateGenerationRankingFilter() {
      const selectedValue = generationRankingFilter.value || "ALL";
      const outgoingYear = getOutgoingBirthYear();
      const turnoverLabel = t("turnover") + " (" + (outgoingYear + 1) + "+)";

      generationRankingFilter.innerHTML =
        '<option value="ALL">' + t("fullRanking") + '</option>' +
        '<option value="TURNOVER">' + turnoverLabel + '</option>' +
        '<option value="2010_PLUS">2010+</option>' +
        '<option value="2011_PLUS">2011+</option>';
      generationRankingFilter.value = selectedValue;

      if (turnoverRankingButton) {
        turnoverRankingButton.textContent = (outgoingYear + 1) + "+";
        turnoverRankingButton.title = t("turnoverTitle") + outgoingYear;
      }

      const fullRankingButton = rankingModeButtons.find((button) =>
        button.getAttribute("data-ranking-mode-option") === "ALL"
      );
      if (fullRankingButton) fullRankingButton.textContent = t("fullRanking");

      const ranking2010Button = rankingModeButtons.find((button) =>
        button.getAttribute("data-ranking-mode-option") === "2010_PLUS"
      );
      if (ranking2010Button) ranking2010Button.textContent = "2010+";

      const ranking2011Button = rankingModeButtons.find((button) =>
        button.getAttribute("data-ranking-mode-option") === "2011_PLUS"
      );
      if (ranking2011Button) ranking2011Button.textContent = "2011+";
    }

    function getGenerationMinimumYear() {
      const value = generationRankingFilter.value;

      if (value === "TURNOVER") return getOutgoingBirthYear() + 1;
      if (value === "2010_PLUS") return 2010;
      if (value === "2011_PLUS") return 2011;

      return 0;
    }

    function isGenerationRankingActive() {
      return generationRankingFilter.value !== "ALL";
    }

    function getGenerationLabel() {
      const selectedOption = generationRankingFilter.options[generationRankingFilter.selectedIndex];
      return selectedOption ? selectedOption.textContent : t("fullRanking");
    }

    function getFlagHtml(row) {
      const iso2 = String(row.country_iso2 || "").toLowerCase();

      if (!iso2) return "";

      const country = escapeHtmlClient(row.country || "");
      const countryName = escapeHtmlClient(row.country_name || row.country || "");

      return '<img class="country-flag" src="https://flagcdn.com/24x18/' + iso2 + '.png" alt="' + country + '" title="' + countryName + '" loading="lazy" />';
    }

    function formatChange(value) {
      const n = Number(value || 0);

      if (!n) return "0";
      if (n > 0) return "+" + n;
      return String(n);
    }

    function movementClass(value) {
      const n = Number(value || 0);

      if (n > 0) return "up";
      if (n < 0) return "down";
      return "same";
    }

    function statusTags(row) {
      return "";
    }

    function getBalanceClass(value) {
      const n = Number(value || 0);
      if (n > 0) return "green";
      if (n < 0) return "red";
      return "gray";
    }

    function getBalanceSign(value) {
      const n = Number(value || 0);
      if (n > 0) return "+";
      return "";
    }

    function getPointsHtml(row) {
      const balance = Number(row.points_change_vs_official || 0);
      const balanceClass = getBalanceClass(balance);
      const balanceSign = getBalanceSign(balance);
      const balanceTone = balanceClass === 'green'
        ? 'positive'
        : balanceClass === 'red'
          ? 'negative'
          : 'neutral';
      const isExpanded = expandedPointsPlayerId === row.player_id;
      const liveDetails = row.point_details?.live || [];
      const dropDetails = row.point_details?.drops || [];
      const hasDetails =
        liveDetails.length ||
        dropDetails.length;
      const buttonLabel = "i";
      const buttonTitle = isExpanded ? t("hidePointDetails") : t("showPointDetails");
      const buttonClass = isExpanded ? "points-info-button active" : "points-info-button";

      return '<div class="points-cell">' +
             '<div class="points-main">' +
             '<span class="points">' + formatNumberClient(row.live_points) + '</span>' +
             '<span class="points-balance ' + balanceTone + '">' +
             balanceSign + formatNumberClient(balance) +
             '</span>' +
             (hasDetails
               ? '<button class="' + buttonClass + '" type="button" title="' + buttonTitle + '" aria-label="' + buttonTitle + '" onclick="togglePointsInfo(event, \\'' + escapeHtmlClient(row.player_id) + '\\')">' + buttonLabel + '</button>'
               : '') +
             '</div>' +
             (isExpanded ? getPointsDetailHtml(row) : '') +
             '</div>';
    }

    function getPointDetailLineHtml(item, sign, className) {
      const impact = Number(item.impact_points || 0);
      const yearText = item.year ? ' ' + escapeHtmlClient(item.year) : '';
      const eventText = item.event ? ' · ' + escapeHtmlClient(item.event) : '';
      const categoryClass = getCategoryClass(item.category);

      return '<div class="points-detail-line ' + categoryClass + '">' +
             '<span class="points-detail-impact ' + className + '">' + sign + formatNumberClient(impact) + '</span>' +
             (item.category ? ' ' + getCategoryChipHtml(item.category) : '') +
             ' · <span class="tournament-name">' + escapeHtmlClient(item.tournament || t("tournament")) + '</span>' +
             yearText +
             eventText +
             '</div>';
    }

    function getPointsDetailSectionHtml(title, items, sign, className) {
      if (!items.length) return "";

      return '<div class="points-detail-section">' +
             '<div class="points-detail-title">' + title + '</div>' +
             items.map((item) => getPointDetailLineHtml(item, sign, className)).join("") +
             '</div>';
    }

    function getPointsDetailHtml(row) {
      const liveDetails = row.point_details?.live || [];
      const dropDetails = row.point_details?.drops || [];

      return '<div class="points-detail">' +
             getPointsDetailSectionHtml(t("entering"), liveDetails, "+", "up") +
             getPointsDetailSectionHtml(t("dropping"), dropDetails, "-", "down") +
             '</div>';
    }

    function getWeekRoundDisplay(round) {
      if (/^1st\\s+round$/i.test(round)) return "R1";
      if (/^2nd\\s+round$/i.test(round)) return "R2";
      if (/^3rd\\s+round$/i.test(round)) return "R3";
      return round;
    }

    function getWeekRoundHtml(round) {
      const display = getWeekRoundDisplay(round);
      if (display.toUpperCase() === "W") return '<span class="trophy">🏆</span>';
      return escapeHtmlClient(display);
    }

    function getWeekResultHtml(label, summary) {
      if (!summary) return "";

      const eliminated = summary.includes("❌");
      const round = summary
        .replace(/^Simples:\\s*/i, "")
        .replace(/^Duplas:\\s*/i, "")
        .replace(/❌/g, "")
        .trim();
      const isTitle = round.toUpperCase() === "W";
      const className = [
        "week-result-item",
        eliminated ? "eliminated" : "",
        isTitle ? "title" : "",
      ].filter(Boolean).join(" ");

      return '<span class="' + className + '">' +
             label + ' <strong>' + getWeekRoundHtml(round || "-") + '</strong>' +
             (eliminated ? ' <span class="out">×</span>' : '') +
             '</span>';
    }

    function getPlayingHtml(row) {
      if (!row.playing_this_week) {
        return '<span class="dash">-</span>';
      }

      const p = row.playing_this_week;
      const categoryClass = getCategoryClass(p.category);
      const tournamentName = getTournamentDisplayNameClient(
        p.tournament || t("weekTournament"),
        p.category
      );
      const resultChips = [
        getWeekResultHtml("🎾", p.singlesSummary),
        getWeekResultHtml("👥", p.doublesSummary),
      ].filter(Boolean).join('<span class="week-result-separator">·</span>');

      return \`
        <div class="week-tournament \${categoryClass}">
          \${getCategoryChipHtml(p.category)}
          <strong class="tournament-name">\${escapeHtmlClient(tournamentName)}</strong>
        </div>
        \${resultChips ? '<div class="week-sub ' + categoryClass + '">' + resultChips + '</div>' : ''}
      \`;
    }

    function getNextRoundHtml(row) {
      if (!row.next_round_scenarios || !row.next_round_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return getProjectionListHtml(row, row.next_round_scenarios);
    }

    function getScenarioEventLabel(scenario) {
      if (scenario.eventType === "singles") return "🎾";
      if (scenario.eventType === "doubles") return "👥";
      if (scenario.eventType === "combined") return "🎾+👥";
      return "";
    }

    function getProjectionRoundHtml(round) {
      const text = escapeHtmlClient(round);
      const parts = text.split("/");

      if (parts.some((part) => part.toUpperCase() === "W")) {
        return '<span class="trophy">🏆</span>';
      }

      return parts
        .map((part) => part.toUpperCase() === "W" ? '<span class="trophy">🏆</span>' : part)
        .join("/");
    }

    function isTitleProjection(round) {
      return String(round || "")
        .split("/")
        .some((part) => part.toUpperCase() === "W");
    }

    function getProjectionItemHtml(scenario) {
      const eventLabel = getScenarioEventLabel(scenario);
      const roundHtml = getProjectionRoundHtml(scenario.targetRound);
      const pointsHtml = formatNumberClient(scenario.projectedTotal);
      const isTitle = isTitleProjection(scenario.targetRound);

      if (isTitle) {
        return \`
            <div class="projection-item projection-item-title">
              <span class="projection-main">\${roundHtml}</span>
              <span class="projection-chip">\${eventLabel}</span>
              <span class="projection-points">\${pointsHtml}</span>
            </div>
          \`;
      }

      return \`
            <div class="projection-item">
              <span class="projection-chip">\${eventLabel}</span>
              <span class="projection-main">\${roundHtml}</span>
              <span class="projection-points">\${pointsHtml}</span>
            </div>
          \`;
    }

    function getProjectionListHtml(row, scenarios) {
      const categoryClass = row.playing_this_week
        ? getCategoryClass(row.playing_this_week.category)
        : "";

      return '<div class="projection-list ' + categoryClass + '">' +
        scenarios
          .map((scenario) => getProjectionItemHtml(scenario))
          .join("") +
        '</div>';
    }

    function getTitleHtml(row) {
      if (!row.title_scenarios || !row.title_scenarios.length) {
        return '<span class="dash">-</span>';
      }

      return getProjectionListHtml(row, row.title_scenarios);
    }

    function passesFilters(row) {
      const gender = genderFilter.value;
      const athleteSearch = normalizeSearchText(searchInput.value);
      const minimumBirthYear = getGenerationMinimumYear();
      const playingOnly = playingOnlyFilter.checked;

      if (row.gender !== gender) {
        return false;
      }

      if (!isGenerationRankingActive() && Number(row.live_rank || 0) > 500) {
        return false;
      }

      if (minimumBirthYear && Number(row.birth_year || 0) < minimumBirthYear) {
        return false;
      }

      if (playingOnly && !row.playing_this_week) {
        return false;
      }

      if (athleteSearch && !includesSearch(row.player_name, athleteSearch)) {
        return false;
      }

      if (selectedCountry && String(row.country || "").toUpperCase() !== selectedCountry.code) {
        return false;
      }

      return true;
    }

    function getRankBasis(row) {
      return sortColumn === "OFFICIAL_RANK"
        ? Number(row.official_rank || 0)
        : Number(row.live_rank || 0);
    }

    function withGenerationRanks(rows) {
      if (!isGenerationRankingActive()) return rows;

      const rankValue = (value) => {
        const n = Number(value || 0);
        return n > 0 ? n : Number.MAX_SAFE_INTEGER;
      };
      const gender = genderFilter.value;
      const minimumBirthYear = getGenerationMinimumYear();
      const eligibleRows = rankingData.filter((row) =>
        row.gender === gender &&
        (!minimumBirthYear || Number(row.birth_year || 0) >= minimumBirthYear)
      );

      const byLive = [...eligibleRows].sort((a, b) =>
        rankValue(a.live_rank) - rankValue(b.live_rank)
      );
      const byOfficial = [...eligibleRows].sort((a, b) =>
        rankValue(a.official_rank) - rankValue(b.official_rank)
      );
      const liveRanks = new Map();
      const officialRanks = new Map();

      byLive.forEach((row, index) => liveRanks.set(row.player_id, index + 1));
      byOfficial.forEach((row, index) => officialRanks.set(row.player_id, index + 1));

      return rows.map((row) => ({
        ...row,
        generation_live_rank: liveRanks.get(row.player_id),
        generation_official_rank: officialRanks.get(row.player_id),
      }));
    }

    function getDisplayRank(row) {
      if (!isGenerationRankingActive()) return getRankBasis(row);

      return sortColumn === "OFFICIAL_RANK"
        ? Number(row.generation_official_rank || 0)
        : Number(row.generation_live_rank || 0);
    }

    function passesDisplayLimit(row) {
      if (!isGenerationRankingActive()) return true;

      const rank = getDisplayRank(row);

      return rank > 0 && rank <= 500;
    }

    function sortRows(rows) {
      const rankValue = (value) => {
        const n = Number(value || 0);
        return n > 0 ? n : Number.MAX_SAFE_INTEGER;
      };

      return [...rows].sort((a, b) => {
        let result = 0;

        if (sortColumn === "OFFICIAL_RANK") {
          if (isGenerationRankingActive()) {
            result = rankValue(a.generation_official_rank) - rankValue(b.generation_official_rank);
          } else {
            result = rankValue(a.official_rank) - rankValue(b.official_rank);
          }
        } else if (sortColumn === "RANK" && isGenerationRankingActive()) {
          result = rankValue(a.generation_live_rank) - rankValue(b.generation_live_rank);
        } else if (sortColumn === "PLAYER") {
          result = normalizeSearchText(a.player_name).localeCompare(
            normalizeSearchText(b.player_name),
            "pt-BR"
          );
        } else if (sortColumn === "YEAR") {
          result = rankValue(a.birth_year) - rankValue(b.birth_year);
        } else {
          result = rankValue(a.live_rank) - rankValue(b.live_rank);
        }

        if (result === 0) {
          result = rankValue(a.live_rank) - rankValue(b.live_rank);
        }

        return sortDirection === "desc" ? -result : result;
      });
    }

    function updateSortHeaders() {
      document.querySelectorAll("[data-sort-header]").forEach((button) => {
        const key = button.getAttribute("data-sort-header");
        button.classList.toggle("active", key === sortColumn || (key === "RANK" && sortColumn === "OFFICIAL_RANK"));
      });

      document.querySelectorAll("[data-sort-indicator]").forEach((indicator) => {
        const key = indicator.getAttribute("data-sort-indicator");
        const active = key === sortColumn || (key === "RANK" && sortColumn === "OFFICIAL_RANK");
        indicator.textContent = active
          ? (sortDirection === "asc" ? "↑" : "↓")
          : "↕";
      });

      const rankHeaderLabel = document.getElementById("rankHeaderLabel");
      if (rankHeaderLabel) {
        rankHeaderLabel.innerHTML = sortColumn === "OFFICIAL_RANK"
          ? t("officialRankHeader")
          : t("liveRankHeader");
      }

      const playerHeaderLabel = document.getElementById("playerHeaderLabel");
      if (playerHeaderLabel) {
        playerHeaderLabel.textContent = t("athlete");
      }

      const pointsHeaderLabel = document.getElementById("pointsHeaderLabel");
      if (pointsHeaderLabel) {
        pointsHeaderLabel.textContent = sortColumn === "OFFICIAL_RANK"
          ? t("officialPoints")
          : t("livePoints");
      }

      setText("yearHeaderLabel", t("year"));

      const rankingContext = document.getElementById("rankingContext");
      if (rankingContext) {
        rankingContext.textContent = sortColumn === "OFFICIAL_RANK"
          ? t("officialItfRanking") + ": " + officialRankingDate
          : t("officialBase") + ": " + officialRankingDate;
      }
    }

    function updateGenderControl() {
      genderButtons.forEach((button) => {
        const active = button.getAttribute("data-gender-option") === genderFilter.value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function updateRankingModeControl() {
      rankingModeButtons.forEach((button) => {
        const active = button.getAttribute("data-ranking-mode-option") === generationRankingFilter.value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function setTableSort(column) {
      if (sortColumn === column) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = column;
        sortDirection = "asc";
      }

      if (Array.from(sortFilter.options).some((option) => option.value === sortColumn)) {
        sortFilter.value = sortColumn;
      }

      renderTable();
    }

    function renderTournaments() {
      weekTournaments.innerHTML = tournamentGroups.map((group) => {
        const categoryClass = getCategoryClass(group.category);

        return \`
          <div class="tournament-group \${categoryClass}">
            <div>\${getCategoryChipHtml(group.category)}</div>
            <div class="tournament-list">
              \${group.items.map((item) => {
                const surfaceKey = item.surfaceKey || getSurfaceKeyClient(item.surface, item.surfaceCode);
                const className = ["week-tournament-name", getSurfaceClass(surfaceKey)].filter(Boolean).join(" ");

                return '<span class="' + className + '" title="' + escapeHtmlClient(item.name) + '">' + escapeHtmlClient(item.displayName || item.name) + '</span>';
              }).join("")}
            </div>
          </div>
        \`;
      }).join("");
    }

    function renderResultCards(results) {
      if (!results.length) {
        return '<div class="profile-empty">' + t("noResult") + '</div>';
      }

      return results.map((item) => {
        const cardClass = item.counting ? "counting" : "not-counting";
        const source = item.source ? ' · ' + escapeHtmlClient(item.source) : '';
        const categoryClass = getCategoryClass(item.category);
        const details = [
          item.date,
          getWeekRoundDisplay(item.round),
        ].filter(Boolean).map(escapeHtmlClient).join(" · ");

        return \`
          <div class="result-card \${cardClass}">
            <div class="result-main">
              <span class="result-status-dot" title="\${item.counting ? t("counting") : t("notCounting")}"></span>
              <div class="result-category-scope \${categoryClass}">
                <div class="result-heading">
                  \${getCategoryChipHtml(item.category)}
                  <div>
                    <div class="result-title tournament-name">\${escapeHtmlClient(item.tournament || t("tournament"))}</div>
                    <div class="result-meta">\${details}\${source}</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="result-points">\${formatNumberClient(item.points)} \${t("pointsShort")}</div>
          </div>
        \`;
      }).join("");
    }

    function getRankingContribution(item) {
      const points = Number(item.points || 0);

      return item.eventType === "doubles"
        ? Number((points * 0.25).toFixed(2))
        : points;
    }

    function getSurfaceBreakdown(row) {
      const totals = new Map();
      const allResults = [
        ...(row.point_cartel?.singles || []),
        ...(row.point_cartel?.doubles || []),
      ];

      for (const item of allResults) {
        if (!item.counting) continue;

        const value = getRankingContribution(item);
        if (value <= 0) continue;

        const surfaceKey = item.surfaceKey || getSurfaceKeyClient(item.surface, item.surfaceCode) || "other";
        totals.set(surfaceKey, Number(((totals.get(surfaceKey) || 0) + value).toFixed(2)));
      }

      return [...totals.entries()]
        .map(([surfaceKey, points]) => ({
          surfaceKey,
          points,
          label: getSurfaceLabel(surfaceKey),
          color: getSurfaceColor(surfaceKey),
        }))
        .sort((a, b) => b.points - a.points);
    }

    function renderSurfaceChart(row) {
      const items = getSurfaceBreakdown(row);
      const total = items.reduce((sum, item) => sum + item.points, 0);

      if (!items.length || total <= 0) {
        return \`
          <div class="profile-overview-card chart-card">
            <div class="profile-section-title">
              <span>\${t("surfacePoints")}</span>
            </div>
            <div class="profile-empty">\${t("noSurface")}</div>
          </div>
        \`;
      }

      let cursor = 0;
      const gradient = items.map((item) => {
        const start = cursor;
        const end = cursor + (item.points / total) * 360;
        cursor = end;

        return item.color + " " + start.toFixed(2) + "deg " + end.toFixed(2) + "deg";
      }).join(", ");

      return \`
        <div class="profile-overview-card chart-card">
          <div class="profile-section-title">
            <span>\${t("surfacePoints")}</span>
          </div>
          <div class="surface-chart">
            <div class="surface-donut" style="background: conic-gradient(\${gradient});"></div>
            <div class="surface-legend">
              \${items.map((item) => \`
                <div class="surface-legend-item" style="--surface-color: \${item.color};">
                  <span class="surface-legend-swatch"></span>
                  <span class="surface-legend-label">\${escapeHtmlClient(item.label)} <strong>\${formatNumberClient(item.points)}</strong> · \${formatNumberClient((item.points / total) * 100)}%</span>
                </div>
              \`).join("")}
            </div>
          </div>
        </div>
      \`;
    }

    function getCategoryBreakdown(row) {
      const totals = new Map();
      const allResults = [
        ...(row.point_cartel?.singles || []),
        ...(row.point_cartel?.doubles || []),
      ];

      for (const item of allResults) {
        if (!item.counting) continue;

        const value = getRankingContribution(item);
        if (value <= 0) continue;

        const category = String(item.category || "").trim().toUpperCase() || t("other");
        totals.set(category, Number(((totals.get(category) || 0) + value).toFixed(2)));
      }

      const categoryOrder = ["JGS", "J500", "J300", "J200", "J100", "J60", "J30"];

      return [...totals.entries()]
        .map(([category, points]) => ({
          category,
          points,
          label: category,
          color: getCategoryColor(category),
          order: categoryOrder.includes(category) ? categoryOrder.indexOf(category) : 99,
        }))
        .sort((a, b) => b.points - a.points || a.order - b.order);
    }

    function renderCategoryChart(row) {
      const items = getCategoryBreakdown(row);
      const total = items.reduce((sum, item) => sum + item.points, 0);

      if (!items.length || total <= 0) {
        return \`
          <div class="profile-overview-card chart-card">
            <div class="profile-section-title">
              <span>\${t("categoryPoints")}</span>
            </div>
            <div class="profile-empty">\${t("noCategoryPoints")}</div>
          </div>
        \`;
      }

      let cursor = 0;
      const gradient = items.map((item) => {
        const start = cursor;
        const end = cursor + (item.points / total) * 360;
        cursor = end;

        return item.color + " " + start.toFixed(2) + "deg " + end.toFixed(2) + "deg";
      }).join(", ");

      return \`
        <div class="profile-overview-card chart-card">
          <div class="profile-section-title">
            <span>\${t("categoryPoints")}</span>
          </div>
          <div class="surface-chart">
            <div class="surface-donut" style="background: conic-gradient(\${gradient});"></div>
            <div class="surface-legend">
              \${items.map((item) => \`
                <div class="surface-legend-item" style="--surface-color: \${item.color};">
                  <span class="surface-legend-swatch"></span>
                  <span class="surface-legend-label">\${escapeHtmlClient(item.label)} <strong>\${formatNumberClient(item.points)}</strong> · \${formatNumberClient((item.points / total) * 100)}%</span>
                </div>
              \`).join("")}
            </div>
          </div>
        </div>
      \`;
    }

    function getRoundLabel(round) {
      if (round === "W") return t("champion");
      if (round === "F") return t("final");
      if (round === "SF") return t("semi");
      if (round === "QF") return t("quarter");
      return round;
    }

    function getSimulationRoundOptions(eventType, category) {
      const categoryPoints =
        pointsByCategory[eventType]?.[category] ||
        pointsByCategory[eventType]?.JGS ||
        {};

      return ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"]
        .filter((round) => Number(categoryPoints[round] || 0) > 0)
        .map((round) => ({
          round,
          points: Number(categoryPoints[round] || 0),
        }));
    }

    function getSimulatedEventDelta(row, eventType, targetRound) {
      if (!targetRound) return 0;

      const category = row.playing_this_week?.category || "";
      const targetRawPoints = Number(
        pointsByCategory[eventType]?.[category]?.[targetRound] ||
        pointsByCategory[eventType]?.JGS?.[targetRound] ||
        0
      );
      const multiplier = eventType === "doubles" ? 0.25 : 1;
      const tournament = normalizeSearchText(row.playing_this_week?.tournament || "");
      const currentResults = (row.point_cartel?.[eventType] || []).filter((item) => {
        const sameTournament = normalizeSearchText(item.tournament) === tournament;
        const sameCategory = String(item.category || "") === category;

        return !(sameTournament && sameCategory && item.source === "LIVE");
      });
      const currentRawTopSix = (row.point_cartel?.[eventType] || [])
        .map((item) => Number(item.points || 0))
        .sort((a, b) => b - a)
        .slice(0, 6)
        .reduce((sum, points) => sum + points, 0);
      const projectedRawTopSix = [
        ...currentResults.map((item) => Number(item.points || 0)),
        targetRawPoints,
      ]
        .sort((a, b) => b - a)
        .slice(0, 6)
        .reduce((sum, points) => sum + points, 0);

      return Number(((projectedRawTopSix - currentRawTopSix) * multiplier).toFixed(2));
    }

    function getProjectedRankForPoints(row, projectedPoints) {
      const minimumBirthYear = getGenerationMinimumYear();

      return 1 + rankingData.filter((item) => {
        if (item.gender !== row.gender) return false;
        if (item.player_id === row.player_id) return false;
        if (isGenerationRankingActive() && Number(item.birth_year || 0) < minimumBirthYear) return false;

        return Number(item.live_points || 0) > projectedPoints;
      }).length;
    }

    function renderSimulatorOptions(options) {
      return '<option value="">-</option>' +
        options
          .map((item) => '<option value="' + item.round + '">' + getRoundLabel(item.round) + ' · ' + formatNumberClient(item.points) + '</option>')
          .join("");
    }

    function renderPointSimulator(row) {
      if (!row.playing_this_week) return "";

      const p = row.playing_this_week;
      const singlesOptions = p.singlesSummary
        ? getSimulationRoundOptions("singles", p.category)
        : [];
      const doublesOptions = p.doublesSummary
        ? getSimulationRoundOptions("doubles", p.category)
        : [];

      if (!singlesOptions.length && !doublesOptions.length) return "";

      return \`
        <div class="profile-overview-card simulator-card">
          <div class="profile-section-title">
            <span>\${t("weekSimulator")}</span>
            <span class="profile-section-meta">\${escapeHtmlClient(getTournamentDisplayNameClient(p.tournament, p.category))}</span>
          </div>
          <div class="simulator">
            <div class="simulator-grid">
              <div class="simulator-field">
                <label for="singlesSimulatorSelect">\${t("singles")}</label>
                <select id="singlesSimulatorSelect" \${singlesOptions.length ? "" : "disabled"} onchange="updatePointSimulator()">
                  \${renderSimulatorOptions(singlesOptions)}
                </select>
              </div>
              <div class="simulator-field">
                <label for="doublesSimulatorSelect">\${t("doubles")}</label>
                <select id="doublesSimulatorSelect" \${doublesOptions.length ? "" : "disabled"} onchange="updatePointSimulator()">
                  \${renderSimulatorOptions(doublesOptions)}
                </select>
              </div>
            </div>
            <div class="simulator-result" id="simulatorResult">
              \${t("selectRound")}
            </div>
          </div>
        </div>
      \`;
    }

    function updatePointSimulator() {
      const row = rankingData.find((item) => item.player_id === selectedPlayerId);
      const resultEl = document.getElementById("simulatorResult");
      const singlesSelect = document.getElementById("singlesSimulatorSelect");
      const doublesSelect = document.getElementById("doublesSimulatorSelect");

      if (!row || !resultEl || !singlesSelect || !doublesSelect) return;

      const singlesRound = singlesSelect.value;
      const doublesRound = doublesSelect.value;

      if (!singlesRound && !doublesRound) {
        resultEl.textContent = t("selectRound");
        return;
      }

      const delta =
        getSimulatedEventDelta(row, "singles", singlesRound) +
        getSimulatedEventDelta(row, "doubles", doublesRound);
      const projectedPoints = Number((Number(row.live_points || 0) + delta).toFixed(2));
      const projectedRank = getProjectedRankForPoints(row, projectedPoints);
      const rankGain = Number(row.live_rank || 0) - projectedRank;

      resultEl.innerHTML =
        '<span class="simulator-pill">' + formatNumberClient(projectedPoints) + ' ' + t("pointsShort") + '</span>' +
        '<span class="simulator-pill">' + formatRankClient(projectedRank) + '</span>' +
        '<span>' + (delta >= 0 ? '+' : '') + formatNumberClient(delta) + ' ' + t("pointsShort") +
        (rankGain > 0 ? ' · +' + rankGain + ' ' + t("positionsShort") : '') +
        '</span>';
    }

    function renderCartelSection(title, results) {
      const counting = results.filter((item) => item.counting);
      const total = results.length;

      return \`
        <div class="profile-section">
          <div class="profile-section-title">
            <span>\${title}</span>
            <span class="profile-section-meta">\${counting.length}/\${total}</span>
          </div>
          <div class="result-list">\${renderResultCards(results)}</div>
        </div>
      \`;
    }

    function renderProfile(row) {
      if (!row) {
        profileModal.classList.remove("open");
        profileModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        profileCard.innerHTML = \`
          <div class="profile-dialog-header">
            <h3 id="profileDialogTitle">\${t("athletePoints")}</h3>
            <button class="modal-close-button" type="button" aria-label="\${t("close")}" onclick="closeProfileModal()">×</button>
          </div>
          <div class="profile-empty">
            \${t("profileEmpty")}
          </div>
        \`;
        return;
      }

      const flag = getFlagHtml(row);
      const tags = statusTags(row);
      const simulatorHtml = renderPointSimulator(row);

      profileCard.innerHTML = \`
        <div class="profile-dialog-header">
          <h3 id="profileDialogTitle">\${t("athletePoints")}</h3>
          <button class="modal-close-button" type="button" aria-label="\${t("close")}" onclick="closeProfileModal()">×</button>
        </div>

        <div class="profile-head">
          <div class="profile-flag">\${flag}</div>
          <div>
            <div class="profile-name">\${escapeHtmlClient(row.player_name)}</div>
            <div class="profile-meta">\${formatNumberClient(row.live_points)} \${t("pointsShort")} \${t("live")}</div>
          </div>
        </div>

        \${tags ? '<div class="profile-line">' + tags + '</div>' : ''}

        <div class="profile-overview">
          \${renderSurfaceChart(row)}
          \${renderCategoryChart(row)}
          \${simulatorHtml}
        </div>
        <div class="cartel-grid">
          \${renderCartelSection(t("singles"), row.point_cartel?.singles || [])}
          \${renderCartelSection(t("doubles"), row.point_cartel?.doubles || [])}
        </div>
      \`;
      profileModal.classList.add("open");
      profileModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("modal-open");
    }

    function getRankingCellHtml(row) {
      if (sortColumn === "OFFICIAL_RANK") {
        const officialRank = isGenerationRankingActive()
          ? Number(row.generation_official_rank || 0)
          : Number(row.official_rank || 0);

        if (isGenerationRankingActive()) {
          return '<span class="rank">' + (officialRank ? officialRank : "NR") + '</span>' +
                 '<div class="rank-meta">' + t("official") + ' ' + formatRankClient(row.official_rank) + '</div>';
        }

        return '<span class="rank">' + (officialRank ? officialRank : "NR") + '</span>';
      }

      if (isGenerationRankingActive()) {
        return '<span class="rank">' + row.generation_live_rank + '</span>' +
               '<div class="rank-meta">' + t("live") + ' ' + formatRankClient(row.live_rank) + '</div>';
      }

      const moveClass = movementClass(row.rank_change_vs_official);

      return '<span class="rank">' + row.live_rank + '</span>' +
             '<span class="rank-change ' + moveClass + '">' + formatChange(row.rank_change_vs_official) + '</span>';
    }

    function getOfficialPointsHtml(row) {
      return '<span class="points">' + formatNumberClient(row.official_points) + '</span>';
    }

    function renderTable() {
      const rows = sortRows(
        withGenerationRanks(rankingData.filter(passesFilters))
          .filter(passesDisplayLimit)
      );
      updateSortHeaders();
      updateGenderControl();
      updateRankingModeControl();
      document.body.classList.toggle("official-ranking-view", sortColumn === "OFFICIAL_RANK");

      const summaryLocale = currentLanguage === "en"
        ? "en-US"
        : currentLanguage === "es"
          ? "es-ES"
          : "pt-BR";
      visibleSummary.innerHTML = '<strong>' + rows.length.toLocaleString(summaryLocale) + '</strong> ' + t("playersShown") +
        (selectedCountry ? ' · ' + escapeHtmlClient(selectedCountry.code) : '') +
        (isGenerationRankingActive() ? ' · ' + escapeHtmlClient(getGenerationLabel()) : '');

      if (selectedPlayerId && !rows.some((row) => row.player_id === selectedPlayerId)) {
        selectedPlayerId = "";
        renderProfile(null);
      }

      rankingBody.innerHTML = rows.map((row) => {
        const selected = selectedPlayerId === row.player_id ? "selected" : "";
        const flag = getFlagHtml(row);
        const pointsCell = sortColumn === "OFFICIAL_RANK"
          ? getOfficialPointsHtml(row)
          : getPointsHtml(row);
        const liveOnlyCells = sortColumn === "OFFICIAL_RANK"
          ? ""
          : \`
            <td class="week-cell live-only">
              \${getPlayingHtml(row)}
            </td>

            <td class="live-only">
              \${getNextRoundHtml(row)}
            </td>

            <td class="live-only">
              \${getTitleHtml(row)}
            </td>
          \`;

        return \`
          <tr class="\${selected}" onclick="selectPlayer('\${escapeHtmlClient(row.player_id)}')">
            <td>
              \${getRankingCellHtml(row)}
            </td>

            <td class="player">
              <div class="player-name">\${flag}<span>\${escapeHtmlClient(row.player_name)}</span></div>
            </td>

            <td>\${escapeHtmlClient(row.birth_year || "-")}</td>

            <td>
              \${pointsCell}
            </td>

            \${liveOnlyCells}
          </tr>
        \`;
      }).join("");
    }

    function selectPlayer(playerId) {
      selectedPlayerId = playerId;
      const row = rankingData.find((item) => item.player_id === playerId);
      renderProfile(row);
      renderTable();
    }

    function closeProfileModal() {
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    }

    function togglePointsInfo(event, playerId) {
      event.stopPropagation();
      expandedPointsPlayerId = expandedPointsPlayerId === playerId ? "" : playerId;
      renderTable();
    }

    window.selectPlayer = selectPlayer;
    window.togglePointsInfo = togglePointsInfo;
    window.closeProfileModal = closeProfileModal;
    window.setTableSort = setTableSort;
    window.updatePointSimulator = updatePointSimulator;

    searchInput.addEventListener("input", renderTable);
    countrySearchInput.addEventListener("input", handleCountryInput);
    countrySearchInput.addEventListener("focus", renderCountrySuggestions);
    countrySearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const firstMatch = getCountrySuggestions(countrySearchInput.value)[0];
        if (firstMatch) {
          event.preventDefault();
          selectCountry(firstMatch);
        }
      } else if (event.key === "Escape") {
        setCountrySuggestionsOpen(false);
      }
    });
    countrySuggestions.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    countrySuggestions.addEventListener("click", (event) => {
      const button = event.target.closest("[data-country-code]");
      if (!button) return;

      const country = countryOptions.find((item) => item.code === button.dataset.countryCode);
      if (country) selectCountry(country);
    });
    countrySearchInput.addEventListener("blur", () => {
      setTimeout(() => setCountrySuggestionsOpen(false), 120);
    });
    countryClearButton.addEventListener("click", clearCountrySelection);
    generationRankingFilter.addEventListener("change", () => {
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    });
    rankingModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        generationRankingFilter.value = button.getAttribute("data-ranking-mode-option");
        generationRankingFilter.dispatchEvent(new Event("change"));
      });
    });
    themeToggle.addEventListener("change", () => {
      applyTheme(themeToggle.checked ? "dark" : "light");
    });
    languageButtons.forEach((button) => {
      button.addEventListener("click", () => {
        applyLanguage(button.getAttribute("data-language-option"));
      });
    });
    playingOnlyFilter.addEventListener("change", renderTable);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && profileModal.classList.contains("open")) {
        closeProfileModal();
      }
    });
    genderFilter.addEventListener("change", () => {
      selectedPlayerId = "";
      renderProfile(null);
      renderTable();
    });
    genderButtons.forEach((button) => {
      button.addEventListener("click", () => {
        genderFilter.value = button.getAttribute("data-gender-option");
        genderFilter.dispatchEvent(new Event("change"));
      });
    });
    sortFilter.addEventListener("change", () => {
      sortColumn = sortFilter.value;
      sortDirection = "asc";
      renderTable();
    });

    renderTournaments();
    applyTheme(localStorage.getItem("itf-live-theme") || "light");
    applyLanguage(currentLanguage);
  </script>
</body>
</html>`;
}

async function main() {
  await ensureDirs();

  console.log("");
  console.log("Lendo live_ranking_with_drops.csv...");
  const rows = await readCsv(LIVE_RANKING_FILE);

  console.log("Lendo week_tournaments.csv...");
  const weekTournaments = await readCsv(WEEK_TOURNAMENTS_FILE);

  console.log("Lendo week_player_results.csv...");
  const weekPlayerResults = await readCsv(WEEK_PLAYER_RESULTS_FILE);

  console.log("Lendo week_matches.csv...");
  const weekMatches = await readCsv(WEEK_MATCHES_FILE);

  console.log("Lendo week_live_ledger_rows.csv...");
  const weekLiveLedgerRows = await readCsv(WEEK_LIVE_LEDGER_ROWS_FILE);

  console.log("Lendo live_dropped_points.csv...");
  const droppedRows = await readCsv(DROPPED_POINTS_FILE);

  console.log("Lendo live_combined_ledger_with_drops.csv...");
  const combinedLedgerRows = await readCsv(LIVE_COMBINED_LEDGER_FILE);

  const weekParticipationMap = buildWeekParticipationMap(
    weekPlayerResults,
    weekLiveLedgerRows,
    weekMatches
  );

  const pointDetailsMap = buildPointDetailsMap(
    weekLiveLedgerRows,
    droppedRows,
    rows
  );
  const pointCartelMap = buildPointCartelMap(combinedLedgerRows);

  const html = buildHtml(
    rows,
    weekTournaments,
    weekParticipationMap,
    pointDetailsMap,
    pointCartelMap
  );

  await fs.writeFile(HTML_OUTPUT_FILE, html, "utf8");
  await fs.writeFile(INDEX_OUTPUT_FILE, html, "utf8");
  await fs.writeFile(CNAME_OUTPUT_FILE, `${CUSTOM_DOMAIN}\n`, "utf8");
  await fs.copyFile(FAVICON_SOURCE_FILE, FAVICON_OUTPUT_FILE);

  for (const page of STATIC_PAGES) {
    await fs.writeFile(
      path.join(OUT_DIR_EXPORTS, page.fileName),
      buildStaticPage(page),
      "utf8"
    );
  }

  console.log("");
  console.log("HTML gerado:");
  console.log("data/exports/live_ranking.html");
  console.log("data/exports/index.html");
  console.log("data/exports/CNAME");
  console.log("data/exports/favicon.png");
  for (const page of STATIC_PAGES) {
    console.log(`data/exports/${page.fileName}`);
  }
  console.log("");
  console.log("Para abrir no navegador:");
  console.log(`file:///${HTML_OUTPUT_FILE.replaceAll("\\\\", "/")}`);
}

main().catch((err) => {
  console.error("");
  console.error("Erro fatal:");
  console.error(err);
  process.exit(1);
});

