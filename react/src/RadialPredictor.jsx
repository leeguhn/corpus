import React, { useState, useEffect } from "react";

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
      {/* Radial predictions */}
      {predictions.map(([letter, count], i) => (
        <button
          key={letter}
          style={{
            position: "absolute",
            left: positions[i].x - 25,
            top: positions[i].y - 25,
            width: 50,
            height: 50,
            borderRadius: "50%",
            background: "#cce",
            fontSize: 20,
            fontWeight: "bold",
            border: "2px solid #88a",
            cursor: "pointer",
          }}
          onClick={() => setInput(input + letter)}
          title={`Count: ${count}`}
        >
          {letter}
        </button>
      ))}
      {/* Reset button */}
      <button style={{ position: "absolute", left: 10, top: 250 }} onClick={() => setInput("")}>Reset</button>
    </div>
  );
}
