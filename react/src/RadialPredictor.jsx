import React, { useState, useEffect, useMemo, useRef } from "react";
import { Shuffle } from 'lucide-react';

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

export default function RadialPredictor() {
  const [input, setInput] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [letterBi, setLetterBi] = useState(null);
  const [letterTri, setLetterTri] = useState(null);
  const [wordBi, setWordBi] = useState(null);
  const [wordTri, setWordTri] = useState(null);
  const [wordVocab, setWordVocab] = useState(new Set());
  const [wordFreq, setWordFreq] = useState({});

  // Lightweight fallbacks when server is unreachable or returns no suggestions
  const COMMON_LETTERS = ['e','t','a','o','i','n','s','r'];
  const COMMON_WORDS = ['the','to','and','of','a','in','is','it'];

  useEffect(() => {
    // Do not preload large JSON into the client. The frontend will query the prediction server.
    setLetterBi({});
    setLetterTri({});
    setWordBi({});
    setWordTri({});
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
                allCandidates = starterLetters;
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
    setPredictions(newPreds);
    try {
      const tokens = (newPreds || []).map((p) => String(p[0]));
      recentlyShownRef.current = [...recentlyShownRef.current, ...tokens].slice(-128);
    } catch (e) {
      // ignore
    }
  }

  const gridOrder = useMemo(() => getGridOrder(), []); // Ensure gridOrder is initialized

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
      return sug.map((s) => [s, 1]);
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
      return sug.map((s) => [s, 1]);
    } catch (err) {
      console.error('fetchDigitsFromServer error', err);
      return COMMON_WORDS.slice(0, n).map((w, i) => [w, n - i]);
    }
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
      setInput(out.endsWith(' ') ? out : out + ' ');
      return;
    }

    // Otherwise append a space then the token (and a trailing space)
    if (trimmed === '' || trimmed.endsWith(' ')) {
      setInput((s) => s + token + ' ');
    } else {
      setInput((s) => s + ' ' + token + ' ');
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

        // For normal text, query words endpoint with last two words as context
        const ctx = t.trim();
        if (ctx.length === 0) {
          // no context, do nothing here (existing effect handles starter letters)
          return;
        }
        const suggestions = await fetchWordsFromServer(ctx, 8);
        if (!mounted) return;
        const withCounts = suggestions.map((s, i) => [s[0], s[1] || (8 - i)]);
        setCandidates(withCounts);
        applyPredictions(withCounts.slice(0, 8));
      } catch (err) {
        console.error('queryServer error', err);
      }
    }
    queryServer();
    return () => { mounted = false; };
  }, [input]);

  return (
    <div className="app-center">
      <div style={{ maxWidth: 520, margin: "1.5rem auto", textAlign: "center" }}>
        <div className="input-area" style={{ marginBottom: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type here or tap predictions"
          style={{ width: "80%", padding: 8, fontSize: 18 }}
        />
        <div className="input-controls">
          <button onClick={() => setInput((s) => s.slice(0, -1))}>Backspace</button>
          <button onClick={() => setInput("")}>Reset</button>
        </div>
      </div>

      <div className="radial-grid" style={{ margin: "0 auto" }}>
        {/* Render 9 grid cells (3x3). Center cell (index 4) is the input; other cells show predictions in order */}
        {Array.from({ length: 9 }).map((_, cellIndex) => (
          <React.Fragment key={cellIndex}>
            {cellIndex === 4 ? (
              <div key="center-input" className="radial-grid-cell radial-center-cell">
                <button
                  className="radial-center-button"
                  onClick={() => {
                    const maxTotal = 8;
                    const visibleSet = new Set((predictions || []).map((p) => String(p[0])));

                    // Build recent set from recentlyShownRef (use larger window)
                    const recent = recentlyShownRef.current || [];
                    const recentSet = new Set(recent.slice(-512).map(String));

                    // Candidates not in recentSet and not visible
                    const pool = (candidates || []).filter((p) => !visibleSet.has(String(p[0])) && !recentSet.has(String(p[0])));

                    let newPreds = [];
                    if (pool.length >= maxTotal) {
                      newPreds = shuffleArray(pool).slice(0, maxTotal);
                    } else if (pool.length > 0) {
                      newPreds = shuffleArray(pool).slice(0, maxTotal);
                    } else {
                      // No unseen candidates available. Build fresh letter set excluding recent and visible tokens
                      const alphabet = 'etaoinshrdlcumwfgypbvkjxqz'.split('');
                      const fresh = alphabet.filter((ch) => !recentSet.has(ch) && !visibleSet.has(ch)).map((ch) => [ch, 1]);
                      newPreds = fresh.slice(0, maxTotal);
                    }

                    // If still short, fill from candidates excluding visible tokens
                    if (newPreds.length < maxTotal) {
                      const remaining = (candidates || []).filter((p) => !visibleSet.has(String(p[0])) && !newPreds.some((n) => n[0] === p[0]));
                      for (const item of shuffleArray(remaining)) {
                        if (newPreds.length >= maxTotal) break;
                        newPreds.push(item);
                      }
                    }

                    // Final pad with space and common letters if needed (avoid duplicates)
                    const padCommon = [' ', 'e','t','a','o','i','n','s','r'];
                    let pi = 0;
                    while (newPreds.length < maxTotal && pi < padCommon.length) {
                      const ch = padCommon[pi];
                      if (!newPreds.some((n) => String(n[0]) === ch)) newPreds.push([ch, 1]);
                      pi++;
                    }

                    console.log('Shuffle selected newPreds:', newPreds.map((p) => p[0]));

                    // Reorder candidates so newPreds are first
                    const reordered = [...newPreds, ...(candidates || []).filter((c) => !newPreds.some((n) => n[0] === c[0]))];
                    setCandidates(reordered);
                    applyPredictions(newPreds);
                  }}
                  title="Shuffle suggestions"
                >
                  <span className="shuffle-icon invert" aria-hidden>
                    <Shuffle size={24} aria-label="Shuffle" />
                  </span>
                </button>
              </div>
            ) : (() => {
              // Find which prediction should go into this cell (reverse map)
              const predIdx = gridOrder.indexOf(cellIndex);
              const p = predictions[predIdx];
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
                      title={`Count: ${count}`}
                      aria-label={label}
                      className="radial-predictor-button radial-word-button"
                      data-rank={predIdx}
                    >
                      {label}
                    </button>
                  </div>
                );
              }

              return (
                <div key={`let-${token}-${cellIndex}`} className="radial-grid-cell">
                  <button
                    onClick={() => onSelect(p)}
                    title={`Count: ${count}`}
                    className="radial-predictor-button radial-letter-button"
                    data-rank={predIdx}
                  >
                    {token}
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
