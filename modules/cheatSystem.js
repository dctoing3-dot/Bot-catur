const engine = require('./chessEngine');

class CheatSystem {
    constructor() {
        this.ownerId = process.env.OWNER_ID;
    }

    // === CEK OWNER ===
    isOwner(userId) {
        return userId === this.ownerId;
    }

    // === CHEAT 1: HINT ===
    async getHint(game) {
        const fen = game.getFEN();
        const topMoves = await engine.getTopMoves(fen, 15);

        if (!topMoves || topMoves.length === 0) {
            return null;
        }

        const medals = ['🥇', '🥈', '🥉'];
        let hintText = '';

        topMoves.forEach((move, i) => {
            const medal = medals[i] || '▪️';
            let scoreText = '';

            if (move.mate !== null) {
                scoreText = `♚ Skakmat dalam ${Math.abs(move.mate)} langkah!`;
            } else if (move.score !== null) {
                const advantage = move.score >= 0 ? 'Kamu unggul' : 'Kamu tertinggal';
                scoreText = `${move.score >= 0 ? '+' : ''}${move.score} (${advantage})`;
            }

            hintText += `${medal} **${move.move}** → ${scoreText}\n`;
            if (move.line) {
                hintText += `   └─ Prediksi: \`${move.line}\`\n`;
            }
        });

        return hintText;
    }

    // === CHEAT 2: EVAL ===
    async getEvaluation(game) {
        const fen = game.getFEN();
        const analysis = await engine.getAnalysis(fen, 15);

        if (!analysis) return null;

        let evalText = '';

        // Eval bar visual
        const score = analysis.score || 0;
        const barLength = 20;
        const filled = Math.round(((score + 5) / 10) * barLength);
        const clamped = Math.max(0, Math.min(barLength, filled));
        const bar = '⬜'.repeat(clamped) + '⬛'.repeat(barLength - clamped);

        evalText += `📊 **Evaluasi Posisi**\n`;
        evalText += `${bar}\n`;

        if (analysis.mate !== null) {
            if (analysis.mate > 0) {
                evalText += `♚ **SKAKMAT** dalam ${analysis.mate} langkah! (Kamu menang!)\n`;
            } else {
                evalText += `💀 Kamu akan di-skakmat dalam ${Math.abs(analysis.mate)} langkah!\n`;
            }
        } else {
            const scoreNum = analysis.score || 0;
            if (scoreNum > 3) evalText += `🟢 Kamu **SANGAT UNGGUL** (+${scoreNum})\n`;
            else if (scoreNum > 1) evalText += `🟢 Kamu **unggul** (+${scoreNum})\n`;
            else if (scoreNum > 0.3) evalText += `🟡 Kamu **sedikit unggul** (+${scoreNum})\n`;
            else if (scoreNum > -0.3) evalText += `⚪ **Seimbang** (${scoreNum})\n`;
            else if (scoreNum > -1) evalText += `🟡 Kamu **sedikit tertinggal** (${scoreNum})\n`;
            else if (scoreNum > -3) evalText += `🔴 Kamu **tertinggal** (${scoreNum})\n`;
            else evalText += `🔴 Kamu **SANGAT TERTINGGAL** (${scoreNum})\n`;
        }

        evalText += `\n🎯 Langkah terbaik: **${analysis.bestMove}**`;

        return { text: evalText, score: analysis.score || 0 };
    }

    // === CHEAT 3: NERF AI ===
    nerfAI(game) {
        if (game.nerfed) {
            game.unnerfAI();
            return `🧠 AI kembali ke **${game.aiLevel}** (Depth ${game.aiDepth})`;
        } else {
            game.nerfAI();
            return `🤪 AI di-nerf! Sekarang bodoh (Depth ${game.aiDepth})\nTapi tampilan masih **"${game.aiLevel}"** 🤫`;
        }
    }

    // === CHEAT 4: AUTO-PLAY ===
    toggleAutoPlay(game) {
        game.autoPlay = !game.autoPlay;
        if (game.autoPlay) {
            return `🤖 Auto-play **AKTIF**!\nAI Master akan main buat kamu 🤫\nDelay random 3-8 detik biar natural`;
        } else {
            return `🤖 Auto-play **NONAKTIF**\nKamu main sendiri lagi`;
        }
    }

    // === CHEAT 5: AUTO-PLAY MOVE ===
    async getAutoMove(game) {
        const fen = game.getFEN();
        // Pakai depth tinggi buat auto-play
        const result = await engine.getBestMove(fen, 15);
        return result ? result.bestMove : null;
    }

    // === CHEAT 6: UNDO ===
    undoMove(game) {
        const success = game.undo();
        if (success) {
            return '⏪ Langkah dibatalkan! (2 langkah terakhir di-undo)';
        }
        return '❌ Tidak bisa undo!';
    }

    // === FORMAT DM MESSAGE ===
    formatCheatDM(type, content) {
        const headers = {
            'hint': '🧠 BISIKAN DEWA (Rahasia!)',
            'eval': '📊 EVALUASI RAHASIA',
            'nerf': '🤪 NERF AI',
            'auto': '🤖 AUTO-PLAY',
            'undo': '⏪ UNDO',
            'xray': '👁️ X-RAY VISION'
        };

        return {
            title: headers[type] || '🤫 CHEAT',
            description: content,
            footer: 'Pesan ini cuma kamu yang bisa liat 🤫'
        };
    }
}

module.exports = new CheatSystem();
