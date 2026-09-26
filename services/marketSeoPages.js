const MARKET_SEO_PAGES = [
  ['over-25', 'Over 2.5 Goals', 'Over/Under'],
  ['btts', 'Both Teams to Score', 'BTTS'],
  ['correct-score', 'Correct Score', 'Correct Score'],
  ['accumulator', 'Accumulator', 'Accumulator'],
  ['1x2', '1X2 Match Result', '1X2'],
  ['double-chance', 'Double Chance', 'Double Chance'],
  ['draw-no-bet', 'Draw No Bet', 'Draw No Bet'],
  ['over-15', 'Over 1.5 Goals', 'Over/Under'],
  ['over-35', 'Over 3.5 Goals', 'Over/Under'],
  ['over-45', 'Over 4.5 Goals', 'Over/Under'],
  ['under-15', 'Under 1.5 Goals', 'Over/Under'],
  ['under-25', 'Under 2.5 Goals', 'Over/Under'],
  ['under-35', 'Under 3.5 Goals', 'Over/Under'],
  ['under-45', 'Under 4.5 Goals', 'Over/Under'],
  ['home-win', 'Home Win', '1X2'],
  ['draw', 'Draw', '1X2'],
  ['away-win', 'Away Win', '1X2'],
  ['btts-yes', 'BTTS Yes', 'BTTS'],
  ['btts-no', 'BTTS No', 'BTTS'],
  ['corners', 'Corners', 'Corners'],
  ['first-half-home-win', 'First Half Home Win', 'First Half Result'],
  ['first-half-away-win', 'First Half Away Win', 'First Half Result'],
];

function article(label) {
  return `## Understanding ${label} Predictions

${label} predictions focus on fixtures that match this specific football market. Predictvilla evaluates available match data before displaying a selection, including recent form, home and away performance, goals scored and conceded, head-to-head meetings, competition trends, player availability and relevant team statistics.

## How We Analyse ${label}

Our prediction engine compares historical performance with the latest available fixture information. Each prediction receives a confidence score based on the strength and consistency of those signals. The matches shown above are the current published selections for this category.

## Using These Predictions

- Review the match analysis and confidence score.
- Check team news, injuries and expected line-ups close to kick-off.
- Compare current form within the relevant competition.
- Confirm the market and available odds before making a decision.

No football prediction is guaranteed. Predictvilla provides statistical analysis for informational and entertainment purposes only. If you choose to bet, gamble responsibly.`;
}

async function removeIncorrectTipPages(db) {
  // Removes only the mistakenly generated standalone /tips records from the
  // superseded implementation. User-created SEO pages are not matched.
  const wrongTargets = [
    'home-win','draw','away-win','over-1-5-goals','over-2-5-goals','over-3-5-goals','over-4-5-goals',
    'under-1-5-goals','under-2-5-goals','under-3-5-goals','under-4-5-goals','btts-yes','btts-no',
    'double-chance-1x','double-chance-x2','double-chance-12','draw-no-bet-home','draw-no-bet-away',
    'first-half-home-win','first-half-draw','first-half-away-win','score-1-0','score-0-1','score-1-1',
    'score-2-0','score-0-2','score-2-1','score-1-2','score-2-2','score-3-0','score-0-3','score-3-1',
    'score-1-3','score-3-2','score-2-3','score-0-0','over-7-5-corners','over-8-5-corners',
    'over-9-5-corners','over-10-5-corners','over-11-5-corners','under-7-5-corners','under-8-5-corners',
    'under-9-5-corners','under-10-5-corners','under-11-5-corners',
  ];
  const targets = wrongTargets.map(slug => `/predictions/${slug}`);
  await db.query(
    `DELETE FROM seo_article_pages
     WHERE target_url IN (?) AND slug LIKE '%-predictions'`,
    [targets]
  );
}

async function seedMarketSeoPages(db) {
  for (const [slug, label, market] of MARKET_SEO_PAGES) {
    await db.query(
      `INSERT IGNORE INTO seo_article_pages
       (slug, title, meta_description, meta_keywords, content, target_url, market, is_published, show_live_predictions)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [slug, `${label} Predictions`, `Data-driven ${label} predictions, match analysis and football tips from Predictvilla.`, `${label.toLowerCase()} predictions, ${label.toLowerCase()} tips, football predictions`, article(label), `/predictions/${slug}`, market]
    );
  }
}

module.exports = { MARKET_SEO_PAGES, removeIncorrectTipPages, seedMarketSeoPages };
