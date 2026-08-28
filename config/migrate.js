require('dotenv').config();
const { pool } = require('./db');
const bcrypt = require('bcryptjs');

async function migrate() {
  const db = pool;

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','vip','admin') DEFAULT 'user',
      country VARCHAR(100),
      timezone VARCHAR(50) DEFAULT 'UTC',
      telegram_invited TINYINT(1) DEFAULT 0,
      password_reset_token VARCHAR(255),
      password_reset_expires DATETIME,
      is_banned TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS leagues (
      id INT PRIMARY KEY AUTO_INCREMENT,
      api_league_id INT UNIQUE,
      name VARCHAR(255) NOT NULL,
      country VARCHAR(100),
      continent VARCHAR(50),
      logo_url VARCHAR(500),
      is_active TINYINT(1) DEFAULT 1,
      is_popular TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS teams (
      id INT PRIMARY KEY AUTO_INCREMENT,
      api_team_id INT UNIQUE,
      name VARCHAR(255) NOT NULL,
      country VARCHAR(100),
      logo_url VARCHAR(500),
      goals_scored_total INT DEFAULT 0,
      goals_conceded_total INT DEFAULT 0,
      matches_played INT DEFAULT 0,
      goals_scored_avg DECIMAL(5,2),
      goals_conceded_avg DECIMAL(5,2),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS predictions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(500) UNIQUE,
      league_id INT,
      home_team VARCHAR(255) NOT NULL,
      away_team VARCHAR(255) NOT NULL,
      home_team_logo VARCHAR(500),
      away_team_logo VARCHAR(500),
      match_date DATETIME NOT NULL,
      tip VARCHAR(255) NOT NULL,
      market ENUM('1X2','Over/Under','BTTS','Draw No Bet','Correct Score','Accumulator') DEFAULT '1X2',
      category ENUM('all','free','over_1_5','over_2_5','over_3_5','under_1_5','under_2_5','under_3_5','gg','home_win','away_win','draw','vip','banker') DEFAULT 'free',
      odds DECIMAL(6,2),
      confidence_score INT,
      intelligence_score INT,
      analysis TEXT,
      seo_body MEDIUMTEXT,
      is_vip TINYINT(1) DEFAULT 0,
      is_banker TINYINT(1) DEFAULT 0,
      is_featured TINYINT(1) DEFAULT 0,
      source ENUM('manual','intelligence','auto_sync') DEFAULT 'manual',
      result ENUM('pending','won','lost','void','cancelled') DEFAULT 'pending',
      home_score INT,
      away_score INT,
      home_form VARCHAR(10),
      away_form VARCHAR(10),
      home_form_venue VARCHAR(10),
      away_form_venue VARCHAR(10),
      h2h_summary TEXT,
      home_goals_avg DECIMAL(5,2),
      away_goals_avg DECIMAL(5,2),
      home_goals_conceded_avg DECIMAL(5,2),
      away_goals_conceded_avg DECIMAL(5,2),
      api_fixture_id INT,
      bookies_available JSON,
      published_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_match_date (match_date),
      INDEX idx_league_id (league_id),
      INDEX idx_result (result),
      INDEX idx_category (category),
      INDEX idx_is_banker (is_banker),
      INDEX idx_is_vip (is_vip),
      INDEX idx_api_fixture_id (api_fixture_id)
    )`,

    `CREATE TABLE IF NOT EXISTS bookmarks (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      prediction_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bookmark (user_id, prediction_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS bet_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      prediction_id INT,
      stake DECIMAL(10,2) NOT NULL,
      odds DECIMAL(6,2),
      result ENUM('won','lost','void') DEFAULT 'void',
      profit_loss DECIMAL(10,2),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS comments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      prediction_id INT NOT NULL,
      user_id INT NOT NULL,
      content TEXT NOT NULL,
      is_approved TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      plan ENUM('monthly','quarterly','annual') NOT NULL,
      status ENUM('active','cancelled','expired','trialing') DEFAULT 'active',
      provider ENUM('paystack','manual') DEFAULT 'paystack',
      provider_subscription_id VARCHAR(255),
      paystack_reference VARCHAR(255),
      amount DECIMAL(10,2),
      currency VARCHAR(10) DEFAULT 'NGN',
      trial_ends_at DATETIME,
      expires_at DATETIME,
      notified_expiry TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS blog_posts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(500) UNIQUE NOT NULL,
      title VARCHAR(500) NOT NULL,
      excerpt TEXT,
      content LONGTEXT,
      featured_image LONGTEXT,
      category VARCHAR(100),
      author_name VARCHAR(100),
      meta_title VARCHAR(255),
      meta_description TEXT,
      keywords TEXT,
      is_published TINYINT(1) DEFAULT 0,
      published_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS seo_settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      page_key VARCHAR(100) UNIQUE NOT NULL,
      title VARCHAR(255),
      description TEXT,
      keywords TEXT,
      og_image VARCHAR(500),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS static_pages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(100) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      content LONGTEXT,
      extra JSON,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS site_settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      setting_key VARCHAR(100) UNIQUE NOT NULL,
      setting_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS site_stat_overrides (
      id INT PRIMARY KEY AUTO_INCREMENT,
      stat_key VARCHAR(100) UNIQUE NOT NULL,
      stat_value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS prediction_accuracy_log (
      id INT PRIMARY KEY AUTO_INCREMENT,
      prediction_id INT UNIQUE NOT NULL,
      market VARCHAR(50),
      category VARCHAR(50),
      league_id INT,
      home_team VARCHAR(255),
      away_team VARCHAR(255),
      tip VARCHAR(255),
      confidence_score INT,
      intelligence_score INT,
      is_correct TINYINT(1),
      source ENUM('manual','intelligence','auto_sync') DEFAULT 'manual',
      logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS accuracy_stats (
      id INT PRIMARY KEY AUTO_INCREMENT,
      stat_key VARCHAR(100) UNIQUE NOT NULL,
      stat_value DECIMAL(10,4),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS intelligence_outcomes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      prediction_id INT NOT NULL,
      market VARCHAR(50),
      category VARCHAR(50),
      league_id INT,
      api_league_id INT,
      home_team VARCHAR(255),
      away_team VARCHAR(255),
      tip VARCHAR(255),
      confidence_score INT,
      home_goals_avg DECIMAL(5,2),
      away_goals_avg DECIMAL(5,2),
      home_goals_conceded_avg DECIMAL(5,2),
      away_goals_conceded_avg DECIMAL(5,2),
      actual_home_score INT,
      actual_away_score INT,
      is_correct TINYINT(1),
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS intelligence_weights (
      id INT PRIMARY KEY AUTO_INCREMENT,
      weight_key VARCHAR(100) UNIQUE NOT NULL,
      weight_value DECIMAL(8,4) NOT NULL,
      description TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS team_statistics (
      id INT PRIMARY KEY AUTO_INCREMENT,
      team_name VARCHAR(255) NOT NULL,
      api_team_id INT,
      league_id INT,
      api_league_id INT,
      season INT,
      matches_played INT DEFAULT 0,
      goals_scored INT DEFAULT 0,
      goals_conceded INT DEFAULT 0,
      goals_scored_avg DECIMAL(5,2),
      goals_conceded_avg DECIMAL(5,2),
      wins INT DEFAULT 0,
      draws INT DEFAULT 0,
      losses INT DEFAULT 0,
      clean_sheets INT DEFAULT 0,
      btts_count INT DEFAULT 0,
      over_1_5_count INT DEFAULT 0,
      over_2_5_count INT DEFAULT 0,
      over_3_5_count INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_team_league_season (api_team_id, api_league_id, season)
    )`,

    `CREATE TABLE IF NOT EXISTS league_statistics (
      id INT PRIMARY KEY AUTO_INCREMENT,
      league_id INT,
      api_league_id INT UNIQUE,
      league_name VARCHAR(255),
      season INT,
      matches_played INT DEFAULT 0,
      total_goals INT DEFAULT 0,
      goals_per_game DECIMAL(5,2),
      btts_percentage DECIMAL(5,2),
      over_1_5_percentage DECIMAL(5,2),
      over_2_5_percentage DECIMAL(5,2),
      over_3_5_percentage DECIMAL(5,2),
      home_win_percentage DECIMAL(5,2),
      away_win_percentage DECIMAL(5,2),
      draw_percentage DECIMAL(5,2),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS prediction_market_stats (
      id INT PRIMARY KEY AUTO_INCREMENT,
      market VARCHAR(50) NOT NULL,
      category VARCHAR(50),
      league_id INT,
      team_name VARCHAR(255),
      total_predictions INT DEFAULT 0,
      correct_predictions INT DEFAULT 0,
      win_rate DECIMAL(5,2),
      avg_confidence DECIMAL(5,2),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS page_views (
      id INT PRIMARY KEY AUTO_INCREMENT,
      path VARCHAR(500),
      country VARCHAR(100),
      city VARCHAR(100),
      device_type VARCHAR(50),
      referrer VARCHAR(500),
      session_id VARCHAR(64),
      viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_viewed_at (viewed_at),
      INDEX idx_country (country)
    )`,
  ];

  for (const sql of tables) {
    await db.query(sql);
  }
  console.log('[Migrate] All tables created/verified');

  // Seed admin user
  const adminHash = await bcrypt.hash('Admin@OL!', 12);
  await db.query(
    `INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`,
    ['Admin', 'admin@predictvilla.com', adminHash]
  );

  // Seed leagues
  const leagues = [
    [39, 'Premier League', 'England', 'Europe', 1],
    [140, 'La Liga', 'Spain', 'Europe', 1],
    [135, 'Serie A', 'Italy', 'Europe', 1],
    [78, 'Bundesliga', 'Germany', 'Europe', 1],
    [61, 'Ligue 1', 'France', 'Europe', 1],
    [2, 'UEFA Champions League', 'Europe', 'Europe', 1],
    [3, 'UEFA Europa League', 'Europe', 'Europe', 1],
    [253, 'MLS', 'USA', 'Americas', 0],
    [71, 'Brasileirao', 'Brazil', 'Americas', 0],
    [323, 'ISL', 'India', 'Asia', 0],
    [6, 'AFCON', 'Africa', 'Africa', 0],
  ];
  for (const [id, name, country, continent, popular] of leagues) {
    await db.query(
      `INSERT IGNORE INTO leagues (api_league_id, name, country, continent, is_popular) VALUES (?, ?, ?, ?, ?)`,
      [id, name, country, continent, popular]
    );
  }

  // Seed intelligence weights
  const weights = [
    ['form_weight', 0.30, 'Weight for team form factor'],
    ['h2h_weight', 0.20, 'Weight for head-to-head factor'],
    ['odds_weight', 0.20, 'Weight for odds factor'],
    ['market_weight', 0.15, 'Weight for market type factor'],
    ['league_weight', 0.15, 'Weight for league tier factor'],
    ['home_advantage', 1.15, 'Home advantage multiplier for Poisson model'],
    ['poisson_k', 6, 'Max goals in Poisson score matrix'],
    ['learning_rate', 0.10, 'Bayesian learning weight from past outcomes'],
    ['min_confidence_publish', 72, 'Minimum intelligence score to save prediction'],
    ['auto_publish_threshold', 78, 'Score above which predictions are auto-published'],
  ];
  for (const [key, val, desc] of weights) {
    await db.query(
      `INSERT IGNORE INTO intelligence_weights (weight_key, weight_value, description) VALUES (?, ?, ?)`,
      [key, val, desc]
    );
  }

  // Seed site settings (social links + adsense)
  const settings = [
    'social_twitter', 'social_telegram', 'social_facebook',
    'social_reddit', 'social_whatsapp', 'adsense_client_id',
    'odds_api_calls_today', 'last_sync_fixtures', 'last_sync_results',
    'last_sync_live', 'last_intelligence_run',
  ];
  for (const key of settings) {
    await db.query(
      `INSERT IGNORE INTO site_settings (setting_key, setting_value) VALUES (?, '')`,
      [key]
    );
  }

  // Seed SEO settings
  const seoPages = ['home', 'predictions', 'statistics', 'blog', 'pricing', 'about', 'contact', 'terms', 'privacy'];
  const seoDefaults = {
    home: ['Predictvilla — Football Intelligence Predictions', 'Data-driven football predictions with an AI-powered Intelligence Engine. Free and VIP tips daily.', 'football predictions, free tips, VIP picks, banker of the day'],
    predictions: ['Football Predictions & Tips — Predictvilla', 'Browse today\'s free and VIP football predictions. Filter by league, market, or category.', 'football tips today, free predictions, over 2.5 tips'],
    statistics: ['Football Statistics & Analytics — Predictvilla', 'Front-tested football statistics: scoring averages, market reliability, and prediction track records.', 'football statistics, prediction accuracy, market analysis'],
    blog: ['Football Blog — Predictvilla', 'Football analysis, betting guides, and expert insights from the Predictvilla team.', 'football blog, betting tips, match analysis'],
    pricing: ['VIP Subscription — Predictvilla', 'Unlock VIP football tips, AI-powered picks, and access to the Telegram VIP channel.', 'VIP football tips, subscription, premium predictions'],
    about: ['About Predictvilla', 'Learn about Predictvilla\'s AI-powered football prediction platform.', 'about predictvilla, football prediction platform'],
    contact: ['Contact Predictvilla', 'Get in touch with the Predictvilla team.', 'contact predictvilla'],
    terms: ['Terms of Service — Predictvilla', 'Predictvilla terms of service and usage policy.', ''],
    privacy: ['Privacy Policy — Predictvilla', 'Predictvilla privacy policy and data handling practices.', ''],
  };
  for (const page of seoPages) {
    const [title, desc, keywords] = seoDefaults[page] || ['', '', ''];
    await db.query(
      `INSERT IGNORE INTO seo_settings (page_key, title, description, keywords) VALUES (?, ?, ?, ?)`,
      [page, title, desc, keywords]
    );
  }

  // Seed static pages
  const staticPages = [
    ['home', 'Home', '# Welcome to Predictvilla\n\nData-Driven Picks. Proven Results.'],
    ['about', 'About Us', '# About Predictvilla\n\nPredictvilla is a football predictions platform powered by a real-time data pipeline and an AI-driven Intelligence Engine targeting an 80–88% prediction win rate.\n\n## Our Mission\n\nWe combine Poisson statistical models, historical outcome learning, and live bookie odds to deliver the most accurate football tips on the internet.\n\n## The Intelligence Engine\n\nOur AI analyses form, H2H data, league statistics, and market odds to generate predictions with confidence scores. Only picks above our quality threshold are published.\n\n## Responsible Gambling\n\nPredictvilla tips are for entertainment only. Always gamble responsibly. If you need help, visit [BeGambleAware](https://www.begambleaware.org).'],
    ['terms', 'Terms of Service', '# Terms of Service\n\n*Last updated: 2025*\n\n## 1. Acceptance\n\nBy using Predictvilla, you agree to these terms.\n\n## 2. Nature of Service\n\nPredictvilla provides football prediction content for entertainment purposes only. We do not guarantee any financial outcomes.\n\n## 3. Subscriptions\n\nVIP subscriptions are billed via Paystack. You may cancel at any time.\n\n## 4. Responsible Gambling\n\nYou must be 18+ to use this service. Please gamble responsibly.'],
    ['privacy', 'Privacy Policy', '# Privacy Policy\n\n*Last updated: 2025*\n\n## Data We Collect\n\n- Email and name upon registration\n- Usage analytics (anonymised)\n- Payment references (via Paystack — we do not store card data)\n\n## How We Use Your Data\n\n- To provide and improve the service\n- To send relevant subscription and prediction emails\n\n## Your Rights\n\nYou may delete your account at any time from your dashboard.'],
    ['contact', 'Contact', '# Contact Us\n\nFor support or enquiries, email us at **support@predictvilla.com**.\n\nFor VIP and subscription issues, include your registered email address.'],
  ];
  for (const [slug, title, content] of staticPages) {
    await db.query(
      `INSERT IGNORE INTO static_pages (slug, title, content) VALUES (?, ?, ?)`,
      [slug, title, content]
    );
  }

  console.log('[Migrate] Seed data inserted');
  process.exitCode = 0;
}

migrate().then(() => {
  console.log('[Migrate] Done');
  process.exit(0);
}).catch(err => {
  console.error('[Migrate] Error:', err.message);
  process.exit(1);
});
