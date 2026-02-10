let engine = null;

class ChessEngine {
    constructor() {
        this.isReady = false;
        this.messageHandler = null;
        this.init();
    }

    init() {
        try {
            // Coba stockfish.js (paling compatible dengan Render)
            const Stockfish = require('stockfish.js');
            engine = Stockfish();

            // Setup listener
            engine.onmessage = (line) => {
                if (line === 'readyok') {
                    this.isReady = true;
                    console.log('✅ Stockfish ready!');
                }
                // Forward ke handler aktif
                if (this.messageHandler) {
                    this.messageHandler(line);
                }
            };

            this.setupEngine();
            console.log('♟️ Stockfish engine loaded (stockfish.js)!');

        } catch (e) {
            console.log('⚠️ stockfish.js gagal, coba fallback...');

            try {
                // Fallback: stockfish.wasm
                const Stockfish = require('stockfish.wasm');
                engine = Stockfish();

                engine.onmessage = (line) => {
                    if (line === 'readyok') {
                        this.isReady = true;
                        console.log('✅ Stockfish WASM ready!');
                    }
                    if (this.messageHandler) {
                        this.messageHandler(line);
                    }
                };

                this.setupEngine();
                console.log('♟️ Stockfish engine loaded (WASM)!');

            } catch (e2) {
                console.log('⚠️ Semua Stockfish gagal, pakai built-in AI');
                console.log('Error:', e2.message);
                engine = null;
            }
        }
    }

    setupEngine() {
        if (!engine) return;
        this.sendCommand('uci');
        this.sendCommand('setoption name Threads value 1');
        this.sendCommand('setoption name Hash value 16');
        this.sendCommand('isready');
    }

    sendCommand(cmd) {
        if (engine) {
            engine.postMessage(cmd);
        }
    }

    // === BUILT-IN AI FALLBACK ===
    // Kalau Stockfish gagal, pakai Minimax sederhana
    builtInBestMove(chess, depth = 3) {
        const { Chess } = require('chess.js');

        const pieceValues = {
            'p': 100, 'n': 320, 'b': 330,
            'r': 500, 'q': 900, 'k': 20000
        };

        function evaluate(chess) {
            let score = 0;
            const board = chess.board();
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const piece = board[row][col];
                    if (piece) {
                        const val = pieceValues[piece.type] || 0;
                        score += piece.color === 'w' ? val : -val;
                    }
                }
            }
            return score;
        }

        function minimax(chess, depth, alpha, beta, isMax) {
            if (depth === 0 || chess.isGameOver()) {
                return evaluate(chess);
            }

            const moves = chess.moves();

            if (isMax) {
                let maxEval = -Infinity;
                for (const move of moves) {
                    chess.move(move);
                    const eval_ = minimax(chess, depth - 1, alpha, beta, false);
                    chess.undo();
                    maxEval = Math.max(maxEval, eval_);
                    alpha = Math.max(alpha, eval_);
                    if (beta <= alpha) break;
                }
                return maxEval;
            } else {
                let minEval = Infinity;
                for (const move of moves) {
                    chess.move(move);
                    const eval_ = minimax(chess, depth - 1, alpha, beta, true);
                    chess.undo();
                    minEval = Math.min(minEval, eval_);
                    beta = Math.min(beta, eval_);
                    if (beta <= alpha) break;
                }
                return minEval;
            }
        }

        const moves = chess.moves();
        let bestMove = moves[0];
        let bestEval = chess.turn() === 'w' ? -Infinity : Infinity;

        for (const move of moves) {
            chess.move(move);
            const eval_ = minimax(chess, depth - 1, -Infinity, Infinity, chess.turn() === 'w');
            chess.undo();

            if (chess.turn() === 'w' && eval_ > bestEval) {
                bestEval = eval_;
                bestMove = move;
            } else if (chess.turn() === 'b' && eval_ < bestEval) {
                bestEval = eval_;
                bestMove = move;
            }
        }

        return bestMove;
    }

    // === FUNGSI UTAMA: Best Move ===
    getBestMove(fen, depth = 12) {
        return new Promise((resolve) => {
            // Kalau Stockfish gak ada, pakai built-in
            if (!engine) {
                const { Chess } = require('chess.js');
                const chess = new Chess(fen);
                const cappedDepth = Math.min(depth, 4); // Limit built-in
                const move = this.builtInBestMove(chess, cappedDepth);
                resolve({ bestMove: move, ponderMove: null, source: 'builtin' });
                return;
            }

            const timeout = setTimeout(() => {
                resolve(null);
            }, 15000);

            this.messageHandler = (line) => {
                if (typeof line === 'string' && line.startsWith('bestmove')) {
                    clearTimeout(timeout);
                    const parts = line.split(' ');
                    resolve({
                        bestMove: parts[1],
                        ponderMove: parts[3] || null,
                        source: 'stockfish'
                    });
                    this.messageHandler = null;
                }
            };

            this.sendCommand('ucinewgame');
            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${depth}`);
        });
    }

    // === FUNGSI CHEAT: Analisis ===
    getAnalysis(fen, depth = 15) {
        return new Promise((resolve) => {
            if (!engine) {
                resolve({ bestMove: null, score: 0, mate: null, lines: [] });
                return;
            }

            const analysis = {
                bestMove: null,
                score: 0,
                mate: null,
                lines: []
            };

            const timeout = setTimeout(() => {
                resolve(analysis);
            }, 15000);

            this.messageHandler = (line) => {
                if (typeof line === 'string') {
                    if (line.startsWith('info depth')) {
                        const scoreMatch = line.match(/score cp (-?\d+)/);
                        const mateMatch = line.match(/score mate (-?\d+)/);
                        const pvMatch = line.match(/pv (.+)/);
                        const depthMatch = line.match(/^info depth (\d+)/);

                        if (depthMatch) {
                            analysis.lines.push({
                                depth: parseInt(depthMatch[1]),
                                score: scoreMatch ? parseInt(scoreMatch[1]) / 100 : null,
                                mate: mateMatch ? parseInt(mateMatch[1]) : null,
                                moves: pvMatch ? pvMatch[1].split(' ') : []
                            });
                        }
                    }

                    if (line.startsWith('bestmove')) {
                        clearTimeout(timeout);
                        analysis.bestMove = line.split(' ')[1];
                        if (analysis.lines.length > 0) {
                            const last = analysis.lines[analysis.lines.length - 1];
                            analysis.score = last.score;
                            analysis.mate = last.mate;
                        }
                        this.messageHandler = null;
                        resolve(analysis);
                    }
                }
            };

            this.sendCommand('ucinewgame');
            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${depth}`);
        });
    }

    // === FUNGSI CHEAT: Top 3 Moves ===
    getTopMoves(fen, depth = 12) {
        return new Promise((resolve) => {
            if (!engine) {
                const { Chess } = require('chess.js');
                const chess = new Chess(fen);
                const move = this.builtInBestMove(chess, 3);
                resolve([{ rank: 1, move, score: 0, mate: null, line: move }]);
                return;
            }

            const topMoves = [];
            const timeout = setTimeout(() => {
                this.sendCommand('setoption name MultiPV value 1');
                this.messageHandler = null;
                resolve(topMoves);
            }, 15000);

            this.sendCommand('setoption name MultiPV value 3');

            this.messageHandler = (line) => {
                if (typeof line === 'string') {
                    if (line.startsWith('info depth') && line.includes(`depth ${depth} `)) {
                        const multipvMatch = line.match(/multipv (\d+)/);
                        const scoreMatch = line.match(/score cp (-?\d+)/);
                        const mateMatch = line.match(/score mate (-?\d+)/);
                        const pvMatch = line.match(/pv (.+)/);

                        if (multipvMatch && pvMatch) {
                            topMoves[parseInt(multipvMatch[1]) - 1] = {
                                rank: parseInt(multipvMatch[1]),
                                move: pvMatch[1].split(' ')[0],
                                score: scoreMatch ? parseInt(scoreMatch[1]) / 100 : null,
                                mate: mateMatch ? parseInt(mateMatch[1]) : null,
                                line: pvMatch[1].split(' ').slice(0, 5).join(' ')
                            };
                        }
                    }

                    if (line.startsWith('bestmove')) {
                        clearTimeout(timeout);
                        this.sendCommand('setoption name MultiPV value 1');
                        this.messageHandler = null;
                        resolve(topMoves.filter(Boolean));
                    }
                }
            };

            this.sendCommand('ucinewgame');
            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${depth}`);
        });
    }

    // === HELPERS ===
    stop() {
        this.sendCommand('stop');
    }

    newGame() {
        this.sendCommand('ucinewgame');
        this.sendCommand('isready');
    }

    isAvailable() {
        return engine !== null;
    }
}

module.exports = new ChessEngine();
