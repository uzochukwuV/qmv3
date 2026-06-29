export const sportsCategories = [
  { icon: "⚽", name: "Football", count: 234 },
  { icon: "🏀", name: "Basketball", count: 45 },
  { icon: "🎾", name: "Tennis", count: 78 },
  { icon: "🏈", name: "American Football", count: 12 },
  { icon: "🏒", name: "Ice Hockey", count: 34 },
  { icon: "🏐", name: "Volleyball", count: 23 },
  { icon: "⚾", name: "Baseball", count: 18 },
  { icon: "🥊", name: "Boxing", count: 8 },
  { icon: "🏉", name: "Rugby", count: 15 },
  { icon: "🎮", name: "E-Sports", count: 56 },
];

export const popularLeagues = [
  { flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", name: "Premier League" },
  { flag: "🇪🇸", name: "La Liga" },
  { flag: "🇩🇪", name: "Bundesliga" },
  { flag: "🇮🇹", name: "Serie A" },
  { flag: "🇫🇷", name: "Ligue 1" },
  { flag: "🌍", name: "NPFL" },
  { flag: "🌍", name: "CAF Champions League" },
];

export const liveMatches = [
  {
    id: "live-1",
    league: "Premier League",
    minute: "67'",
    home: "Arsenal",
    away: "Chelsea",
    homeScore: 2,
    awayScore: 1,
    odds: { "1": 1.85, "X": 3.40, "2": 2.10 },
  },
  {
    id: "live-2",
    league: "La Liga",
    minute: "34'",
    home: "Real Madrid",
    away: "Atletico",
    homeScore: 1,
    awayScore: 1,
    odds: { "1": 2.05, "X": 3.20, "2": 2.40 },
  },
  {
    id: "live-3",
    league: "Bundesliga",
    minute: "52'",
    home: "Bayern",
    away: "Dortmund",
    homeScore: 3,
    awayScore: 0,
    odds: { "1": 1.12, "X": 7.50, "2": 12.00 },
  },
  {
    id: "live-4",
    league: "Serie A",
    minute: "78'",
    home: "Juventus",
    away: "Inter",
    homeScore: 0,
    awayScore: 2,
    odds: { "1": 8.50, "X": 4.80, "2": 1.15 },
  },
];

export const marketTabs = [
  "All Markets",
  "1X2",
  "Double Chance",
  "Both Teams to Score",
  "Over/Under",
  "Correct Score",
  "Half Time",
  "Asian Handicap",
  "Draw No Bet",
  "Clean Sheet",
];

export const oddsColumns = [
  { key: "1", label: "1" },
  { key: "X", label: "X" },
  { key: "2", label: "2" },
  { key: "1X", label: "1X" },
  { key: "X2", label: "X2" },
  { key: "12", label: "12" },
  { key: "GG", label: "GG" },
  { key: "NG", label: "NG" },
  { key: "O2.5", label: "O2.5" },
  { key: "U2.5", label: "U2.5" },
];

export const marketColumnMap = {
  "All Markets": null,
  "1X2": ["1", "X", "2"],
  "Double Chance": ["1X", "X2", "12"],
  "Both Teams to Score": ["GG", "NG"],
  "Over/Under": ["O2.5", "U2.5"],
  "Correct Score": ["1", "X", "2"],
  "Half Time": ["1", "X", "2"],
  "Asian Handicap": ["1", "2"],
  "Draw No Bet": ["1", "2"],
  "Clean Sheet": ["1", "2"],
};

export const matchesByLeague = [
  {
    league: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League",
    matches: [
      { id: "m1", time: "18:00", home: "Arsenal", away: "Chelsea", odds: { "1": 2.10, "X": 3.40, "2": 1.85, "1X": 1.28, "X2": 1.45, "12": 1.35, "GG": 1.72, "NG": 2.05, "O2.5": 1.80, "U2.5": 2.10 }, more: 12 },
      { id: "m2", time: "18:00", home: "Man City", away: "Liverpool", odds: { "1": 1.75, "X": 3.60, "2": 2.30, "1X": 1.20, "X2": 1.55, "12": 1.38, "GG": 1.68, "NG": 2.15, "O2.5": 1.75, "U2.5": 2.20 }, more: 8 },
      { id: "m3", time: "20:45", home: "Tottenham", away: "Man Utd", odds: { "1": 2.40, "X": 3.25, "2": 1.70, "1X": 1.42, "X2": 1.40, "12": 1.30, "GG": 1.65, "NG": 2.20, "O2.5": 1.85, "U2.5": 2.00 }, more: 10 },
      { id: "m4", time: "20:45", home: "Newcastle", away: "Everton", odds: { "1": 1.90, "X": 3.50, "2": 2.10, "1X": 1.30, "X2": 1.50, "12": 1.32, "GG": 1.78, "NG": 2.08, "O2.5": 1.82, "U2.5": 2.05 }, more: 9 },
    ],
  },
  {
    league: "🇪🇸 La Liga",
    matches: [
      { id: "m5", time: "19:00", home: "Real Madrid", away: "Barcelona", odds: { "1": 2.05, "X": 3.55, "2": 1.88, "1X": 1.25, "X2": 1.48, "12": 1.33, "GG": 1.70, "NG": 2.10, "O2.5": 1.78, "U2.5": 2.15 }, more: 15 },
      { id: "m6", time: "19:00", home: "Atletico", away: "Sevilla", odds: { "1": 1.80, "X": 3.45, "2": 2.25, "1X": 1.22, "X2": 1.52, "12": 1.36, "GG": 1.74, "NG": 2.12, "O2.5": 1.80, "U2.5": 2.18 }, more: 11 },
      { id: "m7", time: "21:30", home: "Valencia", away: "Betis", odds: { "1": 2.20, "X": 3.30, "2": 1.78, "1X": 1.38, "X2": 1.42, "12": 1.28, "GG": 1.66, "NG": 2.25, "O2.5": 1.88, "U2.5": 1.95 }, more: 7 },
    ],
  },
  {
    league: "🇩🇪 Bundesliga",
    matches: [
      { id: "m8", time: "17:30", home: "Bayern", away: "Dortmund", odds: { "1": 1.65, "X": 4.00, "2": 2.60, "1X": 1.18, "X2": 1.60, "12": 1.42, "GG": 1.80, "NG": 2.05, "O2.5": 1.72, "U2.5": 2.22 }, more: 13 },
      { id: "m9", time: "20:30", home: "Leipzig", away: "Leverkusen", odds: { "1": 2.15, "X": 3.35, "2": 1.82, "1X": 1.32, "X2": 1.44, "12": 1.30, "GG": 1.68, "NG": 2.18, "O2.5": 1.84, "U2.5": 2.08 }, more: 8 },
    ],
  },
  {
    league: "🇮🇹 Serie A",
    matches: [
      { id: "m10", time: "18:45", home: "Juventus", away: "Inter", odds: { "1": 2.25, "X": 3.20, "2": 1.75, "1X": 1.40, "X2": 1.38, "12": 1.25, "GG": 1.62, "NG": 2.30, "O2.5": 1.90, "U2.5": 1.92 }, more: 9 },
      { id: "m11", time: "21:00", home: "Milan", away: "Napoli", odds: { "1": 1.95, "X": 3.40, "2": 2.15, "1X": 1.28, "X2": 1.50, "12": 1.34, "GG": 1.75, "NG": 2.08, "O2.5": 1.78, "U2.5": 2.12 }, more: 10 },
    ],
  },
  {
    league: "🌍 NPFL",
    matches: [
      { id: "m12", time: "16:00", home: "Enyimba", away: "Rivers Utd", odds: { "1": 2.30, "X": 3.10, "2": 1.72, "1X": 1.42, "X2": 1.36, "12": 1.22, "GG": 1.60, "NG": 2.35, "O2.5": 1.92, "U2.5": 1.90 }, more: 6 },
      { id: "m13", time: "16:00", home: "Kano Pillars", away: "Lobi Stars", odds: { "1": 2.00, "X": 3.25, "2": 2.00, "1X": 1.35, "X2": 1.45, "12": 1.30, "GG": 1.70, "NG": 2.15, "O2.5": 1.80, "U2.5": 2.10 }, more: 5 },
    ],
  },
];

export const initialBetSlip = [
  { id: "bet-1", matchId: "m1", match: "Arsenal vs Chelsea", selection: "1 (Home Win)", market: "1", odds: 2.10 },
  { id: "bet-2", matchId: "m5", match: "Real Madrid vs Barcelona", selection: "GG (Both Score)", market: "GG", odds: 1.70 },
  { id: "bet-3", matchId: "m8", match: "Bayern vs Dortmund", selection: "Over 2.5 Goals", market: "O2.5", odds: 1.72 },
];

export const betHistory = [
  { id: "h1", match: "Arsenal/Chelsea", amount: "₦2,100", status: "won" },
  { id: "h2", match: "Liverpool/City", amount: "₦500", status: "lost" },
  { id: "h3", match: "Barca/Madrid", amount: "₦1,500", status: "pending" },
];

export const oddsLabelMap = {
  "1": "Home Win",
  "X": "Draw",
  "2": "Away Win",
  "1X": "Home or Draw",
  "X2": "Draw or Away",
  "12": "Home or Away",
  "GG": "Both Score",
  "NG": "No Both Score",
  "O2.5": "Over 2.5",
  "U2.5": "Under 2.5",
};