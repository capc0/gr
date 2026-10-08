"use strict";

function normalizeWord(input) {
  const replacements = { "Æ": "AE", "Œ": "OE", "Ø": "O", "Ł": "L", "Ð": "D", "Þ": "TH" };
  const word = input.trim().toUpperCase().replace(/[ÆŒØŁÐÞ]/g, letter => replacements[letter])
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]/g, "");
  if (!/^[A-Z]+$/.test(word)) throw new Error(`“${input.trim()}” must contain letters A–Z, spaces or hyphens only.`);
  return word;
}

function deriveDirections(settings) {
  const bases = [];
  if (settings.horizontal) bases.push([0, 1]);
  if (settings.vertical) bases.push([1, 0]);
  if (settings.diagonal) bases.push([1, 1], [1, -1]);
  return bases.flatMap(([row, column]) => [
    ...(settings.forward ? [[row, column]] : []),
    ...(settings.backward ? [[-row, -column]] : [])
  ]);
}

function validateSettings(settings) {
  if (![settings.rows, settings.columns].every(value => Number.isInteger(value) && value >= 1 && value <= 60)) {
    throw new Error("Choose whole-number dimensions between 1 and 60.");
  }
  if (!settings.words.length) throw new Error("Add at least one word.");
  if (settings.words.some(word => !/^[A-Z]+$/.test(word)) || new Set(settings.words).size !== settings.words.length) {
    throw new Error("Words must be unique uppercase A–Z entries.");
  }
  const directions = deriveDirections(settings);
  if (!directions.length) throw new Error("Enable an alignment and at least one reading direction.");
  const capacity = Math.max(...directions.map(([row, column]) =>
    row === 0 ? settings.columns : column === 0 ? settings.rows : Math.min(settings.rows, settings.columns)));
  return { directions, tooLong: settings.words.filter(word => word.length > capacity) };
}

function candidateScore(overlap, density, random) {
  return density === "spacious" ? -overlap * 3 + random()
    : density === "compact" ? overlap * 3 + random() : overlap * 0.6 + random() * 2;
}

function generatePuzzle(settings, random = Math.random) {
  const { directions, tooLong } = validateSettings(settings);
  if (tooLong.length) return { success: false, unplaced: tooLong, reason: "length" };
  const { rows, columns, words, density } = settings;
  const alignments = [...new Set(directions.map(([rowStep, columnStep]) =>
    rowStep === 0 ? "horizontal" : columnStep === 0 ? "vertical" : "diagonal"))];
  const alignmentWeights = { horizontal: 2, vertical: 2, diagonal: 1 };
  const totalWeight = alignments.reduce((total, alignment) => total + alignmentWeights[alignment], 0);
  const sectorRows = Math.min(3, rows);
  const sectorColumns = Math.min(3, columns);
  const spacingWeight = density === "spacious" ? 4 : density === "compact" ? 0.75 : 2;
  const deadline = performance.now() + 1800;
  let operations = 0;
  let nodes = 0;
  let best = [];
  const exhausted = () => operations > 6000000 || nodes > 5000 || performance.now() > deadline;

  for (let attempt = 0; attempt < 5 && !exhausted(); attempt++) {
    const ordered = words.map(word => ({ word, tie: random() }))
      .sort((first, second) => second.word.length - first.word.length || first.tie - second.tie)
      .map(entry => entry.word);
    const letters = Array(rows * columns).fill("");
    const occupants = new Uint32Array(rows * columns);
    const usedPaths = new Set();
    const placed = [];
    const choices = [];
    const cursors = [];

    function candidatesFor(word) {
      const candidates = [];
      const seen = new Set();
      const sectorLoads = Array(sectorRows * sectorColumns).fill(0);
      placed.forEach(placement => { sectorLoads[placement.sector]++; });
      const preferredAlignment = alignments.map(alignment => ({
        alignment,
        priority: (placed.length + 1) * alignmentWeights[alignment] / totalWeight
          - placed.filter(placement => placement.alignment === alignment).length + random() * 0.4
      })).sort((first, second) => second.priority - first.priority)[0].alignment;
      for (const [rowStep, columnStep] of directions) {
        const alignment = rowStep === 0 ? "horizontal" : columnStep === 0 ? "vertical" : "diagonal";
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            if ((++operations & 127) === 0 && exhausted()) return [];
            const endRow = row + rowStep * (word.length - 1);
            const endColumn = column + columnStep * (word.length - 1);
            if (endRow < 0 || endRow >= rows || endColumn < 0 || endColumn >= columns) continue;
            const start = row * columns + column;
            const end = endRow * columns + endColumn;
            const path = `${Math.min(start, end)}:${Math.max(start, end)}`;
            if (usedPaths.has(path)) continue;
            const cells = [];
            let overlap = 0;
            for (let offset = 0; offset < word.length; offset++) {
              operations++;
              const cell = (row + rowStep * offset) * columns + column + columnStep * offset;
              if (letters[cell] && letters[cell] !== word[offset]) break;
              if (letters[cell]) overlap++;
              cells.push(cell);
            }
            if (cells.length !== word.length) continue;
            const signature = cells.join(",");
            if (seen.has(signature)) continue;
            seen.add(signature);
            const centerRow = (row + rowStep * (word.length - 1) / 2 + 0.5) / rows;
            const centerColumn = (column + columnStep * (word.length - 1) / 2 + 0.5) / columns;
            const sector = Math.floor(centerRow * sectorRows) * sectorColumns
              + Math.floor(centerColumn * sectorColumns);
            let nearestDistance = 2;
            for (const placement of placed) {
              operations++;
              const distance = (centerRow - placement.centerRow) ** 2
                + (centerColumn - placement.centerColumn) ** 2;
              nearestDistance = Math.min(nearestDistance, distance);
            }
            const spacingScore = Math.min(nearestDistance, 0.04) * 3 - sectorLoads[sector] * 2;
            candidates.push({ word, row, column, rowStep, columnStep, cells, path,
              alignment, centerRow, centerColumn, sector,
              score: candidateScore(overlap, density, random) + spacingScore * spacingWeight });
          }
        }
      }
      candidates.sort((first, second) => Number(second.alignment === preferredAlignment)
        - Number(first.alignment === preferredAlignment) || second.score - first.score);
      if (alignments.length === 1) return candidates.slice(0, 36);
      const shortlist = candidates.slice(0, 24);
      const reserveCount = Math.floor(12 / alignments.length);
      for (const alignment of alignments) {
        for (const candidate of candidates.filter(entry => entry.alignment === alignment).slice(0, reserveCount)) {
          if (!shortlist.includes(candidate)) shortlist.push(candidate);
        }
      }
      return shortlist;
    }

    function undo(placement) {
      usedPaths.delete(placement.path);
      placement.cells.forEach(cell => {
        occupants[cell]--;
        if (!occupants[cell]) letters[cell] = "";
      });
    }

    let depth = 0;
    while (depth === ordered.length || !exhausted()) {
      if (depth === ordered.length) {
        const grid = Array.from({ length: rows }, (_, row) => letters.slice(row * columns, (row + 1) * columns)
          .map(letter => letter || String.fromCharCode(65 + Math.floor(random() * 26))));
        return { success: true, rows, columns, words: [...words], grid, placements: [...placed], density };
      }
      if (!choices[depth]) {
        choices[depth] = candidatesFor(ordered[depth]);
        cursors[depth] = 0;
      }
      if (cursors[depth] >= choices[depth].length) {
        choices[depth] = undefined;
        if (depth === 0) break;
        depth--;
        undo(placed.pop());
        continue;
      }
      const placement = choices[depth][cursors[depth]++];
      nodes++;
      placement.cells.forEach((cell, offset) => {
        letters[cell] = placement.word[offset];
        occupants[cell]++;
      });
      usedPaths.add(placement.path);
      placed.push(placement);
      if (placed.length > best.length) best = placed.map(entry => entry.word);
      depth++;
      choices[depth] = undefined;
    }
  }
  return { success: false, unplaced: words.filter(word => !best.includes(word)), reason: "search" };
}

function proposeLargerGrid(settings) {
  const directions = deriveDirections(settings);
  let rows = Math.min(60, Math.max(settings.rows + 1, Math.ceil(settings.rows * 1.2)));
  let columns = Math.min(60, Math.max(settings.columns + 1, Math.ceil(settings.columns * 1.2)));
  for (const word of settings.words) {
    if (word.length > 60) return null;
    const options = directions.map(([rowStep, columnStep]) => ({
      rows: rowStep ? Math.max(rows, word.length) : rows,
      columns: columnStep ? Math.max(columns, word.length) : columns
    })).sort((first, second) => first.rows * first.columns - second.rows * second.columns);
    if (!options.length) return null;
    ({ rows, columns } = options[0]);
  }
  return rows === settings.rows && columns === settings.columns ? null : { rows, columns };
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const token of text.split(/\s+/)) {
    const next = line ? `${line} ${token}` : token;
    if (context.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const letter of token) {
      if (line && context.measureText(line + letter).width > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += letter;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildImageLayout(puzzle, context) {
  const cellSize = 48;
  const margin = 64;
  const width = Math.max(1000, puzzle.columns * cellSize + margin * 2);
  context.font = "52px Georgia";
  const titleLines = wrapText(context, puzzle.title, width - margin * 2);
  const gridTop = 140 + titleLines.length * 62;
  const gridLeft = (width - puzzle.columns * cellSize) / 2;
  const bankTop = gridTop + puzzle.rows * cellSize + 80;
  const bankColumns = Math.max(1, Math.floor((width - margin * 2) / 220));
  const bankColumnWidth = (width - margin * 2) / bankColumns;
  context.font = "22px Consolas, monospace";
  const bankRows = [];
  let bankHeight = 0;
  for (let offset = 0; offset < puzzle.words.length; offset += bankColumns) {
    const items = puzzle.words.slice(offset, offset + bankColumns)
      .map(word => wrapText(context, word, bankColumnWidth - 24));
    const height = Math.max(...items.map(lines => lines.length)) * 30 + 16;
    bankRows.push({ items, top: bankTop + 48 + bankHeight });
    bankHeight += height;
  }
  return { width, height: bankTop + 48 + bankHeight + margin, margin, cellSize, gridTop, gridLeft,
    titleLines, bankTop, bankColumnWidth, bankRows };
}

function drawPuzzleToCanvas(puzzle, showSolution) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser does not support image export.");
  const layout = buildImageLayout(puzzle, context);
  if (layout.height > 16000 || layout.width * layout.height > 40000000) {
    throw new Error("This word list is too large for a single image. Use Print / Save PDF instead.");
  }
  canvas.width = layout.width;
  canvas.height = layout.height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#65736c";
  context.font = "18px Consolas, monospace";
  context.fillText(showSolution ? "WORD SEARCH / SOLUTION" : "WORD SEARCH", layout.margin, 65);
  context.textAlign = "right";
  context.fillText(`${puzzle.rows} x ${puzzle.columns}`, layout.width - layout.margin, 65);
  context.textAlign = "left";
  context.fillStyle = "#252e2b";
  context.font = "52px Georgia";
  layout.titleLines.forEach((line, index) => context.fillText(line, layout.margin, 133 + index * 62));
  const highlighted = new Set(puzzle.placements.flatMap(placement => placement.cells));
  context.font = "26px Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  puzzle.grid.forEach((letters, row) => {
    letters.forEach((letter, column) => {
      const left = layout.gridLeft + column * layout.cellSize;
      const top = layout.gridTop + row * layout.cellSize;
      const isSolution = showSolution && highlighted.has(row * puzzle.columns + column);
      if (isSolution) {
        context.fillStyle = "#cce9d9";
        context.fillRect(left, top, layout.cellSize, layout.cellSize);
      }
      context.strokeStyle = "#dce3de";
      context.lineWidth = 1;
      context.strokeRect(left + 0.5, top + 0.5, layout.cellSize, layout.cellSize);
      context.fillStyle = isSolution ? "#135743" : "#252e2b";
      context.fillText(letter, left + layout.cellSize / 2, top + layout.cellSize / 2 + 1);
    });
  });
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = "bold 23px Consolas, monospace";
  context.fillStyle = "#252e2b";
  context.fillText(`WORDS TO FIND (${puzzle.words.length})`, layout.margin, layout.bankTop);
  context.font = "22px Consolas, monospace";
  for (const row of layout.bankRows) {
    row.items.forEach((lines, column) => {
      lines.forEach((line, index) => context.fillText(line,
        layout.margin + column * layout.bankColumnWidth, row.top + index * 30));
    });
  }
  return canvas;
}

function preparePrint(puzzle, showSolution) {
  const landscape = puzzle.columns > puzzle.rows * 1.15;
  const pageWidth = landscape ? 272 : 185;
  const gridHeight = landscape ? 115 : 202;
  const cellSize = Math.min(10, pageWidth / puzzle.columns, gridHeight / puzzle.rows);
  document.getElementById("print-page-style").textContent = `@media print { @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm; } }`;
  const section = document.createElement("div");
  section.className = "print-grid-section";
  const heading = document.createElement("div");
  heading.className = "print-heading";
  const category = document.createElement("span");
  category.textContent = showSolution ? "WORD SEARCH / SOLUTION" : "WORD SEARCH";
  const dimensions = document.createElement("span");
  dimensions.textContent = `${puzzle.rows} x ${puzzle.columns}`;
  heading.append(category, dimensions);
  const title = document.createElement("h1");
  title.className = "print-title";
  title.textContent = puzzle.title;
  const grid = document.createElement("div");
  grid.className = "print-grid";
  grid.style.setProperty("--columns", puzzle.columns);
  grid.style.setProperty("--print-cell", `${cellSize}mm`);
  const highlighted = new Set(puzzle.placements.flatMap(placement => placement.cells));
  puzzle.grid.flat().forEach((letter, index) => {
    const cell = document.createElement("span");
    cell.className = "print-cell";
    cell.classList.toggle("is-solution", showSolution && highlighted.has(index));
    cell.textContent = letter;
    grid.append(cell);
  });
  section.append(heading, title, grid);
  const bank = document.createElement("div");
  bank.className = "print-bank";
  const bankHeading = document.createElement("h2");
  bankHeading.textContent = `Words to find (${puzzle.words.length})`;
  const bankTitle = document.createElement("p");
  bankTitle.className = "print-bank-title";
  bankTitle.textContent = puzzle.title;
  const list = document.createElement("ul");
  puzzle.words.forEach(word => {
    const item = document.createElement("li");
    item.textContent = word;
    list.append(item);
  });
  bank.append(bankHeading, bankTitle, list);
  document.getElementById("print-puzzle").replaceChildren(section, bank);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const previousFocus = document.activeElement;
  const buffer = document.createElement("textarea");
  buffer.value = text;
  buffer.readOnly = true;
  buffer.style.position = "fixed";
  buffer.style.left = "-9999px";
  document.body.append(buffer);
  buffer.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard access was blocked. Select the text and copy it manually.");
  } finally {
    buffer.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

function initializeApp() {
  const element = id => document.getElementById(id);
  const themeToggle = element("dark-mode");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let themeOverride = null;
  let darkMode = systemTheme.matches;

  function applyTheme() {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = darkMode ? "#111113" : "#f2f2f7";
    themeToggle.setAttribute("aria-pressed", String(darkMode));
    themeToggle.title = darkMode ? "Switch to light mode" : "Switch to dark mode";
    element("theme-moon").hidden = darkMode;
    element("theme-sun").hidden = !darkMode;
  }

  try {
    const savedTheme = localStorage.getItem("word-search-theme");
    if (savedTheme === "dark" || savedTheme === "light") themeOverride = savedTheme;
  } catch {}
  darkMode = themeOverride === null ? systemTheme.matches : themeOverride === "dark";
  applyTheme();
  systemTheme.addEventListener("change", event => {
    if (themeOverride !== null) return;
    darkMode = event.matches;
    applyTheme();
  });
  themeToggle.addEventListener("click", () => {
    darkMode = !darkMode;
    themeOverride = darkMode ? "dark" : "light";
    applyTheme();
    try {
      localStorage.setItem("word-search-theme", themeOverride);
    } catch {}
  });

  let words = ["CAT", "DOG", "HAMSTER", "RABBIT", "PARROT", "GOLDFISH", "TURTLE", "GUINEAPIG", "GERBIL", "FERRET"];
  let puzzle = null;
  let busy = false;
  let exporting = false;
  let resizeProposal = null;
  let updateFrame = 0;
  let regeneratePending = false;
  const history = [];
  let historyIndex = -1;
  const directionIds = ["horizontal", "vertical", "diagonal", "forward", "backward"];

  function readSettings() {
    return {
      rows: Number(element("rows").value), columns: Number(element("columns").value),
      words: [...words], density: document.querySelector('input[name="density"]:checked').value,
      ...Object.fromEntries(directionIds.map(id => [id, element(id).checked]))
    };
  }

  function announce(message, error = false) {
    element("status").textContent = message;
    element("status").classList.toggle("error", error);
  }

  function updateHistoryControls() {
    element("history-previous").disabled = busy || historyIndex <= 0;
    element("history-next").disabled = busy || historyIndex >= history.length - 1;
    element("history-position").textContent = `${historyIndex + 1} / ${history.length}`;
    element("history-position").setAttribute("aria-label", `Puzzle ${historyIndex + 1} of ${history.length}`);
  }

  function navigateHistory(offset) {
    const nextIndex = historyIndex + offset;
    if (busy || nextIndex < 0 || nextIndex >= history.length) return;
    if (updateFrame) cancelAnimationFrame(updateFrame);
    updateFrame = 0;
    regeneratePending = false;
    historyIndex = nextIndex;
    const entry = history[historyIndex];
    puzzle = { ...structuredClone(entry.puzzle), title: element("puzzle-title").value.trim() || "Word search" };
    words = [...entry.settings.words];
    element("rows").value = entry.settings.rows;
    element("columns").value = entry.settings.columns;
    for (const id of directionIds) element(id).checked = entry.settings[id];
    document.querySelector(`input[name="density"][value="${entry.settings.density}"]`).checked = true;
    element("word-feedback").textContent = "";
    element("export-status").textContent = "";
    markDirty(false);
    renderWords();
    renderPuzzle();
    updateHistoryControls();
    announce(`Puzzle ${historyIndex + 1} of ${history.length}.`);
  }

  function scheduleGeneration() {
    if (updateFrame) return;
    updateFrame = requestAnimationFrame(() => {
      updateFrame = 0;
      generate(false);
    });
  }

  function markDirty(regenerate = true) {
    element("dirty-badge").hidden = !puzzle;
    element("resize-grid").hidden = true;
    resizeProposal = null;
    if (regenerate) scheduleGeneration();
  }

  function renderWords() {
    const fragment = document.createDocumentFragment();
    for (const word of words) {
      const chip = document.createElement("span");
      chip.className = "word-chip";
      const label = document.createElement("span");
      label.textContent = word;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-word";
      remove.textContent = "\u00d7";
      remove.setAttribute("aria-label", `Remove ${word}`);
      remove.title = `Remove ${word}`;
      remove.addEventListener("click", () => {
        const index = words.indexOf(word);
        words = words.filter(entry => entry !== word);
        renderWords();
        markDirty();
        const remaining = element("word-list").querySelectorAll("button");
        (remaining[Math.min(index, remaining.length - 1)] || element("word-input")).focus();
      });
      chip.append(label, remove);
      fragment.append(chip);
    }
    element("word-list").replaceChildren(fragment);
    element("word-count").textContent = words.length;
    element("clear-words").disabled = !words.length;
  }

  function solutionCells() {
    return new Set(puzzle.placements.flatMap(placement => placement.cells));
  }

  function renderSolution() {
    if (!puzzle) return;
    const highlighted = solutionCells();
    const show = element("solution").checked;
    element("grid").querySelectorAll(".letter-cell").forEach((cell, index) => {
      cell.classList.toggle("is-solution", show && highlighted.has(index));
    });
  }

  function renderPuzzle() {
    const fragment = document.createDocumentFragment();
    puzzle.grid.forEach((letters, rowIndex) => {
      const row = document.createElement("div");
      row.className = "grid-row";
      row.setAttribute("role", "row");
      letters.forEach((letter, columnIndex) => {
        const cell = document.createElement("span");
        cell.className = "letter-cell";
        cell.setAttribute("role", "cell");
        cell.setAttribute("aria-label", `Row ${rowIndex + 1}, column ${columnIndex + 1}: ${letter}`);
        cell.textContent = letter;
        row.append(cell);
      });
      fragment.append(row);
    });
    element("grid").style.setProperty("--columns", puzzle.columns);
    element("grid").setAttribute("aria-rowcount", puzzle.rows);
    element("grid").setAttribute("aria-colcount", puzzle.columns);
    element("grid").replaceChildren(fragment);
    element("sheet-title").textContent = puzzle.title;
    const bank = puzzle.words.map(word => {
      const item = document.createElement("li");
      item.textContent = word;
      return item;
    });
    element("word-bank").replaceChildren(...bank);
    element("dirty-badge").hidden = true;
    element("solution").disabled = false;
    element("export").disabled = false;
    element("copy-grid").disabled = false;
    element("copy-words").disabled = false;
    renderSolution();
  }

  async function generate(includeDraft = true) {
    if (updateFrame) cancelAnimationFrame(updateFrame);
    updateFrame = 0;
    if (busy) {
      regeneratePending = true;
      return;
    }
    if (includeDraft && element("word-input").value.trim() && !addWords(false)) return;
    const settings = readSettings();
    try {
      validateSettings(settings);
    } catch (error) {
      announce(error.message, true);
      return;
    }
    busy = true;
    updateHistoryControls();
    element("generate").disabled = true;
    element("puzzle-sheet").setAttribute("aria-busy", "true");
    element("generate").textContent = "Generating\u2026";
    element("resize-grid").hidden = true;
    resizeProposal = null;
    element("export-status").textContent = "";
    announce("Finding a place for every word\u2026");
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const result = generatePuzzle(settings);
      if (result.success) {
        puzzle = { ...result, title: element("puzzle-title").value.trim() || "Word search" };
        history.push({ puzzle: structuredClone(result), settings: structuredClone(settings) });
        historyIndex = history.length - 1;
        renderPuzzle();
        announce(`All ${puzzle.words.length} words placed.`);
      } else {
        const message = result.reason === "length" ? "Too long for the enabled directions" : "Could not place every word within the search budget";
        resizeProposal = proposeLargerGrid(settings);
        const advice = resizeProposal ? "Try a larger grid, fewer words or more directions." : "Try fewer or shorter words, or more directions. Maximum grid: 60 x 60.";
        announce(`${message}: ${result.unplaced.join(", ")}. ${puzzle ? "Previous puzzle kept. " : ""}${advice}`, true);
        if (resizeProposal) {
          element("resize-grid").textContent = `Use ${resizeProposal.rows} \u00d7 ${resizeProposal.columns} and retry`;
          element("resize-grid").hidden = false;
        }
      }
    } catch (error) {
      announce(`Generation failed: ${error.message}`, true);
    } finally {
      busy = false;
      updateHistoryControls();
      element("generate").disabled = false;
      element("puzzle-sheet").setAttribute("aria-busy", "false");
      element("generate").replaceChildren();
      const symbol = document.createElement("span");
      symbol.textContent = "\u21bb";
      symbol.setAttribute("aria-hidden", "true");
      element("generate").append(symbol, " Generate puzzle");
      if (regeneratePending) {
        regeneratePending = false;
        scheduleGeneration();
      }
    }
  }

  function addWords(regenerate = true) {
    const entries = element("word-input").value.split(/[,\r\n]+/).map(entry => entry.trim()).filter(Boolean);
    const normalized = [];
    try {
      for (const entry of entries) normalized.push(normalizeWord(entry));
    } catch (error) {
      element("word-feedback").textContent = error.message;
      element("word-input").focus();
      return false;
    }
    if (!normalized.length) {
      element("word-feedback").textContent = "Enter at least one word.";
      element("word-input").focus();
      return false;
    }
    const previousCount = words.length;
    words = [...new Set([...words, ...normalized])];
    const added = words.length - previousCount;
    element("word-feedback").textContent = `${added} ${added === 1 ? "word" : "words"} added.${normalized.length > added ? " Duplicates ignored." : ""}`;
    element("word-input").value = "";
    renderWords();
    if (added) markDirty(regenerate);
    element("word-input").focus();
    return true;
  }

  element("word-form").addEventListener("submit", event => {
    event.preventDefault();
    addWords();
  });
  element("clear-words").addEventListener("click", () => {
    words = [];
    renderWords();
    markDirty();
    element("word-feedback").textContent = "";
    element("word-input").focus();
  });
  element("puzzle-title").addEventListener("input", () => {
    if (!puzzle) return;
    puzzle.title = element("puzzle-title").value.trim() || "Word search";
    element("sheet-title").textContent = puzzle.title;
  });
  for (const id of ["rows", "columns", ...directionIds]) element(id).addEventListener("input", () => markDirty());
  document.querySelectorAll('input[name="density"]').forEach(input => input.addEventListener("change", () => markDirty()));
  element("generate").addEventListener("click", () => generate());
  element("history-previous").addEventListener("click", () => navigateHistory(-1));
  element("history-next").addEventListener("click", () => navigateHistory(1));
  element("resize-grid").addEventListener("click", () => {
    if (!resizeProposal) return;
    element("rows").value = resizeProposal.rows;
    element("columns").value = resizeProposal.columns;
    markDirty(false);
    generate(false);
  });
  element("solution").addEventListener("change", renderSolution);
  async function copyContent(kind) {
    if (!puzzle) return;
    const button = element(kind === "words" ? "copy-words" : "copy-grid");
    if (button.getAttribute("aria-busy") === "true") return;
    const text = kind === "words" ? puzzle.words.join("\n") : puzzle.grid.map(row => row.join(" ")).join("\n");
    button.setAttribute("aria-busy", "true");
    element("export-status").textContent = "";
    try {
      await copyText(text);
      element("export-status").textContent = `${kind === "words" ? "Word list" : "Grid"} copied to clipboard.`;
    } catch (error) {
      element("export-status").textContent = error.message;
    } finally {
      button.removeAttribute("aria-busy");
    }
  }
  element("copy-words").addEventListener("click", () => copyContent("words"));
  element("copy-grid").addEventListener("click", () => copyContent("grid"));
  element("export").addEventListener("click", async () => {
    if (!puzzle || exporting) return;
    const format = element("export-format").value;
    const snapshot = puzzle;
    const showSolution = element("solution").checked;
    element("export-status").textContent = "";
    if (format === "pdf") {
      preparePrint(snapshot, showSolution);
      window.print();
      return;
    }
    exporting = true;
    element("export").disabled = true;
    element("export-status").textContent = "Preparing image\u2026";
    try {
      const canvas = drawPuzzleToCanvas(snapshot, showSolution);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, `image/${format}`, 0.95));
      if (!blob) throw new Error("The browser could not create this image. Try Print / Save PDF.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = snapshot.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "word-search";
      link.download = `${filename}${showSolution ? "-solution" : ""}.${format === "jpeg" ? "jpg" : "png"}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      element("export-status").textContent = `${format.toUpperCase()} image downloaded.`;
    } catch (error) {
      element("export-status").textContent = error.message;
    } finally {
      exporting = false;
      element("export").disabled = !puzzle;
    }
  });
  window.addEventListener("beforeprint", () => {
    if (puzzle) preparePrint(puzzle, element("solution").checked);
  });
  renderWords();
  generate();
}

if (typeof document !== "undefined") initializeApp();