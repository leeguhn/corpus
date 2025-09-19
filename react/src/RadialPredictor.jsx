import React, { useState, useEffect, useMemo } from "react";

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

      const seen = new Map();
      for (const [tok, cnt] of allCandidates) {
        const key = String(tok);
        if (!seen.has(key) || (seen.get(key) || 0) < (cnt || 0)) {
          seen.set(key, cnt || 0);
        }
      }
      const finalCandidates = Array.from(seen.entries()).map(([k, v]) => [k, v]).slice(0, 128);

      console.log("Final candidates:", finalCandidates);
      setCandidates(finalCandidates);
      setPageOffset(0);
      setPredictions(finalCandidates.slice(0, maxTotal));
    } catch (err) {
      console.error('Prediction error', err);
      setCandidates([]);
      setPredictions([]);
    }
  }, [input, letterBi, letterTri, wordBi, wordTri, wordVocab, wordFreq]);

  useEffect(() => {
    const maxTotal = 8;
    if (!candidates || candidates.length === 0) {
      console.log("Candidates are empty:", candidates);
      setPredictions([]);
      return;
    }
    console.log("Paged candidates:", candidates.slice(pageOffset, pageOffset + maxTotal));
    setPredictions(candidates.slice(pageOffset, pageOffset + maxTotal));
  }, [pageOffset, candidates]);

  function onSelect(item) {
    // item is [token, count]
    const token = item[0];
    if (token === " ") {
      setInput((s) => s + " ");
    } else if (token.includes(" ")) {
      // word selected
      setInput((s) => (s.endsWith(" ") ? s + token : s + " " + token));
    } else {
      setInput((s) => s + token);
    }
  }

  const gridOrder = useMemo(() => getGridOrder(), []); // Ensure gridOrder is initialized

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
        {Array.from({ length: 9 }).map((_, cellIndex) => {
          if (cellIndex === 4) {
            // center cell acts as a pager for more candidate sets
            const maxTotal = 8;
            const page = Math.floor(pageOffset / maxTotal);
            const hasMore = candidates.length > (page + 1) * maxTotal;
            return (
              <div key="center-input" className="radial-grid-cell radial-center-cell">
                <button
                  className="radial-center-button"
                  onClick={() => {
                    const nextOffset = pageOffset + maxTotal;
                    if (nextOffset >= candidates.length) {
                      setPageOffset(0);
                      setPredictions(candidates.slice(0, maxTotal));
                    } else {
                      setPageOffset(nextOffset);
                      setPredictions(candidates.slice(nextOffset, nextOffset + maxTotal));
                    }
                  }}
                  title={hasMore ? 'Show more suggestions' : 'Restart suggestions'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M16 3h5v5" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M4 20l6-6 7-7" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M21 14v6h-6" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            );
          }
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
        })}
      </div>
      </div>
    </div>
  );
}
