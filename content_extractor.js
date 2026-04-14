// content_extractor.js - Injected into social media pages on demand
// Extracts post text content from the current page

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    const result = extractPageContent();
    sendResponse(result);
    return false;
  }
});

function extractPageContent() {
  const host = window.location.hostname;

  let text = '';
  let platform = 'unknown';

  if (host.includes('instagram.com')) {
    text = extractInstagram();
    platform = 'Instagram';
  } else if (host.includes('facebook.com')) {
    text = extractFacebook();
    platform = 'Facebook';
  } else if (host.includes('youtube.com')) {
    text = extractYouTube();
    platform = 'YouTube';
  } else if (host.includes('tiktok.com')) {
    text = extractTikTok();
    platform = 'TikTok';
  } else if (host.includes('twitter.com') || host.includes('x.com')) {
    text = extractTwitter();
    platform = 'Twitter/X';
  } else if (host.includes('threads.net')) {
    text = extractThreads();
    platform = 'Threads';
  } else {
    // Generic fallback: grab visible text from main content areas
    text = extractGeneric();
    platform = host;
  }

  // Clean up the text
  text = cleanText(text);

  return {
    platform,
    text,
    url: window.location.href,
    title: document.title,
    hasContent: text.length > 10,
  };
}

// ─── Platform-specific extractors ─────────────────────────────────────────────

function extractInstagram() {
  const parts = [];

  // Post caption / description (on a post page)
  const captions = document.querySelectorAll('article h1, article ._aacl, [data-testid="post-comment-root"] span, ._a9zs span');
  captions.forEach(el => parts.push(el.textContent));

  // Alt text on images (often contains description)
  const images = document.querySelectorAll('article img[alt]');
  images.forEach(img => {
    const alt = img.getAttribute('alt');
    if (alt && alt.length > 20) parts.push(alt);
  });

  // Reel / story text
  const storyText = document.querySelectorAll('[role="dialog"] span, .x1lliihq span');
  storyText.forEach(el => parts.push(el.textContent));

  return parts.join('\n');
}

function extractFacebook() {
  const seen = new Set();
  const parts = [];

  function addText(text) {
    const t = text.trim();
    if (t.length < 5 || seen.has(t)) return;
    seen.add(t);
    parts.push(t);
  }

  // 一般貼文、廣告貼文
  for (const sel of [
    '[data-ad-preview="message"]',
    '[data-testid="post_message"]',
    '[data-ad-comet-preview="message"]',
  ]) {
    document.querySelectorAll(sel).forEach(el => addText(el.textContent));
  }

  // 群組貼文 / 新版 FB 佈局：div[dir="auto"] 含實際文字
  // 過濾掉超短的 UI 標籤，只取真正的貼文段落
  document.querySelectorAll('div[dir="auto"]').forEach(el => {
    // 排除子元素也是 div[dir="auto"] 的容器（只要葉節點）
    if (el.querySelector('div[dir="auto"]')) return;
    const t = el.textContent.trim();
    if (t.length >= 10) addText(t);
  });

  // blockquote 內的文字（分享/引用貼文）
  document.querySelectorAll('blockquote span[dir="auto"]').forEach(el => addText(el.textContent));

  return parts.join('\n');
}

function extractYouTube() {
  const parts = [];

  // Video title
  const title = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.style-scope.ytd-watch-metadata');
  if (title) parts.push(title.textContent);

  // Description (expanded)
  const desc = document.querySelector(
    '#description-inline-expander, #description yt-attributed-string, ytd-expander #content'
  );
  if (desc) parts.push(desc.textContent);

  // Comments mentioning places (optional, first few)
  const comments = document.querySelectorAll('ytd-comment-renderer #content-text');
  Array.from(comments).slice(0, 5).forEach(el => parts.push(el.textContent));

  return parts.join('\n');
}

function extractTikTok() {
  const parts = [];

  // Video caption
  const captions = document.querySelectorAll(
    '[data-e2e="browse-video-desc"], [data-e2e="video-desc"], h1[data-e2e="browse-video-desc"]'
  );
  captions.forEach(el => parts.push(el.textContent));

  // Pinned comments or structured data
  const structuredDesc = document.querySelector('meta[name="description"]');
  if (structuredDesc) parts.push(structuredDesc.getAttribute('content'));

  return parts.join('\n');
}

function extractTwitter() {
  const parts = [];

  // Tweet text
  const tweets = document.querySelectorAll('[data-testid="tweetText"], [data-testid="tweet"] div[lang]');
  tweets.forEach(el => parts.push(el.textContent));

  return parts.join('\n');
}

function extractThreads() {
  const parts = [];

  // Threads post text
  const posts = document.querySelectorAll('article span, [data-pressable-container] span');
  posts.forEach(el => {
    const text = el.textContent.trim();
    if (text.length > 5) parts.push(text);
  });

  return parts.join('\n');
}

function extractGeneric() {
  // Try common content containers
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.entry-content',
    '#content',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim().length > 50) {
      return el.textContent;
    }
  }

  // Last resort: body text
  return document.body.innerText || '';
}

// ─── Text cleanup ─────────────────────────────────────────────────────────────

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')          // collapse whitespace
    .replace(/[\r\n]{3,}/g, '\n\n') // max 2 newlines
    .trim()
    .slice(0, 5000);                // limit length
}
