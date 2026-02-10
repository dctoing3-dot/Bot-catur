const { Chess } = require('chess.js');

class ChessGame {
    constructor(whitePlayer, blackPlayer, options = {}) {
        this.chess = new Chess();
        this.white = whitePlayer;
        this.black = blackPlayer;
        this.lastMove = null;
        this.moveHistory = [];
        this.startTime = Date.now();
        this.gameId = Math.random().toString(36).substring(7);

        // Timer (default 10 menit)
        this.timeLimit = options.timeLimit || 600000;
        this.whiteTime = this.timeLimit;
        this.blackTime = this.timeLimit;
        this.lastMoveTime = Date.now();

        // AI settings
        this.isAIGame = options.isAI || false;
        this.aiLevel = options.aiLevel || 'medium';
        this.aiDepth = options.aiDepth || 12;

        // Cheat settings (owner only)
        this.autoPlay = false;
        this.hintEnabled = false;
        this.nerfed = false;
        this.originalDepth = this.aiDepth;

        // State untuk select menu
        this.selectedSquare = null; // Bidak yang dipilih
        this.phase = 'select_piece'; // select_piece atau select_target

        // Channel & Message reference
        this.channelId = null;
        this.messageId = null;
    }

    // === GETTER ===
    get currentPlayer() {
        return this.chess.turn() === 'w' ? this.white : this.black;
    }

    get currentColor() {
        return this.chess.turn() === 'w' ? 'Putih ⬜' : 'Hitam ⬛';
    }

    get currentColorEmoji() {
        return this.chess.turn() === 'w' ? '⬜' : '⬛';
    }

    get isWhiteTurn() {
        return this.chess.turn() === 'w';
    }

    get turnNumber() {
        return Math.floor(this.moveHistory.length / 2) + 1;
    }

    // === LANGKAH ===
    move(from, to, promotion = 'q') {
        try {
            const result = this.chess.move({ from, to, promotion });
            if (result) {
                this.lastMove = { from, to };
                this.moveHistory.push(result.san);
                this.updateTimer();
                this.resetSelectState();
                return result;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    moveSAN(san) {
        try {
            const result = this.chess.move(san);
            if (result) {
                this.lastMove = { from: result.from, to: result.to };
                this.moveHistory.push(result.san);
                this.updateTimer();
                this.resetSelectState();
                return result;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    moveUCI(uciMove) {
        // Format UCI: e2e4, e7e8q (promosi)
        const from = uciMove.substring(0, 2);
        const to = uciMove.substring(2, 4);
        const promotion = uciMove[4] || undefined;
        return this.move(from, to, promotion);
    }

    undo() {
        const move1 = this.chess.undo(); // Undo AI
        const move2 = this.chess.undo(); // Undo player
        if (move1) this.moveHistory.pop();
        if (move2) this.moveHistory.pop();
        this.lastMove = null;
        this.resetSelectState();
        return move1 && move2;
    }

    // === SELECT MENU STATE ===
    resetSelectState() {
        this.selectedSquare = null;
        this.phase = 'select_piece';
    }

    selectPiece(square) {
        const piece = this.chess.get(square);
        if (!piece) return null;
        if (piece.color !== this.chess.turn()) return null;

        const legalMoves = this.chess.moves({ square, verbose: true });
        if (legalMoves.length === 0) return null;

        this.selectedSquare = square;
        this.phase = 'select_target';
        return legalMoves;
    }

    // Dapatkan bidak yang bisa digerakkan (untuk dropdown)
    getMovablePieces() {
        const pieces = [];
        const board = this.chess.board();
        const turn = this.chess.turn();

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (piece && piece.color === turn) {
                    const square = String.fromCharCode(97 + col) + (8 - row);
                    const moves = this.chess.moves({ square, verbose: true });
                    if (moves.length > 0) {
                        pieces.push({
                            square,
                            piece: piece.type,
                            color: piece.color,
                            moveCount: moves.length,
                            label: `${this.getPieceName(piece.type)} di ${square.toUpperCase()}`,
                            emoji: this.getPieceEmoji(piece)
                        });
                    }
                }
            }
        }
        return pieces;
    }

    // Dapatkan tujuan legal untuk bidak tertentu (untuk dropdown)
    getLegalTargets(square) {
        const moves = this.chess.moves({ square, verbose: true });
        return moves.map(m => ({
            from: m.from,
            to: m.to,
            san: m.san,
            promotion: m.promotion,
            captured: m.captured,
            label: this.getMoveLabel(m),
            emoji: m.captured ? '⚔️' : '📍'
        }));
    }

    getMoveLabel(move) {
        let label = `${move.to.toUpperCase()} (${move.san})`;
        if (move.captured) label += ' ⚔️ Makan!';
        if (move.san.includes('+')) label += ' ♚ Skak!';
        if (move.san.includes('#')) label += ' 🏆 Skakmat!';
        if (move.san === 'O-O') label = 'Castling Pendek ♜';
        if (move.san === 'O-O-O') label = 'Castling Panjang ♜';
        if (move.promotion) label += ` → ${this.getPieceName(move.promotion)}`;
        return label;
    }

    // === STATUS ===
    getStatus() {
        if (this.chess.isCheckmate()) return 'checkmate';
        if (this.chess.isStalemate()) return 'stalemate';
        if (this.chess.isDraw()) return 'draw';
        if (this.chess.isThreefoldRepetition()) return 'repetition';
        if (this.chess.isInsufficientMaterial()) return 'insufficient';
        if (this.chess.isCheck()) return 'check';
        if (this.whiteTime <= 0) return 'white_timeout';
        if (this.blackTime <= 0) return 'black_timeout';
        return 'playing';
    }

    getStatusEmbed() {
        const status = this.getStatus();
        const messages = {
            'checkmate': { text: `♟️ SKAKMAT! ${this.chess.turn() === 'w' ? this.black.username : this.white.username} MENANG!`, color: '#FFD700', emoji: '🏆' },
            'stalemate': { text: '🤝 STALEMATE! Seri!', color: '#808080', emoji: '🤝' },
            'draw': { text: '🤝 SERI!', color: '#808080', emoji: '🤝' },
            'repetition': { text: '🔄 SERI! Posisi diulang 3x', color: '#808080', emoji: '🔄' },
            'insufficient': { text: '🤝 SERI! Material tidak cukup', color: '#808080', emoji: '🤝' },
            'check': { text: `⚠️ SKAK! ${this.currentColor} dalam bahaya!`, color: '#FF4444', emoji: '⚠️' },
            'white_timeout': { text: `⏰ ${this.black.username} MENANG! Waktu putih habis`, color: '#FFD700', emoji: '⏰' },
            'black_timeout': { text: `⏰ ${this.white.username} MENANG! Waktu hitam habis`, color: '#FFD700', emoji: '⏰' },
            'playing': { text: `${this.currentColorEmoji} Giliran ${this.currentColor}`, color: this.isWhiteTurn ? '#FFFFFF' : '#2C2F33', emoji: '♟️' }
        };
        return messages[status];
    }

    isGameOver() {
        return this.chess.isGameOver() || this.whiteTime <= 0 || this.blackTime <= 0;
    }

    // === TIMER ===
    updateTimer() {
        const now = Date.now();
        const elapsed = now - this.lastMoveTime;
        if (!this.isWhiteTurn) {
            this.whiteTime -= elapsed;
        } else {
            this.blackTime -= elapsed;
        }
        this.lastMoveTime = now;
    }

    getTimerDisplay() {
        const format = (ms) => {
            const m = Math.floor(Math.max(0, ms) / 60000);
            const s = Math.floor((Math.max(0, ms) % 60000) / 1000);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };
        return { white: format(this.whiteTime), black: format(this.blackTime) };
    }

    // === NOTASI ===
    getMoveNotation() {
        let notation = '';
        for (let i = 0; i < this.moveHistory.length; i += 2) {
            const num = Math.floor(i / 2) + 1;
            notation += `${num}. ${this.moveHistory[i]}`;
            if (this.moveHistory[i + 1]) notation += ` ${this.moveHistory[i + 1]} `;
        }
        return notation || 'Belum ada langkah';
    }

    getLastMoves(count = 5) {
        return this.moveHistory.slice(-count).join(', ') || '-';
    }

    // === RESIGN ===
    resign(userId) {
        if (userId === this.white.id) {
            return `🏳️ ${this.white.username} menyerah! ${this.black.username} MENANG! 🏆`;
        }
        if (userId === this.black.id) {
            return `🏳️ ${this.black.username} menyerah! ${this.white.username} MENANG! 🏆`;
        }
        return null;
    }

    // === CHEAT FUNCTIONS ===
    nerfAI() {
        this.nerfed = true;
        this.aiDepth = 2; // Bodohin AI jadi cupu
    }

    unnerfAI() {
        this.nerfed = false;
        this.aiDepth = this.originalDepth;
    }

    // === HELPERS ===
    getFEN() {
        return this.chess.fen();
    }

    getPieceName(type) {
        const names = {
            'k': 'Raja', 'q': 'Ratu', 'r': 'Benteng',
            'b': 'Gajah', 'n': 'Kuda', 'p': 'Pion'
        };
        return names[type] || type;
    }

    getPieceEmoji(piece) {
        const emojis = {
            'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
            'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
        };
        return emojis[piece.color + piece.type] || '?';
    }
}

module.exports = ChessGame;
