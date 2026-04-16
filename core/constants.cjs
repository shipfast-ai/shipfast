/**
 * ShipFast Shared Constants
 *
 * Single source of truth for all magic numbers, thresholds, and defaults.
 * Import this instead of hardcoding values.
 */

'use strict';

module.exports = {
  // Database
  DB_NAME: '.shipfast/brain.db',

  // Confidence thresholds for learnings
  CONFIDENCE: {
    HIGH: 0.8,
    MEDIUM: 0.5,
    LOW: 0.3
  },

  // Token budget absolute thresholds
  BUDGET: {
    CRITICAL: 2000,
    WARNING: 5000,
    COMFORTABLE: 15000
  },

  // Token budget percentage thresholds
  BUDGET_PCT: {
    EMERGENCY: 20,
    LOW: 40,
    OK: 60
  },

  // Timeouts
  BUILD_TIMEOUT_MS: 60000,

  // Query limits
  MAX_LEARNINGS: 5,
  MAX_BLAST_RADIUS: 30,
  MAX_HOT_FILES: 50,
  MAX_CONTEXT_DECISIONS: 5,

  // File extensions for source code searches
  SOURCE_EXTENSIONS: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.rs', '*.py'],
  GREP_INCLUDES: ['--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '--include=*.rs', '--include=*.py'],

  // Default model tiers per agent
  DEFAULT_MODEL: {
    scout: 'haiku',
    architect: 'sonnet',
    builder: 'sonnet',
    critic: 'haiku',
    scribe: 'haiku'
  },

  // Cost multipliers (relative to haiku = 1x)
  MODEL_COST: {
    haiku: 1,
    sonnet: 5,
    opus: 25
  }
};
