// chat.js — 실시간 채팅 UI

(function () {
  let initialized = false;

  async function initChat() {
    if (initialized) return;
    initialized = true;

    const result = await window.electronAPI.chatConnect();
    if (!result.success) {
      document.getElementById('chat-messages').innerHTML =
        `<p class="empty-message">채팅 서버 연결 실패: ${result.error}</p>`;
      return;
    }

    window.electronAPI.onChatHistory((messages) => {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      messages.forEach(appendMessage);
      scrollToBottom();
    });

    window.electronAPI.onChatMessage((msg) => {
      appendMessage(msg);
      scrollToBottom();
    });

    window.electronAPI.onChatSystem((text) => {
      const container = document.getElementById('chat-messages');
      const el = document.createElement('p');
      el.className = 'chat-system-msg';
      el.textContent = text;
      container.appendChild(el);
      scrollToBottom();
    });

    window.electronAPI.onChatOnline((users) => {
      const el = document.getElementById('chat-online-list');
      el.innerHTML = users.map(u => `<span class="chat-online-user">${escapeHtml(String(u))}</span>`).join('');
      document.getElementById('chat-online-count').textContent = users.length;
    });
  }

  function appendMessage(msg) {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-message';
    const time = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    const hasTranslation = msg.translatedContent && msg.translatedContent !== msg.content;
    const contentHtml = hasTranslation
      ? `<p class="chat-content">${escapeHtml(msg.translatedContent)}</p>
         <p class="chat-original" style="display:none">${escapeHtml(msg.content)}</p>
         <span class="chat-toggle-original">원문 보기</span>`
      : `<p class="chat-content">${escapeHtml(msg.content)}</p>`;

    el.innerHTML = `
      <span class="chat-alliance">[${escapeHtml(msg.allianceName ?? '')}]</span>
      <span class="chat-nickname">${escapeHtml(msg.nickname ?? '')}</span>
      <span class="chat-time">${time}</span>
      ${contentHtml}
    `;

    if (hasTranslation) {
      const toggle = el.querySelector('.chat-toggle-original');
      const original = el.querySelector('.chat-original');
      toggle.addEventListener('click', () => {
        const isShowing = original.style.display !== 'none';
        original.style.display = isShowing ? 'none' : 'block';
        toggle.textContent = isShowing ? '원문 보기' : '번역 보기';
      });
    }

    container.appendChild(el);
  }

  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setupSendButton() {
    const btn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');

    async function sendMessage() {
      const content = input.value.trim();
      if (!content) return;
      input.value = '';
      await window.electronAPI.chatSend(content);
    }

    btn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  // 채팅 탭 클릭 시 초기화
  document.addEventListener('DOMContentLoaded', () => {
    setupSendButton();
    const chatTabBtn = document.querySelector('[data-tab="chat"]');
    if (chatTabBtn) {
      chatTabBtn.addEventListener('click', initChat);
    }
  });
})();
