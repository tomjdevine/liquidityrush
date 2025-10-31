// Game constants
const BOARD_WIDTH = 300;
const BOARD_HEIGHT = 600;
const CELL_SIZE = 30;
const COLS = BOARD_WIDTH / CELL_SIZE;
const ROWS = BOARD_HEIGHT / CELL_SIZE;

// Target zone (40-60% of board height)
const TARGET_ZONE_TOP = 0.4;
const TARGET_ZONE_BOTTOM = 0.6;
const TARGET_TOP_Y = BOARD_HEIGHT * TARGET_ZONE_TOP;
const TARGET_BOTTOM_Y = BOARD_HEIGHT * TARGET_ZONE_BOTTOM;

// Game state
let canvas, ctx;
let gameRunning = false;
let gameStartTime = 0;
let currentPiece = null;
let stackedBlocks = [];
let balance = 50; // Start at 50% (middle)
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
    
    for (let row = 0; row < shape.length; row++) {
        for (let col = 0; col < shape[row].length; col++) {
            if (shape[row][col]) {
                const boardRow = Math.floor((block.y + row * CELL_SIZE) / CELL_SIZE);
                const boardCol = block.x + col;
                
                if (boardRow >= 0 && boardRow < ROWS) {
                    if (!stackedBlocks[boardRow]) {
                        stackedBlocks[boardRow] = [];
                    }
                    stackedBlocks[boardRow][boardCol] = {
                        type: block.type
                    };
                }
            }
        }
    }

    // Update balance based on block type and size
    let cellCount = 0;
    for (let row = 0; row < shape.length; row++) {
        for (let col = 0; col < shape[row].length; col++) {
            if (shape[row][col]) cellCount++;
        }
    }
    
    // Each cell changes balance by 2% (so a 5-cell block changes balance by 10%)
    const balanceChange = cellCount * 2;
    
    if (block.type === 'inflow') {
        balance = Math.min(100, balance + balanceChange);
    } else {
        balance = Math.max(0, balance - balanceChange);
    }

    updateBalanceDisplay();
}

// Check if piece should stop falling
function shouldStopPiece(block) {
    return block.checkCollision(0, CELL_SIZE);
}

// Draw target zone
function drawTargetZone() {
    // Draw background gradient for target zone
    const gradient = ctx.createLinearGradient(0, TARGET_TOP_Y, 0, TARGET_BOTTOM_Y);
    gradient.addColorStop(0, 'rgba(76, 175, 80, 0.2)');
    gradient.addColorStop(0.5, 'rgba(76, 175, 80, 0.3)');
    gradient.addColorStop(1, 'rgba(76, 175, 80, 0.2)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, TARGET_TOP_Y, BOARD_WIDTH, TARGET_BOTTOM_Y - TARGET_TOP_Y);
    
    // Draw borders
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, TARGET_TOP_Y);
    ctx.lineTo(BOARD_WIDTH, TARGET_TOP_Y);
    ctx.moveTo(0, TARGET_BOTTOM_Y);
    ctx.lineTo(BOARD_WIDTH, TARGET_BOTTOM_Y);
    ctx.stroke();
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

// Draw balance indicator
function drawBalanceIndicator() {
    const balanceY = BOARD_HEIGHT * (1 - balance / 100);
    
    // Draw line at current balance
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, balanceY);
    ctx.lineTo(BOARD_WIDTH, balanceY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw indicator circle
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(BOARD_WIDTH / 2, balanceY, 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

// Update balance display
function updateBalanceDisplay() {
    const balanceElement = document.getElementById('balance');
    balanceElement.textContent = Math.round(balance) + '%';
    
    // Check if balance is out of target zone (40-60%)
    if (balance < 40 || balance > 60) {
        endGame();
    }
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

    // Draw target zone
    drawTargetZone();

    // Draw stacked blocks
    drawStackedBlocks();

    // Draw balance indicator
    drawBalanceIndicator();

    // Draw current falling piece
    if (currentPiece) {
        currentPiece.draw();
    }
}

// Game loop
function gameLoop(time = 0) {
    if (!gameRunning) return;

    const deltaTime = time - lastTime;
    lastTime = time;

    // Drop piece periodically
    dropTime += deltaTime;
    const dropInterval = 500; // milliseconds

    if (dropTime >= dropInterval) {
        if (currentPiece) {
            if (shouldStopPiece(currentPiece)) {
                placeBlock(currentPiece);
                currentPiece = createNewPiece();
                
                // Check if new piece collides immediately (game over condition)
                if (shouldStopPiece(currentPiece)) {
                    endGame();
                    return;
                }
            } else {
                currentPiece.y += CELL_SIZE;
            }
        }
        dropTime = 0;
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
    balance = 50;
    stackedBlocks = [];
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
function endGame() {
    if (!gameRunning) return;
    
    gameRunning = false;
    const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    document.getElementById('final-time').textContent = elapsed;
    document.getElementById('game-over').classList.remove('hidden');
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

