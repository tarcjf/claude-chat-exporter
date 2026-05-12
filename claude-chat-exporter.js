function setupClaudeExporter() {
  // DOM Selectors - only used for the title fallback when the API has none
  const SELECTORS = {
    conversationTitle: '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate'
  };

  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // Format ISO timestamp to readable format
  function formatTimestamp(isoString) {
    if (!isoString) return null;
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  // Fetch the full conversation tree from Claude's internal API. This is the
  // single source of truth - no DOM scraping, so virtualized/scrolled-away
  // messages are still captured.
  async function fetchConversationData() {
    const conversationId = window.location.pathname.split('/').pop();
    const orgId = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];

    if (!conversationId || !orgId) {
      throw new Error('Could not get conversation/org ID from URL or cookies');
    }

    const url = `/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;

    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  }

  // Extract printable text from a message's content blocks. Each block has a
  // `type`; for `text` blocks `block.text` is the model's raw markdown. Other
  // known types (tool_use, tool_result, thinking) are rendered as fenced
  // sections so the export stays a complete record. Unknown types are flagged
  // rather than silently dropped.
  function extractContent(blocks) {
    if (!Array.isArray(blocks)) return '';
    const parts = [];
    for (const block of blocks) {
      const type = block?.type;
      if (type === 'text' || typeof block?.text === 'string') {
        parts.push(block.text ?? '');
      } else if (type === 'thinking') {
        const thought = block.thinking ?? block.text ?? '';
        if (thought) parts.push(`<details><summary>Thinking</summary>\n\n${thought}\n\n</details>`);
      } else if (type === 'tool_use') {
        const name = block.name ?? 'tool';
        const input = JSON.stringify(block.input ?? {}, null, 2);
        parts.push(`\`\`\`tool_use:${name}\n${input}\n\`\`\``);
      } else if (type === 'tool_result') {
        const content = Array.isArray(block.content)
          ? block.content.map(c => c?.text ?? '').join('')
          : (block.content ?? '');
        parts.push(`\`\`\`tool_result\n${content}\n\`\`\``);
      } else if (type) {
        parts.push(`<!-- unsupported content block: type=${type} -->`);
      }
    }
    return parts.join('\n\n').trim();
  }

  function sanitizeTitle(raw) {
    if (!raw) return null;
    const t = raw.trim()
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .substring(0, 100);
    return t || null;
  }

  function getConversationTitle(data) {
    // Prefer API title
    if (data?.name && data.name.trim() && data.name.trim() !== 'New conversation') {
      const t = sanitizeTitle(data.name);
      if (t) return t;
    }
    // Fallback to DOM
    const dom = document.querySelector(SELECTORS.conversationTitle)?.textContent;
    if (dom && !dom.includes('New conversation') && dom.trim() !== 'Claude') {
      const t = sanitizeTitle(dom);
      if (t) return t;
    }
    return 'claude_conversation';
  }

  function buildMarkdown(data) {
    let markdown = '# Conversation with Claude\n\n';
    let humanCount = 0;
    let claudeCount = 0;

    for (const msg of data?.chat_messages ?? []) {
      const text = extractContent(msg.content);
      if (!text) continue;

      const ts = formatTimestamp(msg.created_at);

      if (msg.sender === 'human') {
        const header = ts ? `## Human (${ts}):` : `## Human:`;
        markdown += `${header}\n\n${text}\n\n---\n\n`;
        humanCount++;
      } else if (msg.sender === 'assistant') {
        const header = ts ? `## Claude (${ts}):` : `## Claude:`;
        markdown += `${header}\n\n${text}\n\n---\n\n`;
        claudeCount++;
      }
    }

    return { markdown, humanCount, claudeCount };
  }

  // Create status indicator
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 10000;
    background: #2196F3; color: white; padding: 10px 15px;
    border-radius: 5px; font-family: monospace; font-size: 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3); max-width: 300px;
  `;
  document.body.appendChild(statusDiv);

  async function startExport() {
    try {
      statusDiv.textContent = 'Fetching conversation...';
      const data = await fetchConversationData();

      statusDiv.textContent = 'Building markdown...';
      const { markdown, humanCount, claudeCount } = buildMarkdown(data);

      if (humanCount === 0 && claudeCount === 0) {
        throw new Error('No messages found in API response');
      }

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const prefix = `Claude_Web_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}_`;
      const filename = `${prefix}${getConversationTitle(data)}.md`;
      downloadMarkdown(markdown, filename);

      statusDiv.textContent = `✅ ${humanCount}H/${claudeCount}C → ${filename}`;
      statusDiv.style.background = '#4CAF50';
      console.log(`🎉 Export complete: ${humanCount} human, ${claudeCount} claude messages → ${filename}`);
    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.style.background = '#f44336';
      console.error('Export failed:', error);
    } finally {
      setTimeout(() => statusDiv.remove(), 4000);
    }
  }

  startExport();
}

// Run the exporter
setupClaudeExporter();
