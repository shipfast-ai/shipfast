/**
 * ShipFast Ambiguity Detector — Domain-Aware Questioning
 *
 * Zero-LLM-cost detection with domain-specific question templates.
 * 6 domains × 3-4 questions each = 20+ targeted templates.
 * Supports: --batch (group questions), --chain (auto-run next steps),
 *           --assume (auto-resolve from brain.db patterns).
 */

const brain = require('../brain/index.cjs');

// --- Domain detection (zero cost — keyword matching) ---

const DOMAIN_PATTERNS = {
  ui:       /\b(style|css|theme|layout|component|page|form|button|modal|sidebar|navbar|card|table|grid|responsive|mobile|dark.?mode|animation|icon|tooltip|dropdown|menu|tab|dialog|toast|avatar|badge)\b/i,
  api:      /\b(api|endpoint|route|handler|middleware|webhook|rest|graphql|trpc|server|request|response|cors|rate.?limit|pagination|filter|sort)\b/i,
  database: /\b(database|migration|schema|model|query|table|column|index|relation|foreign.?key|orm|prisma|drizzle|typeorm|knex|seed|fixture)\b/i,
  auth:     /\b(auth|login|signup|password|permission|role|token|session|oauth|jwt|2fa|mfa|rbac|acl|api.?key|refresh.?token|logout|register)\b/i,
  content:  /\b(docs|readme|blog|content|text|copy|email|notification|template|markdown|i18n|translation|locale|message|toast|alert)\b/i,
  infra:    /\b(deploy|ci|cd|docker|k8s|kubernetes|pipeline|monitoring|logging|terraform|aws|gcp|vercel|netlify|nginx|ssl|domain|dns|env)\b/i
};

function detectDomains(input) {
  const domains = [];
  for (const [domain, pattern] of Object.entries(DOMAIN_PATTERNS)) {
    if (pattern.test(input)) domains.push(domain);
  }
  return domains.length > 0 ? domains : ['general'];
}

// --- Domain-specific question templates ---

const DOMAIN_QUESTIONS = {
  ui: {
    HOW: [
      { q: 'Layout density?', options: ['Compact (data-dense)', 'Comfortable (balanced)', 'Spacious (content-focused)'] },
      { q: 'Interaction pattern?', options: ['Inline editing', 'Modal dialogs', 'Page navigation', 'Drawer panels'] },
      { q: 'Empty state behavior?', options: ['Show placeholder', 'Show onboarding CTA', 'Hide section entirely'] },
      { q: 'Responsive approach?', options: ['Mobile-first', 'Desktop-first', 'Adaptive (separate layouts)'] }
    ],
    WHERE: [{ q: 'Which page/route should this appear on?', format: 'free_text' }],
    RISK: [{ q: 'Does this change affect existing UI that users rely on?', options: ['Yes — needs gradual rollout', 'No — new addition', 'Unsure'] }]
  },
  api: {
    HOW: [
      { q: 'Response format?', options: ['JSON REST', 'GraphQL', 'tRPC', 'JSON-RPC'] },
      { q: 'Error handling pattern?', options: ['HTTP status codes + error body', 'Always 200 with error field', 'Problem Details (RFC 7807)'] },
      { q: 'Auth mechanism for this endpoint?', options: ['Bearer token', 'API key header', 'Session cookie', 'Public (no auth)'] },
      { q: 'Versioning strategy?', options: ['URL path (/v1/)', 'Header (Accept-Version)', 'No versioning'] }
    ],
    WHERE: [{ q: 'Which endpoint prefix? (e.g., /api/v1/users)', format: 'free_text' }],
    RISK: [{ q: 'Is this a public-facing API or internal only?', options: ['Public (external clients)', 'Internal (between services)', 'Both'] }]
  },
  database: {
    HOW: [
      { q: 'ORM or raw SQL?', options: ['Prisma', 'Drizzle', 'TypeORM', 'Knex', 'Raw SQL', 'Match existing'] },
      { q: 'Migration strategy?', options: ['Auto-generate from schema', 'Manual migration files', 'Schema push (no migrations)'] },
      { q: 'Data access pattern?', options: ['Repository pattern', 'Direct ORM calls', 'Data Access Layer (DAL)', 'Match existing'] }
    ],
    WHERE: [{ q: 'Which table/model does this affect?', format: 'free_text' }],
    RISK: [{ q: 'Will this require a data migration? Is there existing production data?', options: ['Yes — existing data needs migration', 'No — new table/field only', 'Unsure — need to check'] }]
  },
  auth: {
    HOW: [
      { q: 'Auth approach?', options: ['JWT (stateless)', 'Session cookies (stateful)', 'OAuth2 (delegated)', 'API keys (simple)'] },
      { q: 'Where to store tokens?', options: ['httpOnly cookie', 'localStorage', 'Memory only', 'Secure cookie + CSRF token'] },
      { q: 'Role model?', options: ['Simple roles (admin/user)', 'RBAC (role-based)', 'ABAC (attribute-based)', 'No roles needed'] }
    ],
    WHERE: [{ q: 'Which part of the auth flow? (login, signup, token refresh, permissions)', format: 'free_text' }],
    RISK: [{ q: 'Does this change affect existing user sessions? Will logged-in users be affected?', options: ['Yes — existing sessions impacted', 'No — new flow only', 'Need to check'] }]
  },
  content: {
    HOW: [
      { q: 'Content format?', options: ['Markdown', 'Rich text (WYSIWYG)', 'Structured JSON', 'Plain text'] },
      { q: 'Tone?', options: ['Technical/precise', 'Casual/friendly', 'Formal/enterprise', 'Match existing'] },
      { q: 'i18n needed?', options: ['English only', 'Multi-language from start', 'i18n-ready (extract later)'] }
    ],
    WHERE: [{ q: 'Where does this content appear? (page, email, notification, docs)', format: 'free_text' }],
    RISK: [{ q: 'Does this replace existing content that users reference?', options: ['Yes — update existing', 'No — new content', 'Supplement existing'] }]
  },
  infra: {
    HOW: [
      { q: 'Deploy target?', options: ['Vercel/Netlify', 'AWS/GCP', 'Docker + VPS', 'Self-hosted', 'Match existing'] },
      { q: 'CI/CD pipeline?', options: ['GitHub Actions', 'GitLab CI', 'CircleCI', 'None (manual deploy)', 'Match existing'] }
    ],
    WHERE: [{ q: 'Which environment? (dev, staging, production)', format: 'free_text' }],
    RISK: [{ q: 'Does this affect production infrastructure?', options: ['Yes — production change', 'No — dev/staging only', 'New environment'] }]
  },
  general: {
    HOW: [{ q: 'Which approach do you prefer?', format: 'free_text', hint: 'There are multiple ways to implement this.' }],
    WHERE: [{ q: 'Where should this change be made?', format: 'free_text', hint: 'Mention specific files, components, or areas.' }],
    RISK: [{ q: 'This touches a sensitive area. Please confirm the scope.', options: ['Proceed — I understand the risk', 'Let me narrow the scope first'] }]
  }
};

// --- Ambiguity detection rules ---

const AMBIGUITY_RULES = {
  WHERE: {
    description: 'Location ambiguity — unclear which files/components to change',
    detect: (input) => {
      const hasFilePath = /[\w./\\-]+\.(ts|tsx|js|jsx|rs|py|go|css|html|json)\b/.test(input);
      const hasComponent = /\b[A-Z][a-z]+[A-Z]\w+\b/.test(input);
      const hasSpecificLocation = /\b(in|at|inside|within)\s+(the\s+)?\w+/.test(input);
      return !hasFilePath && !hasComponent && !hasSpecificLocation;
    }
  },
  WHAT: {
    description: 'Behavior ambiguity — unclear what the expected behavior should be',
    detect: (input) => {
      const hasBehavior = /\b(should|must|will|returns?|displays?|shows?|renders?|outputs?|sends?|creates?|stores?)\b/i.test(input);
      const hasCondition = /\b(when|if|unless|after|before|while)\b/i.test(input);
      const isVague = input.split(/\s+/).length < 8;
      return !hasBehavior && !hasCondition && isVague;
    }
  },
  HOW: {
    description: 'Approach ambiguity — multiple valid approaches exist',
    detect: (input) => {
      const hasAlternatives = /\b(or|either|maybe|could|might|possibly|option)\b/i.test(input);
      const isGenericFeature = /\b(add|implement|create|build)\s+(a\s+)?(new\s+)?(auth|cache|search|notification|logging|payment|real.?time|api|database|form|page|dashboard)/i.test(input);
      return hasAlternatives || isGenericFeature;
    }
  },
  RISK: {
    description: 'Risk ambiguity — touches sensitive areas that need confirmation',
    detect: (input) => {
      return /\b(auth|login|password|permission|role|token|session|payment|billing|charge|refund|database|migration|schema|delete|drop|remove|destroy|production|deploy)\b/i.test(input);
    }
  },
  SCOPE: {
    description: 'Scope ambiguity — request is broad or contains multiple features',
    detect: (input) => {
      const words = input.split(/\s+/).length;
      const conjunctions = (input.match(/\b(and|also|plus|with|then|additionally)\b/gi) || []).length;
      return words > 30 && conjunctions >= 2;
    }
  }
};

// --- Core detection ---

function detectAmbiguity(input, context = {}) {
  if (!input || typeof input !== 'string') return [];
  const domains = detectDomains(input);
  const ambiguities = [];

  for (const [type, rule] of Object.entries(AMBIGUITY_RULES)) {
    if (rule.detect(input, context)) {
      // Pick the best domain-specific question for this ambiguity type
      const domainQ = pickDomainQuestion(type, domains);
      ambiguities.push({
        type,
        description: rule.description,
        domains,
        ...domainQ
      });
    }
  }

  return ambiguities;
}

/**
 * Pick the most relevant domain-specific question for an ambiguity type.
 * Checks each detected domain's templates, picks the first match.
 */
function pickDomainQuestion(ambiguityType, domains) {
  for (const domain of domains) {
    const templates = DOMAIN_QUESTIONS[domain];
    if (templates && templates[ambiguityType] && templates[ambiguityType].length > 0) {
      const t = templates[ambiguityType][0];
      return {
        question: t.q,
        options: t.options || null,
        hint: t.hint || null,
        format: t.options ? 'multiple_choice' : (t.format || 'free_text'),
        domain,
        allDomainQuestions: templates[ambiguityType]
      };
    }
  }
  // Fallback to general
  const gen = DOMAIN_QUESTIONS.general[ambiguityType];
  if (gen && gen.length > 0) {
    const t = gen[0];
    return { question: t.q, options: t.options || null, hint: t.hint || null, format: t.options ? 'multiple_choice' : 'free_text', domain: 'general' };
  }
  return { question: 'Please clarify this aspect.', format: 'free_text', domain: 'general' };
}

/**
 * Get ALL domain questions for batch mode.
 * Returns up to 4 questions (AskUserQuestion limit) from detected domains.
 */
function getBatchQuestions(input) {
  const domains = detectDomains(input);
  const questions = [];

  for (const [type, rule] of Object.entries(AMBIGUITY_RULES)) {
    if (!rule.detect(input)) continue;
    for (const domain of domains) {
      const templates = DOMAIN_QUESTIONS[domain];
      if (!templates || !templates[type]) continue;
      for (const t of templates[type]) {
        if (questions.length >= 8) break; // Max 2 batches of 4
        questions.push({ type, domain, question: t.q, options: t.options, format: t.options ? 'multiple_choice' : 'free_text', hint: t.hint });
      }
    }
  }

  return questions;
}

// --- Follow-up depth ---

/**
 * Score an answer to determine if follow-up is needed.
 * Returns 0-1. Below 0.5 triggers a follow-up question.
 */
function scoreAnswer(answer, format) {
  if (!answer || answer.trim().length === 0) return 0;
  const lower = answer.toLowerCase().trim();

  // "I don't know" variants
  if (/^(idk|not sure|unsure|don'?t know|no idea|skip|none|n\/a)$/i.test(lower)) return 0;

  // Multiple choice selection → sufficient
  if (format === 'multiple_choice') return 1.0;

  // Very short free text → may need follow-up
  if (lower.split(/\s+/).length < 3) return 0.5;

  // Decent answer
  return 1.0;
}

/**
 * Generate a follow-up question for a low-scoring answer.
 */
function generateFollowUp(type, domain, previousAnswer) {
  const followUps = {
    WHERE: `You mentioned "${previousAnswer}". Can you be more specific — which file or directory?`,
    WHAT: `You said "${previousAnswer}". What should the user see/experience when this is done?`,
    HOW: `You picked "${previousAnswer}". Any specific library, pattern, or example to follow?`,
    RISK: `Can you confirm: will this affect production data or just development?`,
    SCOPE: `Which part should we tackle first?`
  };
  return followUps[type] || `Can you elaborate on "${previousAnswer}"?`;
}

// --- Existing functions (updated) ---

function ambiguityScore(input, context = {}) {
  const ambiguities = detectAmbiguity(input, context);
  return ambiguities.length / Object.keys(AMBIGUITY_RULES).length;
}

function filterAlreadyAnswered(cwd, ambiguities) {
  const decisions = brain.getDecisions(cwd);
  return ambiguities.filter(a => {
    const matching = decisions.find(d => d.tags && d.tags.includes(a.type));
    return !matching;
  });
}

function lockDecision(cwd, ambiguityType, question, answer, phase, domain) {
  brain.addDecision(cwd, {
    question,
    decision: answer,
    reasoning: 'User-provided via discussion',
    phase: phase || 'discuss',
    tags: [ambiguityType, domain || 'general'].join(',')
  });
}

function shouldDiscuss(input, complexity, context = {}) {
  if (!input) return false;
  if (complexity === 'trivial') return false;
  if (complexity === 'complex') return true;
  return ambiguityScore(input, context) > 0.4;
}

function buildDiscussionPrompt(input, ambiguities, brainContext) {
  const parts = [];
  const domains = detectDomains(input);

  parts.push(`The user wants to: ${input}`);
  parts.push(`Detected domains: ${domains.join(', ')}\n`);

  if (brainContext) {
    parts.push(`<context>\n${brainContext}\n</context>\n`);
  }

  parts.push('Before planning, clarify these ambiguities:\n');

  for (const a of ambiguities) {
    parts.push(`**${a.type}** (${a.domain}): ${a.description}`);
    parts.push(`Question: ${a.question}`);
    if (a.options) parts.push(`Options: ${a.options.join(' | ')}`);
    if (a.hint) parts.push(`Hint: ${a.hint}`);
    if (a.allDomainQuestions && a.allDomainQuestions.length > 1) {
      parts.push(`Additional questions for this domain:`);
      for (const q of a.allDomainQuestions.slice(1)) {
        parts.push(`  - ${q.q}${q.options ? ' [' + q.options.join(', ') + ']' : ''}`);
      }
    }
    parts.push('');
  }

  parts.push('Ask domain-specific questions. Use multiple choice where possible.');
  parts.push('If an answer is vague (<3 words), ask ONE follow-up for specifics.');
  parts.push('Max 2 follow-up rounds per ambiguity. Then lock the decision.');

  return parts.join('\n');
}

function autoResolveAmbiguity(cwd, ambiguities, taskInput) {
  const resolved = [];

  for (const a of ambiguities) {
    let decision = null;
    let confidence = 0;
    let reasoning = '';

    switch (a.type) {
      case 'WHERE': {
        const keywords = taskInput.split(/\s+/).filter(w => w.length > 3);
        for (const kw of keywords) {
          const matches = brain.query(cwd,
            `SELECT file_path, name FROM nodes WHERE kind = 'file' AND (name LIKE '%${brain.esc(kw)}%' OR file_path LIKE '%${brain.esc(kw)}%') LIMIT 5`
          );
          if (matches.length > 0) {
            decision = matches.map(m => m.file_path).join(', ');
            confidence = matches.length === 1 ? 0.8 : 0.6;
            reasoning = 'Matched ' + matches.length + ' file(s) by keyword "' + kw + '"';
            break;
          }
        }
        if (!decision) { confidence = 0.2; reasoning = 'No matching files found in brain.db'; }
        break;
      }
      case 'HOW': {
        const pastDecisions = brain.getDecisions(cwd);
        const howDecision = pastDecisions.find(d => d.tags && d.tags.includes('HOW'));
        if (howDecision) {
          decision = howDecision.decision;
          confidence = 0.7;
          reasoning = 'Reusing previous HOW decision: ' + howDecision.question;
        } else {
          const words = taskInput.toLowerCase().split(/\s+/);
          const domains = Object.keys(DOMAIN_PATTERNS);
          const domain = domains.find(d => words.includes(d));
          if (domain) {
            const learnings = brain.findLearnings(cwd, domain, 1);
            if (learnings.length > 0) {
              decision = 'Follow existing pattern: ' + learnings[0].pattern;
              confidence = learnings[0].confidence;
              reasoning = 'Based on learning with confidence ' + learnings[0].confidence;
            }
          }
          if (!decision) { confidence = 0.3; reasoning = 'No prior decisions or learnings found'; }
        }
        break;
      }
      case 'WHAT': {
        decision = 'Inferred from task description';
        confidence = 0.6;
        reasoning = 'Task description used as behavior spec';
        break;
      }
      case 'RISK': {
        const fs = require('fs');
        const path = require('path');
        const isDevEnv = fs.existsSync(path.join(cwd, '.env.local'))
          || fs.existsSync(path.join(cwd, '.env.development'));
        if (isDevEnv) {
          decision = 'Confirmed — development environment detected';
          confidence = 0.7;
          reasoning = '.env.local or .env.development found';
        } else {
          confidence = 0.3;
          reasoning = 'No dev environment indicators — needs user confirmation';
        }
        break;
      }
      case 'SCOPE': {
        decision = 'Tackle all at once';
        confidence = 0.5;
        reasoning = 'Default: single pass unless complexity warrants phasing';
        break;
      }
    }

    resolved.push({ type: a.type, question: a.question, decision: decision || 'Could not auto-resolve', confidence, reasoning });
  }

  return resolved;
}

module.exports = {
  detectDomains,
  detectAmbiguity,
  ambiguityScore,
  filterAlreadyAnswered,
  lockDecision,
  shouldDiscuss,
  buildDiscussionPrompt,
  autoResolveAmbiguity,
  getBatchQuestions,
  scoreAnswer,
  generateFollowUp,
  AMBIGUITY_RULES,
  DOMAIN_QUESTIONS,
  DOMAIN_PATTERNS
};
