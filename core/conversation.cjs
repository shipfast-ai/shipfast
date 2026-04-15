/**
 * ShipFast Conversation Compression (P5)
 *
 * Multi-turn conversations reload full context each turn.
 * GSD: 3 follow-ups = 3x context loading = ~15K tokens wasted.
 *
 * ShipFast compresses conversation state between turns into brain.db.
 * Next turn loads compressed state (~500 tokens) instead of full transcript (~5K).
 */

const brain = require('../brain/index.cjs');

/**
 * Compress a conversation history into essential state.
 * Keeps: user requests, decisions, errors, final outcomes.
 * Drops: exploration, thinking, rejected approaches.
 */
function compressHistory(messages) {
  return messages
    .filter(m => {
      if (m.role === 'user') return true;
      if (m.type === 'error' || (m.content && m.content.includes('Error'))) return true;
      if (m.type === 'decision') return true;
      if (m.type === 'result' || m.type === 'complete') return true;
      return false;
    })
    .map(m => ({
      role: m.role,
      content: (m.content || '').slice(0, 300),
      type: m.type
    }));
}

/**
 * Save compressed conversation state to brain.db
 */
function saveConversationState(cwd, sessionId, state) {
  const compressed = {
    messages: compressHistory(state.messages || []),
    currentPhase: state.currentPhase,
    completedTasks: (state.completedTasks || []).map(t => t.id),
    pendingTasks: (state.pendingTasks || []).map(t => ({
      id: t.id,
      desc: t.description.slice(0, 100)
    })),
    decisionsThisSession: state.decisions || [],
    lastAction: state.lastAction,
    timestamp: Date.now()
  };

  brain.setContext(cwd, 'session', 'conversation:' + sessionId, compressed);
}

/**
 * Load compressed conversation state from brain.db.
 * Returns ~500 tokens of context instead of ~5K transcript.
 */
function loadConversationState(cwd, sessionId) {
  return brain.getContext(cwd, 'session', 'conversation:' + sessionId);
}

/**
 * Build a continuation prompt from compressed state.
 * This replaces loading the full message history.
 */
function buildContinuationPrompt(state) {
  if (!state) return '';

  const parts = [];

  if (state.messages && state.messages.length) {
    parts.push('<prior_conversation>');
    for (const m of state.messages.slice(-5)) {
      parts.push('[' + m.role + ']: ' + m.content);
    }
    parts.push('</prior_conversation>');
  }

  if (state.completedTasks && state.completedTasks.length) {
    parts.push('<completed>' + state.completedTasks.join(', ') + '</completed>');
  }

  if (state.pendingTasks && state.pendingTasks.length) {
    parts.push('<pending>' + state.pendingTasks.map(t =>
      t.id + ': ' + t.desc
    ).join('\n') + '</pending>');
  }

  if (state.decisionsThisSession && state.decisionsThisSession.length) {
    parts.push('<session_decisions>' + state.decisionsThisSession.map(d =>
      d.q + ' -> ' + d.a
    ).join('\n') + '</session_decisions>');
  }

  return parts.join('\n');
}

/**
 * Extract decisions from an agent response for future context.
 */
function extractDecisions(responseText) {
  const decisions = [];
  const patterns = [
    /(?:decided|choosing|going with|using|picked|selected)\s+(\w[\w\s-]*\w)\s+(?:for|because|since|as)/gi,
    /(?:will|should)\s+use\s+(\w[\w\s-]*\w)\s+(?:for|to|instead)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      decisions.push({
        decision: match[1].trim(),
        context: responseText.slice(
          Math.max(0, match.index - 50),
          match.index + match[0].length + 50
        ).trim()
      });
    }
  }

  return decisions;
}

module.exports = {
  compressHistory,
  saveConversationState,
  loadConversationState,
  buildContinuationPrompt,
  extractDecisions
};
