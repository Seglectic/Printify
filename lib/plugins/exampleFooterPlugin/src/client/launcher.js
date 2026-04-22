const LIFE_STYLE_ID = 'printify-life-styles';
const LIFE_SURFACE_ID = 'life';
const LIFE_WORLD_WIDTH = 1440;
const LIFE_WORLD_HEIGHT = 840;
const LIFE_MIN_CELL_SIZE = 12;
const LIFE_MAX_CELL_SIZE = 36;
const LIFE_DEFAULT_CELL_SIZE = 20;
const LIFE_MIN_FPS = 5;
const LIFE_MAX_FPS = 60;
const LIFE_DEFAULT_FPS = 18;
const LIFE_DEFAULT_PRESET = 'glider-field';
const LIFE_STORAGE_KEY = 'printify-life-settings';
const LIFE_STARTUP_MESSAGES = [
  "Conway's Game of Life first appeared in 1970.",
  "John Horton Conway designed Life as a zero-player game.",
  "Life only needs four simple rules to create complex behavior.",
  "A glider is one of Life's most famous repeating traveling patterns.",
  "Martin Gardner helped make Conway's Game of Life widely known.",
  "Conway first developed Game of Life in the late 1960s.",
  "Scientific American popularized Life in October 1970.",
  "Game of Life models birth, survival, and death on a grid.",
  "Life became one of the best-known cellular automata ever created.",
  "Conway's rules can create stable, oscillating, and traveling patterns.",
];
const LIFE_PRESET_OPTIONS = [
  { id: 'empty', label: 'Empty' },
  { id: 'random', label: 'Random' },
  { id: 'glider-field', label: 'Glider Field' },
  { id: 'acorn-garden', label: 'Acorn Garden' },
  { id: 'oscillator-lab', label: 'Oscillator Lab' },
  { id: 'spaceship-lanes', label: 'Spaceship Lanes' },
  { id: 'pulsar-array', label: 'Pulsar Array' },
  { id: 'r-pentomino-rain', label: 'R-Pentomino Rain' },
];

let activePlugin = null;

const getRandomLifeMessage = () => (
  LIFE_STARTUP_MESSAGES[Math.floor(Math.random() * LIFE_STARTUP_MESSAGES.length)]
);

const getPresetLabel = presetId => (
  LIFE_PRESET_OPTIONS.find(option => option.id === presetId)?.label || 'Glider Field'
);

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};

const loadStoredLifeSettings = () => {
  try {
    const raw = window.localStorage.getItem(LIFE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return {
      fps: clampNumber(parsed?.fps, LIFE_MIN_FPS, LIFE_MAX_FPS, LIFE_DEFAULT_FPS),
      cellSize: clampNumber(parsed?.cellSize, LIFE_MIN_CELL_SIZE, LIFE_MAX_CELL_SIZE, LIFE_DEFAULT_CELL_SIZE),
      preset: LIFE_PRESET_OPTIONS.some(option => option.id === parsed?.preset)
        ? parsed.preset
        : LIFE_DEFAULT_PRESET,
    };
  } catch (_error) {
    return null;
  }
};

const LIFE_PRESETS = {
  empty: () => {},
  random: ({ grid, rows, columns }) => {
    const density = (rows * columns) > 2600 ? 0.18 : 0.22;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        grid[row][column] = Math.random() < density ? 1 : 0;
      }
    }
  },
  'glider-field': ({ stamp }) => {
    const glider = [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ];
    const spacing = 12;

    for (let row = 4; row < 200; row += spacing) {
      const rowOffset = Math.floor(((row - 4) / spacing) % 2) * Math.floor(spacing / 2);
      for (let column = 4; column < 200; column += spacing) {
        stamp(glider, row, column + rowOffset);
      }
    }
  },
  'acorn-garden': ({ stamp, rows, columns }) => {
    const acorn = [
      [0, 1],
      [1, 3],
      [2, 0],
      [2, 1],
      [2, 4],
      [2, 5],
      [2, 6],
    ];
    const rowStep = Math.max(10, Math.floor(rows / 4));
    const columnStep = Math.max(14, Math.floor(columns / 5));

    for (let row = Math.max(3, Math.floor(rowStep / 2)); row < rows - 4; row += rowStep) {
      const rowIndex = Math.floor((row - Math.max(3, Math.floor(rowStep / 2))) / rowStep);
      const columnOffset = (rowIndex % 2) * Math.floor(columnStep / 2);
      for (let column = Math.max(3, Math.floor(columnStep / 2)); column < columns - 7; column += columnStep) {
        const staggeredColumn = column + columnOffset;
        if (staggeredColumn >= columns - 7) {
          continue;
        }
        stamp(acorn, row, staggeredColumn);
      }
    }
  },
  'oscillator-lab': ({ stamp, rows, columns }) => {
    const blinker = [
      [0, 0],
      [0, 1],
      [0, 2],
    ];
    const toad = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
    ];
    const beacon = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 2],
      [2, 3],
      [3, 2],
      [3, 3],
    ];
    const patterns = [blinker, toad, beacon];
    const rowStep = Math.max(8, Math.floor(rows / 5));
    const columnStep = Math.max(10, Math.floor(columns / 6));
    let patternIndex = 0;

    for (let row = 4; row < rows - 5; row += rowStep) {
      const rowIndex = Math.floor((row - 4) / rowStep);
      const columnOffset = (rowIndex % 2) * Math.floor(columnStep / 2);
      for (let column = 4; column < columns - 5; column += columnStep) {
        const staggeredColumn = column + columnOffset;
        if (staggeredColumn >= columns - 5) {
          continue;
        }
        stamp(patterns[patternIndex % patterns.length], row, staggeredColumn);
        patternIndex += 1;
      }
    }
  },
  'spaceship-lanes': ({ stamp, rows, columns }) => {
    const lightweightSpaceship = [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 0],
      [1, 4],
      [2, 4],
      [3, 0],
      [3, 3],
    ];
    const rowStep = Math.max(10, Math.floor(rows / 5));
    const columnStep = Math.max(16, Math.floor(columns / 5));

    for (let row = 3; row < rows - 5; row += rowStep) {
      const rowIndex = Math.floor((row - 3) / rowStep);
      const columnOffset = (rowIndex % 2) * Math.floor(columnStep / 2);
      for (let column = 3; column < columns - 6; column += columnStep) {
        const staggeredColumn = column + columnOffset;
        if (staggeredColumn >= columns - 6) {
          continue;
        }
        stamp(lightweightSpaceship, row, staggeredColumn);
      }
    }
  },
  'pulsar-array': ({ stamp, rows, columns }) => {
    const pulsar = [
      [0, 2], [0, 3], [0, 4], [0, 8], [0, 9], [0, 10],
      [2, 0], [2, 5], [2, 7], [2, 12],
      [3, 0], [3, 5], [3, 7], [3, 12],
      [4, 0], [4, 5], [4, 7], [4, 12],
      [5, 2], [5, 3], [5, 4], [5, 8], [5, 9], [5, 10],
      [7, 2], [7, 3], [7, 4], [7, 8], [7, 9], [7, 10],
      [8, 0], [8, 5], [8, 7], [8, 12],
      [9, 0], [9, 5], [9, 7], [9, 12],
      [10, 0], [10, 5], [10, 7], [10, 12],
      [12, 2], [12, 3], [12, 4], [12, 8], [12, 9], [12, 10],
    ];
    const rowStep = Math.max(16, Math.floor(rows / 3));
    const columnStep = Math.max(18, Math.floor(columns / 3));

    for (let row = 2; row < rows - 14; row += rowStep) {
      const rowIndex = Math.floor((row - 2) / rowStep);
      const columnOffset = (rowIndex % 2) * Math.floor(columnStep / 2);
      for (let column = 2; column < columns - 14; column += columnStep) {
        const staggeredColumn = column + columnOffset;
        if (staggeredColumn >= columns - 14) {
          continue;
        }
        stamp(pulsar, row, staggeredColumn);
      }
    }
  },
  'r-pentomino-rain': ({ stamp, rows, columns }) => {
    const rPentomino = [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [2, 1],
    ];
    const rowStep = Math.max(9, Math.floor(rows / 5));
    const columnStep = Math.max(12, Math.floor(columns / 6));

    for (let row = 3; row < rows - 4; row += rowStep) {
      const rowIndex = Math.floor((row - 3) / rowStep);
      const columnOffset = (rowIndex % 2) * Math.floor(columnStep / 2);
      for (let column = 3; column < columns - 4; column += columnStep) {
        const staggeredColumn = column + columnOffset;
        if (staggeredColumn >= columns - 4) {
          continue;
        }
        stamp(rPentomino, row, staggeredColumn);
      }
    }
  },
};

const loadStyles = () => {
  if (document.getElementById(LIFE_STYLE_ID)) {
    return;
  }

  const link = document.createElement('link');
  link.id = LIFE_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plugins/exampleFooterPlugin/client/life.css';
  document.head.appendChild(link);
};

class PrintifyLifePlugin {
  constructor(pluginConfig, options = {}) {
    this.pluginConfig = pluginConfig;
    this.options = options;
    const storedSettings = loadStoredLifeSettings();
    this.cellSize = storedSettings?.cellSize || LIFE_DEFAULT_CELL_SIZE;
    this.columns = Math.floor(LIFE_WORLD_WIDTH / this.cellSize);
    this.rows = Math.floor(LIFE_WORLD_HEIGHT / this.cellSize);
    this.fps = storedSettings?.fps || LIFE_DEFAULT_FPS;
    this.selectedPreset = storedSettings?.preset || LIFE_DEFAULT_PRESET;
    this.running = true;
    this.lastTickAt = 0;
    this.animationFrameId = null;
    this.isVisible = false;
    this.grid = this.createPresetGrid(this.selectedPreset);
    this.nextGrid = this.createEmptyGrid();
    this.isPainting = false;
    this.paintValue = 1;
    this.lastPaintedCellKey = null;
    this.resizeObserver = null;
    this.lastAnnouncementAt = 0;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.stepLoop = this.stepLoop.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  get footerDrawer() {
    return this.options.footerDrawer || window.printifyFooterDrawer || null;
  }

  get showFeedback() {
    return typeof this.options.showFeedback === 'function'
      ? this.options.showFeedback
      : null;
  }

  persistSettings() {
    try {
      window.localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({
        fps: this.fps,
        cellSize: this.cellSize,
        preset: this.selectedPreset,
      }));
    } catch (_error) {
      // Storage is best-effort here; the sim should stay usable if the browser blocks it.
    }
  }

  createEmptyGrid() {
    return Array.from({ length: this.rows }, () => Array.from({ length: this.columns }, () => 0));
  }

  createRandomGrid() {
    return Array.from({ length: this.rows }, () => Array.from({ length: this.columns }, () => (
      Math.random() > 0.74 ? 1 : 0
    )));
  }

  createPresetGrid(presetId) {
    const grid = this.createEmptyGrid();
    const preset = LIFE_PRESETS[presetId] || LIFE_PRESETS[LIFE_DEFAULT_PRESET];
    const stamp = (cells, startRow, startColumn) => {
      cells.forEach(([rowOffset, columnOffset]) => {
        const row = startRow + rowOffset;
        const column = startColumn + columnOffset;
        if (row >= 0 && row < this.rows && column >= 0 && column < this.columns) {
          grid[row][column] = 1;
        }
      });
    };

    preset({
      grid,
      rows: this.rows,
      columns: this.columns,
      stamp,
    });

    return grid;
  }

  async open() {
    loadStyles();

    if (!this.footerDrawer) {
      throw new Error('Life plugin needs the footer drawer host.');
    }

    if (!this.root) {
      this.renderShell();
    }

    // Footer plugins are expected to register a long-lived surface object with
    // the shared host and then activate that surface by id. This keeps heavy
    // client plugins mounted while the footer is hidden.
    this.footerDrawer.registerSurface({
      id: LIFE_SURFACE_ID,
      title: '',
      tabLabel: 'LIFE',
      eyebrow: '',
      statusLabel: "Conway's Game of Life",
      height: '90vh',
      content: this.root,
      onVisibilityChange: isVisible => this.handleVisibilityChange(isVisible),
    });
    this.footerDrawer.activateSurface(LIFE_SURFACE_ID);
    this.scheduleLayoutSync();
    this.announceStartupMessage();
  }

  announceStartupMessage() {
    if (!this.showFeedback) {
      return;
    }

    const now = Date.now();
    if ((now - this.lastAnnouncementAt) < 1800) {
      return;
    }

    this.lastAnnouncementAt = now;
    this.showFeedback(getRandomLifeMessage(), { interruptAssistant: true });
  }

  renderShell() {
    this.root = document.createElement('div');
    this.root.className = 'printify-life';
    this.root.innerHTML = `
      <section class="printify-life__shell">
        <div class="printify-life__board-wrap">
          <canvas class="printify-life__board" width="${LIFE_WORLD_WIDTH}" height="${LIFE_WORLD_HEIGHT}"></canvas>
        </div>
        <footer class="printify-life__control-panel">
          <div class="printify-life__meta">
            <div class="printify-life__stats">
              <div class="printify-life__stat">
                <p class="printify-life__stat-label">Generation</p>
                <p class="printify-life__stat-value" data-role="generation">0</p>
              </div>
              <div class="printify-life__stat">
                <p class="printify-life__stat-label">Living Cells</p>
                <p class="printify-life__stat-value" data-role="population">0</p>
              </div>
            </div>
          </div>
          <p class="printify-life__copy">Click and drag to seed cells. Pause, step, reseed, or tune the colony below.</p>
          <div class="printify-life__controls">
            <div class="printify-life__sliders">
              <label class="printify-life__slider">
                <span class="printify-life__stat-label">Speed</span>
                <input type="range" min="${LIFE_MIN_FPS}" max="${LIFE_MAX_FPS}" step="1" value="${this.fps}" data-role="speed">
                <span class="printify-life__slider-value" data-role="speed-value">${this.fps} FPS</span>
              </label>
              <label class="printify-life__slider">
                <span class="printify-life__stat-label">Cell Size</span>
                <input type="range" min="${LIFE_MIN_CELL_SIZE}" max="${LIFE_MAX_CELL_SIZE}" step="2" value="${this.cellSize}" data-role="cell-size">
                <span class="printify-life__slider-value" data-role="cell-size-value">${this.cellSize}px</span>
              </label>
              <label class="printify-life__slider">
                <span class="printify-life__stat-label">Starting Pattern</span>
                <select class="printify-life__select" data-role="preset">
                  ${LIFE_PRESET_OPTIONS.map(option => `
                    <option value="${option.id}"${option.id === this.selectedPreset ? ' selected' : ''}>${option.label}</option>
                  `).join('')}
                </select>
                <span class="printify-life__slider-value" data-role="preset-value">${getPresetLabel(this.selectedPreset)}</span>
              </label>
            </div>
            <div class="printify-life__actions">
              <button class="printify-life__button printify-life__button--primary" type="button" data-role="toggle">Pause</button>
              <button class="printify-life__button" type="button" data-role="step">Step</button>
              <button class="printify-life__button" type="button" data-role="seed">Reseed</button>
              <button class="printify-life__button" type="button" data-role="clear">Clear</button>
            </div>
          </div>
        </footer>
      </section>
    `;

    this.canvas = this.root.querySelector('canvas');
    this.context = this.canvas.getContext('2d');
    this.toggleButton = this.root.querySelector('[data-role="toggle"]');
    this.generationNode = this.root.querySelector('[data-role="generation"]');
    this.populationNode = this.root.querySelector('[data-role="population"]');
    this.speedSlider = this.root.querySelector('[data-role="speed"]');
    this.speedValueNode = this.root.querySelector('[data-role="speed-value"]');
    this.cellSizeSlider = this.root.querySelector('[data-role="cell-size"]');
    this.cellSizeValueNode = this.root.querySelector('[data-role="cell-size-value"]');
    this.presetSelect = this.root.querySelector('[data-role="preset"]');
    this.presetValueNode = this.root.querySelector('[data-role="preset-value"]');
    this.shell = this.root.querySelector('.printify-life__shell');
    this.footer = this.root.querySelector('.printify-life__control-panel');
    this.boardWrap = this.root.querySelector('.printify-life__board-wrap');
    this.generation = 0;

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('lostpointercapture', this.handlePointerUp);
    this.root.querySelector('[data-role="toggle"]').addEventListener('click', () => {
      this.running = !this.running;
      this.toggleButton.textContent = this.running ? 'Pause' : 'Resume';
      if (this.running) {
        this.startLoop();
      }
    });
    this.root.querySelector('[data-role="step"]').addEventListener('click', () => {
      this.running = false;
      this.toggleButton.textContent = 'Resume';
      this.advance();
      this.render();
    });
    this.root.querySelector('[data-role="seed"]').addEventListener('click', () => {
      this.grid = this.createPresetGrid(this.selectedPreset);
      this.generation = 0;
      this.render();
    });
    this.root.querySelector('[data-role="clear"]').addEventListener('click', () => {
      this.grid = this.createEmptyGrid();
      this.generation = 0;
      this.render();
    });
    this.speedSlider.addEventListener('input', event => {
      this.fps = Number(event.currentTarget.value) || LIFE_DEFAULT_FPS;
      this.speedValueNode.textContent = `${this.fps} FPS`;
      this.persistSettings();
    });
    this.cellSizeSlider.addEventListener('input', event => {
      const nextCellSize = Number(event.currentTarget.value) || LIFE_DEFAULT_CELL_SIZE;
      this.resizeGrid(nextCellSize);
      this.cellSizeValueNode.textContent = `${this.cellSize}px`;
      this.persistSettings();
      this.render();
    });
    this.presetSelect.addEventListener('change', event => {
      this.selectedPreset = event.currentTarget.value || LIFE_DEFAULT_PRESET;
      this.presetValueNode.textContent = getPresetLabel(this.selectedPreset);
      this.persistSettings();
      this.grid = this.createPresetGrid(this.selectedPreset);
      this.generation = 0;
      this.render();
    });
  }

  handleVisibilityChange(isVisible) {
    this.isVisible = Boolean(isVisible);

    if (this.isVisible) {
      window.addEventListener('resize', this.handleResize);
      this.startObservingLayout();
      this.startLoop();
      this.scheduleLayoutSync();
      return;
    }

    window.removeEventListener('resize', this.handleResize);
    this.stopObservingLayout();
    this.stopLoop();
  }

  handleResize() {
    this.render();
  }

  startObservingLayout() {
    if (this.resizeObserver || typeof window.ResizeObserver !== 'function') {
      return;
    }

    this.resizeObserver = new window.ResizeObserver(() => {
      this.render();
    });

    [this.root, this.shell, this.footer, this.boardWrap].forEach(node => {
      if (node) {
        this.resizeObserver.observe(node);
      }
    });
  }

  stopObservingLayout() {
    if (!this.resizeObserver) {
      return;
    }

    this.resizeObserver.disconnect();
    this.resizeObserver = null;
  }

  scheduleLayoutSync() {
    this.render();
    window.requestAnimationFrame(() => {
      this.render();
      window.requestAnimationFrame(() => {
        this.render();
      });
    });
  }

  getCellFromPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const cellWidth = rect.width / this.columns;
    const cellHeight = rect.height / this.rows;
    const column = Math.max(0, Math.min(this.columns - 1, Math.floor((event.clientX - rect.left) / cellWidth)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((event.clientY - rect.top) / cellHeight)));
    return { row, column };
  }

  paintCell(cell) {
    if (!cell) {
      return;
    }

    const cellKey = `${cell.row}:${cell.column}`;
    if (this.lastPaintedCellKey === cellKey) {
      return;
    }

    this.grid[cell.row][cell.column] = this.paintValue;
    this.lastPaintedCellKey = cellKey;
  }

  handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const cell = this.getCellFromPointer(event);
    if (!cell) {
      return;
    }

    this.isPainting = true;
    this.paintValue = 1;
    this.lastPaintedCellKey = null;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.paintCell(cell);
    this.render();
  }

  handlePointerMove(event) {
    if (!this.isPainting) {
      return;
    }

    this.paintCell(this.getCellFromPointer(event));
    this.render();
  }

  handlePointerUp() {
    this.isPainting = false;
    this.lastPaintedCellKey = null;
  }

  countPopulation() {
    return this.grid.reduce((count, row) => (
      count + row.reduce((rowCount, cell) => rowCount + cell, 0)
    ), 0);
  }

  countNeighbors(row, column) {
    let total = 0;

    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) {
          continue;
        }

        const nextRow = (row + rowOffset + this.rows) % this.rows;
        const nextColumn = (column + columnOffset + this.columns) % this.columns;
        total += this.grid[nextRow][nextColumn];
      }
    }

    return total;
  }

  resizeGrid(nextCellSize) {
    const clampedCellSize = Math.max(LIFE_MIN_CELL_SIZE, Math.min(LIFE_MAX_CELL_SIZE, nextCellSize));
    const nextColumns = Math.max(8, Math.floor(LIFE_WORLD_WIDTH / clampedCellSize));
    const nextRows = Math.max(8, Math.floor(LIFE_WORLD_HEIGHT / clampedCellSize));
    const nextGrid = Array.from({ length: nextRows }, (_, nextRow) => (
      Array.from({ length: nextColumns }, (_, nextColumn) => {
        const sourceRow = Math.min(this.rows - 1, Math.floor((nextRow / nextRows) * this.rows));
        const sourceColumn = Math.min(this.columns - 1, Math.floor((nextColumn / nextColumns) * this.columns));
        return this.grid[sourceRow]?.[sourceColumn] ? 1 : 0;
      })
    ));

    this.cellSize = clampedCellSize;
    this.rows = nextRows;
    this.columns = nextColumns;
    this.grid = nextGrid;
    this.nextGrid = this.createEmptyGrid();
  }

  advance() {
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const alive = this.grid[row][column] === 1;
        const neighbors = this.countNeighbors(row, column);
        this.nextGrid[row][column] = alive
          ? (neighbors === 2 || neighbors === 3 ? 1 : 0)
          : (neighbors === 3 ? 1 : 0);
      }
    }

    const previousGrid = this.grid;
    this.grid = this.nextGrid;
    this.nextGrid = previousGrid;
    this.generation += 1;
  }

  startLoop() {
    if (!this.isVisible || this.animationFrameId) {
      return;
    }

    this.lastTickAt = 0;
    this.animationFrameId = window.requestAnimationFrame(this.stepLoop);
  }

  stopLoop() {
    if (this.animationFrameId) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  stepLoop(timestamp) {
    if (!this.isVisible) {
      this.animationFrameId = null;
      return;
    }

    if (!this.lastTickAt) {
      this.lastTickAt = timestamp;
    }

    const frameInterval = 1000 / Math.max(LIFE_MIN_FPS, this.fps || LIFE_DEFAULT_FPS);

    if (this.running && (timestamp - this.lastTickAt) >= frameInterval) {
      this.advance();
      this.lastTickAt = timestamp;
      this.render();
    }

    this.animationFrameId = window.requestAnimationFrame(this.stepLoop);
  }

  syncBoardSize() {
    if (!this.shell || !this.footer || !this.boardWrap || !this.canvas) {
      return;
    }

    // Size the live canvas from the stable shell/footer layout instead of from
    // the board itself so the display cannot grow into a feedback loop.
    const shellStyles = window.getComputedStyle(this.shell);
    const shellGap = parseFloat(shellStyles.rowGap || shellStyles.gap || '0') || 0;
    const boardWrapStyles = window.getComputedStyle(this.boardWrap);
    const boardWrapPaddingX = (parseFloat(boardWrapStyles.paddingLeft || '0') || 0)
      + (parseFloat(boardWrapStyles.paddingRight || '0') || 0);
    const boardWrapPaddingY = (parseFloat(boardWrapStyles.paddingTop || '0') || 0)
      + (parseFloat(boardWrapStyles.paddingBottom || '0') || 0);
    const boardWrapBorderX = (parseFloat(boardWrapStyles.borderLeftWidth || '0') || 0)
      + (parseFloat(boardWrapStyles.borderRightWidth || '0') || 0);
    const boardWrapBorderY = (parseFloat(boardWrapStyles.borderTopWidth || '0') || 0)
      + (parseFloat(boardWrapStyles.borderBottomWidth || '0') || 0);
    const wrapWidth = this.shell.clientWidth - boardWrapPaddingX - boardWrapBorderX;
    const wrapHeight = this.shell.clientHeight - this.footer.offsetHeight - shellGap - boardWrapPaddingY - boardWrapBorderY;

    if (!wrapWidth || !wrapHeight) {
      return;
    }

    const scale = Math.min(wrapWidth / LIFE_WORLD_WIDTH, wrapHeight / LIFE_WORLD_HEIGHT);
    const nextWidth = Math.max(1, Math.floor(LIFE_WORLD_WIDTH * scale));
    const nextHeight = Math.max(1, Math.floor(LIFE_WORLD_HEIGHT * scale));

    this.canvas.style.width = `${nextWidth}px`;
    this.canvas.style.height = `${nextHeight}px`;
  }

  render() {
    if (!this.context || !this.canvas) {
      return;
    }

    this.syncBoardSize();

    const styles = window.getComputedStyle(this.root);
    const shellColor = styles.getPropertyValue('--life-shell').trim() || '#f4f7fb';
    const gridColor = styles.getPropertyValue('--life-grid').trim() || 'rgba(49, 103, 213, 0.12)';
    const cellColor = styles.getPropertyValue('--life-cell').trim() || '#27354a';
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cellWidth = width / this.columns;
    const cellHeight = height / this.rows;

    this.context.clearRect(0, 0, width, height);
    this.context.fillStyle = shellColor;
    this.context.fillRect(0, 0, width, height);

    this.context.strokeStyle = gridColor;
    this.context.lineWidth = 1;

    for (let column = 0; column <= this.columns; column += 1) {
      const x = Math.round(column * cellWidth) + 0.5;
      this.context.beginPath();
      this.context.moveTo(x, 0);
      this.context.lineTo(x, height);
      this.context.stroke();
    }

    for (let row = 0; row <= this.rows; row += 1) {
      const y = Math.round(row * cellHeight) + 0.5;
      this.context.beginPath();
      this.context.moveTo(0, y);
      this.context.lineTo(width, y);
      this.context.stroke();
    }

    this.context.fillStyle = cellColor;

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        if (!this.grid[row][column]) {
          continue;
        }

        const x = Math.floor(column * cellWidth) + 1;
        const y = Math.floor(row * cellHeight) + 1;
        this.context.fillRect(x, y, Math.ceil(cellWidth) - 2, Math.ceil(cellHeight) - 2);
      }
    }

    this.generationNode.textContent = String(this.generation);
    this.populationNode.textContent = String(this.countPopulation());
    this.speedValueNode.textContent = `${this.fps} FPS`;
    this.cellSizeValueNode.textContent = `${this.cellSize}px`;
    this.presetValueNode.textContent = getPresetLabel(this.selectedPreset);
  }
}

export const activatePlugin = async (pluginConfig, options = {}) => {
  if (activePlugin) {
    await activePlugin.open();
    return activePlugin;
  }

  activePlugin = new PrintifyLifePlugin(pluginConfig, options);

  try {
    await activePlugin.open();
    return activePlugin;
  } catch (error) {
    activePlugin?.root?.remove();
    options?.footerDrawer?.unregisterSurface?.(LIFE_SURFACE_ID);
    activePlugin = null;
    throw error;
  }
};
