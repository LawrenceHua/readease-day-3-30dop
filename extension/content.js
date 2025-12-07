/**
 * ReadEase Content Script
 * v1.7 - Fixed padding, summary display, bullet points, and filter scoring
 */

(function() {
  'use strict';

  // ==========================================================================
  // BLOCKED DOMAINS
  // ==========================================================================
  const BLOCKED_DOMAINS = [
    'docs.google.com', 'mail.google.com', 'sheets.google.com', 'slides.google.com',
    'notion.so', 'figma.com', 'github.com', 'codepen.io', 'codesandbox.io', 'chrome://'
  ];

  const currentDomain = window.location.hostname;
  const isBlocked = BLOCKED_DOMAINS.some(d => currentDomain.includes(d));

  if (isBlocked) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      sendResponse({ isActive: false, blocked: true });
      return true;
    });
    return;
  }

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================
  const BIONIC_CLASS = 're-bionic';
  const ANCHOR_CLASS = 're-anchor';
  const FILTER_CLASS = 're-filtered';
  const DIMMED_CLASS = 're-dimmed';
  const READING_CLASS = 're-reading';
  const PANEL_ID = 're-panel';
  const FAB_ID = 're-fab';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'BUTTON', 'NAV', 'HEADER', 
    'FOOTER', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'IMG', 'A'
  ]);

  const SKIP_CLASSES = ['nav', 'menu', 'sidebar', 'footer', 'header', 'toolbar', 'btn', 'button', 're-panel', 're-fab'];

  const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'eg', 'ie', 'al', 'et']);

  // ==========================================================================
  // STATE
  // ==========================================================================
  let isActive = false;
  let currentSettings = { bionicEnabled: true, filterEnabled: false, filterStrength: 50 };
  let stats = { sentencesProcessed: 0, wordsProcessed: 0, blurredCount: 0 };
  const originalBionicContent = new Map();
  const originalFilterContent = new Map();
  let abortController = null;
  
  // TTS State
  let isSpeaking = false;
  let currentUtterance = null;
  let readingSentences = [];
  let currentSentenceIndex = 0;
  
  // Panel State
  let isPanelOpen = false;
  let panelElement = null;
  let fabElement = null;
  
  // Topic Analysis Cache
  let pageTopicData = null;

  // ==========================================================================
  // TOPIC EXTRACTION & RELEVANCE SCORING
  // ==========================================================================
  
  function analyzePageTopic() {
    if (pageTopicData) return pageTopicData;
    
    // Get title
    const title = document.title || '';
    
    // Get h1
    const h1 = document.querySelector('h1')?.textContent?.trim() || '';
    
    // Get all h2s
    const h2s = Array.from(document.querySelectorAll('h2'))
      .map(h => h.textContent?.trim() || '')
      .filter(t => t.length > 0)
      .slice(0, 5);
    
    // Get meta description
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    
    // Get first 3 paragraphs
    const firstPs = Array.from(document.querySelectorAll('article p, main p, .content p, p'))
      .slice(0, 3)
      .map(p => p.textContent?.trim() || '')
      .join(' ');
    
    // Combine all topic sources
    const topicText = `${title} ${title} ${h1} ${h1} ${h2s.join(' ')} ${metaDesc} ${firstPs}`.toLowerCase();
    
    // Stop words to filter out
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'would', 'could', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'people', 'into', 'year', 'your', 'some', 'them', 'than', 'then', 'look', 'only', 'come', 'over', 'such', 'with', 'this', 'that', 'from', 'they', 'will', 'more', 'also', 'very', 'after', 'most', 'made', 'being', 'well', 'back', 'through', 'where', 'much', 'should', 'these', 'other', 'each', 'those', 'first', 'said', 'many', 'before', 'between', 'must', 'under', 'three', 'write', 'read', 'click', 'here']);
    
    const words = topicText.split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
    
    // Count word frequency
    const wordFreq = {};
    words.forEach(w => {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    });
    
    // Get top 25 keywords by frequency
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([word]) => word);
    
    pageTopicData = {
      title: title.toLowerCase(),
      h1: h1.toLowerCase(),
      keywords: new Set(topKeywords),
      keywordList: topKeywords
    };
    
    console.log('ReadEase: Topic keywords:', topKeywords.slice(0, 10));
    return pageTopicData;
  }

  function scoreSentenceRelevance(sentence, isFirst = false, isLast = false) {
    const topic = analyzePageTopic();
    const lowerSentence = sentence.toLowerCase();
    const words = lowerSentence.split(/\W+/).filter(w => w.length > 2);
    
    let score = 20; // Base score (lowered from 35)
    
    // Keyword matches - MOST IMPORTANT
    let keywordMatches = 0;
    for (const word of words) {
      if (topic.keywords.has(word)) {
        keywordMatches++;
      }
    }
    // Each keyword match adds score (reduced from 15/45)
    score += Math.min(keywordMatches * 10, 30);
    
    // Filler patterns - penalize heavily
    const fillerPatterns = [
      /^(in this article|in this post|read on|click here|subscribe)/i,
      /^(as (we|you) (can see|know|mentioned))/i,
      /(share this|leave a comment|related posts|advertisement)/i,
      /^(let's|let us) (take a look|see|explore|dive)/i
    ];
    if (fillerPatterns.some(p => p.test(lowerSentence))) {
      score -= 20;
    }
    
    // Length scoring
    const wordCount = words.length;
    if (wordCount >= 10 && wordCount <= 30) {
      score += 5;
    } else if (wordCount < 6) {
      score -= 25; // Short sentences less relevant (was -20)
    } else if (wordCount > 50) {
      score -= 15; // Very long sentences (was -5 at 40)
    } else if (wordCount > 40) {
      score -= 5;
    }
    
    // Position bonus (reduced)
    if (isFirst) score += 15; // Was 25
    if (isLast) score += 10;  // Was 15
    
    // Signal words (reduced from 10)
    const signalWords = ['important', 'key', 'main', 'essential', 'conclusion', 'summary', 'result', 'therefore', 'however', 'significant', 'research', 'found', 'shows', 'demonstrates', 'according', 'finally', 'crucial', 'notably', 'specifically'];
    for (const signal of signalWords) {
      if (lowerSentence.includes(signal)) {
        score += 8;
        break;
      }
    }
    
    // Data/numbers
    if (/\d+%|\$\d+|\d+\.\d+|\b\d{4}\b/.test(sentence)) {
      score += 8;
    }
    
    // Questions
    if (sentence.includes('?')) {
      score += 5;
    }
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ==========================================================================
  // UTILITY FUNCTIONS
  // ==========================================================================
  
  function shouldSkipElement(element) {
    if (!element || !element.tagName) return true;
    if (SKIP_TAGS.has(element.tagName)) return true;
    if (element.id === PANEL_ID || element.id === FAB_ID) return true;
    if (element.closest(`#${PANEL_ID}`)) return true;
    const className = (element.className?.toString() || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    for (const skip of SKIP_CLASSES) {
      if (className.includes(skip) || id.includes(skip)) return true;
    }
    return false;
  }

  function segmentSentences(text) {
    let processed = text;
    ABBREVIATIONS.forEach(abbr => {
      const regex = new RegExp(`\\b(${abbr})\\.`, 'gi');
      processed = processed.replace(regex, '$1{{ABBR}}');
    });
    return processed.split(/(?<=[.!?])\s+/)
      .map(s => s.replace(/\{\{ABBR\}\}/g, '.').trim())
      .filter(s => s.length > 15);
  }

  function getBoldLength(wordLength) {
    if (wordLength <= 1) return 0;
    if (wordLength <= 3) return 1;
    if (wordLength <= 6) return 2;
    return Math.ceil(wordLength * 0.4);
  }

  function processWord(word) {
    if (word.length <= 1 || !/[a-zA-Z]/.test(word)) return word;
    
    let letterStart = 0;
    while (letterStart < word.length && !/[a-zA-Z]/.test(word[letterStart])) {
      letterStart++;
    }
    if (letterStart >= word.length) return word;
    
    const prefix = word.slice(0, letterStart);
    const rest = word.slice(letterStart);
    const boldLen = getBoldLength(rest.length);
    if (boldLen === 0) return word;
    
    return `${prefix}<b class="${ANCHOR_CLASS}">${rest.slice(0, boldLen)}</b>${rest.slice(boldLen)}`;
  }

  function processText(text) {
    return text.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part)) return part;
      return processWord(part);
    }).join('');
  }

  // ==========================================================================
  // BIONIC PROCESSING
  // ==========================================================================
  
  function applyBionicToElement(element) {
    if (shouldSkipElement(element)) return 0;
    
    let wordsProcessed = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${PANEL_ID}`)) return NodeFilter.FILTER_REJECT;
        if (parent.classList?.contains(ANCHOR_CLASS)) return NodeFilter.FILTER_REJECT;
        if (parent.classList?.contains(BIONIC_CLASS)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    
    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      if (!text.trim()) continue;
      
      wordsProcessed += text.split(/\s+/).filter(w => w.length > 0).length;
      
      const span = document.createElement('span');
      span.className = BIONIC_CLASS;
      span.innerHTML = processText(text);
      originalBionicContent.set(span, text);
      textNode.parentNode?.replaceChild(span, textNode);
    }
    
    return wordsProcessed;
  }

  async function applyBionic() {
    const paragraphs = document.querySelectorAll('p, li, td, th, dd, dt, blockquote');
    let totalWords = 0;
    
    for (let i = 0; i < paragraphs.length; i += 15) {
      if (abortController?.signal.aborted) return totalWords;
      
      const chunk = Array.from(paragraphs).slice(i, i + 15);
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          for (const el of chunk) {
            if (!shouldSkipElement(el) && !el.querySelector(`.${BIONIC_CLASS}`)) {
              totalWords += applyBionicToElement(el);
            }
          }
          resolve();
        });
      });
    }
    return totalWords;
  }

  function removeBionic() {
    document.querySelectorAll(`.${BIONIC_CLASS}`).forEach(span => {
      const original = originalBionicContent.get(span);
      const textNode = document.createTextNode(original || span.textContent || '');
      span.parentNode?.replaceChild(textNode, span);
    });
    originalBionicContent.clear();
  }

  // ==========================================================================
  // FOCUS FILTER - IMPROVED SCORING
  // ==========================================================================
  
  function applyFilterToElement(element, threshold) {
    if (shouldSkipElement(element)) return { total: 0, blurred: 0 };
    
    const text = element.textContent?.trim() || '';
    if (text.length < 40) return { total: 0, blurred: 0 };
    
    // Store original
    if (!originalFilterContent.has(element)) {
      originalFilterContent.set(element, element.innerHTML);
    }
    
    const sentences = segmentSentences(text);
    if (sentences.length === 0) return { total: 0, blurred: 0 };
    
    let html = originalFilterContent.get(element) || element.innerHTML;
    let blurredCount = 0;
    const totalSentences = sentences.length;
    
    sentences.forEach((sentence, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === totalSentences - 1;
      const score = scoreSentenceRelevance(sentence, isFirst, isLast);
      
      // Blur if score is below threshold
      if (score < threshold) {
        // Create a safe search pattern
        const searchText = sentence.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        if (html.includes(sentence.slice(0, 30)) && !html.includes(`class="${DIMMED_CLASS}"`)) {
          // Find the sentence and wrap it
          const idx = html.indexOf(sentence.slice(0, 30));
          if (idx !== -1) {
            // Find where this sentence ends
            let endIdx = idx;
            for (let i = idx; i < html.length; i++) {
              if (html[i] === '.' || html[i] === '!' || html[i] === '?') {
                endIdx = i + 1;
                break;
              }
              if (i - idx > sentence.length + 50) break;
              endIdx = i + 1;
            }
            
            const before = html.slice(0, idx);
            const match = html.slice(idx, endIdx);
            const after = html.slice(endIdx);
            
            // Only wrap if not already a tag
            if (!match.startsWith('<') && !before.endsWith('<')) {
              html = before + `<span class="${DIMMED_CLASS}" data-score="${score}">` + match + '</span>' + after;
              blurredCount++;
            }
          }
        }
      }
    });
    
    element.innerHTML = html;
    element.classList.add(FILTER_CLASS);
    
    return { total: totalSentences, blurred: blurredCount };
  }

  async function applyFilter(strength) {
    // Analyze topic first
    analyzePageTopic();
    
    // Clear existing
    removeFilter();
    
    const threshold = strength;
    const paragraphs = document.querySelectorAll('p, li, blockquote, article > div, .content > div, .post > div, .entry-content > *');
    let totalSentences = 0;
    let totalBlurred = 0;
    
    for (let i = 0; i < paragraphs.length; i += 8) {
      if (abortController?.signal.aborted) break;
      
      const chunk = Array.from(paragraphs).slice(i, i + 8);
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          for (const el of chunk) {
            if (!shouldSkipElement(el)) {
              const result = applyFilterToElement(el, threshold);
              totalSentences += result.total;
              totalBlurred += result.blurred;
            }
          }
          resolve();
        });
      });
    }
    
    console.log(`ReadEase: Blurred ${totalBlurred}/${totalSentences} sentences (threshold: ${threshold})`);
    return { sentences: totalSentences, blurred: totalBlurred };
  }

  function removeFilter() {
    document.querySelectorAll(`.${DIMMED_CLASS}`).forEach(span => {
      const text = span.textContent || '';
      const textNode = document.createTextNode(text);
      span.parentNode?.replaceChild(textNode, span);
    });
    
    document.querySelectorAll(`.${FILTER_CLASS}`).forEach(el => {
      const original = originalFilterContent.get(el);
      if (original) {
        el.innerHTML = original;
      }
      el.classList.remove(FILTER_CLASS);
    });
    
    originalFilterContent.clear();
  }

  // ==========================================================================
  // SUMMARIZATION - FIXED: Full summary, max 500 words
  // ==========================================================================
  
  function generateSummary() {
    const paragraphs = document.querySelectorAll('article p, main p, .content p, .post p, .entry-content p, p');
    const allText = [];
    
    paragraphs.forEach(p => {
      if (!shouldSkipElement(p)) {
        const text = p.textContent?.trim();
        if (text && text.length > 40) {
          allText.push(text);
        }
      }
    });
    
    const fullText = allText.join(' ');
    if (fullText.length < 100) {
      return { summary: 'Not enough content to summarize.', keyPoints: [] };
    }
    
    const sentences = segmentSentences(fullText);
    if (sentences.length < 3) {
      return { summary: sentences.join(' '), keyPoints: [] };
    }
    
    // Score all sentences with position
    const scored = sentences.map((sentence, idx) => ({
      text: sentence,
      score: scoreSentenceRelevance(sentence, idx === 0, idx === sentences.length - 1),
      index: idx
    }));
    
    // Get top sentences (more for longer content)
    const numTop = Math.min(7, Math.max(3, Math.ceil(sentences.length * 0.15)));
    const topSentences = [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, numTop)
      .sort((a, b) => a.index - b.index);
    
    let summary = topSentences.map(s => s.text).join(' ');
    
    // Limit to 500 words
    const words = summary.split(/\s+/);
    if (words.length > 500) {
      summary = words.slice(0, 500).join(' ') + '...';
    }
    
    // Get key points - top 3 highest scoring
    const keyPoints = [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => {
        // Don't truncate key points
        return s.text;
      });
    
    return { summary, keyPoints };
  }

  // ==========================================================================
  // TEXT-TO-SPEECH
  // ==========================================================================
  
  function getReadableSentences() {
    const paragraphs = document.querySelectorAll('article p, main p, .content p, .post p, p');
    const sentenceData = [];
    
    paragraphs.forEach((p) => {
      if (shouldSkipElement(p) || p.offsetParent === null) return;
      
      const text = p.textContent?.trim();
      if (!text || text.length < 20) return;
      
      const sentences = segmentSentences(text);
      
      sentences.forEach((sentence, idx) => {
        if (currentSettings.filterEnabled) {
          const score = scoreSentenceRelevance(sentence, idx === 0, idx === sentences.length - 1);
          if (score < currentSettings.filterStrength) return;
        }
        
        sentenceData.push({ text: sentence, paragraph: p });
      });
    });
    
    return sentenceData;
  }

  function highlightSentence(paragraph) {
    clearHighlights();
    paragraph.classList.add(READING_CLASS);
    paragraph.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearHighlights() {
    document.querySelectorAll(`.${READING_CLASS}`).forEach(el => {
      el.classList.remove(READING_CLASS);
    });
  }

  function startReading() {
    if (!('speechSynthesis' in window)) {
      return { success: false, error: 'TTS not supported' };
    }
    
    stopReading();
    readingSentences = getReadableSentences();
    
    if (readingSentences.length === 0) {
      return { success: false, error: 'No readable content' };
    }
    
    currentSentenceIndex = 0;
    isSpeaking = true;
    readNextSentence();
    updatePanelUI();
    
    return { success: true };
  }

  function readNextSentence() {
    if (!isSpeaking || currentSentenceIndex >= readingSentences.length) {
      stopReading();
      return;
    }
    
    const data = readingSentences[currentSentenceIndex];
    highlightSentence(data.paragraph);
    
    currentUtterance = new SpeechSynthesisUtterance(data.text);
    currentUtterance.rate = 1.0;
    
    currentUtterance.onend = () => {
      currentSentenceIndex++;
      setTimeout(readNextSentence, 150);
    };
    
    currentUtterance.onerror = () => {
      currentSentenceIndex++;
      readNextSentence();
    };
    
    window.speechSynthesis.speak(currentUtterance);
  }

  function stopReading() {
    window.speechSynthesis?.cancel();
    isSpeaking = false;
    currentUtterance = null;
    clearHighlights();
    readingSentences = [];
    currentSentenceIndex = 0;
    updatePanelUI();
  }

  // ==========================================================================
  // FLOATING PANEL UI
  // ==========================================================================
  
  function createFloatingPanel() {
    if (document.getElementById(PANEL_ID)) return;
    
    // FAB
    fabElement = document.createElement('div');
    fabElement.id = FAB_ID;
    fabElement.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
    fabElement.title = 'Open ReadEase';
    document.body.appendChild(fabElement);
    
    // Panel
    panelElement = document.createElement('div');
    panelElement.id = PANEL_ID;
    panelElement.className = 're-hidden';
    panelElement.innerHTML = getPanelHTML();
    document.body.appendChild(panelElement);
    
    addPanelStyles();
    bindPanelEvents();
    loadSettings();
  }
  
  function getPanelHTML() {
    return `
      <div class="re-header">
        <div class="re-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <span>ReadEase</span>
        </div>
        <button class="re-close" id="re-close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      
      <div class="re-body">
        <button class="re-main-btn" id="re-toggle">
          <span class="re-btn-icon">▶</span>
          <span class="re-btn-text">Start ReadEase</span>
        </button>
        
        <div class="re-section">
          <div class="re-section-title">Reading Modes</div>
          
          <label class="re-option">
            <div class="re-option-info">
              <span class="re-option-name">Smart Bolding</span>
              <span class="re-option-desc">Bold first letters of words</span>
            </div>
            <input type="checkbox" id="re-bionic" checked>
            <span class="re-toggle-switch"></span>
          </label>
          
          <label class="re-option">
            <div class="re-option-info">
              <span class="re-option-name">Focus Filter</span>
              <span class="re-option-desc">Blur less relevant sentences</span>
            </div>
            <input type="checkbox" id="re-filter">
            <span class="re-toggle-switch"></span>
          </label>
        </div>
        
        <div class="re-section re-slider-box" id="re-slider-box">
          <div class="re-slider-header">
            <span>Filter Intensity</span>
            <span class="re-slider-val" id="re-slider-val">30%</span>
          </div>
          <input type="range" class="re-slider" id="re-slider" min="10" max="95" value="50">
          <div class="re-slider-labels">
            <span>Less blur</span>
            <span>More blur</span>
          </div>
        </div>
        
        <div class="re-section">
          <div class="re-section-title">Actions</div>
          
          <div class="re-actions">
            <button class="re-action-btn" id="re-read">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              <span>Read Aloud</span>
            </button>
            <button class="re-action-btn re-stop-btn" id="re-stop-read" style="display:none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
              <span>Stop</span>
            </button>
            <button class="re-action-btn" id="re-summarize">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>Summarize</span>
            </button>
          </div>
        </div>
        
        <div class="re-section re-summary-section" id="re-summary-section" style="display:none;">
          <div class="re-section-title">Summary</div>
          <div class="re-summary" id="re-summary"></div>
          <div class="re-keypoints" id="re-keypoints"></div>
        </div>
        
        <div class="re-status" id="re-status">
          <span class="re-status-dot"></span>
          <span class="re-status-text">Ready</span>
        </div>
      </div>
    `;
  }
  
  function addPanelStyles() {
    if (document.getElementById('re-styles')) return;
    
    const style = document.createElement('style');
    style.id = 're-styles';
    style.textContent = `
      #${FAB_ID} {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: #18181b;
        color: #a1a1aa;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 24px rgba(0,0,0,0.25);
        z-index: 2147483646;
        transition: all 0.2s ease;
        border: 1px solid #27272a;
      }
      #${FAB_ID}:hover {
        background: #27272a;
        color: #fafafa;
        transform: translateY(-2px);
      }
      #${FAB_ID}.re-hidden { display: none; }
      
      #${PANEL_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        bottom: 16px;
        width: 320px;
        background: #09090b;
        color: #fafafa;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        border-radius: 16px;
        border: 1px solid #27272a;
        box-shadow: 0 8px 40px rgba(0,0,0,0.4);
        display: flex;
        flex-direction: column;
        transition: transform 0.25s ease, opacity 0.25s ease;
        overflow: hidden;
      }
      #${PANEL_ID}.re-hidden {
        transform: translateX(calc(100% + 32px));
        opacity: 0;
        pointer-events: none;
      }
      #${PANEL_ID} * { box-sizing: border-box; margin: 0; padding: 0; }
      
      .re-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 28px;
        border-bottom: 1px solid #27272a;
        background: #0a0a0b;
      }
      .re-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 600;
        font-size: 15px;
        color: #fafafa;
      }
      .re-brand svg { color: #22c55e; }
      .re-close {
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        color: #71717a;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .re-close:hover { background: #27272a; color: #fafafa; }
      
      .re-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px 28px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .re-body::-webkit-scrollbar { width: 6px; }
      .re-body::-webkit-scrollbar-track { background: transparent; }
      .re-body::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
      
      .re-main-btn {
        width: 100%;
        padding: 16px 24px;
        border: none;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: all 0.2s;
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        color: white;
      }
      .re-main-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
      .re-main-btn.re-active {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      }
      .re-btn-icon { font-size: 12px; }
      
      .re-section { display: flex; flex-direction: column; gap: 12px; }
      .re-section-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #71717a;
      }
      
      .re-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: #18181b;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.15s;
        border: 1px solid transparent;
      }
      .re-option:hover { background: #1f1f23; }
      .re-option-info { display: flex; flex-direction: column; gap: 2px; }
      .re-option-name { font-weight: 500; color: #fafafa; font-size: 13px; }
      .re-option-desc { font-size: 11px; color: #71717a; }
      .re-option input { display: none; }
      .re-toggle-switch {
        width: 44px;
        height: 24px;
        background: #27272a;
        border-radius: 12px;
        position: relative;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .re-toggle-switch::after {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        background: #71717a;
        border-radius: 50%;
        transition: all 0.2s;
      }
      .re-option input:checked + .re-toggle-switch { background: #22c55e; }
      .re-option input:checked + .re-toggle-switch::after {
        left: 23px;
        background: white;
      }
      
      .re-slider-box {
        background: #18181b;
        border-radius: 10px;
        padding: 16px;
        display: none;
      }
      .re-slider-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 14px;
        font-size: 12px;
      }
      .re-slider-val { color: #a78bfa; font-weight: 600; }
      .re-slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: #27272a;
        outline: none;
        -webkit-appearance: none;
      }
      .re-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #a78bfa;
        cursor: pointer;
        border: 2px solid #09090b;
      }
      .re-slider-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #52525b;
        margin-top: 10px;
      }
      
      .re-actions { display: flex; gap: 10px; }
      .re-action-btn {
        flex: 1;
        padding: 12px 14px;
        border: none;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: #18181b;
        color: #a1a1aa;
        transition: all 0.15s;
        border: 1px solid #27272a;
      }
      .re-action-btn:hover { background: #27272a; color: #fafafa; }
      .re-action-btn.re-stop-btn { background: #7f1d1d; color: #fca5a5; border-color: #991b1b; }
      .re-action-btn.re-stop-btn:hover { background: #991b1b; }
      .re-action-btn.re-loading { opacity: 0.6; cursor: wait; }
      
      .re-summary-section { 
        background: #18181b; 
        border-radius: 10px; 
        padding: 16px;
      }
      .re-summary {
        font-size: 13px;
        line-height: 1.7;
        color: #d4d4d8;
        margin-top: 12px;
        max-height: 300px;
        overflow-y: auto;
      }
      .re-summary::-webkit-scrollbar { width: 4px; }
      .re-summary::-webkit-scrollbar-track { background: transparent; }
      .re-summary::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
      
      .re-keypoints {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #27272a;
      }
      .re-keypoints ul {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .re-keypoints li {
        font-size: 12px;
        line-height: 1.5;
        color: #a1a1aa;
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }
      .re-keypoints li::before {
        content: '•';
        color: #a78bfa;
        font-weight: bold;
        flex-shrink: 0;
      }
      
      .re-status {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background: #18181b;
        border-radius: 10px;
        margin-top: auto;
      }
      .re-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #71717a;
        flex-shrink: 0;
      }
      .re-status-dot.re-active { background: #22c55e; animation: re-pulse 2s infinite; }
      .re-status-text { font-size: 12px; color: #71717a; }
      
      @keyframes re-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);
  }
  
  function bindPanelEvents() {
    fabElement.addEventListener('click', openPanel);
    document.getElementById('re-close').addEventListener('click', closePanel);
    
    // Main toggle
    document.getElementById('re-toggle').addEventListener('click', async () => {
      if (isActive) {
        isActive = false;
        removeModes();
      } else {
        saveSettings();
        isActive = true;
        await applyModes();
      }
      updatePanelUI();
    });
    
    // Bionic toggle
    document.getElementById('re-bionic').addEventListener('change', async (e) => {
      currentSettings.bionicEnabled = e.target.checked;
      saveSettings();
      if (isActive) {
        removeBionic();
        if (currentSettings.bionicEnabled) {
          stats.wordsProcessed = await applyBionic();
        }
        updatePanelUI();
      }
    });
    
    // Filter toggle
    document.getElementById('re-filter').addEventListener('change', async (e) => {
      currentSettings.filterEnabled = e.target.checked;
      document.getElementById('re-slider-box').style.display = e.target.checked ? 'block' : 'none';
      saveSettings();
      if (isActive) {
        if (currentSettings.filterEnabled) {
          if (currentSettings.bionicEnabled) removeBionic();
          const result = await applyFilter(currentSettings.filterStrength);
          stats.sentencesProcessed = result.sentences;
          stats.blurredCount = result.blurred;
          if (currentSettings.bionicEnabled) stats.wordsProcessed = await applyBionic();
        } else {
          removeFilter();
          stats.blurredCount = 0;
        }
        updatePanelUI();
      }
    });
    
    // Slider
    let sliderDebounce = null;
    document.getElementById('re-slider').addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('re-slider-val').textContent = `${val}%`;
      
      clearTimeout(sliderDebounce);
      sliderDebounce = setTimeout(async () => {
        currentSettings.filterStrength = parseInt(val);
        saveSettings();
        
        if (isActive && currentSettings.filterEnabled) {
          if (currentSettings.bionicEnabled) removeBionic();
          const result = await applyFilter(currentSettings.filterStrength);
          stats.sentencesProcessed = result.sentences;
          stats.blurredCount = result.blurred;
          if (currentSettings.bionicEnabled) stats.wordsProcessed = await applyBionic();
          updatePanelUI();
        }
      }, 80);
    });
    
    // Read aloud
    document.getElementById('re-read').addEventListener('click', () => {
      startReading();
    });
    
    document.getElementById('re-stop-read').addEventListener('click', () => {
      stopReading();
    });
    
    // Summarize
    document.getElementById('re-summarize').addEventListener('click', () => {
      const btn = document.getElementById('re-summarize');
      btn.classList.add('re-loading');
      
      setTimeout(() => {
        const result = generateSummary();
        btn.classList.remove('re-loading');
        
        document.getElementById('re-summary-section').style.display = 'block';
        document.getElementById('re-summary').textContent = result.summary;
        
        if (result.keyPoints.length > 0) {
          document.getElementById('re-keypoints').innerHTML = `
            <ul>${result.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
          `;
        } else {
          document.getElementById('re-keypoints').innerHTML = '';
        }
      }, 50);
    });
  }
  
  function openPanel() {
    panelElement.classList.remove('re-hidden');
    fabElement.classList.add('re-hidden');
    isPanelOpen = true;
    updatePanelUI();
  }
  
  function closePanel() {
    panelElement.classList.add('re-hidden');
    fabElement.classList.remove('re-hidden');
    isPanelOpen = false;
  }
  
  function updatePanelUI() {
    if (!panelElement) return;
    
    const toggleBtn = document.getElementById('re-toggle');
    const statusDot = panelElement.querySelector('.re-status-dot');
    const statusText = panelElement.querySelector('.re-status-text');
    const readBtn = document.getElementById('re-read');
    const stopBtn = document.getElementById('re-stop-read');
    
    if (isActive) {
      toggleBtn.classList.add('re-active');
      toggleBtn.querySelector('.re-btn-icon').textContent = '⏹';
      toggleBtn.querySelector('.re-btn-text').textContent = 'Stop ReadEase';
      statusDot.classList.add('re-active');
      let statusStr = `Active • ${stats.wordsProcessed} words`;
      if (stats.blurredCount > 0) {
        statusStr += ` • ${stats.blurredCount} blurred`;
      }
      statusText.textContent = statusStr;
    } else {
      toggleBtn.classList.remove('re-active');
      toggleBtn.querySelector('.re-btn-icon').textContent = '▶';
      toggleBtn.querySelector('.re-btn-text').textContent = 'Start ReadEase';
      statusDot.classList.remove('re-active');
      statusText.textContent = 'Ready';
    }
    
    if (isSpeaking) {
      readBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
    } else {
      readBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
    }
  }
  
  function saveSettings() {
    chrome.storage.local.set({ readease_settings: currentSettings });
  }
  
  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(['readease_settings']);
      if (stored.readease_settings) {
        currentSettings = { ...currentSettings, ...stored.readease_settings };
        
        document.getElementById('re-bionic').checked = currentSettings.bionicEnabled;
        document.getElementById('re-filter').checked = currentSettings.filterEnabled;
        document.getElementById('re-slider').value = currentSettings.filterStrength;
        document.getElementById('re-slider-val').textContent = `${currentSettings.filterStrength}%`;
        document.getElementById('re-slider-box').style.display = currentSettings.filterEnabled ? 'block' : 'none';
      }
    } catch (e) {
      console.log('ReadEase: Settings load error');
    }
  }

  // ==========================================================================
  // MAIN FUNCTIONS
  // ==========================================================================
  
  async function applyModes() {
    abortController = new AbortController();
    stats = { sentencesProcessed: 0, wordsProcessed: 0, blurredCount: 0 };
    pageTopicData = null;
    
    analyzePageTopic();
    
    if (currentSettings.filterEnabled) {
      const result = await applyFilter(currentSettings.filterStrength);
      stats.sentencesProcessed = result.sentences;
      stats.blurredCount = result.blurred;
    }
    
    if (currentSettings.bionicEnabled) {
      stats.wordsProcessed = await applyBionic();
    }
    
    updatePanelUI();
  }

  function removeModes() {
    abortController?.abort();
    abortController = null;
    stopReading();
    removeBionic();
    removeFilter();
    stats = { sentencesProcessed: 0, wordsProcessed: 0, blurredCount: 0 };
    pageTopicData = null;
    updatePanelUI();
  }

  function getState() {
    return { isActive, settings: currentSettings, stats, blocked: false, isSpeaking, isPanelOpen };
  }

  // ==========================================================================
  // MESSAGE HANDLER
  // ==========================================================================
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'TOGGLE_PANEL':
            isPanelOpen ? closePanel() : openPanel();
            sendResponse(getState());
            break;
          case 'GET_STATUS':
            sendResponse(getState());
            break;
          case 'START':
            if (message.payload) currentSettings = message.payload;
            isActive = true;
            await applyModes();
            sendResponse(getState());
            break;
          case 'STOP':
            isActive = false;
            removeModes();
            sendResponse(getState());
            break;
          default:
            sendResponse(getState());
        }
      } catch (e) {
        sendResponse({ ...getState(), error: String(e) });
      }
    })();
    return true;
  });

  // ==========================================================================
  // INIT
  // ==========================================================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingPanel);
  } else {
    createFloatingPanel();
  }
  
  console.log('ReadEase v1.8 loaded');
})();
