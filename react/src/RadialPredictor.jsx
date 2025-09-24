import React, { useState, useEffect, useMemo, useRef } from "react";
import { Shuffle } from 'lucide-react';

// Helper to load JSON from public folder
async function loadJson(filename) {
  const res = await fetch(`/${filename}`);
  return res.json();
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

  useEffect(() => {
    loadJson("letter_bigram_next.json").then((d) => {
      console.log("Loaded letterBi:", d);
      setLetterBi(d);
    }).catch((e) => {
      console.error(e);
      setLetterBi({});
    });
    loadJson("letter_trigram_next.json").then((d) => setLetterTri(d)).catch((e) => { console.error(e); setLetterTri({}); });
    loadJson("word_bigram_next.json").then((d) => {
      console.log("Loaded wordBi:", d);
      setWordBi(d);
    }).catch((e) => {
      console.error(e);
      setWordBi({});
    });
    loadJson("word_trigram_next.json").then((d) => { setWordTri(d); }).catch((e) => { console.error(e); setWordTri({}); });
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

  function onSelect(item) {
    console.log("onSelect called with:", item);
    // item is [token, count]
    const token = item[0];

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
                return <div key={`empty-${cellIndex}`} className="radial-grid-cell" />;
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
