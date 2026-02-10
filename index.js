require('dotenv').config();
const {
    Client, GatewayIntentBits,
    EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder,
    AttachmentBuilder, ModalBuilder,
    TextInputBuilder, TextInputStyle
} = require('discord.js');
const http = require('http');

const ChessGame = require('./modules/chessGame');
const boardRenderer = require('./modules/boardRenderer');
const cheatSystem = require('./modules/cheatSystem');
const engine = require('./modules/chessEngine');

// === DISCORD CLIENT ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ]
});

// === STORAGE ===
const activeGames = new Map();      // gameId -> ChessGame
const playerGames = new Map();      // playerId -> gameId
const pendingChallenges = new Map(); // challengeId -> data
const playerStats = new Map();      // playerId -> stats

const OWNER_ID = process.env.OWNER_ID;
const PREFIX = '!';

// === AI LEVELS ===
const AI_LEVELS = {
    'cupu':    { depth: 4,  label: '👶 Cupu',    description: 'AI bodoh, cocok buat pemanasan' },
    'mudah':   { depth: 8,  label: '👦 Mudah',    description: 'AI lumayan, kadang blunder' },
    'sedang':  { depth: 10, label: '👨‍🎓 Sedang',  description: 'AI jago, jarang salah' },
    'susah':   { depth: 12, label: '💀 Susah',    description: 'AI master, susah dikalahkan' },
    'dewa':    { depth: 15, label: '👑 Dewa',     description: 'AI maximum, hampir mustahil menang' },
};

// === HELPER: Cari game berdasarkan player ===
function findGame(playerId) {
    const gameId = playerGames.get(playerId);
    if (!gameId) return null;
    return activeGames.get(gameId) || null;
}

// === HELPER: Akhiri game ===
function endGame(gameId) {
    const game = activeGames.get(gameId);
    if (!game) return;
    playerGames.delete(game.white.id);
    if (!game.black.id.startsWith('ai_')) {
        playerGames.delete(game.black.id);
    }
    activeGames.delete(gameId);
}

// === HELPER: Update stats ===
function updateStats(game) {
    const status = game.getStatus();
    const getStats = (id) => playerStats.get(id) || { wins: 0, losses: 0, draws: 0, games: 0 };

    if (status === 'checkmate' || status === 'white_timeout' || status === 'black_timeout') {
        let winnerId, loserId;

        if (status === 'checkmate') {
            winnerId = game.chess.turn() === 'w' ? game.black.id : game.white.id;
            loserId = game.chess.turn() === 'w' ? game.white.id : game.black.id;
        } else if (status === 'white_timeout') {
            winnerId = game.black.id;
            loserId = game.white.id;
        } else {
            winnerId = game.white.id;
            loserId = game.black.id;
        }

        if (!winnerId.startsWith('ai_')) {
            const ws = getStats(winnerId);
            ws.wins++; ws.games++;
            playerStats.set(winnerId, ws);
        }
        if (!loserId.startsWith('ai_')) {
            const ls = getStats(loserId);
            ls.losses++; ls.games++;
            playerStats.set(loserId, ls);
        }
    } else {
        // Draw
        if (!game.white.id.startsWith('ai_')) {
            const ws = getStats(game.white.id);
            ws.draws++; ws.games++;
            playerStats.set(game.white.id, ws);
        }
        if (!game.black.id.startsWith('ai_')) {
            const bs = getStats(game.black.id);
            bs.draws++; bs.games++;
            playerStats.set(game.black.id, bs);
        }
    }
}

// === HELPER: Delay ===
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// === HELPER: Random delay buat auto-play biar natural ===
function randomDelay() {
    return Math.floor(Math.random() * 5000) + 3000; // 3-8 detik
}

// === BUILD SELECT MENU: Pilih Bidak ===
function buildPieceSelectMenu(game) {
    const pieces = game.getMovablePieces();

    if (pieces.length === 0) return null;

    // Discord max 25 options per select menu
    const options = pieces.slice(0, 25).map(p => ({
        label: p.label,
        description: `${p.moveCount} langkah tersedia`,
        value: `piece_${p.square}`,
        emoji: p.emoji
    }));

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`chess_select_piece_${game.gameId}`)
        .setPlaceholder('♟️ Pilih bidak yang mau dijalankan...')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(menu);
}

// === BUILD SELECT MENU: Pilih Tujuan ===
function buildTargetSelectMenu(game, square) {
    const targets = game.getLegalTargets(square);

    if (targets.length === 0) return null;

    const options = targets.slice(0, 25).map(t => ({
        label: t.label,
        description: `${t.from.toUpperCase()} → ${t.to.toUpperCase()}`,
        value: `target_${t.from}_${t.to}${t.promotion ? '_' + t.promotion : ''}`,
        emoji: t.emoji
    }));

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`chess_select_target_${game.gameId}`)
        .setPlaceholder(`📍 Gerakkan ${square.toUpperCase()} ke mana?`)
        .addOptions(options);

    return new ActionRowBuilder().addComponents(menu);
}

// === BUILD BUTTONS ===
function buildGameButtons(game, isOwner = false) {
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`chess_resign_${game.gameId}`)
            .setLabel('Menyerah')
            .setEmoji('🏳️')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`chess_draw_${game.gameId}`)
            .setLabel('Tawarkan Seri')
            .setEmoji('🤝')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`chess_flip_${game.gameId}`)
            .setLabel('Putar Papan')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`chess_move_manual_${game.gameId}`)
            .setLabel('Ketik Manual')
            .setEmoji('⌨️')
            .setStyle(ButtonStyle.Secondary)
    );

    return buttons;
}

// === BUILD CHEAT BUTTONS (DM only) ===
function buildCheatButtons(game) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cheat_hint_${game.gameId}`)
            .setLabel('Hint')
            .setEmoji('🧠')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`cheat_eval_${game.gameId}`)
            .setLabel('Eval')
            .setEmoji('📊')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`cheat_xray_${game.gameId}`)
            .setLabel('X-Ray')
            .setEmoji('👁️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`cheat_undo_${game.gameId}`)
            .setLabel('Undo')
            .setEmoji('⏪')
            .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cheat_nerf_${game.gameId}`)
            .setLabel(game.nerfed ? 'Un-Nerf AI' : 'Nerf AI')
            .setEmoji('🤪')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`cheat_auto_${game.gameId}`)
            .setLabel(game.autoPlay ? 'Stop Auto' : 'Auto-Play')
            .setEmoji('🤖')
            .setStyle(game.autoPlay ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`cheat_autorun_${game.gameId}`)
            .setLabel('Jalankan Sekarang')
            .setEmoji('⚡')
            .setStyle(ButtonStyle.Success)
    );

    return [row1, row2];
}

// === BUILD GAME EMBED ===
async function buildGameEmbed(game, statusText = null) {
    const status = game.getStatusEmbed();
    const timer = game.getTimerDisplay();
    const flipped = !game.isWhiteTurn && !game.isAIGame;

    // Render papan
    let renderOptions = {
        lastMove: game.lastMove,
        flipped: false
    };

    // Kalau bidak sudah dipilih, tunjukkan legal moves
    if (game.selectedSquare && game.phase === 'select_target') {
        const legalMoves = game.chess.moves({ square: game.selectedSquare, verbose: true });
        renderOptions.selectedSquare = game.selectedSquare;
        renderOptions.legalMoves = legalMoves;
    }

    const boardImage = await boardRenderer.renderBoard(game.chess, renderOptions);
    const attachment = new AttachmentBuilder(boardImage, { name: 'board.png' });

    const embed = new EmbedBuilder()
        .setTitle('♟️ Catur')
        .setDescription(statusText || status.text)
        .setImage('attachment://board.png')
        .setColor(status.color)
        .addFields(
            {
                name: `⬜ Putih ${game.isWhiteTurn ? '👈' : ''}`,
                value: `${game.white.username}\n⏱️ ${timer.white}`,
                inline: true
            },
            {
                name: `⬛ Hitam ${!game.isWhiteTurn ? '👈' : ''}`,
                value: `${game.black.username}\n⏱️ ${timer.black}`,
                inline: true
            },
            {
                name: `📝 Langkah (${game.turnNumber})`,
                value: `\`${game.getLastMoves(6)}\``,
                inline: false
            }
        )
        .setFooter({ text: `Game #${game.gameId} | Pilih bidak di menu bawah` });

    return { embed, attachment };
}

// === KIRIM BOARD MESSAGE LENGKAP ===
async function sendGameMessage(channel, game, statusText = null) {
    const { embed, attachment } = await buildGameEmbed(game, statusText);

    const components = [];

    // Select menu berdasarkan phase
    if (!game.isGameOver()) {
        // Cek apakah giliran AI
        const isAITurn = game.isAIGame && !game.isWhiteTurn;

        if (!isAITurn) {
            if (game.phase === 'select_piece') {
                const pieceMenu = buildPieceSelectMenu(game);
                if (pieceMenu) components.push(pieceMenu);
            } else if (game.phase === 'select_target') {
                const targetMenu = buildTargetSelectMenu(game, game.selectedSquare);
                if (targetMenu) components.push(targetMenu);
            }
        }

        components.push(buildGameButtons(game));
    }

    const msg = await channel.send({
        embeds: [embed],
        files: [attachment],
        components
    });

    game.messageId = msg.id;
    game.channelId = channel.id;

    return msg;
}

// === UPDATE BOARD MESSAGE ===
async function updateGameMessage(channel, game, statusText = null) {
    const { embed, attachment } = await buildGameEmbed(game, statusText);

    const components = [];

    if (!game.isGameOver()) {
        const isAITurn = game.isAIGame && !game.isWhiteTurn;

        if (!isAITurn) {
            if (game.phase === 'select_piece') {
                const pieceMenu = buildPieceSelectMenu(game);
                if (pieceMenu) components.push(pieceMenu);
            } else if (game.phase === 'select_target') {
                const targetMenu = buildTargetSelectMenu(game, game.selectedSquare);
                if (targetMenu) components.push(targetMenu);
            }
        }

        components.push(buildGameButtons(game));
    }

    // Kirim pesan baru (bukan edit, karena gambar gak bisa di-edit)
    const msg = await channel.send({
        embeds: [embed],
        files: [attachment],
        components
    });

    // Hapus pesan lama
    try {
        if (game.messageId) {
            const oldMsg = await channel.messages.fetch(game.messageId);
            if (oldMsg) await oldMsg.delete();
        }
    } catch (e) { /* ignore */ }

    game.messageId = msg.id;
    return msg;
}
// === HANDLE AI MOVE ===
async function handleAIMove(channel, game) {
    // Tampilkan "AI sedang berpikir..."
    await channel.sendTyping();
    await delay(1500);

    const fen = game.getFEN();
    const result = await engine.getBestMove(fen, game.aiDepth);

    if (result && result.bestMove) {
        const moveResult = game.moveUCI(result.bestMove);

        if (moveResult) {
            let statusText = `🤖 AI: **${moveResult.san}**`;

            if (game.isGameOver()) {
                statusText += `\n${game.getStatusEmbed().text}`;
                await updateGameMessage(channel, game, statusText);
                updateStats(game);
                endGame(game.gameId);
                return;
            }

            const statusInfo = game.getStatusEmbed();
            statusText += ` | ${statusInfo.text}`;

            await updateGameMessage(channel, game, statusText);

            // Kirim cheat DM ke owner setelah AI jalan
            await sendCheatDM(game);

            // Auto-play mode
            if (game.autoPlay) {
                await handleAutoPlay(channel, game);
            }
        }
    }
}

// === HANDLE AUTO-PLAY ===
async function handleAutoPlay(channel, game) {
    if (!game.autoPlay || game.isGameOver()) return;
    if (game.currentPlayer.id !== game.white.id) return; // Cuma saat giliran owner

    await delay(randomDelay()); // Delay natural

    const fen = game.getFEN();
    const result = await engine.getBestMove(fen, 15); // Depth tinggi

    if (result && result.bestMove) {
        const moveResult = game.moveUCI(result.bestMove);

        if (moveResult) {
            let statusText = `♟️ **${moveResult.san}** | ${game.getStatusEmbed().text}`;

            if (game.isGameOver()) {
                await updateGameMessage(channel, game, statusText);
                updateStats(game);
                endGame(game.gameId);
                return;
            }

            await updateGameMessage(channel, game, statusText);

            // Giliran AI
            if (game.isAIGame) {
                await handleAIMove(channel, game);
            }
        }
    }
}

// === KIRIM CHEAT DM ===
async function sendCheatDM(game) {
    try {
        if (!cheatSystem.isOwner(game.white.id)) return;
        if (game.isGameOver()) return;

        const owner = await client.users.fetch(OWNER_ID);
        if (!owner) return;

        // Hint otomatis
        const hint = await cheatSystem.getHint(game);
        const evalData = await cheatSystem.getEvaluation(game);

        if (!hint && !evalData) return;

        const embed = new EmbedBuilder()
            .setTitle('🧠 Bisikan Dewa (Otomatis)')
            .setColor('#9B59B6')
            .setFooter({ text: `Game #${game.gameId} | Cuma kamu yang liat 🤫` });

        if (hint) {
            embed.addFields({ name: '💡 Top Langkah', value: hint, inline: false });
        }
        if (evalData) {
            embed.addFields({ name: '📊 Evaluasi', value: evalData.text, inline: false });
        }

        const cheatButtons = buildCheatButtons(game);

        await owner.send({ embeds: [embed], components: cheatButtons });
    } catch (e) {
        // DM mungkin gagal, ignore
    }
}

// === EVENT: READY ===
client.on('ready', () => {
    console.log('═══════════════════════════════════════');
    console.log(`♟️ ${client.user.tag} is online!`);
    console.log(`🎮 Chess Bot Ready!`);
    console.log(`👑 Owner: ${OWNER_ID}`);
    console.log('═══════════════════════════════════════');
});

// === EVENT: MESSAGE ===
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ========================
    // !chess - Menu Utama
    // ========================
    if (command === 'chess') {
        const sub = args[0]?.toLowerCase();

        // --- !chess (tanpa argumen) = Help ---
        if (!sub) {
            const embed = new EmbedBuilder()
                .setTitle('♟️ Bot Catur')
                .setColor('#FFD700')
                .setDescription('Mainkan catur langsung di Discord!')
                .addFields(
                    { name: '🎮 Mulai Game', value: [
                        '`!chess play @user` - Lawan teman',
                        '`!chess ai [level]` - Lawan AI'
                    ].join('\n')},
                    { name: '🤖 AI Level', value: Object.entries(AI_LEVELS).map(
                        ([key, val]) => `\`${key}\` - ${val.label} (Depth ${val.depth})`
                    ).join('\n')},
                    { name: '⌨️ Perintah Lain', value: [
                        '`!chess resign` - Menyerah',
                        '`!chess stats [@user]` - Statistik',
                        '`!move [dari][ke]` - Langkah manual'
                    ].join('\n')},
                    { name: '📋 Cara Main', value: 'Pilih bidak di **dropdown menu**, lalu pilih tujuannya!' }
                )
                .setFooter({ text: 'Atau klik tombol di bawah papan catur' });

            return message.reply({ embeds: [embed] });
        }

        // --- !chess play @user ---
        if (sub === 'play') {
            const opponent = message.mentions.users.first();
            if (!opponent) return message.reply('❌ Tag lawan! `!chess play @user`');
            if (opponent.bot) return message.reply('❌ Gak bisa lawan bot Discord! Pakai `!chess ai`');
            if (opponent.id === message.author.id) return message.reply('❌ Main lawan diri sendiri? 😂');

            if (playerGames.has(message.author.id)) return message.reply('❌ Kamu masih dalam game!');
            if (playerGames.has(opponent.id)) return message.reply('❌ Lawan masih dalam game!');

            const challengeId = `${message.author.id}_${opponent.id}`;
            pendingChallenges.set(challengeId, {
                challenger: message.author,
                opponent: opponent,
                channel: message.channel,
                time: Date.now()
            });

            const embed = new EmbedBuilder()
                .setTitle('♟️ Tantangan Catur!')
                .setDescription(`${message.author} menantang ${opponent}!`)
                .setColor('#FFD700')
                .addFields(
                    { name: '⬜ Putih', value: `${message.author}`, inline: true },
                    { name: '⬛ Hitam', value: `${opponent}`, inline: true }
                )
                .setFooter({ text: 'Tantangan expired dalam 60 detik' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`chess_accept_${challengeId}`)
                    .setLabel('Terima')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`chess_decline_${challengeId}`)
                    .setLabel('Tolak')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger)
            );

            await message.reply({ embeds: [embed], components: [row] });

            // Auto expire 60 detik
            setTimeout(() => {
                if (pendingChallenges.has(challengeId)) {
                    pendingChallenges.delete(challengeId);
                }
            }, 60000);
        }

        // --- !chess ai [level] ---
        else if (sub === 'ai') {
            const levelKey = args[1]?.toLowerCase() || 'sedang';
            const level = AI_LEVELS[levelKey];

            if (!level) {
                const validLevels = Object.keys(AI_LEVELS).join(', ');
                return message.reply(`❌ Level tidak valid! Pilihan: \`${validLevels}\``);
            }

            if (playerGames.has(message.author.id)) {
                return message.reply('❌ Kamu masih dalam game!');
            }

            const aiUser = {
                id: `ai_${levelKey}`,
                username: `AI ${level.label}`,
                displayAvatarURL: () => client.user.displayAvatarURL()
            };

            const game = new ChessGame(message.author, aiUser, {
                isAI: true,
                aiLevel: levelKey,
                aiDepth: level.depth
            });

            activeGames.set(game.gameId, game);
            playerGames.set(message.author.id, game.gameId);

            engine.newGame();

            await sendGameMessage(message.channel, game,
                `🎮 Game dimulai! Kamu vs ${level.label}\n♟️ Pilih bidak di menu bawah!`
            );

            // Kirim cheat panel ke DM owner
            if (cheatSystem.isOwner(message.author.id)) {
                await sendCheatDM(game);
            }
        }

        // --- !chess resign ---
        else if (sub === 'resign') {
            const game = findGame(message.author.id);
            if (!game) return message.reply('❌ Kamu tidak dalam game!');

            const result = game.resign(message.author.id);

            await updateGameMessage(message.channel, game, result);
            updateStats(game);
            endGame(game.gameId);
        }

        // --- !chess stats ---
        else if (sub === 'stats') {
            const target = message.mentions.users.first() || message.author;
            const stats = playerStats.get(target.id) || { wins: 0, losses: 0, draws: 0, games: 0 };
            const winRate = stats.games > 0 ? ((stats.wins / stats.games) * 100).toFixed(1) : '0';

            const embed = new EmbedBuilder()
                .setTitle(`📊 Statistik ${target.username}`)
                .setThumbnail(target.displayAvatarURL())
                .setColor('#00D4FF')
                .addFields(
                    { name: '🏆 Menang', value: `${stats.wins}`, inline: true },
                    { name: '💀 Kalah', value: `${stats.losses}`, inline: true },
                    { name: '🤝 Seri', value: `${stats.draws}`, inline: true },
                    { name: '📈 Win Rate', value: `${winRate}%`, inline: true },
                    { name: '🎮 Total', value: `${stats.games}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
        }
    }

    // ========================
    // !move [dari][ke] - Manual Move
    // ========================
    if (command === 'move') {
        const game = findGame(message.author.id);
        if (!game) return message.reply('❌ Kamu tidak dalam game!');
        if (game.currentPlayer.id !== message.author.id) return message.reply('❌ Bukan giliran kamu!');

        const input = args[0];
        if (!input) return message.reply('❌ Format: `!move e2e4`');

        let result = null;

        // Format UCI: e2e4
        if (input.length >= 4) {
            result = game.moveUCI(input);
        }
        // Format SAN: Nf3
        if (!result) {
            result = game.moveSAN(input);
        }

        if (!result) {
            return message.reply('❌ Langkah tidak valid!');
        }

        // Hapus pesan command
        try { await message.delete(); } catch (e) { /* ignore */ }

        let statusText = `♟️ **${result.san}**`;

        if (game.isGameOver()) {
            statusText += `\n${game.getStatusEmbed().text}`;
            await updateGameMessage(message.channel, game, statusText);
            updateStats(game);
            endGame(game.gameId);
            return;
        }

        statusText += ` | ${game.getStatusEmbed().text}`;
        await updateGameMessage(message.channel, game, statusText);

        // AI move
        if (game.isAIGame && !game.isGameOver()) {
            await handleAIMove(message.channel, game);
        }
    }
});

// === EVENT: INTERACTION ===
client.on('interactionCreate', async (interaction) => {

    // ============================
    // SELECT MENU HANDLER
    // ============================
    if (interaction.isStringSelectMenu()) {
        const customId = interaction.customId;

        // --- Pilih Bidak (Phase 1) ---
        if (customId.startsWith('chess_select_piece_')) {
            const gameId = customId.replace('chess_select_piece_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });
            if (game.currentPlayer.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
            }

            const value = interaction.values[0]; // piece_e2
            const square = value.replace('piece_', '');

            const legalMoves = game.selectPiece(square);
            if (!legalMoves) {
                return interaction.reply({ content: '❌ Bidak ini tidak bisa digerakkan!', ephemeral: true });
            }

            // Update pesan dengan highlight dan target menu
            await interaction.deferUpdate();
            const channel = interaction.channel;
            await updateGameMessage(channel, game,
                `♟️ Bidak **${square.toUpperCase()}** dipilih! Pilih tujuan di menu bawah 👇`
            );
        }

        // --- Pilih Tujuan (Phase 2) ---
        else if (customId.startsWith('chess_select_target_')) {
            const gameId = customId.replace('chess_select_target_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });
            if (game.currentPlayer.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
            }

            const value = interaction.values[0]; // target_e2_e4 atau target_e7_e8_q
            const parts = value.replace('target_', '').split('_');
            const from = parts[0];
            const to = parts[1];
            const promotion = parts[2] || undefined;

            const result = game.move(from, to, promotion);
            if (!result) {
                return interaction.reply({ content: '❌ Langkah tidak valid!', ephemeral: true });
            }

            await interaction.deferUpdate();
            const channel = interaction.channel;

            let statusText = `♟️ **${result.san}**`;

            // Cek game over
            if (game.isGameOver()) {
                statusText += `\n${game.getStatusEmbed().text}`;
                await updateGameMessage(channel, game, statusText);
                updateStats(game);
                endGame(game.gameId);
                return;
            }

            statusText += ` | ${game.getStatusEmbed().text}`;
            await updateGameMessage(channel, game, statusText);

            // AI move
            if (game.isAIGame && !game.isGameOver()) {
                await handleAIMove(channel, game);
            }
        }
    }

    // ============================
    // BUTTON HANDLER
    // ============================
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // --- Accept Challenge ---
        if (customId.startsWith('chess_accept_')) {
            const challengeId = customId.replace('chess_accept_', '');
            const challengeData = pendingChallenges.get(challengeId);

            if (!challengeData) {
                return interaction.reply({ content: '❌ Tantangan expired!', ephemeral: true });
            }
            if (interaction.user.id !== challengeData.opponent.id) {
                return interaction.reply({ content: '❌ Bukan tantangan untuk kamu!', ephemeral: true });
            }

            const game = new ChessGame(challengeData.challenger, challengeData.opponent);
            activeGames.set(game.gameId, game);
            playerGames.set(challengeData.challenger.id, game.gameId);
            playerGames.set(challengeData.opponent.id, game.gameId);
            pendingChallenges.delete(challengeId);

            await interaction.update({ content: '✅ Tantangan diterima!', embeds: [], components: [] });
            await sendGameMessage(challengeData.channel, game, '🎮 Game dimulai! ⬜ Putih jalan duluan!');
        }

        // --- Decline Challenge ---
        else if (customId.startsWith('chess_decline_')) {
            const challengeId = customId.replace('chess_decline_', '');
            const challengeData = pendingChallenges.get(challengeId);

            if (!challengeData) {
                return interaction.reply({ content: '❌ Tantangan expired!', ephemeral: true });
            }
            if (interaction.user.id !== challengeData.opponent.id) {
                return interaction.reply({ content: '❌ Bukan tantangan untuk kamu!', ephemeral: true });
            }

            pendingChallenges.delete(challengeId);
            await interaction.update({ content: '❌ Tantangan ditolak!', embeds: [], components: [] });
        }

        // --- Resign ---
        else if (customId.startsWith('chess_resign_')) {
            const gameId = customId.replace('chess_resign_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });

            const isPlayer = interaction.user.id === game.white.id || interaction.user.id === game.black.id;
            if (!isPlayer) return interaction.reply({ content: '❌ Kamu bukan pemain!', ephemeral: true });

            const result = game.resign(interaction.user.id);

            await interaction.deferUpdate();
            await updateGameMessage(interaction.channel, game, result);
            updateStats(game);
            endGame(gameId);
        }

        // --- Draw ---
        else if (customId.startsWith('chess_draw_')) {
            const gameId = customId.replace('chess_draw_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });

            if (game.isAIGame) {
                return interaction.reply({ content: '🤖 AI tidak menerima tawaran seri!', ephemeral: true });
            }

            await interaction.reply({ content: '🤝 Tawaran seri! (fitur coming soon)', ephemeral: true });
        }

        // --- Flip Board ---
        else if (customId.startsWith('chess_flip_')) {
            const gameId = customId.replace('chess_flip_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });

            await interaction.deferUpdate();
            await updateGameMessage(interaction.channel, game);
        }

        // --- Manual Move (Modal) ---
        else if (customId.startsWith('chess_move_manual_')) {
            const gameId = customId.replace('chess_move_manual_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });
            if (game.currentPlayer.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId(`chess_modal_move_${gameId}`)
                .setTitle('♟️ Masukkan Langkah');

            const moveInput = new TextInputBuilder()
                .setCustomId('move_input')
                .setLabel('Langkah (contoh: e2e4 atau Nf3)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e2e4')
                .setRequired(true)
                .setMaxLength(10);

            const row = new ActionRowBuilder().addComponents(moveInput);
            modal.addComponents(row);

            await interaction.showModal(modal);
        }

        // ==========================
        // CHEAT BUTTONS (dari DM)
        // ==========================

        // --- Cheat: Hint ---
        else if (customId.startsWith('cheat_hint_')) {
            const gameId = customId.replace('cheat_hint_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const hint = await cheatSystem.getHint(game);
            await interaction.editReply({ content: hint || '❌ Gagal analisis' });
        }

        // --- Cheat: Eval ---
        else if (customId.startsWith('cheat_eval_')) {
            const gameId = customId.replace('cheat_eval_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const evalData = await cheatSystem.getEvaluation(game);
            await interaction.editReply({ content: evalData?.text || '❌ Gagal analisis' });
        }

        // --- Cheat: X-Ray ---
        else if (customId.startsWith('cheat_xray_')) {
            const gameId = customId.replace('cheat_xray_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const xrayImage = await boardRenderer.renderXRay(game.chess, { lastMove: game.lastMove });
            const attachment = new AttachmentBuilder(xrayImage, { name: 'xray.png' });
            await interaction.editReply({ content: '👁️ X-Ray Vision:', files: [attachment] });
        }

        // --- Cheat: Undo ---
        else if (customId.startsWith('cheat_undo_')) {
            const gameId = customId.replace('cheat_undo_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            const result = cheatSystem.undoMove(game);
            await interaction.reply({ content: result, ephemeral: true });

            // Update board di channel
            try {
                const channel = await client.channels.fetch(game.channelId);
                if (channel) await updateGameMessage(channel, game, '♟️ Giliran kamu!');
            } catch (e) { /* ignore */ }
        }

        // --- Cheat: Nerf AI ---
        else if (customId.startsWith('cheat_nerf_')) {
            const gameId = customId.replace('cheat_nerf_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            const result = cheatSystem.nerfAI(game);
            await interaction.reply({ content: result, ephemeral: true });
        }

        // --- Cheat: Toggle Auto-Play ---
        else if (customId.startsWith('cheat_auto_')) {
            const gameId = customId.replace('cheat_auto_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            const result = cheatSystem.toggleAutoPlay(game);
            await interaction.reply({ content: result, ephemeral: true });

            // Langsung jalankan kalau baru diaktifkan dan giliran owner
            if (game.autoPlay && game.currentPlayer.id === game.white.id) {
                try {
                    const channel = await client.channels.fetch(game.channelId);
                    if (channel) await handleAutoPlay(channel, game);
                } catch (e) { /* ignore */ }
            }
        }

        // --- Cheat: Run Auto Move Now ---
        else if (customId.startsWith('cheat_autorun_')) {
            const gameId = customId.replace('cheat_autorun_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game sudah selesai!', ephemeral: true });
            if (!cheatSystem.isOwner(interaction.user.id)) return interaction.reply({ content: '❌', ephemeral: true });

            if (game.currentPlayer.id !== game.white.id) {
                return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
            }

            await interaction.reply({ content: '⚡ Menjalankan langkah terbaik...', ephemeral: true });

            const fen = game.getFEN();
            const result = await engine.getBestMove(fen, 15);

            if (result && result.bestMove) {
                const moveResult = game.moveUCI(result.bestMove);

                if (moveResult) {
                    try {
                        const channel = await client.channels.fetch(game.channelId);
                        let statusText = `♟️ **${moveResult.san}** | ${game.getStatusEmbed().text}`;

                        if (game.isGameOver()) {
                            await updateGameMessage(channel, game, statusText);
                            updateStats(game);
                            endGame(gameId);
                            return;
                        }

                        await updateGameMessage(channel, game, statusText);

                        if (game.isAIGame) {
                            await handleAIMove(channel, game);
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        }
    }

    // ============================
    // MODAL HANDLER (Manual Move)
    // ============================
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('chess_modal_move_')) {
            const gameId = interaction.customId.replace('chess_modal_move_', '');
            const game = activeGames.get(gameId);

            if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan!', ephemeral: true });
            if (game.currentPlayer.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
            }

            const input = interaction.fields.getTextInputValue('move_input').trim();
            let result = null;

            if (input.length >= 4) result = game.moveUCI(input);
            if (!result) result = game.moveSAN(input);

            if (!result) {
                return interaction.reply({ content: '❌ Langkah tidak valid!', ephemeral: true });
            }

            await interaction.deferUpdate();

            let statusText = `♟️ **${result.san}** | ${game.getStatusEmbed().text}`;

            if (game.isGameOver()) {
                await updateGameMessage(interaction.channel, game, statusText);
                updateStats(game);
                endGame(gameId);
                return;
            }

            await updateGameMessage(interaction.channel, game, statusText);

            if (game.isAIGame && !game.isGameOver()) {
                await handleAIMove(interaction.channel, game);
            }
        }
    }
});

// === WEB SERVER (Render butuh ini biar gak mati) ===
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <html>
        <body style="background:#1a1a2e;color:white;font-family:Arial;text-align:center;padding:50px;">
            <h1>♟️ Discord Chess Bot</h1>
            <p>Bot is running!</p>
            <p>Active games: ${activeGames.size}</p>
            <p>Players online: ${playerGames.size}</p>
        </body>
        </html>
    `);
});

server.listen(10000, () => {
    console.log('🌐 Web server running on port 10000');
});

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN);
