// Game constants
const BOARD_WIDTH = 300;
const BOARD_HEIGHT = 600;
const CELL_SIZE = 30;
const COLS = BOARD_WIDTH / CELL_SIZE;
const ROWS = BOARD_HEIGHT / CELL_SIZE;

// Two bands: overdraft (bottom) and excess cash (top)
const OVERDRAFT_LINE = 0.8; // 80% from top (20% from bottom)
const EXCESS_CASH_LINE = 0.2; // 20% from top
const OVERDRAFT_Y = BOARD_HEIGHT * OVERDRAFT_LINE;
const EXCESS_CASH_Y = BOARD_HEIGHT * EXCESS_CASH_LINE;

// Grace period: number of blocks that can be placed before checking overdraft
let gracePeriodBlocks = 5;
let blocksPlaced = 0;

// Timer state
let warningTimer = null; // null means no timer active, otherwise it's the end time
const WARNING_TIMER_DURATION = 20000; // 20 seconds in milliseconds
let hasSolidLayerAboveOverdraft = false;

// Game state
let canvas, ctx;
let gameRunning = false;
let gameStartTime = 0;
let currentPiece = null;
let stackedBlocks = [];
let dropTime = 0;
let lastTime = 0;

// Block shapes (smaller than Tetris to fit narrow column)
const BLOCK_SHAPES = [
    // Line (single block)
    [[1]],
    // L-shapes
    [[1, 0], [1, 1]],
    [[0, 1], [1, 1]],
    [[1, 1], [1, 0]],
    [[1, 1], [0, 1]],
    // T-shape
    [[1, 1, 1], [0, 1, 0]],
    // Square
    [[1, 1], [1, 1]]
];

// Initialize canvas
function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
}

// Block class
class Block {
    constructor(shape, type, x) {
        this.shape = shape;
        this.type = type; // 'inflow' (blue) or 'outflow' (red)
        this.x = x; // Horizontal position (0 to COLS - shape width)
        this.y = 0; // Vertical position
        this.rotation = 0;
    }

    getWidth() {
        return this.shape[0].length;
    }

    getHeight() {
        return this.shape.length;
    }

    // Get rotated shape
    getRotatedShape() {
        let shape = this.shape;
        for (let i = 0; i < this.rotation % 4; i++) {
            shape = this.rotate90(shape);
        }
        return shape;
    }

    rotate90(matrix) {
        const rows = matrix.length;
        const cols = matrix[0].length;
        const rotated = [];
        for (let i = 0; i < cols; i++) {
            rotated[i] = [];
            for (let j = 0; j < rows; j++) {
                rotated[i][j] = matrix[rows - 1 - j][i];
            }
        }
        return rotated;
    }

    // Check collision with walls or stacked blocks
    checkCollision(offsetX = 0, offsetY = 0, newRotation = null) {
        const shape = newRotation !== null ? this.getRotatedShapeWithRotation(newRotation) : this.getRotatedShape();
        const newX = this.x + offsetX;
        const newY = this.y + offsetY;

        // Check walls
        if (newX < 0 || newX + shape[0].length > COLS) {
            return true;
        }
        if (newY + shape.length * CELL_SIZE > BOARD_HEIGHT) {
            return true;
        }

        // Check stacked blocks
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const boardRow = Math.floor((newY + row * CELL_SIZE) / CELL_SIZE);
                    const boardCol = newX + col;
                    
                    if (boardRow >= 0 && boardRow < ROWS) {
                        if (stackedBlocks[boardRow] && stackedBlocks[boardRow][boardCol]) {
                            return true;
                        }
                    }
                }
            }
        }

        return false;
    }

    getRotatedShapeWithRotation(rotation) {
        let shape = this.shape;
        for (let i = 0; i < rotation % 4; i++) {
            shape = this.rotate90(shape);
        }
        return shape;
    }

    // Move block
    move(dx) {
        if (!this.checkCollision(dx, 0)) {
            this.x += dx;
        }
    }

    // Rotate block
    rotate() {
        const newRotation = (this.rotation + 1) % 4;
        if (!this.checkCollision(0, 0, newRotation)) {
            this.rotation = newRotation;
        }
    }

    // Draw block
    draw() {
        const shape = this.getRotatedShape();
        const color = this.type === 'inflow' ? '#4a9eff' : '#ff6b6b';
        const strokeColor = this.type === 'inflow' ? '#2d5aa0' : '#cc0000';

        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const x = (this.x + col) * CELL_SIZE;
                    const y = this.y + row * CELL_SIZE;

                    // Draw block with gradient
                    const gradient = ctx.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
                    gradient.addColorStop(0, color);
                    gradient.addColorStop(1, this.type === 'inflow' ? '#2d5aa0' : '#cc0000');

                    ctx.fillStyle = gradient;
                    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
                    
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
                }
            }
        }
    }
}

// Create new falling piece
function createNewPiece() {
    const shapeIndex = Math.floor(Math.random() * BLOCK_SHAPES.length);
    const shape = BLOCK_SHAPES[shapeIndex].map(row => [...row]);
    const type = Math.random() < 0.5 ? 'inflow' : 'outflow'; // 50/50 chance
    const maxX = COLS - shape[0].length;
    const x = Math.floor(Math.random() * (maxX + 1));
    return new Block(shape, type, x);
}

// Place block on the board
function placeBlock(block) {
    const shape = block.getRotatedShape();
    let hasExcessCashBlocks = false;
    let hasOverdraftBlocks = false;
    
    for (let row = 0; row < shape.length; row++) {
        for (let col = 0; col < shape[row].length; col++) {
            if (shape[row][col]) {
                const boardRow = Math.floor((block.y + row * CELL_SIZE) / CELL_SIZE);
                const boardCol = block.x + col;
                const blockY = block.y + row * CELL_SIZE;
                
                if (boardRow >= 0 && boardRow < ROWS) {
                    if (!stackedBlocks[boardRow]) {
                        stackedBlocks[boardRow] = [];
                    }
                    stackedBlocks[boardRow][boardCol] = {
                        type: block.type
                    };
                    
                    // Check if block is outside safe zone
                    // Blocks must be BELOW the excess cash line (top) and ABOVE the overdraft line (bottom)
                    if (blockY < EXCESS_CASH_Y) {
                        // Block is above the excess cash line (too high)
                        hasExcessCashBlocks = true;
                    }
                    if (blockY > OVERDRAFT_Y && blocksPlaced >= gracePeriodBlocks) {
                        // Block is below the overdraft line (too low)
                        hasOverdraftBlocks = true;
                    }
                }
            }
        }
    }

    blocksPlaced++;
    
    // Clear solid layers anywhere on the board (if any)
    clearSolidLayers();
    
    // Check if there's still a solid layer above overdraft line after clearing
    hasSolidLayerAboveOverdraft = checkSolidLayerAboveOverdraft();
}

// Check if there's a solid layer above the overdraft line (just check, don't clear)
function checkSolidLayerAboveOverdraft() {
    const overdraftRow = Math.floor(OVERDRAFT_Y / CELL_SIZE);
    
    // Check if there's at least one complete row above the overdraft line
    for (let row = 0; row < overdraftRow; row++) {
        if (stackedBlocks[row]) {
            // Check if this row is solid (all columns filled)
            let isSolid = true;
            for (let col = 0; col < COLS; col++) {
                if (!stackedBlocks[row][col]) {
                    isSolid = false;
                    break;
                }
            }
            if (isSolid) {
                return true;
            }
        }
    }
    return false;
}

// Clear solid layers anywhere on the board and make blocks fall down
function clearSolidLayers() {
    const rowsToClear = [];
    
    // Find all solid rows (complete rows) anywhere on the board
    for (let row = 0; row < ROWS; row++) {
        if (stackedBlocks[row]) {
            // Check if this row is solid (all columns filled)
            let isSolid = true;
            for (let col = 0; col < COLS; col++) {
                if (!stackedBlocks[row][col]) {
                    isSolid = false;
                    break;
                }
            }
            if (isSolid) {
                rowsToClear.push(row);
            }
        }
    }
    
    // Clear solid rows and make blocks above fall down
    if (rowsToClear.length > 0) {
        // Sort cleared rows from top to bottom
        rowsToClear.sort((a, b) => a - b);
        
        // For each cleared row, make all rows above it shift down by one
        for (let clearedRow of rowsToClear) {
            // Shift all rows above the cleared row down by one
            // Process from the row just above the cleared row down to row 0
            for (let row = clearedRow - 1; row >= 0; row--) {
                if (stackedBlocks[row]) {
                    // Move this row down by one (to higher row number = lower on screen)
                    stackedBlocks[row + 1] = [...stackedBlocks[row]];
                    delete stackedBlocks[row];
                }
            }
            
            // Clear the topmost row (row 0 moves down, leaving row 0 empty)
            // Actually, we want to clear the cleared row itself, not row 0
            // The cleared row should be empty now after shifting
            if (stackedBlocks[clearedRow]) {
                delete stackedBlocks[clearedRow];
            }
            
            // Adjust indices for subsequent cleared rows
            for (let i = 0; i < rowsToClear.length; i++) {
                if (rowsToClear[i] < clearedRow) {
                    rowsToClear[i]++;
                }
            }
        }
    }
}

// Get the top block position (lowest Y value of stacked blocks only - not falling piece)
function getTopBlockPosition() {
    let topY = BOARD_HEIGHT; // Start at bottom, work up
    
    // Only check stacked blocks, not the current falling piece
    for (let row = 0; row < ROWS; row++) {
        if (stackedBlocks[row]) {
            for (let col = 0; col < COLS; col++) {
                if (stackedBlocks[row][col]) {
                    const y = row * CELL_SIZE;
                    if (y < topY) {
                        topY = y;
                    }
                }
            }
        }
    }
    
    return topY === BOARD_HEIGHT ? null : topY;
}

// Check if piece should stop falling
function shouldStopPiece(block) {
    return block.checkCollision(0, CELL_SIZE);
}

// Draw two bands (overdraft and excess cash)
function drawBands() {
    // Draw safe zone (between the two lines)
    const safeGradient = ctx.createLinearGradient(0, EXCESS_CASH_Y, 0, OVERDRAFT_Y);
    safeGradient.addColorStop(0, 'rgba(76, 175, 80, 0.15)');
    safeGradient.addColorStop(0.5, 'rgba(76, 175, 80, 0.25)');
    safeGradient.addColorStop(1, 'rgba(76, 175, 80, 0.15)');
    
    ctx.fillStyle = safeGradient;
    ctx.fillRect(0, EXCESS_CASH_Y, BOARD_WIDTH, OVERDRAFT_Y - EXCESS_CASH_Y);
    
    // Draw excess cash zone (top - above safe zone)
    const excessGradient = ctx.createLinearGradient(0, 0, 0, EXCESS_CASH_Y);
    excessGradient.addColorStop(0, 'rgba(255, 152, 0, 0.2)');
    excessGradient.addColorStop(1, 'rgba(255, 152, 0, 0.1)');
    
    ctx.fillStyle = excessGradient;
    ctx.fillRect(0, 0, BOARD_WIDTH, EXCESS_CASH_Y);
    
    // Draw overdraft zone (bottom - below safe zone)
    const overdraftGradient = ctx.createLinearGradient(0, OVERDRAFT_Y, 0, BOARD_HEIGHT);
    overdraftGradient.addColorStop(0, 'rgba(244, 67, 54, 0.1)');
    overdraftGradient.addColorStop(1, 'rgba(244, 67, 54, 0.2)');
    
    ctx.fillStyle = overdraftGradient;
    ctx.fillRect(0, OVERDRAFT_Y, BOARD_WIDTH, BOARD_HEIGHT - OVERDRAFT_Y);
    
    // Draw excess cash line (top)
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, EXCESS_CASH_Y);
    ctx.lineTo(BOARD_WIDTH, EXCESS_CASH_Y);
    ctx.stroke();
    
    // Draw overdraft line (bottom)
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, OVERDRAFT_Y);
    ctx.lineTo(BOARD_WIDTH, OVERDRAFT_Y);
    ctx.stroke();
    
    // Draw labels
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    
    // Excess Cash label at top
    ctx.fillText('EXCESS CASH', BOARD_WIDTH / 2, EXCESS_CASH_Y - 8);
    
    // Overdraft label at bottom
    ctx.fillText('OVERDRAFT', BOARD_WIDTH / 2, OVERDRAFT_Y + 20);
}

// Draw stacked blocks
function drawStackedBlocks() {
    for (let row = 0; row < ROWS; row++) {
        if (stackedBlocks[row]) {
            for (let col = 0; col < COLS; col++) {
                if (stackedBlocks[row][col]) {
                    const block = stackedBlocks[row][col];
                    const x = col * CELL_SIZE;
                    const y = row * CELL_SIZE;
                    const color = block.type === 'inflow' ? '#4a9eff' : '#ff6b6b';
                    const strokeColor = block.type === 'inflow' ? '#2d5aa0' : '#cc0000';

                    const gradient = ctx.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
                    gradient.addColorStop(0, color);
                    gradient.addColorStop(1, block.type === 'inflow' ? '#2d5aa0' : '#cc0000');

                    ctx.fillStyle = gradient;
                    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
                    
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
                }
            }
        }
    }
}

// Update balance display (shows blocks placed count instead)
function updateBalanceDisplay() {
    const balanceElement = document.getElementById('balance');
    balanceElement.textContent = blocksPlaced;
}

// Draw timer warning
function drawTimerWarning() {
    if (warningTimer === null) return;
    
    const now = Date.now();
    const remaining = Math.max(0, warningTimer - now);
    const seconds = Math.ceil(remaining / 1000);
    
    // Draw warning overlay
    ctx.fillStyle = 'rgba(244, 67, 54, 0.3)';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    
    // Draw timer text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(seconds, BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    
    // Draw warning text
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('WARNING!', BOARD_WIDTH / 2, BOARD_HEIGHT / 2 - 40);
}

// Update time display
function updateTimeDisplay() {
    if (gameRunning) {
        const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
        document.getElementById('time').textContent = elapsed;
    }
}

// Draw everything
function draw() {
    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    // Draw bands (overdraft and excess cash)
    drawBands();

    // Draw stacked blocks
    drawStackedBlocks();

    // Draw current falling piece
    if (currentPiece) {
        currentPiece.draw();
    }
    
    // Draw timer warning if active
    drawTimerWarning();
}

// Game loop
function gameLoop(time = 0) {
    if (!gameRunning) return;

    const deltaTime = time - lastTime;
    lastTime = time;

    // Drop piece periodically (faster if down arrow is held)
    dropTime += deltaTime;
    const normalDropInterval = 500; // milliseconds
    const fastDropInterval = 50; // milliseconds when down arrow is pressed
    const dropInterval = keys['ArrowDown'] ? fastDropInterval : normalDropInterval;

    if (dropTime >= dropInterval) {
        if (currentPiece) {
            if (shouldStopPiece(currentPiece)) {
                placeBlock(currentPiece);
                currentPiece = createNewPiece();
                
                // Check if new piece collides immediately (game over condition)
                if (shouldStopPiece(currentPiece)) {
                    endGame('Stack Too High!');
                    return;
                }
            } else {
                currentPiece.y += CELL_SIZE;
            }
        }
        dropTime = 0;
    }

    // Check if there's a solid layer above overdraft line (for timer activation)
    hasSolidLayerAboveOverdraft = checkSolidLayerAboveOverdraft();
    
    // Timer logic: only check after solid layer is established
    if (hasSolidLayerAboveOverdraft) {
        const topBlockY = getTopBlockPosition();
        
        if (topBlockY !== null) {
            const isTopBlockBelowOverdraft = topBlockY > OVERDRAFT_Y;
            const isTopBlockAboveExcessCash = topBlockY < EXCESS_CASH_Y;
            
            if (isTopBlockBelowOverdraft || isTopBlockAboveExcessCash) {
                // Top block is outside safe zone - start timer if not already started
                if (warningTimer === null) {
                    warningTimer = Date.now() + WARNING_TIMER_DURATION;
                }
                
                // Check if timer has expired
                if (warningTimer !== null) {
                    const now = Date.now();
                    if (now >= warningTimer) {
                        endGame('Time Limit Exceeded!');
                        return;
                    }
                }
            } else {
                // Top block is back in safe zone - cancel timer
                warningTimer = null;
            }
        }
    }

    // Update time display
    updateTimeDisplay();

    // Draw everything
    draw();

    requestAnimationFrame(gameLoop);
}

// Start game
function startGame() {
    gameRunning = true;
    gameStartTime = Date.now();
    stackedBlocks = [];
    blocksPlaced = 0;
    warningTimer = null;
    hasSolidLayerAboveOverdraft = false;
    currentPiece = createNewPiece();
    dropTime = 0;
    lastTime = performance.now();
    
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('start-btn').textContent = 'Restart';
    updateBalanceDisplay();
    updateTimeDisplay();
    
    requestAnimationFrame(gameLoop);
}

// End game
function endGame(message = '') {
    if (!gameRunning) return;
    
    gameRunning = false;
    const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    document.getElementById('final-time').textContent = elapsed;
    
    // Update game over message if provided
    const gameOverDiv = document.getElementById('game-over');
    if (message) {
        const messageElement = gameOverDiv.querySelector('.game-over-message');
        if (messageElement) {
            messageElement.textContent = message;
        } else {
            const h2 = gameOverDiv.querySelector('h2');
            const msgP = document.createElement('p');
            msgP.className = 'game-over-message';
            msgP.textContent = message;
            msgP.style.color = '#ff6b6b';
            msgP.style.fontSize = '1.2em';
            msgP.style.marginBottom = '10px';
            h2.insertAdjacentElement('afterend', msgP);
        }
    }
    
    gameOverDiv.classList.remove('hidden');
}

// Keyboard controls
let keys = {};
document.addEventListener('keydown', (e) => {
    if (!gameRunning) return;

    keys[e.key] = true;

    if (currentPiece) {
        if (e.key === 'ArrowLeft') {
            currentPiece.move(-1);
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            currentPiece.move(1);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            currentPiece.rotate();
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            // Fast drop - handled in game loop
            e.preventDefault();
        }
    }
    
    draw();
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

// Button handlers
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', () => {
    startGame();
});

// Initialize
window.addEventListener('load', () => {
    initCanvas();
    draw();
});

