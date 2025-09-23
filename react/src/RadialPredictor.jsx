import React, { useState, useEffect } from "react";
import { Shuffle } from 'lucide-react';

// Helper to load JSON from public folder
async function loadJson(filename) {
  const res = await fetch(`/${filename}`);
  return res.json();
}

function getRadialPositions(n, radius = 120, center = { x: 150, y: 150 }) {
  // Returns array of {x, y} positions for n items in a circle
  const angleStep = (2 * Math.PI) / n;
  return Array.from({ length: n }, (_, i) => {
    const angle = i * angleStep - Math.PI / 2;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

export default function RadialPredictor() {
  const [input, setInput] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [ngramData, setNgramData] = useState(null);

  useEffect(() => {
    // Load letter bigram data on mount
    loadJson("letter_bigram_next.json").then(setNgramData);
  }, []);

  useEffect(() => {
    if (!ngramData || input.length === 0) {
      setPredictions([]);
      return;
    }
    const lastChar = input.slice(-1);
    const preds = ngramData[lastChar]?.slice(0, 8) || [];
    setPredictions(preds);
  }, [input, ngramData]);

  const positions = getRadialPositions(predictions.length);

  return (
    <div style={{ position: "relative", width: 300, height: 300, margin: "2rem auto" }}>
      {/* Center input */}
      <div style={{ position: "absolute", left: 125, top: 125, width: 50, height: 50, borderRadius: "50%", background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold" }}>
        {input || "_"}
      </div>

      <div className="radial-grid" style={{ margin: "0 auto" }}>
        {/* Render 9 grid cells (3x3). Center cell (index 4) is the input; other cells show predictions in order */}
        {Array.from({ length: 9 }).map((_, cellIndex) => {
          if (cellIndex === 4) {
            // center cell acts as a pager for more candidate sets
            const maxTotal = 8;
            return (
              <div key="center-input" className="radial-grid-cell radial-center-cell">
                <button
                  className="radial-center-button"
                  onClick={() => {
                    const maxTotal = 8;
                    const visibleSet = new Set((predictions || []).map((p) => String(p[0])));
                    // Pool of candidates not currently visible
                    const pool = (candidates || []).filter((p) => !visibleSet.has(String(p[0])));

                    let newPreds = [];
                    if (pool.length >= maxTotal) {
                      newPreds = shuffleArray(pool).slice(0, maxTotal);
                    } else {
                      // Try to fill from pool first, then from remaining candidates excluding duplicates
                      newPreds = shuffleArray(pool).slice(0, maxTotal);
                      const remaining = shuffleArray(candidates || []).filter((p) => !newPreds.some((n) => n[0] === p[0]));
                      for (let i = 0; i < remaining.length && newPreds.length < maxTotal; i++) {
                        // avoid adding items that were visible before
                        if (!visibleSet.has(String(remaining[i][0]))) {
                          newPreds.push(remaining[i]);
                        }
                      }
                      // If still not enough, allow reusing some candidates (last resort)
                      if (newPreds.length < maxTotal) {
                        const fallback = shuffleArray(candidates || []).filter((p) => !newPreds.some((n) => n[0] === p[0]));
                        newPreds = [...newPreds, ...fallback.slice(0, maxTotal - newPreds.length)];
                      }
                    }

                    // If we ended up with fewer than maxTotal, pad with placeholder space or common letters
                    if (newPreds.length < maxTotal) {
                      const padCommon = ['e','t','a','o','i','n','s','r'];
                      let i = 0;
                      while (newPreds.length < maxTotal && i < padCommon.length) {
                        if (!newPreds.some((n) => n[0] === padCommon[i])) newPreds.push([padCommon[i], 1]);
                        i++;
                      }
                    }

                    // Reorder candidates so newPreds are first
                    const reordered = [...newPreds, ...(candidates || []).filter((c) => !newPreds.some((n) => n[0] === c[0]))];
                    setCandidates(reordered);
                    setPredictions(newPreds);
                  }}
                  title="Shuffle suggestions"
                >
                  <span className="shuffle-icon invert" aria-hidden>
                    <Shuffle size={18} aria-hidden />
                  </span>
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
