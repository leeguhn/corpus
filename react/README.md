# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

# Radial Predictive Text UI

This React app prototypes a predictive text input system for small screens using a radial layout. It loads n-gram JSON files and displays up to 8 most likely next letters/words around the current input.

## Features

- Radial layout for predictions
- Dynamic updates as user selects letters/words
- Loads n-gram data from local JSON files

## Getting Started

1. Place your n-gram JSON files (e.g., `letter_bigram_next.json`, `word_bigram_next.json`, etc.) in the `public/` folder.
2. Run the app:

   ```sh
   npm run dev
   ```

3. Open the local URL shown in the terminal.

## Next Steps

- Build the radial prediction component in `src/RadialPredictor.jsx`
- Connect to n-gram data and update UI on user input

---

This is a prototype for research and UI experimentation.
