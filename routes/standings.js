const router = require('express').Router();
const axios = require('axios');
const quota = require('../services/apiQuota');
const { storeResponse } = require('../services/apiFootballArchive');
const memoryCache = require('../services/memoryCache');

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = 'https://v3.football.api-sports.io';

function currentSeason() {
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

const CACHE_TTL = 3600000;

// Loads standings widgets from the worker cache and archives fresh API responses in MySQL.
async function apiFetch(endpoint, params) {
  const cleanEndpoint = endpoint.replace(/^\//, '');
  return memoryCache.remember(memoryCache.stableKey(`historical:${cleanEndpoint}`, params), CACHE_TTL, async () => {
    quota.checkAndIncrement(`standings:${cleanEndpoint}`);
    const { data } = await axios.get(`${API_BASE}${endpoint}`, {
      params,
      headers: { 'x-apisports-key': API_KEY },
      timeout: 10000,
    });
    await storeResponse(cleanEndpoint, params, data?.response)
      .catch(error => console.error(`[Standings] archive ${cleanEndpoint}:`, error.message));
    return data;
  });
}

router.get('/standings', async (req, res) => {
  try {
    const leagueId = parseInt(req.query.league) || 39;
    const season = parseInt(req.query.season) || currentSeason();
    const data = await apiFetch('/standings', { league: leagueId, season });
    const league = data.response?.[0]?.league || {};
    const standings = league.standings?.[0] || [];
    res.json({
      success: true,
      data: {
        league: {
          id: leagueId,
          name: league.name || '',
          logo: league.logo || '',
          country: league.country || '',
        },
        standings: standings.map(t => ({
          rank: t.rank,
          team: t.team.name,
          logo: t.team.logo,
          played: t.all.played,
          won: t.all.win,
          drawn: t.all.draw,
          lost: t.all.lose,
          goalsFor: t.all.goals.for,
          goalsAgainst: t.all.goals.against,
          points: t.points,
          form: t.form || '',
        })),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Could not load standings' });
  }
});

router.get('/topscorers', async (req, res) => {
  try {
    const leagueId = parseInt(req.query.league) || 39;
    const season = parseInt(req.query.season) || currentSeason();
    const data = await apiFetch('/players/topscorers', { league: leagueId, season });
    const players = (data.response || []).slice(0, 10);
    res.json({
      success: true,
      data: {
        players: players.map(p => ({
          name: p.player.name,
          team: p.statistics[0]?.team?.name || '',
          goals: p.statistics[0]?.goals?.total || 0,
          assists: p.statistics[0]?.goals?.assists || 0,
          matches: p.statistics[0]?.games?.appearences || 0,
        })),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Could not load top scorers' });
  }
});

module.exports = router;
