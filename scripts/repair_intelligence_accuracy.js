const { pool } = require('../config/db');
const { recalculateStats } = require('../services/accuracy');

// Removes accuracy records created from raw fixtures and restores falsely graded TBD rows.
async function repairIntelligenceAccuracy() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [invalidRows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM prediction_accuracy_log pal
       JOIN predictions p ON p.id = pal.prediction_id
       WHERE p.published_at IS NULL
          OR p.confidence_score IS NULL
          OR p.tip IS NULL
          OR TRIM(p.tip) = ''
          OR UPPER(TRIM(p.tip)) = 'TBD'`
    );

    const [deletedLogs] = await connection.query(
      `DELETE pal FROM prediction_accuracy_log pal
       JOIN predictions p ON p.id = pal.prediction_id
       WHERE p.published_at IS NULL
          OR p.confidence_score IS NULL
          OR p.tip IS NULL
          OR TRIM(p.tip) = ''
          OR UPPER(TRIM(p.tip)) = 'TBD'`
    );

    const [deletedOutcomes] = await connection.query(
      `DELETE io FROM intelligence_outcomes io
       JOIN predictions p ON p.id = io.prediction_id
       WHERE p.published_at IS NULL
          OR p.confidence_score IS NULL
          OR p.tip IS NULL
          OR TRIM(p.tip) = ''
          OR UPPER(TRIM(p.tip)) = 'TBD'`
    );

    const [resetFixtures] = await connection.query(
      `UPDATE predictions
       SET result = 'pending'
       WHERE published_at IS NULL
         AND UPPER(TRIM(COALESCE(tip, 'TBD'))) = 'TBD'
         AND result IN ('won', 'lost')`
    );

    await connection.commit();
    const stats = await recalculateStats();
    console.log(JSON.stringify({
      invalidFound: Number(invalidRows[0]?.count || 0),
      accuracyLogsDeleted: deletedLogs.affectedRows,
      intelligenceOutcomesDeleted: deletedOutcomes.affectedRows,
      fixturesReset: resetFixtures.affectedRows,
      stats,
    }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

repairIntelligenceAccuracy().catch(error => {
  console.error('[repair-intelligence-accuracy]', error.message);
  process.exitCode = 1;
});
