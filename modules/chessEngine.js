const stockfish = require('stockfish');

class ChessEngine {
    constructor() {
        this.engine = null;
        this.isReady = false;
        this.init();
    }

    init() {
        try {
            this.engine = stockfish();
            this.setupEngine();
            console.log('♟️ Stockfish engine loaded!');
        } catch (e) {
            console.log('⚠️ Stockfish gagal dimuat:', e.message);
        }
    }

    setupEngine() {
        // Setting anak baik (hemat CPU buat Render)
        this.sendCommand('uci');
        this.sendCommand('setoption name Threads value 1');
        this.sendCommand('setoption name Hash value 16');
        this.sendCommand('isready');

        this.engine.onmessage = (line) => {
            if (line === 'readyok') {
                this.isReady = true;
                console.log('✅ Stockfish ready!');
            }
        };
    }

    sendCommand(cmd) {
        if (this.engine) {
            this.engine.postMessage(cmd);
        }
    }

    // Fungsi utama: Minta langkah terbaik
    getBestMove(fen, depth = 12) {
        return new Promise((resolve, reject) => {
            if (!this.engine) {
                reject('Engine tidak tersedia');
                return;
            }

            const timeout = setTimeout(() => {
                resolve(null);
            }, 10000); // Timeout 10 detik

            this.engine.onmessage = (line) => {
                if (typeof line === 'string' && line.startsWith('bestmove')) {
                    clearTimeout(timeout);
                    const parts = line.split(' ');
                    const bestMove = parts[1];
                    const ponderMove = parts[3] || null;
                    resolve({ bestMove, ponderMove });
                }
            };

            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${depth}`);
        });
    }

    // Fungsi cheat: Analisis mendalam
    getAnalysis(fen, depth = 15) {
        return new Promise((resolve) => {
            const analysis = {
                bestMove: null,
                score: 0,
                lines: []
            };

            const timeout = setTimeout(() => {
                resolve(analysis);
            }, 10000);

            this.engine.onmessage = (line) => {
                if (typeof line === 'string') {
                    // Ambil info evaluasi
                    if (line.startsWith('info depth')) {
                        const scoreMatch = line.match(/score cp (-?\d+)/);
                        const mateMatch = line.match(/score mate (-?\d+)/);
                        const pvMatch = line.match(/pv (.+)/);
                        const depthMatch = line.match(/^info depth (\d+)/);

                        if (depthMatch) {
                            const info = {
                                depth: parseInt(depthMatch[1]),
                                score: scoreMatch ? parseInt(scoreMatch[1]) / 100 : null,
                                mate: mateMatch ? parseInt(mateMatch[1]) : null,
                                moves: pvMatch ? pvMatch[1].split(' ') : []
                            };
                            analysis.lines.push(info);
                        }
                    }

                    if (line.startsWith('bestmove')) {
                        clearTimeout(timeout);
                        analysis.bestMove = line.split(' ')[1];
                        // Ambil score terakhir
                        if (analysis.lines.length > 0) {
                            const lastLine = analysis.lines[analysis.lines.length - 1];
                            analysis.score = lastLine.score;
                            analysis.mate = lastLine.mate;
                        }
                        resolve(analysis);
                    }
                }
            };

            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${depth}`);
        });
    }

    // Fungsi cheat: Top 3 langkah terbaik
    getTopMoves(fen, depth = 12) {
        return new Promise((resolve) => {
            // Set MultiPV untuk dapat beberapa line
            this.sendCommand('setoption name MultiPV value 3');

            const topMoves = [];
            const timeout = setTimeout(() => {
                this.sendCommand('setoption name MultiPV value 1');
                resolve(topMoves);
            }, 10000);

            this.engine.onmessage = (line) => {
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
                        resolve(topMoves.filter(Boolean));
                    }
                }
            };

            this.sendCommand(`position fen ${fen}`);
            this.sendCommand(`go depth ${depth}`);
        });
    }

    // Stop engine mikir
    stop() {
        this.sendCommand('stop');
    }

    // Reset untuk game baru
    newGame() {
        this.sendCommand('ucinewgame');
        this.sendCommand('isready');
    }
}

module.exports = new ChessEngine();
