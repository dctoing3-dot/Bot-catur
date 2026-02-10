const { createCanvas } = require('@napi-rs/canvas');

// === KONFIGURASI TAMPILAN ===
const SQUARE_SIZE = 80;
const BOARD_SIZE = SQUARE_SIZE * 8;
const BORDER = 35;
const CANVAS_SIZE = BOARD_SIZE + (BORDER * 2);

// Warna tema (Chess.com style)
const THEME = {
    lightSquare: '#EEEED2',
    darkSquare: '#769656',
    border: '#302E2B',
    borderText: '#AAAAAA',
    lastMoveFrom: '#F6F669',
    lastMoveTo: '#BACA2B',
    selectedSquare: '#FFFF0088',
    legalMoveEmpty: '#00000033',
    legalMoveCapture: '#FF000055',
    checkHighlight: '#FF000088',
    coordLight: '#769656',
    coordDark: '#EEEED2',
};

// Unicode bidak catur (fallback tanpa gambar)
const PIECE_CHARS = {
    'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
};

class BoardRenderer {

    // === GAMBAR PAPAN UTAMA ===
    async renderBoard(chess, options = {}) {
        const {
            lastMove = null,
            flipped = false,
            selectedSquare = null,
            legalMoves = [],
            highlightCheck = true
        } = options;

        const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
        const ctx = canvas.getContext('2d');
        const board = chess.board();

        // 1. Background border
        ctx.fillStyle = THEME.border;
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // 2. Gambar kotak-kotak
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const displayRow = flipped ? 7 - row : row;
                const displayCol = flipped ? 7 - col : col;

                const x = BORDER + displayCol * SQUARE_SIZE;
                const y = BORDER + displayRow * SQUARE_SIZE;

                const isLight = (row + col) % 2 === 0;

                // Warna dasar kotak
                ctx.fillStyle = isLight ? THEME.lightSquare : THEME.darkSquare;
                ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);

                const file = col;
                const rank = 7 - row;
                const square = String.fromCharCode(97 + file) + (rank + 1);

                // Highlight last move
                if (lastMove) {
                    if (square === lastMove.from) {
                        ctx.fillStyle = THEME.lastMoveFrom;
                        ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
                    }
                    if (square === lastMove.to) {
                        ctx.fillStyle = THEME.lastMoveTo;
                        ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
                    }
                }

                // Highlight selected square
                if (selectedSquare && square === selectedSquare) {
                    ctx.fillStyle = THEME.selectedSquare;
                    ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
                }

                // Highlight legal moves
                if (legalMoves.length > 0) {
                    const isLegal = legalMoves.find(m => m.to === square);
                    if (isLegal) {
                        if (isLegal.captured) {
                            // Kotak ada bidak lawan = lingkaran besar merah
                            this.drawCaptureHighlight(ctx, x, y);
                        } else {
                            // Kotak kosong = titik kecil
                            this.drawMoveIndicator(ctx, x, y);
                        }
                    }
                }

                // Highlight check
                const piece = board[row][col];
                if (piece && highlightCheck) {
                    if (piece.type === 'k' && chess.isCheck()) {
                        if (piece.color === chess.turn()) {
                            ctx.fillStyle = THEME.checkHighlight;
                            ctx.fillRect(x, y, SQUARE_SIZE, SQUARE_SIZE);
                        }
                    }
                }

                // Gambar bidak
                if (piece) {
                    this.drawPiece(ctx, piece, x, y);
                }

                // Koordinat di pojok kotak (seperti chess.com)
                // File (a-h) di baris paling bawah
                if (displayRow === 7) {
                    ctx.fillStyle = isLight ? THEME.coordLight : THEME.coordDark;
                    ctx.font = 'bold 12px Arial';
                    ctx.textAlign = 'right';
                    ctx.fillText(
                        String.fromCharCode(97 + (flipped ? 7 - col : col)),
                        x + SQUARE_SIZE - 3,
                        y + SQUARE_SIZE - 4
                    );
                }
                // Rank (1-8) di kolom paling kiri
                if (displayCol === 0) {
                    ctx.fillStyle = isLight ? THEME.coordLight : THEME.coordDark;
                    ctx.font = 'bold 12px Arial';
                    ctx.textAlign = 'left';
                    ctx.fillText(
                        (flipped ? row + 1 : 8 - row).toString(),
                        x + 3,
                        y + 14
                    );
                }
            }
        }

        return canvas.toBuffer('image/png');
    }

    // === GAMBAR BIDAK ===
    drawPiece(ctx, piece, x, y) {
        const key = piece.color + piece.type;
        const char = PIECE_CHARS[key];

        const centerX = x + SQUARE_SIZE / 2;
        const centerY = y + SQUARE_SIZE / 2;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.font = `bold ${SQUARE_SIZE * 0.7}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(char, centerX + 2, centerY + 2);

        // Bidak putih = putih dengan outline hitam
        if (piece.color === 'w') {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(char, centerX, centerY);
            ctx.fillStyle = '#FFFFFF';
        } else {
            // Bidak hitam = hitam dengan outline putih
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.strokeText(char, centerX, centerY);
            ctx.fillStyle = '#1A1A1A';
        }
        ctx.fillText(char, centerX, centerY);
    }

    // === TITIK LANGKAH LEGAL ===
    drawMoveIndicator(ctx, x, y) {
        const centerX = x + SQUARE_SIZE / 2;
        const centerY = y + SQUARE_SIZE / 2;
        const radius = SQUARE_SIZE * 0.15;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = THEME.legalMoveEmpty;
        ctx.fill();
    }

    // === HIGHLIGHT MAKAN ===
    drawCaptureHighlight(ctx, x, y) {
        const centerX = x + SQUARE_SIZE / 2;
        const centerY = y + SQUARE_SIZE / 2;
        const outerRadius = SQUARE_SIZE * 0.47;
        const innerRadius = SQUARE_SIZE * 0.38;

        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
        ctx.fillStyle = THEME.legalMoveCapture;
        ctx.fill();
    }

    // === GAMBAR PAPAN UNTUK CHEAT X-RAY ===
    async renderXRay(chess, options = {}) {
        const allMoves = chess.moves({ verbose: true });

        // Kelompokin per kotak asal
        const movesBySquare = {};
        for (const move of allMoves) {
            if (!movesBySquare[move.from]) {
                movesBySquare[move.from] = [];
            }
            movesBySquare[move.from].push(move);
        }

        // Render board dengan SEMUA legal moves di-highlight
        return this.renderBoard(chess, {
            ...options,
            legalMoves: allMoves
        });
    }

    // === GAMBAR EVAL BAR ===
    async renderEvalBar(score, width = 30, height = BOARD_SIZE) {
        const canvas = createCanvas(width, height + (BORDER * 2));
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1A1A1A';
        ctx.fillRect(0, 0, width, height + (BORDER * 2));

        // Hitung posisi bar
        // Score: +10 = full putih, -10 = full hitam
        const clampedScore = Math.max(-10, Math.min(10, score));
        const whitePercent = ((clampedScore + 10) / 20);
        const blackHeight = height * (1 - whitePercent);

        // Bagian hitam (atas)
        ctx.fillStyle = '#1A1A1A';
        ctx.fillRect(0, BORDER, width, blackHeight);

        // Bagian putih (bawah)
        ctx.fillStyle = '#EEEEEE';
        ctx.fillRect(0, BORDER + blackHeight, width, height - blackHeight);

        // Score text
        ctx.fillStyle = score >= 0 ? '#000000' : '#FFFFFF';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        const scoreText = score >= 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
        const textY = score >= 0 
            ? BORDER + blackHeight + 15
            : BORDER + blackHeight - 8;
        ctx.fillText(scoreText, width / 2, textY);

        return canvas.toBuffer('image/png');
    }
}

module.exports = new BoardRenderer();
