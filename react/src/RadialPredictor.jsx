import React, { useState, useEffect, useMemo, useRef } from "react";
import { Shuffle, ArrowLeft, ArrowRight } from 'lucide-react';

// Small inline Spacebar SVG icon (from user-provided snippet)
const SpacebarIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} fill={"currentColor"} viewBox="0 0 24 24" {...props}>
    {/* Boxicons v3.0 https://boxicons.com | License  https://docs.boxicons.com/free */}
    <path d="m18,13H6v-4h-2v5c0,.55.45,1,1,1h14c.55,0,1-.45,1-1v-5h-2v4Z"></path>
  </svg>
);

// Try to dynamically load CoreUI CIcon and the cisSpaceBar icon at runtime.
// (Previously supported CoreUI dynamic loading — removed in favor of inline SVG)

// Backend base URL (assumes predict_server.py runs on localhost:8000)
// Prefer Vite env var (import.meta.env.VITE_PREDICTOR_URL). Access import.meta inside a try/catch
// so that environments where import.meta isn't available won't throw.
let BACKEND_BASE = '';
try {
  BACKEND_BASE = (import.meta && import.meta.env && import.meta.env.VITE_PREDICTOR_URL) || '';
} catch (e) {
  BACKEND_BASE = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_PREDICTOR_URL) || '';
}
// Final fallback for dev if still empty
if (!BACKEND_BASE) {
  BACKEND_BASE = 'http://127.0.0.1:8000';
}
// Normalize
BACKEND_BASE = BACKEND_BASE.replace(/\/$/, '');
if (typeof window !== 'undefined') {
  console.debug('[RadialPredictor] BACKEND_BASE =', BACKEND_BASE);
}

function backendUrl(path) {
  if (BACKEND_BASE) return `${BACKEND_BASE.replace(/\/$/, '')}${path}`;
  return path; // relative to same origin
}

// Numpad positions: center cell is input, surround with 8 positions like a phone numpad
// Grid cell ordering for a 3x3 layout (indexes 0..8). Center is index 4.
function getGridOrder() {
  // map prediction index -> grid cell index (skip center)
  // We'll place predictions into these grid cell indices in order:
  return [0, 1, 2, 3, /* center(4) */ 5, 6, 7, 8];
}

function scaleSizes(counts, minSize = 40, maxSize = 90) {
  if (!counts || counts.length === 0) return [];
  const vals = counts.map(([, c]) => c);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return counts.map(() => (minSize + maxSize) / 2);
  return vals.map((v) => {
    const t = (v - min) / (max - min);
    return Math.round(minSize + t * (maxSize - minSize));
  });
}

// Letter variants mapping for accent characters
const LETTER_VARIANTS = {
  'a': ['á', 'à', 'â', 'ä', 'ã', 'å', 'æ'],
  'e': ['é', 'è', 'ê', 'ë', 'ē', 'ė', 'ę'],
  'i': ['í', 'ì', 'î', 'ï', 'ī', 'į', 'ı'],
  'o': ['ó', 'ò', 'ô', 'ö', 'õ', 'ø', 'œ'],
  'u': ['ú', 'ù', 'û', 'ü', 'ū', 'ů', 'ų'],
  'n': ['ñ', 'ń', 'ň', 'ņ'],
  'c': ['ç', 'ć', 'č', 'ĉ'],
  's': ['ş', 'ś', 'š', 'ŝ'],
  'z': ['ž', 'ź', 'ż', 'ẑ'],
  'l': ['ł', 'ĺ', 'ľ', 'ļ'],
  'r': ['ř', 'ŕ', 'ŗ'],
  'd': ['đ', 'ď', 'ḑ'],
  'g': ['ğ', 'ģ', 'ġ'],
  'h': ['ħ', 'ĥ'],
  'j': ['ĵ'],
  'k': ['ķ', 'ĸ'],
  'p': ['þ'],
  't': ['ţ', 'ť', 'ŧ'],
  'w': ['ŵ'],
  'y': ['ý', 'ÿ', 'ŷ']
};

export default function RadialPredictor() {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewValue, setPreviewValue] = useState("");
  const [previewSel, setPreviewSel] = useState([0, 0]); // [start, end]
  const [predictions, setPredictions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [letterBi, setLetterBi] = useState(null);
  const [letterTri, setLetterTri] = useState(null);
  const [wordBi, setWordBi] = useState(null);
  const [wordTri, setWordTri] = useState(null);
  const [wordVocab, setWordVocab] = useState(new Set());
  const [wordFreq, setWordFreq] = useState({});

  // Letter variant holding state
  const [letterHoldActive, setLetterHoldActive] = useState(false);
  const [heldLetter, setHeldLetter] = useState('');
  const [heldLetterButton, setHeldLetterButton] = useState(null); // button element reference
  const [variantHover, setVariantHover] = useState(''); // which variant is being hovered

  // Lightweight fallbacks when server is unreachable or returns no suggestions
  const COMMON_LETTERS = ['e','t','a','o','i','n','s','r'];
  const COMMON_WORDS = ['the','to','and','of','a','in','is','it'];

  useEffect(() => {
    // Do not preload large JSON into the client. The frontend will query the prediction server.
    setLetterBi({});
    setLetterTri({});
    setWordBi({});
    setWordTri({});
    // Keep input focused so caret is always visible
    try { setTimeout(() => { inputRef.current && inputRef.current.focus(); }, 50); } catch (e) {}
  }, []);

  // Build a simple vocabulary and frequency map from word bigram/trigram data for prefix completions
  useEffect(() => {
    try {
      const freq = {};
      const vocab = new Set();
      const addWord = (w, c = 0) => {
        if (!w) return;
        vocab.add(w);
        freq[w] = (freq[w] || 0) + (Number(c) || 0);
      };
      if (wordBi) {
        Object.entries(wordBi).forEach(([k, arr]) => {
          // Compute candidates and page/present predictions. We produce a longer candidates list and then slice by pageOffset.
          try {
            if (input.trim() === "") {
              let starterLetters = [];
              if (letterBi && letterBi[' ']) {
                starterLetters = (letterBi[' '] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
              } else {
                const counts = {};
                Object.values(letterBi || {}).forEach((arr) => {
                  (arr || []).forEach((p) => {
                    const ch = Array.isArray(p) ? String(p[0]) : String(p);
                    const c = Array.isArray(p) ? Number(p[1] || 0) : 0;
                    counts[ch] = (counts[ch] || 0) + c;
                  });
                });
                starterLetters = Object.entries(counts).map(([k, v]) => [k, v]).sort((a, b) => b[1] - a[1]);
      setInput(out); // Do not add a space if it ends with a space
              }
            }
          } catch (err) {
            console.error('Vocab build error', err);
            setWordVocab(new Set());
            setWordFreq({});
          } // Closing the inner try block
        }); // Closing Object.entries loop
      } // Closing if (wordBi) block
    } catch (err) {
      console.error('Vocab build error', err);
      setWordVocab(new Set());
      setWordFreq({});
    } // Closing outer try block
  }, [wordBi, wordTri]); // Closing useEffect block

  useEffect(() => {
    try {
      if (!letterBi) return;
      let allCandidates = [];
      const maxTotal = 8;

      if (input.trim() === "") {
        let starterLetters = [];
        const lb = letterBi || {};
        if (lb[' ']) {
          starterLetters = (lb[' '] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
        } else {
          const counts = {};
          Object.values(lb || {}).forEach((arr) => {
            (arr || []).forEach((p) => {
              const ch = Array.isArray(p) ? String(p[0]) : String(p);
              const c = Array.isArray(p) ? Number(p[1] || 0) : 0;
              counts[ch] = (counts[ch] || 0) + c;
            });
          });
          starterLetters = Object.entries(counts).map(([k, v]) => [k, v]).sort((a, b) => b[1] - a[1]);
        }
        // Fallback common letters if starterLetters empty
        if (!starterLetters || starterLetters.length === 0) {
          const common = ['e','t','a','o','i','n','s','r'];
          starterLetters = common.map((ch, i) => [ch, 100 - i]);
        }
        allCandidates = starterLetters.slice(0, 8);
      } else {
        // Handle non-empty input
        const trimmed = input.trim();
        const lastChar = trimmed.slice(-1);
        const lastTwo = trimmed.slice(-2);
        
        // Get letter suggestions
        let letterSuggestions = [];
        if (letterTri && letterTri[lastTwo]) {
          letterSuggestions = (letterTri[lastTwo] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
        } else if (letterBi && letterBi[lastChar]) {
          letterSuggestions = (letterBi[lastChar] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
        }
        console.log("Letter suggestions:", letterSuggestions);
        
        // Get word completions if input ends with space
        let wordSuggestions = [];
        if (trimmed.endsWith(' ') && wordBi) {
          const prefix = trimmed.slice(0, -1).split(' ').pop() || '';
          console.log("Prefix for word suggestions:", prefix);
          if (wordBi[prefix]) {
            wordSuggestions = (wordBi[prefix] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            console.log("Word suggestions:", wordSuggestions);
            // Take up to 4 word suggestions when space is pressed
            wordSuggestions = wordSuggestions.slice(0, 4);
          } else {
            console.log("No wordBi entry for prefix:", prefix);
          }
        } else if (wordBi) {
          // For non-space input, show max 2 word suggestions only if highly probable
          const prefix = trimmed.split(' ').pop() || '';
          if (wordBi[prefix]) {
            wordSuggestions = (wordBi[prefix] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            // Filter to highly probable (e.g., count > 10) and take up to 2
            wordSuggestions = wordSuggestions.filter(([_, count]) => count > 10).slice(0, 2);
          }
        }
        
        // Combine: words first, then letters, up to 8 total
        allCandidates = [...wordSuggestions, ...letterSuggestions].slice(0, 8);
      }

      const seen = new Map();
      for (const [tok, cnt] of allCandidates) {
        const key = String(tok);
        if (!seen.has(key) || (seen.get(key) || 0) < (cnt || 0)) {
          seen.set(key, cnt || 0);
        }
      }
      const finalCandidates = Array.from(seen.entries()).map(([k, v]) => [k, v]);
      // Ensure space is always an option
      if (!seen.has(" ")) {
        finalCandidates.unshift([" ", 1]);
      }
      const slicedCandidates = finalCandidates.slice(0, 128);

      console.log("Final candidates:", slicedCandidates);
      setCandidates(slicedCandidates);
      setPageOffset(0);
      applyPredictions(slicedCandidates.slice(0, maxTotal));
    } catch (err) {
      console.error('Prediction error', err);
      setCandidates([]);
      applyPredictions([]);
    }
  }, [input, letterBi, letterTri, wordBi, wordTri, wordVocab, wordFreq]);

  useEffect(() => {
    const maxTotal = 8;
    if (!candidates || candidates.length === 0) {
      console.log("Candidates are empty:", candidates);
      applyPredictions([]);
      return;
    }
    console.log("Paged candidates:", candidates.slice(pageOffset, pageOffset + maxTotal));
    applyPredictions(candidates.slice(pageOffset, pageOffset + maxTotal));
  }, [pageOffset, candidates]);

  function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Track recently shown tokens to avoid repeating them immediately on shuffle
  const recentlyShownRef = useRef([]);
  const lastServerSuggestionsRef = useRef([]); // raw array of strings from backend
  const lastServerSourceRef = useRef('');
  function applyPredictions(newPreds) {
    // Update recently shown tokens immediately to avoid repeats
    try {
      const tokens = (newPreds || []).map((p) => String(p[0]));
      recentlyShownRef.current = [...recentlyShownRef.current, ...tokens].slice(-128);
    } catch (e) {
      // ignore
    }

    // If no gridRef available, just set predictions immediately
    if (!gridRef || !gridRef.current) {
      setPredictions(newPreds);
      return;
    }

    // Cancel any in-flight update
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    // Wait a tiny amount before swapping the predictions to reduce instant flicker.
    // This makes quick successive updates feel smoother without heavy animation.
    transitionTimeoutRef.current = setTimeout(() => {
      setPredictions(newPreds);
      // After React renders the new DOM, check what's under the cursor and preview it.
      try {
        requestAnimationFrame(() => {
          try {
            const mp = mousePosRef.current || { x: 0, y: 0 };
            const el = document.elementFromPoint(mp.x, mp.y);
            if (el && el.getAttribute) {
              const tokenAttr = el.getAttribute('data-token') || (el.closest && el.closest('[data-token]') && el.closest('[data-token]').getAttribute('data-token')) || null;
              if (tokenAttr) {
                if (hoverShowTimeoutRef.current) { clearTimeout(hoverShowTimeoutRef.current); hoverShowTimeoutRef.current = null; }
                  handleHoverPreview(tokenAttr, { highlight: false });
              }
            }
          } catch (e) {}
        });
      } catch (e) {}
      transitionTimeoutRef.current = null;
    }, 20);
  }

  // When user hovers a suggestion, compute a preview value and selection range
  function computePreviewForToken(token) {
    const cur = input || '';
    if (!token) return { preview: cur, selStart: cur.length, selEnd: cur.length };
    // Space token
    if (token === ' ') {
      const preview = cur + ' ';
      return { preview, selStart: cur.length, selEnd: cur.length + 1 };
    }
    const isWord = token.length > 1 || token.includes(' ');
    if (!isWord) {
      // single char append
      const preview = cur + token;
      return { preview, selStart: cur.length, selEnd: cur.length + 1 };
    }
    // Word token
    if (/\s$/.test(cur)) {
      // if current ends with space, append word + space
      const preview = cur + token + ' ';
      return { preview, selStart: cur.length + token.length, selEnd: cur.length + token.length + 1 };
    }
    // Replace last token if it looks like a prefix
    const parts = cur.split(' ');
    const last = parts[parts.length - 1] || '';
    if (last && token.toLowerCase().startsWith(last.toLowerCase())) {
      const prefixStart = cur.lastIndexOf(last);
      const preview = parts.slice(0, -1).concat([token + ' ']).join(' ');
      // find first index where preview and cur differ
      let start = 0;
      while (start < cur.length && start < preview.length && cur[start] === preview[start]) start++;
      return { preview, selStart: start, selEnd: preview.length };
    }
    // Otherwise append with space
    const preview = (cur === '' || /\s$/.test(cur)) ? cur + token + ' ' : cur + ' ' + token + ' ';
    const selStart = preview.length - 1; // highlight trailing space
    return { preview, selStart, selEnd: preview.length };
  }

  function handleHoverPreview(token, opts = { highlight: true }) {
    try {
      const { preview, selStart, selEnd } = computePreviewForToken(token);
      setPreviewValue(preview);
      setPreviewSel([selStart, selEnd]);
      setPreviewActive(true);
      // Focus and set selection in the input element after React updates the DOM
      setTimeout(() => {
        try {
          if (inputRef.current) {
            // Ensure DOM update has occurred and then set selection/scroll
            requestAnimationFrame(() => {
              try {
                inputRef.current.focus();
                // If requested, highlight the appended portion; otherwise place caret at end
                if (opts && opts.highlight === false) {
                  inputRef.current.setSelectionRange(selEnd, selEnd);
                } else {
                  inputRef.current.setSelectionRange(selStart, selEnd);
                }
                // Ensure the input scrolls to show the caret / rightmost text only when content overflows
                try {
                  const sw = inputRef.current.scrollWidth || 0;
                  const cw = inputRef.current.clientWidth || 0;
                  if (sw > cw) {
                    inputRef.current.scrollLeft = Math.max(0, sw - cw);
                    // Also align text to the right while previewing so the most recent chars are visible
                    try { inputRef.current.style.textAlign = 'right'; } catch (e) {}
                  } else {
                    try { inputRef.current.style.textAlign = ''; } catch (e) {}
                  }
                } catch (e) {}
              } catch (e) {}
            });
          }
        } catch (e) {}
      }, 0);
    } catch (e) {
      // noop
    }
  }

  function clearHoverPreview() {
    setPreviewActive(false);
    setPreviewValue('');
    setPreviewSel([0, 0]);
    // restore focus and caret at end of real input after DOM update
    setTimeout(() => {
      try {
        if (inputRef.current) {
          requestAnimationFrame(() => {
              try {
                inputRef.current.focus();
                const pos = (input || '').length;
                inputRef.current.setSelectionRange(pos, pos);
                try {
                  const sw = inputRef.current.scrollWidth || 0;
                  const cw = inputRef.current.clientWidth || 0;
                  if (sw > cw) {
                    inputRef.current.scrollLeft = Math.max(0, sw - cw);
                  }
                } catch (e) {}
                // remove temporary right alignment applied during preview
                try { inputRef.current.style.textAlign = ''; } catch (e) {}
              } catch (e) {}
          });
        }
      } catch (e) {}
    }, 0);
  }

  // Ensure selection highlight is shown reliably by deferring selection until after DOM update
  function previewSelectRange(selStart, selEnd) {
    try {
      const cur = input || '';
      setPreviewValue(cur);
      setPreviewSel([selStart, selEnd]);
      setPreviewActive(true);
      // Defer to next frame to ensure DOM updated
      setTimeout(() => {
        try {
          requestAnimationFrame(() => {
            try {
              if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(selStart, selEnd);
                const sw = inputRef.current.scrollWidth || 0;
                const cw = inputRef.current.clientWidth || 0;
                if (sw > cw) inputRef.current.scrollLeft = Math.max(0, sw - cw);
                try { inputRef.current.style.textAlign = ''; } catch (e) {}
              }
            } catch (e) {}
          });
        } catch (e) {}
      }, 0);
    } catch (e) {}
  }

  const gridOrder = useMemo(() => getGridOrder(), []); // Ensure gridOrder is initialized
  const gridRef = useRef(null);
  const transitionTimeoutRef = useRef(null);
  const hoverShowTimeoutRef = useRef(null);
  const hoverHideTimeoutRef = useRef(null);
  const hoverElementRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const holdGlobalUpRef = useRef(null);
  // Hold-to-show overlay state and refs
  const [holdActive, setHoldActive] = useState(false);
  const holdTimeoutRef = useRef(null);
  const holdTriggeredRef = useRef(false);
  const centerBtnRef = useRef(null);
  const [overlayPos, setOverlayPos] = useState({ top: 0, left: 0, width: 88, height: 64, gap: 8 });
  const [overlayHover, setOverlayHover] = useState(null); // 'back' | 'reset' | 'left' | 'right' | null

  // Debounced hover helpers to avoid flicker when moving quickly between keys
  const HOVER_SHOW_DELAY = 20; // ms
  const HOVER_HIDE_DELAY = 30; // ms

  function scheduleShowHover(token) {
    if (hoverHideTimeoutRef.current) {
      clearTimeout(hoverHideTimeoutRef.current);
      hoverHideTimeoutRef.current = null;
    }
    if (hoverShowTimeoutRef.current) clearTimeout(hoverShowTimeoutRef.current);
    hoverShowTimeoutRef.current = setTimeout(() => {
      hoverShowTimeoutRef.current = null;
      hoverElementRef.current = null;
      // Show caret-only preview (no highlighted selection) for hover to keep caret blinking
      handleHoverPreview(token, { highlight: false });
    }, HOVER_SHOW_DELAY);
  }

  function scheduleHideHover() {
    if (hoverShowTimeoutRef.current) {
      clearTimeout(hoverShowTimeoutRef.current);
      hoverShowTimeoutRef.current = null;
    }
    // If we're currently in a hold overlay interaction, don't hide the preview
    if (holdTriggeredRef.current || (typeof holdActive !== 'undefined' && holdActive)) return;
    if (hoverHideTimeoutRef.current) clearTimeout(hoverHideTimeoutRef.current);
    hoverHideTimeoutRef.current = setTimeout(() => {
      hoverHideTimeoutRef.current = null;
      hoverElementRef.current = null;
      clearHoverPreview();
    }, HOVER_HIDE_DELAY);
  }

  // Keep last mouse position so we can detect what element is under the cursor
  useEffect(() => {
    function onMove(e) {
      mousePosRef.current.x = e.clientX;
      mousePosRef.current.y = e.clientY;
    }
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Letter variant hold functions
  const letterHoldTimeoutRef = useRef(null);
  const letterHoldTriggeredRef = useRef(false);
  const LETTER_HOLD_DELAY = 200; // Reduced delay for faster response

  function beginLetterHold(letter, buttonElement) {
    console.log('beginLetterHold called for:', letter); // Debug log
    letterHoldTriggeredRef.current = false;
    
    if (letterHoldTimeoutRef.current) {
      clearTimeout(letterHoldTimeoutRef.current);
    }
    
    letterHoldTimeoutRef.current = setTimeout(() => {
      console.log('Hold timeout triggered for:', letter); // Debug log
      // Show capital letter for ANY single letter, regardless of whether it has variants
      letterHoldTriggeredRef.current = true;
      setLetterHoldActive(true);
      setHeldLetter(letter.toLowerCase());
      setHeldLetterButton(buttonElement);
      // Show uppercase in preview
      const previewText = input + letter.toUpperCase();
      setPreviewActive(true);
      setPreviewValue(previewText);
      setPreviewSel([input.length, previewText.length]);
      letterHoldTimeoutRef.current = null;
    }, LETTER_HOLD_DELAY);
  }

  function cancelLetterHold() {
    console.log('cancelLetterHold called'); // Debug log
    if (letterHoldTimeoutRef.current) {
      clearTimeout(letterHoldTimeoutRef.current);
      letterHoldTimeoutRef.current = null;
    }
    letterHoldTriggeredRef.current = false;
    setLetterHoldActive(false);
    setHeldLetter('');
    setHeldLetterButton(null);
    setVariantHover('');
    clearHoverPreview();
  }

  function handleVariantHover(variant) {
    setVariantHover(variant);
    if (variant) {
      const previewText = input + variant;
      setPreviewActive(true);
      setPreviewValue(previewText);
      setPreviewSel([input.length, previewText.length]);
    }
  }

  function selectVariant(variant) {
    const newInput = input + variant;
    setInput(newInput);
    cancelLetterHold();
  }

  useEffect(() => {
    // recompute overlay position when holdActive toggles or on resize/scroll
    function recompute() {
      try {
        const el = centerBtnRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // cell sizes are defined in CSS, but use actual element size for accuracy
        const width = Math.round(r.width);
        const height = Math.round(r.height);
        // gap between grid cells as defined in CSS (.radial-grid gap: 8px)
        const gap = 8;
        const left = Math.round(r.left + r.width / 2 - width / 2);
        const topCenter = Math.round(r.top);
        setOverlayPos({ top: topCenter, left, width, height, gap });
      } catch (e) {}
    }
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => { window.removeEventListener('resize', recompute); window.removeEventListener('scroll', recompute, true); };
  }, [holdActive]);

  // Helpers for hold/show behavior
  const HOLD_DELAY = 250; // ms before overlay appears
  function beginHold(e) {
    try {
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
      holdTriggeredRef.current = false;
      // start a timer; if it fires, show the overlay
      holdTimeoutRef.current = setTimeout(() => {
        holdTimeoutRef.current = null;
        holdTriggeredRef.current = true;
        setHoldActive(true);
        // install a global pointerup listener so release anywhere triggers endHold
        if (!holdGlobalUpRef.current) {
          holdGlobalUpRef.current = (ev) => {
            try { endHold(ev, null); } catch (e) {}
          };
          window.addEventListener('pointerup', holdGlobalUpRef.current);
          window.addEventListener('pointercancel', holdGlobalUpRef.current);
        }
      }, HOLD_DELAY);
    } catch (err) {}
  }

  function cancelHold(e) {
    if (holdTimeoutRef.current) { clearTimeout(holdTimeoutRef.current); holdTimeoutRef.current = null; }
    holdTriggeredRef.current = false;
    setHoldActive(false);
    setOverlayHover(null);
    try {
      // remove any global pointerup listener installed during hold
      if (holdGlobalUpRef.current) {
        try { window.removeEventListener('pointerup', holdGlobalUpRef.current); window.removeEventListener('pointercancel', holdGlobalUpRef.current); } catch (e) {}
        holdGlobalUpRef.current = null;
      }
    } catch (err) {}
  }

  // Called on pointer up of center button. If hold was not triggered, treat as a normal click (shuffle)
  async function endHold(e, doShuffle) {
    try {
      if (holdTimeoutRef.current) { clearTimeout(holdTimeoutRef.current); holdTimeoutRef.current = null; }
      const wasHold = holdTriggeredRef.current;
      // remove global listener if present
      if (holdGlobalUpRef.current) {
        try { window.removeEventListener('pointerup', holdGlobalUpRef.current); window.removeEventListener('pointercancel', holdGlobalUpRef.current); } catch (e) {}
        holdGlobalUpRef.current = null;
      }

      if (!wasHold) {
        // normal click: run shuffle
        if (typeof doShuffle === 'function') await doShuffle();
        return;
      }

      // If hold was active and overlay visible, examine overlayHover to decide action
      // overlayHover may be set by overlay pointer events; if not, fall back to checking pointer position
      let resolved = overlayHover;
      if (!resolved) {
        try {
          const mp = { x: (e && e.clientX) || mousePosRef.current.x, y: (e && e.clientY) || mousePosRef.current.y };
          const el = document.elementFromPoint(mp.x, mp.y);
          if (el) {
            if (el.classList && el.classList.contains('overlay-back')) resolved = 'back';
            if (el.classList && el.classList.contains('overlay-reset')) resolved = 'reset';
          }
        } catch (err) {}
      }
      if (resolved === 'back') {
        setInput((s) => s.slice(0, -1));
      } else if (resolved === 'reset') {
        setInput("");
      }
    } finally {
      holdTriggeredRef.current = false;
      setHoldActive(false);
      setOverlayHover(null);
      // restore selection/caret
      clearHoverPreview();
    }
  }

  console.log("Rendering predictions:", predictions); // Debug log to check predictions before rendering

  async function fetchWordsFromServer(context, n = 8) {
    try {
      const url = backendUrl(`/predict/words?context=${encodeURIComponent(context)}&n=${n}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const j = await res.json();
      // server returns { suggestions: [str], source }
      const sug = (j.suggestions || []);
      lastServerSuggestionsRef.current = sug;
      lastServerSourceRef.current = j.source || '';
      if (!sug || sug.length === 0) {
        // fallback to common words
        return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
      }
      // Assign weights by inverse rank so earlier results are higher-weighted
      return sug.map((s, i) => [s, Math.max(1, n - i)]);
    } catch (err) {
      console.error('fetchWordsFromServer error', err);
      // return a small fallback set so UI isn't empty
      return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
    }
  }

  async function fetchDigitsFromServer(digits, n = 8) {
    try {
      const url = backendUrl(`/predict/digits?digits=${encodeURIComponent(digits)}&n=${n}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const j = await res.json();
      const sug = (j.suggestions || []);
      lastServerSuggestionsRef.current = sug;
      lastServerSourceRef.current = j.source || '';
      if (!sug || sug.length === 0) {
        // fallback: return common words as placeholder
        return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
      }
      return sug.map((s, i) => [s, Math.max(1, n - i)]);
    } catch (err) {
      console.error('fetchDigitsFromServer error', err);
      return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
    }
  }

  async function fetchPrefixFromServer(prefix, n = 8) {
    try {
      const url = backendUrl(`/predict/prefix?prefix=${encodeURIComponent(prefix)}&n=${n}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const j = await res.json();
      const sug = (j.suggestions || []);
      lastServerSuggestionsRef.current = sug;
      lastServerSourceRef.current = j.source || '';
      if (!sug || sug.length === 0) {
        return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
      }
      return sug.map((s, i) => [s, Math.max(1, n - i)]);
    } catch (err) {
      console.error('fetchPrefixFromServer error', err);
      return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
    }
  }

  // Merge and pick candidates by weight while ensuring at least minLetters letters
  function mergePick(wordItems, letterItems, maxTotal = 8, minLetters = 3, maxWords = 5, wordThreshold = 0.4) {
    // Normalize inputs to arrays of [token, count]
    const words = (wordItems || []).map((w) => [String(w[0]), Number(w[1] || 1)]);
    const letters = (letterItems || []).map((l) => [String(l[0]), Number(l[1] || 1)]);

    // Build combined pool keyed to token with highest count
    const combinedMap = new Map();
    for (const [t, c] of [...words, ...letters]) {
      const key = String(t);
      const existing = combinedMap.get(key) || 0;
      combinedMap.set(key, Math.max(existing, Number(c || 0)));
    }

    // Separate letter keys and word keys
    const letterSet = new Set((letters || []).map((l) => String(l[0])));

  // Determine top word weight for thresholding
  const wordsSortedForThreshold = [...words].sort((a, b) => b[1] - a[1]);
  const topWordWeight = wordsSortedForThreshold.length ? wordsSortedForThreshold[0][1] : 0;

    // Convert to array and sort by descending weight
    const items = Array.from(combinedMap.entries()).map(([k, v]) => [k, v]);
    items.sort((a, b) => b[1] - a[1]);

    // Pick top items but enforce maxWords and ensure minLetters present
    const chosen = [];
    let lettersChosen = 0;
    let wordsChosen = 0;
    for (const [t, c] of items) {
      if (chosen.length >= maxTotal) break;
      const isLetter = letterSet.has(t);
      if (!isLetter) {
        // It's a word. Enforce maxWords and threshold relative to top word weight.
        const meetsThreshold = topWordWeight === 0 ? true : (c >= topWordWeight * wordThreshold);
        if (wordsChosen >= maxWords || !meetsThreshold) {
          continue; // skip this word
        }
        wordsChosen++;
      } else {
        lettersChosen++;
      }
      chosen.push([t, c]);
    }

    // If not enough letters, insert highest-ranked letters not yet included
    if (lettersChosen < minLetters) {
      // sort letters by weight
      const letterWeights = (letters || []).map((l) => [String(l[0]), Number(l[1])]).sort((a, b) => b[1] - a[1]);
      for (const [lt, lc] of letterWeights) {
        if (lettersChosen >= minLetters) break;
        if (chosen.some((c) => String(c[0]) === lt)) continue;
        // replace lowest-ranked non-letter if possible
        const idx = chosen.map((c) => c[0]).reverse().findIndex((tok) => !letterSet.has(tok));
        if (idx === -1) break;
        const replaceIdx = chosen.length - 1 - idx;
        chosen[replaceIdx] = [lt, lc];
        lettersChosen++;
      }
    }

    // Finally, if chosen less than maxTotal, pad with most common letters/words preserved order
    const padCommon = [' ', 'e','t','a','o','i','n','s','r'];
    let pi = 0;
    while (chosen.length < maxTotal && pi < padCommon.length) {
      const ch = padCommon[pi];
      if (!chosen.some((c) => String(c[0]) === ch)) chosen.push([ch, 1]);
      pi++;
    }

    return chosen.slice(0, maxTotal);
  }
  function onSelect(item) {
    console.log("onSelect called with:", item);
    // item is [token, count]
    const token = item[0];

    // Fire-and-forget analytics POST (non-blocking)
    try {
      const ctx = input;
      const payload = {
        context: ctx,
        selected: token,
        mode: /^[0-9]+$/.test(ctx.trim()) ? 'digits' : 'words',
        candidates: (candidates || []).map(c => String(c[0])),
        server_suggestions: lastServerSuggestionsRef.current || [],
        server_source: lastServerSourceRef.current || '',
        digits: /^[0-9]+$/.test(ctx.trim()) ? ctx.trim() : undefined,
        ts: Date.now() / 1000.0,
      };
      const url = backendUrl('/analytics/selection');
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    } catch (e) {
      // ignore analytics errors
    }

    // always handle explicit space token quickly
    if (token === " ") {
      setInput((s) => s + " ");
      return;
    }

    const isWordToken = token.length > 1 || token.includes(' ');
    if (!isWordToken) {
      // single-letter letter; just append
      setInput((s) => s + token);
      return;
    }

    // For word tokens: decide whether to replace the current last token (completion)
    // or to append a new word (with a separating space).
    const trimmed = input; // keep raw spacing to inspect last char
    const parts = trimmed.split(' ');
    const last = parts[parts.length - 1] || '';

    // If the selected token starts with the last token (case-insensitive), treat as completion
    if (last && token.toLowerCase().startsWith(last.toLowerCase())) {
      parts[parts.length - 1] = token;
      const out = parts.join(' ');
      const newInput = out.endsWith(' ') ? out : out + ' ';
      setInput(newInput);
      // Immediately fetch likely next-word suggestions (max 3) and surface them mixed with letters
      (async () => {
        try {
          const ctxTrim = String(newInput || '').trim();
          const suggestions = await fetchWordsFromServer(ctxTrim, 8);
          const wordItems = (suggestions || []).map((s, i) => [s[0], s[1] || (8 - i)]).filter(([w]) => String(w || '').toLowerCase() !== String(token || '').toLowerCase());
          // derive letter suggestions similar to the main query flow
          let letterSuggestions = [];
          try {
            const lastChar = ctxTrim.slice(-1);
            const lastTwo = ctxTrim.slice(-2);
            if (letterTri && letterTri[lastTwo]) {
              letterSuggestions = (letterTri[lastTwo] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            } else if (letterBi && letterBi[lastChar]) {
              letterSuggestions = (letterBi[lastChar] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            }
          } catch (e) {
            letterSuggestions = [];
          }
          if (!letterSuggestions || letterSuggestions.length === 0) {
            letterSuggestions = COMMON_LETTERS.map((ch, i) => [ch, 100 - i]);
          }
          // Use mergePick with a cap of 3 words to prioritize showing up to 3 next-word suggestions
          const final = mergePick(wordItems, letterSuggestions, 8, 2, 3);
          if (!final.some((c) => c[0] === ' ')) final.unshift([' ', 1]);
          setCandidates(final);
          applyPredictions(final.slice(0, 8));
        } catch (e) {
          // ignore fetch/display errors
        }
      })();
      return;
    }

    // Otherwise append a space then the token (and a trailing space)
    if (trimmed === '' || trimmed.endsWith(' ')) {
      const newInput = (trimmed === '' || trimmed.endsWith(' ')) ? (input + token + ' ') : (input + ' ' + token + ' ');
      setInput(newInput);
      // Immediately fetch and show likely next-word suggestions (max 3)
      (async () => {
        try {
          const ctxTrim = String(newInput || '').trim();
          const suggestions = await fetchWordsFromServer(ctxTrim, 8);
          const wordItems = (suggestions || []).map((s, i) => [s[0], s[1] || (8 - i)]).filter(([w]) => String(w || '').toLowerCase() !== String(token || '').toLowerCase());
          let letterSuggestions = [];
          try {
            const lastChar = ctxTrim.slice(-1);
            const lastTwo = ctxTrim.slice(-2);
            if (letterTri && letterTri[lastTwo]) {
              letterSuggestions = (letterTri[lastTwo] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            } else if (letterBi && letterBi[lastChar]) {
              letterSuggestions = (letterBi[lastChar] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            }
          } catch (e) {
            letterSuggestions = [];
          }
          if (!letterSuggestions || letterSuggestions.length === 0) {
            letterSuggestions = COMMON_LETTERS.map((ch, i) => [ch, 100 - i]);
          }
          const final = mergePick(wordItems, letterSuggestions, 8, 2, 3);
          if (!final.some((c) => c[0] === ' ')) final.unshift([' ', 1]);
          setCandidates(final);
          applyPredictions(final.slice(0, 8));
        } catch (e) {}
      })();
    } else {
      const newInput = (input === '' || input.endsWith(' ')) ? (input + token + ' ') : (input + ' ' + token + ' ');
      setInput(newInput);
      (async () => {
        try {
          const ctxTrim = String(newInput || '').trim();
          const suggestions = await fetchWordsFromServer(ctxTrim, 8);
          const wordItems = (suggestions || []).map((s, i) => [s[0], s[1] || (8 - i)]).filter(([w]) => String(w || '').toLowerCase() !== String(token || '').toLowerCase());
          let letterSuggestions = [];
          try {
            const lastChar = ctxTrim.slice(-1);
            const lastTwo = ctxTrim.slice(-2);
            if (letterTri && letterTri[lastTwo]) {
              letterSuggestions = (letterTri[lastTwo] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            } else if (letterBi && letterBi[lastChar]) {
              letterSuggestions = (letterBi[lastChar] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            }
          } catch (e) {
            letterSuggestions = [];
          }
          if (!letterSuggestions || letterSuggestions.length === 0) {
            letterSuggestions = COMMON_LETTERS.map((ch, i) => [ch, 100 - i]);
          }
          const final = mergePick(wordItems, letterSuggestions, 8, 2, 3);
          if (!final.some((c) => c[0] === ' ')) final.unshift([' ', 1]);
          setCandidates(final);
          applyPredictions(final.slice(0, 8));
        } catch (e) {}
      })();
    }
  }

  // Whenever input changes, prefer server suggestions. For short inputs, keep local heuristics.
  useEffect(() => {
    let mounted = true;
    async function queryServer() {
      try {
        const t = input || '';
        // If user typed digits only (T9 mode), call digits endpoint
        if (/^[0-9]+$/.test(t.trim())) {
          const suggestions = await fetchDigitsFromServer(t.trim(), 8);
          if (!mounted) return;
          const withCounts = suggestions.map((s, i) => [s[0], s[1] || (8 - i)]);
          setCandidates(withCounts);
          applyPredictions(withCounts.slice(0, 8));
          return;
        }

        // For normal text: choose between prefix completions (in-word typing)
        // and next-word predictions (when user just typed a space).
        const ctxRaw = t;
        if (ctxRaw.length === 0) {
          // no context, do nothing here (existing effect handles starter letters)
          return;
        }

        const endsWithSpace = /\s$/.test(ctxRaw);
        const parts = ctxRaw.trim().split(/\s+/).filter(Boolean);

        const maxTotal = 8;

        if (endsWithSpace) {
          // user completed a word and expects next-word suggestions
          const suggestions = await fetchWordsFromServer(ctxRaw.trim(), maxTotal);
          if (!mounted) return;
          const withCounts = suggestions.map((s, i) => [s[0], s[1] || (maxTotal - i)]);
          // ensure a mix: prefer more words after a space but still include letters
          const letterSlots = 3;
          let letterSuggestions = [];
          try {
            const trimmed = ctxRaw.trim();
            const lastChar = trimmed.slice(-1);
            const lastTwo = trimmed.slice(-2);
            if (letterTri && letterTri[lastTwo]) {
              letterSuggestions = (letterTri[lastTwo] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            } else if (letterBi && letterBi[lastChar]) {
              letterSuggestions = (letterBi[lastChar] || []).map((p) => Array.isArray(p) ? [String(p[0]), Number(p[1] || 0)] : [String(p), 0]);
            }
          } catch (e) {
            letterSuggestions = [];
          }
          if (!letterSuggestions || letterSuggestions.length === 0) {
            letterSuggestions = COMMON_LETTERS.map((ch, i) => [ch, 100 - i]);
          }
          // Merge and pick candidates by weight, prefer words but ensure at least 2 letters
          const wordItems = withCounts;
          const final = mergePick(wordItems, letterSuggestions, maxTotal, 2);
          // Do NOT add space here because input already ends with a space
          setCandidates(final.slice(0, maxTotal));
          applyPredictions(final.slice(0, maxTotal));
          return;
        }

        // In-word typing: use prefix completions for last token and derive allowed next letters
        const lastToken = parts.length > 0 ? parts[parts.length - 1] : '';
        if (lastToken) {
          let words = await fetchPrefixFromServer(lastToken, 40); // request more to get a good letter distribution
          if (!mounted) return;
          // Filter out completions that exactly match what user already typed (we don't need that token)
          try {
            const lowerLast = String(lastToken || '').toLowerCase();
            words = (words || []).filter((s) => String(s[0] || '').toLowerCase() !== lowerLast);
          } catch (e) {
            // noop
          }
          // words is array of [token, count] pairs from fetchPrefixFromServer
          const wordItems = (words || []).map((s, i) => [s[0], s[1] || (40 - i)]);

          // Derive next-letter distribution from the returned completions
          const letterCounts = {};
          const lowerPrefix = lastToken.toLowerCase();
          for (const w of wordItems) {
            const tok = String(w[0] || '').toLowerCase();
            if (tok.length > lowerPrefix.length && tok.startsWith(lowerPrefix)) {
              const nextCh = tok.charAt(lowerPrefix.length);
              letterCounts[nextCh] = (letterCounts[nextCh] || 0) + (Number(w[1]) || 1);
            }
          }
          let letterSuggestions = Object.entries(letterCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([ch, cnt]) => [ch, cnt]);

          // Fallback if no letters from completions
          if (!letterSuggestions || letterSuggestions.length === 0) {
            letterSuggestions = COMMON_LETTERS.map((ch, i) => [ch, 100 - i]);
          }

          // Merge by weights and ensure a minimum number of letters (so not all words)
          const final = mergePick(wordItems, letterSuggestions, maxTotal, 3);
          if (!final.some((c) => c[0] === ' ')) final.unshift([' ', 1]);
          setCandidates(final);
          applyPredictions(final.slice(0, maxTotal));
          return;
        }
      } catch (err) {
        console.error('queryServer error', err);
      }
    }
    queryServer();
    return () => { mounted = false; };
  }, [input]);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    };
  }, []);

  // Ensure space token, if present in current predictions, is rendered only at bottom-row center cell.
  // This only affects rendering order; the underlying `predictions` state is unchanged.
  const renderPreds = useMemo(() => {
    try {
      const arr = (predictions || []).slice(0, 8);
      // Determine where the bottom-center cell maps into predictions array
      const targetCellIndex = 7; // bottom row, center cell
      const targetPredIdx = gridOrder.indexOf(targetCellIndex);
      const spaceIdx = arr.findIndex((p) => p && String(p[0]) === ' ');
      if (spaceIdx !== -1 && targetPredIdx !== -1 && spaceIdx !== targetPredIdx) {
        const [spaceItem] = arr.splice(spaceIdx, 1);
        // insert at targetPredIdx (may shift other items)
        arr.splice(targetPredIdx, 0, spaceItem);
      }
      return arr.slice(0, 8);
    } catch (e) {
      return (predictions || []).slice(0, 8);
    }
  }, [predictions, gridOrder]);

  return (
    <div className="app-center">
      <div style={{ maxWidth: 520, margin: "1.5rem auto", textAlign: "center" }}>
        <div className="input-area" style={{ marginBottom: 12 }}>
        <input
          ref={inputRef}
          value={previewActive ? previewValue : input}
          onChange={(e) => { setInput(e.target.value); setPreviewActive(false); }}
          placeholder="Type here or tap predictions"
          style={{ width: "80%", padding: 8, fontSize: 18 }}
        />
        <div className="input-controls">
          {/* back/reset handled via hold on center shuffle - external buttons removed */}
        </div>
      </div>

  <div ref={gridRef} className="radial-grid" style={{ margin: "0 auto" }}>
        {/* Render 9 grid cells (3x3). Center cell (index 4) is the input; other cells show predictions in order */}
        {Array.from({ length: 9 }).map((_, cellIndex) => (
          <React.Fragment key={cellIndex}>
            {cellIndex === 4 ? (
              <div key="center-input" className="radial-grid-cell radial-center-cell">
                <button
                  ref={centerBtnRef}
                  className={"radial-center-button" + (holdActive ? ' holding' : '')}
                  /* no hover preview on center shuffle button to avoid moving caret */
                  onPointerDown={(e) => beginHold(e)}
                  onPointerUp={(e) => endHold(e, async () => {
                    // original shuffle logic
                    const maxTotal = 8;
                    const visibleSet = new Set((predictions || []).map((p) => String(p[0])));
                    const recent = recentlyShownRef.current || [];
                    const recentSet = new Set(recent.slice(-512).map(String));
                    const pool = (candidates || []).filter((p) => !visibleSet.has(String(p[0])) && !recentSet.has(String(p[0])));
                    let newPreds = [];
                    const t = input || '';
                    const endsWithSpace = /\s$/.test(t);
                    if (!endsWithSpace) {
                      const parts = (t.trim().split(/\s+/).filter(Boolean));
                      const lastToken = parts.length > 0 ? parts[parts.length - 1] : '';
                      if (lastToken) {
                        try {
                          const srv = await fetchPrefixFromServer(lastToken, 128);
                          const wordItems = [];
                          const letterCounts = {};
                          const seenTokens = new Set();
                          for (let i = 0; i < (srv || []).length; i++) {
                            const s = srv[i];
                            const tok = String(s[0] || '');
                            if (!tok) continue;
                            const weight = Number(s[1]) || Math.max(1, 128 - i);
                            if (!visibleSet.has(tok) && !recentSet.has(tok) && tok.length > 1 && !seenTokens.has(tok) && String(tok).toLowerCase() !== String(lastToken).toLowerCase()) {
                              wordItems.push([tok, weight]);
                              seenTokens.add(tok);
                            }
                            const lowerTok = tok.toLowerCase();
                            if (lowerTok.length > lastToken.length && lowerTok.startsWith(lastToken.toLowerCase())) {
                              const nextCh = lowerTok.charAt(lastToken.length);
                              if (nextCh) {
                                letterCounts[nextCh] = (letterCounts[nextCh] || 0) + weight;
                              }
                            }
                          }
                          const letterItems = Object.entries(letterCounts).sort((a,b)=>b[1]-a[1]).map(([ch,c])=>[ch,c]).filter(([ch])=>!recentSet.has(ch) && !visibleSet.has(ch));
                          newPreds = mergePick(wordItems, letterItems, maxTotal, 3);
                        } catch (e) { console.error('shuffle prefix fetch error', e); }
                      }
                      if (!newPreds || newPreds.length === 0) {
                        if (pool.length >= maxTotal) newPreds = shuffleArray(pool).slice(0, maxTotal);
                        else if (pool.length > 0) newPreds = shuffleArray(pool).slice(0, maxTotal);
                        else {
                          const alphabet = 'etaoinshrdlcumwfgypbvkjxqz'.split('');
                          const fresh = alphabet.filter((ch) => !recentSet.has(ch) && !visibleSet.has(ch)).map((ch) => [ch, 1]);
                          newPreds = fresh.slice(0, maxTotal);
                        }
                      }
                    } else {
                      if (pool.length >= maxTotal) newPreds = shuffleArray(pool).slice(0, maxTotal);
                      else if (pool.length > 0) newPreds = shuffleArray(pool).slice(0, maxTotal);
                      else {
                        const alphabet = 'etaoinshrdlcumwfgypbvkjxqz'.split('');
                        const fresh = alphabet.filter((ch) => !recentSet.has(ch) && !visibleSet.has(ch)).map((ch) => [ch, 1]);
                        newPreds = fresh.slice(0, maxTotal);
                      }
                    }
                    if (newPreds.length < maxTotal) {
                      const remaining = (candidates || []).filter((p) => !visibleSet.has(String(p[0])) && !newPreds.some((n) => n[0] === p[0]));
                      for (const item of shuffleArray(remaining)) { if (newPreds.length >= maxTotal) break; newPreds.push(item); }
                    }
                    const padCommon = [' ', 'e','t','a','o','i','n','s','r']; let pi = 0;
                    while (newPreds.length < maxTotal && pi < padCommon.length) { const ch = padCommon[pi]; if (!newPreds.some((n) => String(n[0]) === ch)) newPreds.push([ch, 1]); pi++; }
                    const reordered = [...newPreds, ...(candidates || []).filter((c) => !newPreds.some((n) => n[0] === c[0]))];
                    setCandidates(reordered);
                    applyPredictions(newPreds);
                  })}
                  title="Shuffle suggestions"
                >
                  <span className="shuffle-icon invert" aria-hidden>
                    <Shuffle size={24} aria-label="Shuffle" />
                  </span>
                </button>

                {holdActive && (
                  <div className="overlay-layer" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {/* reset above the center button */}
                    <div
                      className={"overlay-button hold-top-action overlay-reset" + (overlayHover === 'reset' ? ' hovering' : '')}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        top: `calc(-1 * (64px + 8px))`,
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                      onPointerEnter={() => {
                        setOverlayHover('reset');
                        try {
                          previewSelectRange(0, (input || '').length);
                        } catch (e) {}
                      }}
                      onPointerMove={() => { setOverlayHover('reset'); }}
                      onPointerLeave={() => { setOverlayHover(null); clearHoverPreview(); }}
                    >
                      reset
                    </div>

                    {/* left arrow to the left of the center button */}
                    <div
                      className={"overlay-button hold-left-action overlay-left" + (overlayHover === 'left' ? ' hovering' : '')}
                      style={{
                        position: 'absolute',
                        left: `calc(-1 * (88px + 8px))`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                      onPointerEnter={() => {
                        setOverlayHover('left');
                      }}
                      onPointerMove={() => { setOverlayHover('left'); }}
                      onPointerLeave={() => { setOverlayHover(null); clearHoverPreview(); }}
                    >
                      <span className="shuffle-icon invert" aria-hidden>
                        <ArrowLeft size={24} aria-label="Move Left" />
                      </span>
                    </div>

                    {/* right arrow to the right of the center button */}
                    <div
                      className={"overlay-button hold-right-action overlay-right" + (overlayHover === 'right' ? ' hovering' : '')}
                      style={{
                        position: 'absolute',
                        left: `calc(100% + 8px)`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                      onPointerEnter={() => {
                        setOverlayHover('right');
                      }}
                      onPointerMove={() => { setOverlayHover('right'); }}
                      onPointerLeave={() => { setOverlayHover(null); clearHoverPreview(); }}
                    >
                      <span className="shuffle-icon invert" aria-hidden>
                        <ArrowRight size={24} aria-label="Move Right" />
                      </span>
                    </div>

                    {/* back below the center button */}
                    <div
                      className={"overlay-button hold-bottom-action overlay-back" + (overlayHover === 'back' ? ' hovering' : '')}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        top: `calc(100% + 8px)`,
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                      onPointerEnter={() => {
                        setOverlayHover('back');
                        try {
                          if (!input || input.length === 0) return;
                          previewSelectRange(input.length - 1, input.length);
                        } catch (e) {}
                      }}
                      onPointerMove={() => { setOverlayHover('back'); }}
                      onPointerLeave={() => { setOverlayHover(null); clearHoverPreview(); }}
                    >
                      back
                    </div>

                    {/* Corner overlay buttons */}
                    {/* Top-left: Numbers (123) - Yellow */}
                    <div
                      className="corner-button corner-top-left"
                      style={{
                        position: 'absolute',
                        left: `calc(var(--corner-offset-x, 0px) - 96px)`, // -88px button width - 8px gap
                        top: `calc(var(--corner-offset-y, 0px) - 72px)`, // -64px button height - 8px gap  
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                    >
                      <button className="radial-predictor-button radial-yellow-button radial-corner-button">
                        123
                      </button>
                    </div>

                    {/* Top-right: Special characters (!@#) - Yellow */}
                    <div
                      className="corner-button corner-top-right"
                      style={{
                        position: 'absolute',
                        left: `calc(var(--corner-offset-x, 0px) + 96px)`, // +88px button width + 8px gap
                        top: `calc(var(--corner-offset-y, 0px) - 72px)`, // -64px button height - 8px gap
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                    >
                      <button className="radial-predictor-button radial-yellow-button radial-corner-button">
                        !@#
                      </button>
                    </div>

                    {/* Bottom-left: Emoji (😊) - Yellow */}
                    <div
                      className="corner-button corner-bottom-left"
                      style={{
                        position: 'absolute',
                        left: `calc(var(--corner-offset-x, 0px) - 96px)`, // -88px button width - 8px gap
                        top: `calc(var(--corner-offset-y, 0px) + 72px)`, // +64px button height + 8px gap
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                    >
                      <button className="radial-predictor-button radial-yellow-button radial-corner-button">
                        😊
                      </button>
                    </div>

                    {/* Bottom-right: Submit - Green */}
                    <div
                      className="corner-button corner-bottom-right"
                      style={{
                        position: 'absolute',
                        left: `calc(var(--corner-offset-x, 0px) + 96px)`, // +88px button width + 8px gap
                        top: `calc(var(--corner-offset-y, 0px) + 72px)`, // +64px button height + 8px gap
                        pointerEvents: 'auto',
                        zIndex: 999,
                      }}
                    >
                      <button className="radial-predictor-button radial-green-button radial-corner-button">
                        submit
                      </button>
                    </div>
                  </div>
                )}

                {/* Letter variant overlay - appears when holding a letter button */}
                {letterHoldActive && heldLetterButton && LETTER_VARIANTS[heldLetter] && (
                  <div className="letter-variant-layer" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {LETTER_VARIANTS[heldLetter].slice(0, Math.min(predictions.length, 8)).map((variant, index) => {
                      // Only show variants where there are actual prediction buttons
                      if (index >= predictions.length) return null;
                      
                      const gridOrder = [0, 1, 2, 3, 5, 6, 7, 8]; // skip center (4)
                      const gridPosition = gridOrder[index];
                      if (gridPosition === undefined) return null;

                      // Calculate offset from center like corner buttons do
                      const row = Math.floor(gridPosition / 3);
                      const col = gridPosition % 3;
                      const centerRow = 1, centerCol = 1;
                      
                      // Double check we're within grid bounds
                      if (row < 0 || row > 2 || col < 0 || col > 2) return null;
                      
                      // Find which prediction position contains the held letter and skip that position
                      const heldLetterPredIndex = predictions.findIndex(p => 
                        String(p[0]).toLowerCase() === heldLetter.toLowerCase()
                      );
                      
                      // If this variant would appear in the same position as the held letter, skip it
                      if (index === heldLetterPredIndex) return null;
                      
                      const offsetX = (col - centerCol) * (88 + 8); // button width + gap
                      const offsetY = (row - centerRow) * (64 + 8); // button height + gap

                      return (
                        <div
                          key={`variant-${variant}-${index}`}
                          className="variant-button-wrapper"
                          style={{
                            position: 'absolute',
                            left: `calc(50% + ${offsetX}px - 44px)`, // center and offset by half button width
                            top: `calc(50% + ${offsetY}px - 32px)`, // center and offset by half button height
                            pointerEvents: 'auto',
                            zIndex: 1000,
                          }}
                        >
                          <button 
                            className="radial-predictor-button radial-mint-button radial-variant-button"
                            onPointerEnter={() => handleVariantHover(variant)}
                            onPointerUp={() => selectVariant(variant)}
                            style={{
                              width: '88px',
                              height: '64px'
                            }}
                          >
                            {variant}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (() => {
              // Find which prediction should go into this cell (reverse map)
              const predIdx = gridOrder.indexOf(cellIndex);
              const p = renderPreds[predIdx];
              if (!p) {
                // Render an inert, visually empty but present button so DOM structure stays stable.
                return (
                  <div key={`empty-${cellIndex}`} className="radial-grid-cell">
                    <button className="radial-predictor-button radial-empty-button" disabled aria-hidden />
                  </div>
                );
              }
              const token = p[0];
              const count = p[1];
              const isSpace = token === " ";
              const isWord = isSpace || token.length > 1 || token.includes(" ");
              const label = isSpace ? "Space" : token;

              if (isWord) {
                return (
                  <div key={`word-${token}-${cellIndex}`} className="radial-grid-cell">
                    <button
                      onClick={() => onSelect(p)}
                      onMouseEnter={() => scheduleShowHover(String(token))}
                      onMouseLeave={() => scheduleHideHover()}
                      aria-label={label}
                      className="radial-predictor-button radial-word-button"
                      data-rank={predIdx}
                      data-token={String(token)}
                    >
                      {isSpace ? (
                        <span className="space-icon" aria-hidden>
                          <SpacebarIcon width={20} height={20} />
                        </span>
                      ) : (
                        label
                      )}
                    </button>
                  </div>
                );
              }

              return (
                <div key={`let-${token}-${cellIndex}`} className="radial-grid-cell">
                  <button
                    ref={(el) => {
                      // Store button reference for letter hold functionality
                      if (el && letterHoldActive && heldLetter === token.toLowerCase()) {
                        setHeldLetterButton(el);
                      }
                    }}
                    onClick={(e) => {
                      // Prevent normal click if we triggered hold mode
                      if (letterHoldTriggeredRef.current) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      onSelect(p);
                    }}
                    onMouseEnter={() => {
                      if (!letterHoldActive) {
                        scheduleShowHover(String(token));
                      }
                    }}
                    onMouseLeave={() => {
                      if (!letterHoldActive) {
                        scheduleHideHover();
                      }
                    }}
                    onPointerDown={(e) => {
                      // Check if this is a single letter that can have variants
                      if (String(token).length === 1 && /[a-z]/i.test(token)) {
                        console.log('Pointer down on letter:', token); // Debug log
                        beginLetterHold(String(token), e.currentTarget);
                      }
                    }}
                    onPointerUp={(e) => {
                      console.log('Pointer up, letterHoldActive:', letterHoldActive, 'triggered:', letterHoldTriggeredRef.current); // Debug log
                      if (letterHoldActive || letterHoldTimeoutRef.current) {
                        // If we were in hold mode but didn't select a variant, just add the base letter
                        if (letterHoldTriggeredRef.current && !variantHover) {
                          const newInput = input + heldLetter.toUpperCase();
                          setInput(newInput);
                        }
                        cancelLetterHold();
                      }
                    }}
                    onPointerCancel={() => {
                      cancelLetterHold();
                    }}
                    className={`radial-predictor-button radial-letter-button ${
                      letterHoldActive && heldLetter === token.toLowerCase() ? 'radial-mint-button held' : ''
                    }`}
                    data-rank={predIdx}
                    data-token={String(token)}
                  >
                    {isSpace ? (
                      <span className="space-icon" aria-hidden>
                        <SpacebarIcon width={20} height={20} />
                      </span>
                    ) : (
                      // Show uppercase when held, normal case otherwise
                      letterHoldActive && heldLetter === token.toLowerCase() 
                        ? token.toUpperCase() 
                        : token
                    )}
                  </button>
                </div>
              );
            })()}
          </React.Fragment>
        ))}
      </div>
      </div>
    </div>
  );
}
